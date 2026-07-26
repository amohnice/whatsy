// In local dev VITE_API_URL is unset, so requests go to /api and the Vite proxy
// forwards them to :4000 — same origin, nothing to configure.
//
// In production the backend is a separate Vercel project on its own domain, so
// VITE_API_URL must be set to that origin at BUILD time (Vite inlines env vars
// into the bundle; changing it requires a redeploy, not just a restart).
//
// Either way the Anthropic key stays server-side — only this base URL is public.
const API_BASE = (import.meta.env.VITE_API_URL || '').replace(/\/+$/, '');

export const apiBase = API_BASE;

async function request(path, options = {}) {
  const res = await fetch(`${API_BASE}/api${path}`, {
    headers: { 'content-type': 'application/json' },
    ...options,
  });
  const text = await res.text();
  const body = text ? JSON.parse(text) : null;
  if (!res.ok) throw new Error(body?.error || `${res.status} ${res.statusText}`);
  return body;
}

export const getHealth = () => request('/health');
export const getCatalog = () => request('/catalog');
export const getConversations = () => request('/conversations');
export const getConversation = (id) => request(`/conversations/${id}`);

export const sendInbound = (payload) =>
  request('/messages/inbound', { method: 'POST', body: JSON.stringify(payload) });

export const editDraft = (conversationId, { messageId, text }) =>
  request(`/conversations/${conversationId}/send-draft`, {
    method: 'PATCH',
    body: JSON.stringify({ messageId, text }),
  });

export const sendDraft = (conversationId, { messageId, text } = {}) =>
  request(`/conversations/${conversationId}/send-draft`, {
    method: 'POST',
    body: JSON.stringify({ messageId, text }),
  });

export const createPaymentLink = (conversationId) =>
  request(`/conversations/${conversationId}/payment-link`, { method: 'POST' });

export const getFunnel = ({ refresh = false } = {}) =>
  request(`/funnel/summary${refresh ? '?refresh=1' : ''}`);

export const getSimulationMessages = () => request('/simulation/messages');
export const resetInbox = () => request('/dev/reset', { method: 'POST' });
