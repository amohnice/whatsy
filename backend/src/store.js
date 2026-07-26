// Single data-access interface with two backends: MongoDB (mongoose) when
// MONGODB_URI is reachable, otherwise an in-memory store so the app still runs
// fully offline. Routes only ever talk to `store` — they never know which.
import './dns-bootstrap.js'; // must run before any mongodb+srv:// lookup
import mongoose from 'mongoose';
import { randomUUID } from 'node:crypto';
import { CATALOG_SEED } from './seed/catalog.js';
import { Conversation, Message, CatalogItem } from './models.js';

let backend = 'memory';
export const getBackend = () => backend;

// ---------------------------------------------------------------- memory impl

const mem = {
  conversations: new Map(),
  messages: new Map(),
  catalog: new Map(),
};

const now = () => new Date();

const memoryStore = {
  async seedCatalog() {
    if (mem.catalog.size > 0) return;
    for (const item of CATALOG_SEED) {
      const id = randomUUID();
      mem.catalog.set(id, { id, ...item, createdAt: now(), updatedAt: now() });
    }
  },

  async listCatalog() {
    return [...mem.catalog.values()];
  },

  async listConversations() {
    return [...mem.conversations.values()].sort((a, b) => b.updatedAt - a.updatedAt);
  },

  async getConversation(id) {
    return mem.conversations.get(id) ?? null;
  },

  async findConversationByHandle(handle) {
    return [...mem.conversations.values()].find((c) => c.buyerHandle === handle) ?? null;
  },

  async createConversation({ buyerName, buyerHandle, item = null }) {
    const id = randomUUID();
    const doc = {
      id,
      buyerName,
      buyerHandle,
      status: 'cold',
      item,
      statusReason: null,
      hotSummary: null,
      everWarm: false,
      everHot: false,
      simDone: false,
      createdAt: now(),
      updatedAt: now(),
    };
    mem.conversations.set(id, doc);
    return doc;
  },

  async updateConversation(id, patch) {
    const doc = mem.conversations.get(id);
    if (!doc) return null;
    Object.assign(doc, patch, { updatedAt: now() });
    return doc;
  },

  async listMessages(conversationId) {
    return [...mem.messages.values()]
      .filter((m) => m.conversationId === conversationId)
      .sort((a, b) => a.createdAt - b.createdAt || a.seq - b.seq);
  },

  async createMessage({ conversationId, sender, text, isDraft = false, kind = 'text' }) {
    const id = randomUUID();
    const doc = {
      id,
      conversationId,
      sender,
      text,
      isDraft,
      kind,
      seq: mem.messages.size,
      createdAt: now(),
      updatedAt: now(),
    };
    mem.messages.set(id, doc);
    return doc;
  },

  async updateMessage(id, patch) {
    const doc = mem.messages.get(id);
    if (!doc) return null;
    Object.assign(doc, patch, { updatedAt: now() });
    return doc;
  },

  async findPendingDraft(conversationId) {
    return (
      [...mem.messages.values()]
        .filter((m) => m.conversationId === conversationId && m.isDraft)
        .sort((a, b) => b.createdAt - a.createdAt)[0] ?? null
    );
  },

  async conversationIdsWithPaymentLink() {
    return new Set(
      [...mem.messages.values()].filter((m) => m.kind === 'payment_link').map((m) => m.conversationId),
    );
  },

  async reset() {
    mem.conversations.clear();
    mem.messages.clear();
  },
};

// ----------------------------------------------------------------- mongo impl

const shapeConversation = (d) =>
  d && {
    id: d._id.toString(),
    buyerName: d.buyerName,
    buyerHandle: d.buyerHandle,
    status: d.status,
    item: d.item,
    statusReason: d.statusReason,
    hotSummary: d.hotSummary,
    everWarm: d.everWarm,
    everHot: d.everHot,
    simDone: d.simDone,
    createdAt: d.createdAt,
    updatedAt: d.updatedAt,
  };

const shapeMessage = (d) =>
  d && {
    id: d._id.toString(),
    conversationId: d.conversationId,
    sender: d.sender,
    text: d.text,
    isDraft: d.isDraft,
    kind: d.kind,
    createdAt: d.createdAt,
    updatedAt: d.updatedAt,
  };

const shapeItem = (d) =>
  d && {
    id: d._id.toString(),
    name: d.name,
    price: d.price,
    available: d.available,
    description: d.description,
  };

const mongoStore = {
  async seedCatalog() {
    // Upsert by name rather than count-then-insert: several serverless instances
    // can cold-start at once, and the check-then-write version would let two of
    // them both see an empty collection and insert the catalog twice.
    await CatalogItem.bulkWrite(
      CATALOG_SEED.map((item) => ({
        updateOne: { filter: { name: item.name }, update: { $setOnInsert: item }, upsert: true },
      })),
      { ordered: false },
    );
  },

  async listCatalog() {
    return (await CatalogItem.find().lean()).map((d) => shapeItem(d));
  },

  async listConversations() {
    return (await Conversation.find().sort({ updatedAt: -1 })).map(shapeConversation);
  },

  async getConversation(id) {
    if (!mongoose.isValidObjectId(id)) return null;
    return shapeConversation(await Conversation.findById(id));
  },

  async findConversationByHandle(handle) {
    return shapeConversation(await Conversation.findOne({ buyerHandle: handle }));
  },

  async createConversation({ buyerName, buyerHandle, item = null }) {
    try {
      return shapeConversation(await Conversation.create({ buyerName, buyerHandle, item }));
    } catch (err) {
      // Lost the race against a concurrent message from the same buyer — the
      // other request already created the thread, so use theirs.
      if (err?.code === 11000) {
        return shapeConversation(await Conversation.findOne({ buyerHandle }));
      }
      throw err;
    }
  },

  async updateConversation(id, patch) {
    if (!mongoose.isValidObjectId(id)) return null;
    // updatedAt is set explicitly: callers pass an empty patch purely to bump the
    // conversation to the top of the list (e.g. after a payment link), and
    // mongoose's automatic timestamp does not fire for a no-op update.
    return shapeConversation(
      await Conversation.findByIdAndUpdate(
        id,
        { ...patch, updatedAt: new Date() },
        { new: true, timestamps: false },
      ),
    );
  },

  async listMessages(conversationId) {
    return (await Message.find({ conversationId }).sort({ createdAt: 1, _id: 1 })).map(shapeMessage);
  },

  async createMessage({ conversationId, sender, text, isDraft = false, kind = 'text' }) {
    return shapeMessage(await Message.create({ conversationId, sender, text, isDraft, kind }));
  },

  async updateMessage(id, patch) {
    if (!mongoose.isValidObjectId(id)) return null;
    return shapeMessage(await Message.findByIdAndUpdate(id, patch, { new: true }));
  },

  async findPendingDraft(conversationId) {
    return shapeMessage(
      await Message.findOne({ conversationId, isDraft: true }).sort({ createdAt: -1 }),
    );
  },

  async conversationIdsWithPaymentLink() {
    const ids = await Message.distinct('conversationId', { kind: 'payment_link' });
    return new Set(ids);
  },

  async reset() {
    await Promise.all([Conversation.deleteMany({}), Message.deleteMany({})]);
  },
};

// ------------------------------------------------------------------ selection

let active = memoryStore;

// Memoised: the local entrypoint awaits this at boot and the serverless
// middleware awaits it per request, so it must be safe to call repeatedly.
let initPromise = null;

export function initStore() {
  if (!initPromise) {
    initPromise = doInit().catch((err) => {
      initPromise = null; // allow a retry on the next request
      throw err;
    });
  }
  return initPromise;
}

// Serverless connection reuse. Each warm invocation re-enters this module, and
// dialing a new Atlas connection per request would exhaust the M0 connection cap
// and add ~1s of TLS handshake to every call. Cached on globalThis so the
// connection survives module re-evaluation within an instance.
const globalCache = globalThis.__whatsyMongoose ?? (globalThis.__whatsyMongoose = { conn: null });

async function connectMongo(uri) {
  if (globalCache.conn) return globalCache.conn;
  globalCache.conn = mongoose
    .connect(uri, {
      // Atlas M0 can take several seconds to answer a cold connection — the old
      // 2.5s timeout was tuned for a local mongod and would spuriously fail.
      serverSelectionTimeoutMS: 10000,
      // Fail fast instead of silently queueing operations behind a dead socket.
      bufferCommands: false,
      maxPoolSize: 5, // serverless: many instances × small pool
    })
    .catch((err) => {
      globalCache.conn = null; // don't cache a failure
      throw err;
    });
  return globalCache.conn;
}

async function doInit() {
  const uri = process.env.MONGODB_URI;

  if (!uri) {
    // No database configured. Fine locally; on Vercel this means an inbox that
    // empties on every cold start, so say so loudly.
    if (process.env.VERCEL) {
      console.warn(
        '[store] MONGODB_URI is not set on Vercel — using the in-memory store. ' +
          'Conversations WILL be lost on cold starts and split across instances.',
      );
    } else {
      console.log('[store] no MONGODB_URI set — using in-memory store');
    }
  } else {
    try {
      await connectMongo(uri);
      active = mongoStore;
      backend = 'mongodb';
      console.log('[store] connected to MongoDB');
    } catch (err) {
      // Falling back silently is right for local dev, but on a deployment it
      // would hide a misconfigured URI behind an inbox that looks merely buggy.
      // Fail loudly there instead — unless explicitly overridden.
      if (process.env.VERCEL && process.env.ALLOW_MEMORY_FALLBACK !== '1') {
        console.error(`[store] MongoDB connection failed: ${err.message}`);
        throw new Error(
          `MONGODB_URI is set but unreachable: ${err.message}. ` +
            'Check the password is URL-encoded and that Network Access allows 0.0.0.0/0. ' +
            'Set ALLOW_MEMORY_FALLBACK=1 to run without persistence instead.',
        );
      }
      console.warn(`[store] MongoDB unavailable (${err.message}) — using in-memory store`);
      active = memoryStore;
      backend = 'memory';
    }
  }

  await active.seedCatalog();
  return active;
}

// Proxy so `store.foo()` always hits whichever backend won.
export const store = new Proxy(
  {},
  {
    get(_t, prop) {
      const fn = active[prop];
      if (typeof fn !== 'function') return undefined;
      return fn.bind(active);
    },
  },
);
