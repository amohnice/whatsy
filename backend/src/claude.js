// All Anthropic Claude API calls. Server-side only — ANTHROPIC_API_KEY never
// leaves this process.
//
// Every prompt is grounded: the real catalog and the real thread history are
// passed in verbatim, and the system prompt forbids inventing items or prices.
import Anthropic from '@anthropic-ai/sdk';

const MODEL = process.env.ANTHROPIC_MODEL || 'claude-opus-5';

let client = null;
function getClient() {
  if (!client) client = new Anthropic();
  return client;
}

export const claudeConfigured = () => Boolean(process.env.ANTHROPIC_API_KEY);

/** Renders the catalog as a compact, unambiguous block for the prompt. */
function renderCatalog(catalog) {
  return catalog
    .map(
      (i) =>
        `- ${i.name} | KES ${i.price.toLocaleString('en-KE')} | ${
          i.available ? 'IN STOCK' : 'OUT OF STOCK'
        } | ${i.description}`,
    )
    .join('\n');
}

/** Renders the thread oldest-first with explicit speaker labels. */
function renderThread(messages, buyerName) {
  if (messages.length === 0) return '(no messages yet)';
  return messages
    .map((m) => {
      const who =
        m.sender === 'buyer' ? buyerName : m.sender === 'james' ? 'James (shop owner)' : 'Shop assistant';
      return `${who}: ${m.text}`;
    })
    .join('\n');
}

const GROUNDING_RULES = `
Hard rules:
- The catalog below is the ONLY inventory that exists. Never mention a watch that is not in it.
- Never state a price other than the exact price listed. Prices are in Kenyan Shillings (KES).
- If an item is OUT OF STOCK, say so plainly and offer the closest in-stock alternative from the catalog.
- If the buyer asks about something not in the catalog, say the shop does not stock it.
- Do not invent delivery times, discounts, warranties, or payment details that are not stated here.
`.trim();

/**
 * Low-level JSON call. Uses structured outputs so the response is guaranteed to
 * match the schema — no parsing heuristics, no markdown fences to strip.
 */
async function jsonCall({ system, user, schema, maxTokens = 1024, effort = 'low' }) {
  const response = await getClient().messages.create({
    model: MODEL,
    max_tokens: maxTokens,
    system,
    // Thinking off + low effort: these are short, well-specified tasks and the
    // demo needs snappy turnaround as the morning rush fires.
    thinking: { type: 'disabled' },
    output_config: {
      effort,
      format: { type: 'json_schema', schema },
    },
    messages: [{ role: 'user', content: user }],
  });

  if (response.stop_reason === 'refusal') {
    throw new Error(`Claude declined the request (${response.stop_details?.category ?? 'unknown'})`);
  }
  const block = response.content.find((b) => b.type === 'text');
  if (!block) throw new Error('Claude returned no text block');
  return JSON.parse(block.text);
}

// ---------------------------------------------------------------------------
// Claude call #1 — draft James's reply
// ---------------------------------------------------------------------------

const REPLY_SCHEMA = {
  type: 'object',
  properties: {
    reply: {
      type: 'string',
      description:
        "The message to send to the buyer, as James's shop assistant. 1-3 short sentences, WhatsApp/DM tone.",
    },
    item: {
      type: ['string', 'null'],
      description:
        'Exact catalog name of the watch this buyer is most clearly interested in, or null if still unclear.',
    },
  },
  required: ['reply', 'item'],
  additionalProperties: false,
};

export async function draftReply({ catalog, messages, buyerName }) {
  const system = `You are the sales assistant for James, who sells watches from a small shop in Nairobi. You reply to buyers in his Instagram and WhatsApp DMs.

${GROUNDING_RULES}

How to write:
- Warm, brief, human. The tone of a Nairobi shop owner on WhatsApp — not a corporate chatbot.
- Never use emoji more than once in a message. No bullet lists. No greetings longer than a couple of words.
- If the buyer asked about price or availability, answer it directly and exactly.
- If their intent is unclear (just "hi", "bei?", vague browsing), answer what you can and ask ONE short qualifying question — budget, which style, or which of two specific catalog items.
- If they sound ready to buy, confirm the item and price and tell them James will send payment details. Do NOT invent a till number, paybill, or link.
- Buyers often write in Sheng or mixed Swahili-English. Understand it; reply in simple English with light Swahili only if they used it.

CATALOG:
${renderCatalog(catalog)}`;

  const user = `Thread with ${buyerName} so far (oldest first):

${renderThread(messages, buyerName)}

Write the next reply from the shop assistant.`;

  return jsonCall({ system, user, schema: REPLY_SCHEMA, maxTokens: 800 });
}

// ---------------------------------------------------------------------------
// Claude call #2 — classify buying intent
// ---------------------------------------------------------------------------

const CLASSIFY_SCHEMA = {
  type: 'object',
  properties: {
    status: {
      type: 'string',
      enum: ['cold', 'warm', 'hot'],
      description:
        'cold = browsing, vague, or just greeting. warm = asking about a specific item, price, or availability with real interest. hot = clear intent to buy now.',
    },
    reason: {
      type: 'string',
      description: 'One short sentence (max 15 words) explaining the classification.',
    },
    paymentReady: {
      type: 'boolean',
      description:
        "True only if the buyer's latest message is a closing or payment signal — asking how to pay, requesting a till/paybill number, confirming a specific item to purchase, or asking about delivery for a decided purchase.",
    },
  },
  required: ['status', 'reason', 'paymentReady'],
  additionalProperties: false,
};

export async function classifyConversation({ catalog, messages, buyerName }) {
  const system = `You classify buying intent for James, a watch seller in Nairobi, based on a DM thread.

${GROUNDING_RULES}

Classify the CONVERSATION as a whole, weighted toward the buyer's most recent messages.
- cold: greetings only, window shopping, "just looking", asking general questions with no specific item.
- warm: asking price or availability of a specific watch, comparing two, asking if it is original, negotiating lightly.
- hot: explicit buying language — "I'll take it", "how do I pay", "send till number", "niko na cash", picking a specific one to purchase, or asking where to collect it now.

Buyers write in Sheng and mixed Swahili-English. "Bei?" = how much. "Niaje" = hi. "Nitatuma" = I'll send. "Mbao"/"ngiri" are slang amounts. Judge intent, not grammar.

CATALOG (for context on what they might be referring to):
${renderCatalog(catalog)}`;

  const user = `Thread with ${buyerName} (oldest first):

${renderThread(messages, buyerName)}

Classify this conversation.`;

  return jsonCall({ system, user, schema: CLASSIFY_SCHEMA, maxTokens: 400 });
}

// ---------------------------------------------------------------------------
// Claude call #3 — one-line hot-lead summary (fires once, on first turning hot)
// ---------------------------------------------------------------------------

const SUMMARY_SCHEMA = {
  type: 'object',
  properties: {
    summary: {
      type: 'string',
      description:
        'One line, max 25 words: what the buyer wants plus their budget or readiness signal. Written for James to skim.',
    },
  },
  required: ['summary'],
  additionalProperties: false,
};

export async function summarizeHotLead({ catalog, messages, buyerName }) {
  const system = `You write one-line hot-lead briefs for James, a watch seller in Nairobi, so he can decide who to call back first.

${GROUNDING_RULES}

Format: what they want + their budget or readiness. No preamble, no "This buyer". Max 25 words.
Good: "Wants the black Curren 8225 at 1,800 — asked for the till number, ready to pay today."
Bad: "This buyer seems interested in purchasing a watch and may be ready to buy soon."

CATALOG:
${renderCatalog(catalog)}`;

  const user = `Thread with ${buyerName} (oldest first):

${renderThread(messages, buyerName)}

Write the one-line brief.`;

  const { summary } = await jsonCall({ system, user, schema: SUMMARY_SCHEMA, maxTokens: 300 });
  return summary;
}

// ---------------------------------------------------------------------------
// Claude call #4 — plain-language funnel insight for the dashboard
// ---------------------------------------------------------------------------

const INSIGHT_SCHEMA = {
  type: 'object',
  properties: {
    insight: {
      type: 'string',
      description:
        "One or two plain-language sentences about this week's funnel, naming the biggest drop-off and what it implies. No jargon, no bullet points.",
    },
  },
  required: ['insight'],
  additionalProperties: false,
};

export async function funnelInsight(counts) {
  const system = `You write a single plain-language insight about a small shop's sales funnel for the week. The reader is James, who sells watches in Nairobi and is not a data person.

Rules:
- Use only the numbers given. Never invent revenue, percentages you cannot compute, or comparisons to previous weeks.
- Name the biggest drop-off in the funnel and what it suggests he should do.
- One or two sentences. Conversational. No jargon like "conversion funnel" or "lead velocity".`;

  const user = `This week:
- Total inquiries: ${counts.inquiries}
- Reached warm: ${counts.warm}
- Reached hot: ${counts.hot}
- Converted (payment link sent): ${counts.converted}

Write the insight.`;

  const { insight } = await jsonCall({ system, user, schema: INSIGHT_SCHEMA, maxTokens: 400 });
  return insight;
}
