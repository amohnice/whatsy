// All API access goes through the Vite proxy at /api, so the client never sees
// the Anthropic key and there is no base URL to configure.

async function request(path, options = {}) {
  const res = await fetch(`/api${path}`, {
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
