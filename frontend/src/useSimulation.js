import { useCallback, useEffect, useRef, useState } from 'react';
import { getSimulationMessages, sendInbound } from './api.js';

const DRIP_GAP_MS = 2600; // slow trickle so the inbox is never empty or static
const RUSH_MIN_MS = 300; // spec'd burst window
const RUSH_MAX_MS = 500;

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
export function useSimulation({ ready, inboxEmpty, onActivity }) {
  const [seed, setSeed] = useState([]);
  const [inFlight, setInFlight] = useState(0);
  const [rushRunning, setRushRunning] = useState(false);
  const [simError, setSimError] = useState(null);

  const hasDripped = useRef(false);
  const extraCursor = useRef(0);

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
  }, []);

  return { inFlight, rushRunning, simError, runRush, sendOneMore, resetDrip };
}
