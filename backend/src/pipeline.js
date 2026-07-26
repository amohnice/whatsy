// The inbound-message pipeline:
//   buyer message in → AI reply drafted + intent classified (parallel)
//   → draft held for approval if hot & payment-ready
//   → one-line hot summary generated the first time a thread turns hot.
import { store } from './store.js';
import { draftReply, classifyConversation, summarizeHotLead } from './claude.js';

/** "wanjiku_254" -> "Wanjiku 254" — a stand-in display name for simulated DMs. */
export function nameFromHandle(handle) {
  return handle
    .replace(/^@/, '')
    .split(/[._-]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

/**
 * Handle one inbound buyer message end to end.
 * @returns {{conversation: object, buyerMessage: object, aiMessage: object,
 *            classification: object, hotSummary: string|null}}
 */
export async function handleInbound({ conversationId, buyerHandle, buyerName, text }) {
  const catalog = await store.listCatalog();

  // 1. Resolve or create the conversation.
  let conversation = null;
  if (conversationId) {
    conversation = await store.getConversation(conversationId);
    if (!conversation) {
      const err = new Error('conversation not found');
      err.status = 404;
      throw err;
    }
  } else {
    const handle = buyerHandle.startsWith('@') ? buyerHandle : `@${buyerHandle}`;
    conversation = await store.findConversationByHandle(handle);
    if (!conversation) {
      conversation = await store.createConversation({
        buyerName: buyerName || nameFromHandle(handle),
        buyerHandle: handle,
      });
    }
  }

  // 2. Persist the buyer's message so the thread we reason over is complete.
  const buyerMessage = await store.createMessage({
    conversationId: conversation.id,
    sender: 'buyer',
    text,
  });

  const messages = await store.listMessages(conversation.id);
  const promptInput = { catalog, messages, buyerName: conversation.buyerName };

  // 3. Two real Claude calls, in parallel — they read the same thread and
  //    neither depends on the other's output.
  const [{ reply, item }, classification] = await Promise.all([
    draftReply(promptInput),
    classifyConversation(promptInput),
  ]);

  const { status, reason, paymentReady } = classification;

  // 4. A hot thread with a payment-ready signal is the one case James must tap
  //    to send. Everything else auto-sends.
  const holdForApproval = status === 'hot' && paymentReady;

  const aiMessage = await store.createMessage({
    conversationId: conversation.id,
    sender: 'ai',
    text: reply,
    isDraft: holdForApproval,
  });

  // 5. Persist classification. everWarm/everHot are latches — they record that
  //    a thread *reached* a stage, so the funnel is not distorted if a buyer
  //    later goes quiet and gets reclassified downward.
  const becameHotNow = status === 'hot' && !conversation.everHot;
  const patch = {
    status,
    statusReason: reason,
    everWarm: conversation.everWarm || status === 'warm' || status === 'hot',
    everHot: conversation.everHot || status === 'hot',
  };
  if (item) patch.item = item;
  conversation = await store.updateConversation(conversation.id, patch);

  // 6. Third Claude call, only on the transition into hot — one line for James.
  let hotSummary = null;
  if (becameHotNow) {
    const withReply = await store.listMessages(conversation.id);
    hotSummary = await summarizeHotLead({ ...promptInput, messages: withReply });
    conversation = await store.updateConversation(conversation.id, { hotSummary });
  }

  return { conversation, buyerMessage, aiMessage, classification, hotSummary };
}
