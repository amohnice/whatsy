import { useCallback, useEffect, useRef, useState } from 'react';
import ConversationList from './components/ConversationList.jsx';
import Thread from './components/Thread.jsx';
import SimulationControls from './components/SimulationControls.jsx';
import Dashboard from './components/Dashboard.jsx';
import { useSimulation } from './useSimulation.js';
import {
  createPaymentLink,
  editDraft,
  getConversation,
  getConversations,
  getFunnel,
  getHealth,
  resetInbox,
  sendDraft,
} from './api.js';

const POLL_MS = 1500;

export default function App() {
  const [tab, setTab] = useState('inbox');
  const [health, setHealth] = useState(null);
  const [conversations, setConversations] = useState([]);
  const [activeId, setActiveId] = useState(null);
  const [thread, setThread] = useState({ conversation: null, messages: [] });
  const [error, setError] = useState(null);
  const [loaded, setLoaded] = useState(false);

  // Keep the id in a ref so the polling loop always reads the latest selection
  // without being torn down and rebuilt on every click.
  const activeIdRef = useRef(null);
  activeIdRef.current = activeId;

  const refresh = useCallback(async () => {
    try {
      const list = await getConversations();
      setConversations(list);
      const id = activeIdRef.current;
      if (id) {
        const detail = await getConversation(id);
        setThread(detail);
      }
      setError(null);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoaded(true);
    }
  }, []);

  const simulation = useSimulation({
    ready: loaded,
    inboxEmpty: loaded && conversations.length === 0,
    onActivity: refresh,
  });

  const handleReset = useCallback(async () => {
    await resetInbox();
    setActiveId(null);
    setThread({ conversation: null, messages: [] });
    setConversations([]);
    simulation.resetDrip(); // let the drip re-run so the demo is repeatable
    refresh();
  }, [refresh, simulation]);

  useEffect(() => {
    getHealth().then(setHealth).catch(() => setHealth(null));
  }, []);

  useEffect(() => {
    refresh();
    const timer = setInterval(refresh, POLL_MS);
    return () => clearInterval(timer);
  }, [refresh]);

  const selectConversation = useCallback(async (id) => {
    setActiveId(id);
    setThread({ conversation: null, messages: [] });
    try {
      setThread(await getConversation(id));
    } catch (err) {
      setError(err.message);
    }
  }, []);

  const [acting, setActing] = useState(false);
  const [funnel, setFunnel] = useState(null);
  const [funnelLoading, setFunnelLoading] = useState(false);

  // The funnel is only fetched while the Dashboard is visible — the insight is a
  // real Claude call, and there is no reason to keep it warm behind the Inbox.
  const loadFunnel = useCallback(async ({ refresh = false } = {}) => {
    setFunnelLoading(true);
    try {
      setFunnel(await getFunnel({ refresh }));
      setError(null);
    } catch (err) {
      setError(err.message);
    } finally {
      setFunnelLoading(false);
    }
  }, []);

  useEffect(() => {
    if (tab !== 'dashboard') return;
    loadFunnel();
    const timer = setInterval(loadFunnel, 4000);
    return () => clearInterval(timer);
  }, [tab, loadFunnel]);

  const openConversation = useCallback((id) => {
    setTab('inbox');
    setActiveId(id);
    getConversation(id).then(setThread).catch((err) => setError(err.message));
  }, []);

  // Draft/payment actions all mutate the thread, so they share one guard and
  // one refresh to keep the list badges and draft dots in sync.
  const act = useCallback(
    async (fn) => {
      setActing(true);
      try {
        await fn();
        setError(null);
      } catch (err) {
        setError(err.message);
      } finally {
        setActing(false);
        refresh();
      }
    },
    [refresh],
  );

  const handleSendDraft = useCallback(
    (conversationId, messageId, text) => act(() => sendDraft(conversationId, { messageId, text })),
    [act],
  );

  const handleEditDraft = useCallback(
    (conversationId, messageId, text) => act(() => editDraft(conversationId, { messageId, text })),
    [act],
  );

  const handlePaymentLink = useCallback(
    (conversationId) => act(() => createPaymentLink(conversationId)),
    [act],
  );

  const pendingDrafts = conversations.filter((c) => c.hasPendingDraft).length;

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          WHAT<span>S</span>Y
        </div>
        <nav className="tabs">
          <button
            className={`tab${tab === 'inbox' ? ' is-active' : ''}`}
            onClick={() => setTab('inbox')}
          >
            Inbox
          </button>
          <button
            className={`tab${tab === 'dashboard' ? ' is-active' : ''}`}
            onClick={() => setTab('dashboard')}
          >
            Dashboard
          </button>
        </nav>
        <div className="topbar-right">
          {pendingDrafts > 0 && (
            <span className="chip is-bad">
              {pendingDrafts} draft{pendingDrafts === 1 ? '' : 's'} to approve
            </span>
          )}
          {health && (
            <>
              <span className="chip">store: {health.store}</span>
              <span className={`chip${health.claude === 'configured' ? '' : ' is-bad'}`}>
                {health.model}
              </span>
            </>
          )}
        </div>
      </header>

      <div className="sim-banner">
        <strong>Simulated inbox</strong>
        <span>
          — standing in for Instagram/WhatsApp DMs. No Meta or M-Pesa integration; messages are
          generated locally. The AI replies are real Claude API calls.
        </span>
      </div>

      <SimulationControls
        inFlight={simulation.inFlight}
        rushRunning={simulation.rushRunning}
        onRush={simulation.runRush}
        onOneMore={simulation.sendOneMore}
        onReset={handleReset}
      />

      {(error || simulation.simError) && (
        <div className="error-bar">Backend error: {error || simulation.simError}</div>
      )}

      {tab === 'inbox' ? (
        <div className="inbox">
          <section className="pane pane-list">
            <div className="pane-head">
              <h2>Conversations</h2>
              <span className="count">{conversations.length}</span>
            </div>
            <div className="scroll">
              <ConversationList
                conversations={conversations}
                activeId={activeId}
                onSelect={selectConversation}
              />
            </div>
          </section>

          <section className="pane pane-thread">
            <Thread
              conversation={thread.conversation}
              messages={thread.messages}
              onSendDraft={handleSendDraft}
              onEditDraft={handleEditDraft}
              onPaymentLink={handlePaymentLink}
              busy={acting}
            />
          </section>
        </div>
      ) : (
        <div className="scroll">
          <Dashboard
            funnel={funnel}
            loading={funnelLoading}
            onRefreshInsight={() => loadFunnel({ refresh: true })}
            onOpenConversation={openConversation}
          />
        </div>
      )}
    </div>
  );
}
