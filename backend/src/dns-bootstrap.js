// Optional DNS resolver override for local development.
//
// Some machines hand Node a loopback resolver (a local DNS filter/proxy that
// isn't running, a VPN leftover, etc). Node reads adapter DNS config directly
// rather than going through the OS resolver, so `nslookup` can succeed while
// Node's dns module fails with ECONNREFUSED — which shows up here as a
// mongodb+srv:// connection failing at the SRV lookup before it ever dials Atlas.
//
// Set DNS_SERVERS to work around it, e.g. DNS_SERVERS=1.1.1.1,8.8.8.8
// Not needed on Vercel — its resolvers work.
import dns from 'node:dns';

const configured = (process.env.DNS_SERVERS || '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

if (configured.length > 0) {
  try {
    dns.setServers(configured);
    console.log(`[dns] resolver overridden -> ${configured.join(', ')}`);
  } catch (err) {
    console.warn(`[dns] invalid DNS_SERVERS (${err.message}) — keeping system resolvers`);
  }
}
