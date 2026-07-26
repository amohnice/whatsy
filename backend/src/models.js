import mongoose from 'mongoose';

const conversationSchema = new mongoose.Schema(
  {
    buyerName: { type: String, required: true },
    // One conversation per buyer handle. Unique so two concurrent inbound
    // messages from the same buyer can't race into two separate threads.
    buyerHandle: { type: String, required: true, unique: true, index: true },
    status: { type: String, enum: ['cold', 'warm', 'hot'], default: 'cold' },
    item: { type: String, default: null },
    statusReason: { type: String, default: null },
    hotSummary: { type: String, default: null },
    everWarm: { type: Boolean, default: false },
    everHot: { type: Boolean, default: false },
    // Simulation only: the role-played buyer has stopped replying, so the
    // auto-reply engine should leave this thread alone.
    simDone: { type: Boolean, default: false },
  },
  { timestamps: true },
);

const messageSchema = new mongoose.Schema(
  {
    conversationId: { type: String, required: true, index: true },
    sender: { type: String, enum: ['buyer', 'ai', 'james'], required: true },
    text: { type: String, required: true },
    isDraft: { type: Boolean, default: false },
    kind: { type: String, default: 'text' }, // 'text' | 'payment_link'
  },
  { timestamps: true },
);

const catalogItemSchema = new mongoose.Schema(
  {
    name: { type: String, required: true },
    price: { type: Number, required: true },
    available: { type: Boolean, default: true },
    description: { type: String, default: '' },
  },
  { timestamps: true },
);

export const Conversation = mongoose.model('Conversation', conversationSchema);
export const Message = mongoose.model('Message', messageSchema);
export const CatalogItem = mongoose.model('CatalogItem', catalogItemSchema);
