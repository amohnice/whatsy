// Single data-access interface with two backends: MongoDB (mongoose) when
// MONGODB_URI is reachable, otherwise an in-memory store so the app still runs
// fully offline. Routes only ever talk to `store` — they never know which.
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
    if ((await CatalogItem.countDocuments()) > 0) return;
    await CatalogItem.insertMany(CATALOG_SEED);
  },

  async listCatalog() {
    return (await CatalogItem.find().lean({ virtuals: false })).map((d) => shapeItem(d));
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
    return shapeConversation(await Conversation.create({ buyerName, buyerHandle, item }));
  },

  async updateConversation(id, patch) {
    if (!mongoose.isValidObjectId(id)) return null;
    return shapeConversation(await Conversation.findByIdAndUpdate(id, patch, { new: true }));
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

export async function initStore() {
  const uri = process.env.MONGODB_URI;
  if (uri) {
    try {
      await mongoose.connect(uri, { serverSelectionTimeoutMS: 2500 });
      active = mongoStore;
      backend = 'mongodb';
      console.log('[store] connected to MongoDB');
    } catch (err) {
      console.warn(`[store] MongoDB unavailable (${err.message}) — using in-memory store`);
      active = memoryStore;
      backend = 'memory';
    }
  } else {
    console.log('[store] no MONGODB_URI set — using in-memory store');
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
