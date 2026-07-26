// Exercises the store interface directly against whatever backend MONGODB_URI
// selects — no Claude calls, so it is fast and free. This is the mongoose path
// that was never executed during development.
//
//   node scripts/db-check.js
import 'dotenv/config';
import mongoose from 'mongoose';
import { initStore, store, getBackend } from '../src/store.js';

let failures = 0;
const check = (label, pass, detail = '') => {
  console.log(`  ${pass ? '✓' : '✗'} ${label}${detail ? ` — ${detail}` : ''}`);
  if (!pass) failures += 1;
};

const uri = process.env.MONGODB_URI;
if (!uri) {
  console.error('MONGODB_URI is not set — nothing to check.');
  process.exit(1);
}
if (uri.includes('<db_password>')) {
  console.error('MONGODB_URI still contains the literal <db_password> placeholder.');
  process.exit(1);
}
console.log(`host: ${uri.replace(/\/\/[^@]*@/, '//***:***@')}\n`);

const t0 = Date.now();
await initStore();
console.log(`backend: ${getBackend()} (connected in ${Date.now() - t0}ms)\n`);

if (getBackend() !== 'mongodb') {
  console.error('Expected the mongodb backend but got the in-memory fallback — see the warning above.');
  process.exit(1);
}

console.log('catalog');
const catalog = await store.listCatalog();
check('8 items seeded', catalog.length === 8, `got ${catalog.length}`);
check('2 marked unavailable', catalog.filter((i) => !i.available).length === 2);
check('items have string ids', typeof catalog[0]?.id === 'string' && !('_id' in catalog[0]));
await store.seedCatalog(); // idempotency: must not duplicate
check('re-seed is idempotent', (await store.listCatalog()).length === 8);

console.log('\nconversations');
const handle = `@dbcheck_${Date.now()}`;
const conv = await store.createConversation({ buyerName: 'DB Check', buyerHandle: handle });
check('created with string id', typeof conv.id === 'string');
check('defaults to cold', conv.status === 'cold');
check('latches start false', conv.everWarm === false && conv.everHot === false);
check('findable by handle', (await store.findConversationByHandle(handle))?.id === conv.id);
check('getConversation round-trips', (await store.getConversation(conv.id))?.id === conv.id);
check('bad id returns null, not a throw', (await store.getConversation('not-an-objectid')) === null);

const dup = await store.createConversation({ buyerName: 'Dup', buyerHandle: handle });
check('duplicate handle adopts existing thread', dup.id === conv.id);

console.log('\nmessages');
const m1 = await store.createMessage({ conversationId: conv.id, sender: 'buyer', text: 'bei?' });
const m2 = await store.createMessage({
  conversationId: conv.id,
  sender: 'ai',
  text: 'KES 1,800',
  isDraft: true,
});
const thread = await store.listMessages(conv.id);
check('both messages stored', thread.length === 2, `got ${thread.length}`);
check('ordered oldest first', thread[0].id === m1.id && thread[1].id === m2.id);
check('findPendingDraft finds the draft', (await store.findPendingDraft(conv.id))?.id === m2.id);

await store.updateMessage(m2.id, { text: 'KES 1,800 — edited', isDraft: false });
const afterSend = await store.listMessages(conv.id);
check('draft edited + sent', afterSend[1].text.endsWith('edited') && afterSend[1].isDraft === false);
check('no pending draft left', (await store.findPendingDraft(conv.id)) === null);

console.log('\nstatus + latches');
await store.updateConversation(conv.id, { status: 'hot', everWarm: true, everHot: true, item: 'X' });
const hot = await store.getConversation(conv.id);
check('status persisted', hot.status === 'hot');
check('latches persisted', hot.everWarm === true && hot.everHot === true);
check('item persisted', hot.item === 'X');

const before = (await store.getConversation(conv.id)).updatedAt;
await new Promise((r) => setTimeout(r, 20));
await store.updateConversation(conv.id, {});
const after = (await store.getConversation(conv.id)).updatedAt;
check('empty patch still bumps updatedAt', new Date(after) > new Date(before));

console.log('\npayment link / conversion');
check('no payment link yet', !(await store.conversationIdsWithPaymentLink()).has(conv.id));
await store.createMessage({
  conversationId: conv.id,
  sender: 'ai',
  text: 'https://pay.mock/replyrescue/abc123',
  kind: 'payment_link',
});
check('payment link detected', (await store.conversationIdsWithPaymentLink()).has(conv.id));

console.log('\nlist ordering');
const list = await store.listConversations();
check('list returns conversations', list.length >= 1);
check(
  'sorted newest-updated first',
  list.every((c, i) => i === 0 || new Date(list[i - 1].updatedAt) >= new Date(c.updatedAt)),
);

console.log('\ncleanup');
await store.reset();
check('reset clears conversations', (await store.listConversations()).length === 0);
check('reset clears messages', (await store.listMessages(conv.id)).length === 0);
check('reset keeps catalog', (await store.listCatalog()).length === 8);

await mongoose.disconnect();
console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`}`);
process.exit(failures === 0 ? 0 : 1);
