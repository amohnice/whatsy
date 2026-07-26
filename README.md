# WHATSY

An AI-assisted sales inbox for James, who sells watches from a small shop in
Nairobi. Buyer DMs come in, Claude drafts the reply, scores buying intent, and
flags the hot leads so James knows who to call back first.

**Hackathon prototype.** The pipeline is fully functional end to end, but:

- **There is no Meta / Instagram / WhatsApp integration of any kind.** Inbound
  DMs come from a local seed file, played back through the real API by a drip
  feed and a "Simulate morning rush" button.
- **There is no payment processing.** The payment-link endpoint mints a fake
  `https://pay.mock/replyrescue/{id}` URL. No M-Pesa, no money.
- **The Claude API calls are real**, server-side only, via `ANTHROPIC_API_KEY`.

## Stack

| Layer    | Choice |
|----------|--------|
| Backend  | Node + Express, mongoose, **falls back to an in-memory store** if MongoDB is unreachable |
| Frontend | React (Vite), plain CSS |
| AI       | Anthropic Claude (`claude-opus-5`), called only from the server |

## Run it

```bash
# 1. backend
cd backend
cp .env.example .env          # then put your real key in .env
npm install
npm run dev                   # http://localhost:4000

# 2. frontend (separate terminal)
cd frontend
npm install
npm run dev                   # http://localhost:5173  ← open this
```

`.env` needs `ANTHROPIC_API_KEY`. `MONGODB_URI` is optional — leave it unset and
the app runs entirely in memory, offline-friendly, no database required.

Vite proxies `/api` to port 4000, so the browser bundle contains no API key and
no base URL.

## The pipeline

Each inbound message triggers up to three real Claude calls:

1. **Draft reply** — gets the actual catalog plus the full thread, and answers
   price/availability questions or asks one qualifying question when intent is
   unclear. Auto-sends, *unless* the thread is hot **and** the buyer signalled
   payment readiness, in which case it is held as a draft for James to tap.
2. **Classify** — scores the thread `cold` / `warm` / `hot` with a one-line
   reason. Runs in parallel with (1); neither depends on the other.
3. **Hot summary** — fires once, on the transition into hot, producing a
   one-line brief of what the buyer wants and how ready they are.

A fourth call generates the dashboard's weekly funnel insight (cached against
the counts it describes, so polling doesn't bill a call per poll).

### Grounding

Prompts are grounded, not trusted. The seed catalog is rendered verbatim into
every system prompt with hard rules against inventing items, prices, stock,
delivery times, or payment details. Two catalog items are deliberately marked
out of stock to make this testable — asking for a real Rolex gets a refusal plus
a real alternative, not a hallucinated price.

## API

| Method | Path | Notes |
|---|---|---|
| `GET` | `/api/health` | store backend, model, key presence |
| `GET` | `/api/catalog` | seeded watches |
| `GET` | `/api/conversations` | list, enriched with preview + draft flag |
| `GET` | `/api/conversations/:id` | conversation + messages |
| `POST` | `/api/messages/inbound` | `{conversationId \| buyerHandle, text}` — runs the pipeline |
| `PATCH` | `/api/conversations/:id/send-draft` | edit draft text, stays a draft |
| `POST` | `/api/conversations/:id/send-draft` | approve + send (optional `text` to edit-and-send) |
| `POST` | `/api/conversations/:id/payment-link` | **mock** link, posted into the thread |
| `GET` | `/api/funnel/summary` | counts + measured latency + hot leads + Claude insight |
| `GET` | `/api/simulation/messages` | the seeded DM script |
| `POST` | `/api/dev/reset` | clear conversations, keep catalog |

Both draft routes accept an optional `messageId`; omit it to target the newest
pending draft.

## Funnel definitions

- **inquiries** — total conversations
- **reached warm / reached hot** — latched (`everWarm` / `everHot`), so a thread
  that reached a stage still counts if it is later reclassified down
- **converted** — a payment-link message exists on the thread

`avgResponseMs` is genuinely measured: first buyer message → first AI reply.
The "~4h manual" comparison on the dashboard is an illustrative stand-in and is
labelled as such in the UI.

## Known limitations

- The in-memory store is wiped on every backend restart, which under
  `npm run dev` (`node --watch`) means every backend file save. Set
  `MONGODB_URI` for persistence.
- The mongoose code path is written but untested — there was no local `mongod`
  during development.
- Inbound latency is ~4–7s per message (three sequential-ish Claude calls at the
  top end). The morning rush overlaps requests deliberately, so badges resolve
  out of send order.
- Drafts can stack if a buyer sends several payment-ready messages in a row.
  Each renders with its own Send/Edit controls rather than superseding.
- The frontend polls (1.5s inbox, 4s dashboard) instead of using websockets.
