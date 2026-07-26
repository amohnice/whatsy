import { useCallback, useEffect, useRef, useState } from 'react';
import { getSimulationMessages, sendInbound, simulateBuyerReply } from './api.js';

const DRIP_GAP_MS = 2600; // slow trickle so the inbox is never empty or static
const RUSH_MIN_MS = 300; // spec'd burst window
const RUSH_MAX_MS = 500;

// Auto-reply engine. Each buyer turn costs three Claude calls, so it is paced
// and capped rather than replying to everything the instant it can.
const AUTO_TICK_MS = 4000;
const AUTO_MAX_CONCURRENT = 2;
const AUTO_MAX_BUYER_TURNS = 4; // mirrors MAX_BUYER_TURNS on the server

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const rushGap = () => RUSH_MIN_MS + Math.random() * (RUSH_MAX_MS - RUSH_MIN_MS);

/**
 * Drives the simulated DM feed.
 *
 * Every message is POSTed to /api/messages/inbound individually, so the real
 * pipeline (reply + classification + hot summary) runs per message and the UI
 * observes each result landing. Sends are deliberately NOT awaited during the
 * rush — the point is overlapping in-flight requests with badges resolving out
 * of order, the way a real burst of DMs would behave.
 */
export function useSimulation({ ready, inboxEmpty, conversations, onActivity }) {
  const [seed, setSeed] = useState([]);
  const [inFlight, setInFlight] = useState(0);
  const [rushRunning, setRushRunning] = useState(false);
  const [autoReply, setAutoReply] = useState(true);
  const [simError, setSimError] = useState(null);

  const hasDripped = useRef(false);
  const extraCursor = useRef(0);
  const autoInFlight = useRef(new Set());

  // Read the latest list inside the interval without restarting it on every poll.
  const convRef = useRef([]);
  convRef.current = conversations ?? [];

  useEffect(() => {
    getSimulationMessages().then(setSeed).catch((e) => setSimError(e.message));
  }, []);

  const fire = useCallback(
    async (msg) => {
      setInFlight((n) => n + 1);
      try {
        await sendInbound({
          buyerHandle: msg.buyerHandle,
          buyerName: msg.buyerName,
          text: msg.text,
        });
        onActivity?.();
      } catch (err) {
        setSimError(err.message);
      } finally {
        setInFlight((n) => n - 1);
      }
    },
    [onActivity],
  );

  // Auto-drip on load — only into an empty inbox. Re-dripping on top of an
  // existing thread list would just add noise, not solve the empty-inbox problem.
  useEffect(() => {
    if (!ready || hasDripped.current || seed.length === 0 || !inboxEmpty) return;
    hasDripped.current = true;

    let cancelled = false;
    (async () => {
      for (const msg of seed.filter((m) => m.group === 'drip')) {
        if (cancelled) return;
        fire(msg);
        await sleep(DRIP_GAP_MS);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [ready, inboxEmpty, seed, fire]);

  const runRush = useCallback(async () => {
    const batch = seed.filter((m) => m.group === 'rush');
    if (batch.length === 0) return;
    setRushRunning(true);
    setSimError(null);
    for (const msg of batch) {
      fire(msg); // not awaited — requests overlap, as a real rush would
      await sleep(rushGap());
    }
    setRushRunning(false);
  }, [seed, fire]);

  const sendOneMore = useCallback(() => {
    const pool = seed.filter((m) => m.group === 'extra');
    if (pool.length === 0) return;
    const msg = pool[extraCursor.current % pool.length];
    extraCursor.current += 1;
    fire(msg);
  }, [seed, fire]);

  const resetDrip = useCallback(() => {
    hasDripped.current = false;
    autoInFlight.current.clear();
  }, []);

  // Auto-reply engine: buyers answer the shop instead of going silent after one
  // message. Eligibility is judged from the conversation list; the server
  // re-checks and is the real authority (it also owns simDone and the turn cap).
  useEffect(() => {
    if (!autoReply) return undefined;

    const tick = async () => {
      // Stay out of the way of the rush so the two don't stampede together.
      if (rushRunning) return;

      const eligible = convRef.current.filter(
        (c) =>
          !c.simDone &&
          !c.hasPendingDraft && // buyer waits while James holds a draft
          c.lastSender && // conversation has started
          c.lastSender !== 'buyer' && // shop replied last, so it's their turn
          (c.buyerTurns ?? 0) < AUTO_MAX_BUYER_TURNS &&
          !autoInFlight.current.has(c.id),
      );
      if (eligible.length === 0) return;

      const slots = AUTO_MAX_CONCURRENT - autoInFlight.current.size;
      if (slots <= 0) return;

      // Pick at random so the same few threads don't monopolise the engine.
      const picks = eligible.sort(() => Math.random() - 0.5).slice(0, slots);

      for (const c of picks) {
        autoInFlight.current.add(c.id);
        setInFlight((n) => n + 1);
        simulateBuyerReply(c.id)
          .then(() => onActivity?.())
          .catch((err) => setSimError(err.message))
          .finally(() => {
            autoInFlight.current.delete(c.id);
            setInFlight((n) => n - 1);
          });
      }
    };

    const timer = setInterval(tick, AUTO_TICK_MS);
    return () => clearInterval(timer);
  }, [autoReply, rushRunning, onActivity]);

  return {
    inFlight,
    rushRunning,
    autoReply,
    setAutoReply,
    simError,
    runRush,
    sendOneMore,
    resetDrip,
  };
}
