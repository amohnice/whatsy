// Live end-to-end check of the inbound pipeline against a running backend.
//   node scripts/smoke.js            (assumes backend on :4000)
//   BASE=http://localhost:4000 node scripts/smoke.js
const BASE = process.env.BASE || 'http://localhost:4000';

async function post(path, body) {
  const res = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(`${path} -> ${res.status} ${JSON.stringify(json)}`);
  return json;
}

const CASES = [
  // cold — vague browsing
  { buyerHandle: '@brayo_ke', text: 'niaje boss, uko na watches?' },
  // warm — specific item + price question, with typos
  { buyerHandle: '@wanjiku254', text: 'hi, hiyo seiko automatic iko? na bei ni ngapi exactly' },
  // hot — explicit payment signal
  { buyerHandle: '@dennis_m', text: 'i want the black curren one, nitatuma pesa leo. send till number pls' },
  // grounding check — asks for something NOT in the catalog
  { buyerHandle: '@otis.k', text: 'uko na Omega Speedmaster? or rolex submariner original' },
  // grounding check — asks about a deliberately out-of-stock item
  { buyerHandle: '@faith_w', text: 'that silver rolex datejust you posted, ni how much? i want it' },
];

console.log(`health: ${JSON.stringify(await (await fetch(`${BASE}/api/health`)).json())}\n`);

for (const c of CASES) {
  const t0 = Date.now();
  const { conversation, aiMessage } = await post('/api/messages/inbound', c);
  console.log(`── ${c.buyerHandle}  (${Date.now() - t0}ms)`);
  console.log(`   buyer : ${c.text}`);
  console.log(`   ai    : ${aiMessage.text}`);
  console.log(
    `   state : status=${conversation.status} item=${conversation.item ?? '-'} isDraft=${aiMessage.isDraft}`,
  );
  if (conversation.statusReason) console.log(`   why   : ${conversation.statusReason}`);
  if (conversation.hotSummary) console.log(`   hot   : ${conversation.hotSummary}`);
  console.log();
}
