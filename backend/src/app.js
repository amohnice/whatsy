import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { randomBytes, randomUUID } from 'node:crypto';
import { initStore, store, getBackend } from './store.js';
import { claudeConfigured } from './claude.js';
import { handleInbound } from './pipeline.js';
import { INBOUND_SEED } from './seed/inbound.js';
import { computeFunnel, getFunnelInsight, clearInsightCache } from './funnel.js';

// Identifies this process. On Vercel each serverless instance loads the module
// fresh, so a changing instanceId in /api/health is the visible signal that you
// have been routed to a different instance — which, with the in-memory store,
// means a different (probably empty) inbox.
const INSTANCE_ID = randomUUID().slice(0, 8);
const BOOTED_AT = new Date().toISOString();

export const app = express();

// Same-origin in local dev (Vite proxy). In production the frontend is a
// separate Vercel project on its own domain, so its origin must be allowed
// explicitly via CORS_ORIGIN (comma-separated). Unset = allow all, which is
// fine locally but should be set in production.
const allowedOrigins = (process.env.CORS_ORIGIN || '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

app.use(
  cors({
    origin:
      allowedOrigins.length === 0
        ? true
        : (origin, cb) => {
            // No Origin header = curl / same-origin / server-to-server.
            if (!origin || allowedOrigins.includes(origin)) return cb(null, true);
            cb(new Error(`origin ${origin} not allowed by CORS_ORIGIN`));
          },
  }),
);
app.use(express.json());

// Vercel serverless: the store must be initialised before the first request,
// but there is no startup hook. Memoise the promise so a cold start initialises
// once and every later request on that instance reuses it.
let storeReady = null;
app.use(async (_req, _res, next) => {
  try {
    if (!storeReady) storeReady = initStore();
    await storeReady;
    next();
  } catch (err) {
    storeReady = null; // let the next request retry rather than wedging
    next(err);
  }
});

app.get('/api/health', async (_req, res) => {
  res.json({
    ok: true,
    store: getBackend(),
    // With the in-memory store nothing survives a cold start or a second
    // instance. The client surfaces this so the behaviour isn't mysterious.
    ephemeral: getBackend() === 'memory',
    instanceId: INSTANCE_ID,
    bootedAt: BOOTED_AT,
    claude: claudeConfigured() ? 'configured' : 'missing ANTHROPIC_API_KEY',
    model: process.env.ANTHROPIC_MODEL || 'claude-opus-5',
  });
});

app.get('/api/catalog', async (_req, res) => {
  res.json(await store.listCatalog());
});

// The list view needs a preview line and a draft indicator per row, so the
// list is enriched here rather than making the client fetch every thread.
app.get('/api/conversations', async (_req, res) => {
  const conversations = await store.listConversations();
  const enriched = await Promise.all(
    conversations.map(async (c) => {
      const messages = await store.listMessages(c.id);
      const last = messages[messages.length - 1];
      return {
        ...c,
        messageCount: messages.length,
        lastMessage: last ? `${last.sender === 'buyer' ? '' : '↩ '}${last.text}` : null,
        hasPendingDraft: messages.some((m) => m.isDraft),
      };
    }),
  );
  res.json(enriched);
});

app.get('/api/conversations/:id', async (req, res) => {
  const conversation = await store.getConversation(req.params.id);
  if (!conversation) return res.status(404).json({ error: 'conversation not found' });
  const messages = await store.listMessages(conversation.id);
  res.json({ conversation, messages });
});

// Inbound buyer DM (simulated). Runs the real Claude pipeline.
app.post('/api/messages/inbound', async (req, res, next) => {
  try {
    const { conversationId, buyerHandle, buyerName, text } = req.body ?? {};
    if (!text || typeof text !== 'string' || !text.trim()) {
      return res.status(400).json({ error: 'text is required' });
    }
    if (!conversationId && !buyerHandle) {
      return res.status(400).json({ error: 'conversationId or buyerHandle is required' });
    }
    if (!claudeConfigured()) {
      return res
        .status(503)
        .json({ error: 'ANTHROPIC_API_KEY is not set — the AI pipeline cannot run' });
    }
    const result = await handleInbound({ conversationId, buyerHandle, buyerName, text: text.trim() });
    res.status(201).json(result);
  } catch (err) {
    next(err);
  }
});

// James types a reply himself, bypassing the AI. No Claude call — but the
// message joins the thread, so later drafts and classifications see it.
app.post('/api/conversations/:id/reply', async (req, res, next) => {
  try {
    const conversation = await store.getConversation(req.params.id);
    if (!conversation) return res.status(404).json({ error: 'conversation not found' });

    const { text } = req.body ?? {};
    if (!text || typeof text !== 'string' || !text.trim()) {
      return res.status(400).json({ error: 'text is required' });
    }

    const message = await store.createMessage({
      conversationId: conversation.id,
      sender: 'james',
      text: text.trim(),
    });
    const updated = await store.updateConversation(conversation.id, {});
    res.status(201).json({ conversation: updated, message });
  } catch (err) {
    next(err);
  }
});

/** Resolves which draft an action targets: an explicit id, else the newest. */
async function resolveDraft(conversationId, messageId) {
  if (messageId) {
    const messages = await store.listMessages(conversationId);
    const found = messages.find((m) => m.id === messageId);
    if (!found) return { error: 'draft not found in this conversation', status: 404 };
    if (!found.isDraft) return { error: 'that message is not a pending draft', status: 409 };
    return { draft: found };
  }
  const draft = await store.findPendingDraft(conversationId);
  if (!draft) return { error: 'no pending draft on this conversation', status: 404 };
  return { draft };
}

// Edit a pending draft's text WITHOUT sending it. Stays a draft.
app.patch('/api/conversations/:id/send-draft', async (req, res, next) => {
  try {
    const conversation = await store.getConversation(req.params.id);
    if (!conversation) return res.status(404).json({ error: 'conversation not found' });

    const { messageId, text } = req.body ?? {};
    if (!text || typeof text !== 'string' || !text.trim()) {
      return res.status(400).json({ error: 'text is required' });
    }
    const { draft, error, status } = await resolveDraft(conversation.id, messageId);
    if (error) return res.status(status).json({ error });

    const updated = await store.updateMessage(draft.id, { text: text.trim() });
    res.json({ conversation, message: updated });
  } catch (err) {
    next(err);
  }
});

// James approves the draft — flip isDraft to false so it counts as sent.
// An optional `text` lets the client edit and send in one tap.
app.post('/api/conversations/:id/send-draft', async (req, res, next) => {
  try {
    const conversation = await store.getConversation(req.params.id);
    if (!conversation) return res.status(404).json({ error: 'conversation not found' });

    const { messageId, text } = req.body ?? {};
    const { draft, error, status } = await resolveDraft(conversation.id, messageId);
    if (error) return res.status(status).json({ error });

    const patch = { isDraft: false };
    if (typeof text === 'string' && text.trim()) patch.text = text.trim();
    const sent = await store.updateMessage(draft.id, patch);

    res.json({ conversation, message: sent });
  } catch (err) {
    next(err);
  }
});

// MOCK payment link. No M-Pesa, no payment processor, no real money — this
// generates a fake URL and posts it into the thread as a message.
app.post('/api/conversations/:id/payment-link', async (req, res, next) => {
  try {
    const conversation = await store.getConversation(req.params.id);
    if (!conversation) return res.status(404).json({ error: 'conversation not found' });

    const shortId = randomBytes(4).toString('hex');
    const url = `https://pay.mock/replyrescue/${shortId}`;
    const item = conversation.item ? ` for the ${conversation.item}` : '';
    const text = `Here is your payment link${item}: ${url}`;

    const message = await store.createMessage({
      conversationId: conversation.id,
      sender: 'ai',
      text,
      isDraft: false,
      kind: 'payment_link',
    });

    const updated = await store.updateConversation(conversation.id, {});
    res.status(201).json({ conversation: updated, message, url, mock: true });
  } catch (err) {
    next(err);
  }
});

// Funnel counts + a real Claude-generated insight sentence.
// ?refresh=1 forces a fresh insight even if the counts are unchanged.
app.get('/api/funnel/summary', async (req, res, next) => {
  try {
    const funnel = await computeFunnel();
    let insight = null;
    let insightError = null;
    if (claudeConfigured() && funnel.counts.inquiries > 0) {
      try {
        insight = await getFunnelInsight(funnel.counts, { force: req.query.refresh === '1' });
      } catch (err) {
        // The numbers are still useful if the insight call fails — don't 500.
        insightError = err.message;
      }
    }
    res.json({ ...funnel, insight, insightError });
  } catch (err) {
    next(err);
  }
});

// The simulated DM script. The client drives the timing so the pipeline runs
// live, message by message, and the UI updates as each classification lands.
app.get('/api/simulation/messages', (_req, res) => {
  res.json(INBOUND_SEED);
});

// Dev helper: clear conversations/messages, keep the catalog.
app.post('/api/dev/reset', async (_req, res) => {
  await store.reset();
  clearInsightCache();
  res.json({ ok: true });
});

app.use((req, res) => {
  res.status(404).json({ error: `no route for ${req.method} ${req.path}` });
});

// eslint-disable-next-line no-unused-vars
app.use((err, _req, res, _next) => {
  console.error('[error]', err);
  res.status(err.status || 500).json({ error: err.message || 'internal error' });
});

export default app;
