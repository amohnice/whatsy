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

## Deploying to Vercel (two projects)

The Vite `/api` proxy is **dev-only** — a production build is static files and
cannot proxy. So the frontend must be told the backend's absolute origin, and the
backend must allow the frontend's origin through CORS.

Import the same GitHub repo **twice**, changing only the Root Directory.

### 1. Backend project

| Setting | Value |
|---|---|
| Root Directory | `backend` |
| Framework Preset | Other |
| Build Command | *(leave empty)* |

Environment variables:

| Name | Value |
|---|---|
| `ANTHROPIC_API_KEY` | your key |
| `MONGODB_URI` | Atlas string, incl. `/whatsy` — see step 3 |
| `ANTHROPIC_MODEL` | `claude-opus-5` *(optional)* |
| `CORS_ORIGIN` | the frontend URL, e.g. `https://whatsy.vercel.app` |

Deploy, then confirm `https://<backend>.vercel.app/api/health` returns JSON.

`CORS_ORIGIN` is a chicken-and-egg: you don't know the frontend URL yet. Deploy
the backend once without it, deploy the frontend, then come back and set it.
Leaving it unset allows all origins — fine for a demo, but set it before sharing.

### 2. Frontend project

| Setting | Value |
|---|---|
| Root Directory | `frontend` |
| Framework Preset | Vite |

Environment variable:

| Name | Value |
|---|---|
| `VITE_API_URL` | the backend URL, e.g. `https://whatsy-backend.vercel.app` (no trailing slash) |

**`VITE_API_URL` is inlined at build time.** Changing it requires a redeploy, not
just a restart — Vite bakes it into the bundle.

### What is configured for you

- `backend/api/index.js` exports the Express app as a serverless handler; there
  is no `listen()` call on that path. `backend/src/index.js` (with `listen`) is
  local-dev only.
- `backend/vercel.json` rewrites all paths to that function and raises
  `maxDuration` to 60s, because an inbound message takes 4–7s (and one measured
  outlier hit 18s) against Vercel's 10s default.
- Store init is memoised in an app-level middleware, since serverless has no
  startup hook.

### 3. MongoDB Atlas

Set `MONGODB_URI` on the **backend** project. Without it the app uses the
in-memory store, which on serverless means an empty inbox after every cold start
and conversations scattered across instances that cannot see each other.

Atlas setup:

1. **M0** (free) cluster.
2. **Database Access** → a user with *Read and write to any database*. Prefer an
   autogenerated password with no `@ # / : ? & %` so there is nothing to
   percent-encode.
3. **Network Access** → **Allow Access from Anywhere** (`0.0.0.0/0`). Mandatory:
   Vercel functions have no static egress IPs, so an IP allowlist cannot work.
   The database user's password is the access control.
4. Connection string, with the database name in the path:
   ```
   mongodb+srv://USER:PASS@cluster0.xxxxx.mongodb.net/whatsy?retryWrites=true&w=majority
   ```
   Omitting `/whatsy` silently connects to a database called `test`.

Serverless specifics already handled in `src/store.js`:

- Connection cached on `globalThis`, so warm invocations reuse one socket instead
  of exhausting the M0 connection cap.
- `serverSelectionTimeoutMS` 10s (Atlas cold connections exceed the old 2.5s).
- Catalog seeding upserts by name, so simultaneous cold starts cannot double-seed.
- `buyerHandle` is uniquely indexed and duplicate-key is handled by adopting the
  winning thread, so two concurrent messages from one buyer cannot fork it.
- A set-but-unreachable `MONGODB_URI` **fails loudly** on Vercel rather than
  silently degrading to memory. Override with `ALLOW_MEMORY_FALLBACK=1`.

Verify with `npm run db-check` — 27 assertions over the store interface
(seeding + idempotency, CRUD, the duplicate-handle race, message ordering, draft
edit/send, latch persistence, `updatedAt` bumping, conversion detection, reset).

### Local troubleshooting: `querySrv ECONNREFUSED`

If `mongodb+srv://` fails at the SRV lookup while `nslookup` works, Node has been
handed a loopback DNS resolver with nothing listening (Node reads adapter DNS
config directly rather than using the OS resolver). Check with:

```bash
node -e "console.log(require('dns').getServers())"
```

If that prints `127.0.0.1`, set `DNS_SERVERS=1.1.1.1,8.8.8.8` in `.env`. Local
dev only — Vercel's resolvers are fine.

## Funnel definitions

- **inquiries** — total conversations
- **reached warm / reached hot** — latched (`everWarm` / `everHot`), so a thread
  that reached a stage still counts if it is later reclassified down
- **converted** — a payment-link message exists on the thread

`avgResponseMs` is genuinely measured: first buyer message → first AI reply.
The "~4h manual" comparison on the dashboard is an illustrative stand-in and is
labelled as such in the UI.

## Known limitations

- Without `MONGODB_URI` the in-memory store is wiped on every backend restart,
  which under `npm run dev` (`node --watch`) means every backend file save.
- Inbound latency is ~4–7s per message (three sequential-ish Claude calls at the
  top end). The morning rush overlaps requests deliberately, so badges resolve
  out of send order.
- Drafts can stack if a buyer sends several payment-ready messages in a row.
  Each renders with its own Send/Edit controls rather than superseding.
- The frontend polls (1.5s inbox, 4s dashboard) instead of using websockets.
