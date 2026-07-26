// Local dev entrypoint — starts a long-lived HTTP server.
// Vercel does NOT use this file; it loads backend/api/index.js instead, which
// exports the same app as a serverless handler with no listen() call.
import 'dotenv/config';
import app from './app.js';
import { initStore, getBackend } from './store.js';
import { claudeConfigured } from './claude.js';

const PORT = process.env.PORT || 4000;

await initStore();

app.listen(PORT, () => {
  console.log(`[whatsy] backend on http://localhost:${PORT}  (store: ${getBackend()})`);
  if (getBackend() === 'memory') {
    console.warn('[whatsy] in-memory store — all conversations are lost on restart');
  }
  if (!claudeConfigured()) {
    console.warn('[whatsy] ANTHROPIC_API_KEY is not set — /api/messages/inbound will return 503');
  }
});
