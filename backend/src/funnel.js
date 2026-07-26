import { store } from './store.js';
import { funnelInsight } from './claude.js';

/**
 * Funnel counts.
 *
 * warm/hot use the everWarm/everHot latches rather than the live status, so a
 * thread that reached a stage still counts even if it was later reclassified
 * down. "converted" is defined as: a payment-link message exists on the thread.
 */
export async function computeFunnel() {
  const conversations = await store.listConversations();
  const paid = await store.conversationIdsWithPaymentLink();

  const counts = {
    inquiries: conversations.length,
    warm: conversations.filter((c) => c.everWarm).length,
    hot: conversations.filter((c) => c.everHot).length,
    converted: conversations.filter((c) => paid.has(c.id)).length,
  };

  // Real measured latency: buyer message → first AI reply in the same thread.
  // This is genuine Claude round-trip time, not a made-up number.
  const latencies = [];
  for (const c of conversations) {
    const messages = await store.listMessages(c.id);
    const firstBuyer = messages.find((m) => m.sender === 'buyer');
    const firstAi = messages.find((m) => m.sender === 'ai');
    if (firstBuyer && firstAi) {
      const ms = new Date(firstAi.createdAt) - new Date(firstBuyer.createdAt);
      if (ms >= 0) latencies.push(ms);
    }
  }
  const avgResponseMs = latencies.length
    ? Math.round(latencies.reduce((a, b) => a + b, 0) / latencies.length)
    : null;

  const hotConversations = conversations
    .filter((c) => c.everHot)
    .map((c) => ({
      id: c.id,
      buyerName: c.buyerName,
      buyerHandle: c.buyerHandle,
      item: c.item,
      status: c.status,
      hotSummary: c.hotSummary,
      converted: paid.has(c.id),
    }));

  return { counts, avgResponseMs, sampleSize: latencies.length, hotConversations };
}

// The insight is a real Claude call, so it is cached against the exact counts it
// describes. The dashboard polls; without this we would bill a call per poll.
let cache = { key: null, insight: null, generatedAt: null };

export async function getFunnelInsight(counts, { force = false } = {}) {
  const key = JSON.stringify(counts);
  if (!force && cache.key === key && cache.insight) {
    return { insight: cache.insight, generatedAt: cache.generatedAt, cached: true };
  }
  const insight = await funnelInsight(counts);
  cache = { key, insight, generatedAt: new Date().toISOString() };
  return { insight, generatedAt: cache.generatedAt, cached: false };
}

export function clearInsightCache() {
  cache = { key: null, insight: null, generatedAt: null };
}
