import { useEffect, useRef, useState } from 'react';
import Badge from './Badge.jsx';
import Composer from './Composer.jsx';

const time = (iso) =>
  new Date(iso).toLocaleTimeString('en-KE', { hour: '2-digit', minute: '2-digit' });

const SENDER_LABEL = { buyer: 'buyer', ai: 'AI', james: 'James' };

// Turns the mock pay.mock URL in a payment-link message into a real anchor.
function withLinks(text) {
  const parts = text.split(/(https?:\/\/\S+)/g);
  return parts.map((part, i) =>
    /^https?:\/\//.test(part) ? (
      <a key={i} href={part} target="_blank" rel="noreferrer">
        {part}
      </a>
    ) : (
      part
    ),
  );
}

export default function Thread({
  conversation,
  messages,
  onSendDraft,
  onEditDraft,
  onPaymentLink,
  onSendAsBuyer,
  onSendAsJames,
  busy,
}) {
  const scrollRef = useRef(null);

  // Stick to the bottom as new messages land.
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages.length, conversation?.id]);

  if (!conversation) {
    return (
      <div className="empty">
        <h3>No conversation selected</h3>
        <p>Pick a buyer on the left to read the thread.</p>
      </div>
    );
  }

  const hasPaymentLink = messages.some((m) => m.kind === 'payment_link');

  return (
    <>
      <div className="thread-head">
        <h2>
          {conversation.buyerName}
          <span className="conv-handle">{conversation.buyerHandle}</span>
          <Badge status={conversation.status} />
          {busy && <span className="spinner" title="working" />}
          <button
            className="btn btn-small"
            onClick={() => onPaymentLink(conversation.id)}
            disabled={busy}
            title="Generates a fake link — no real payment processing"
          >
            {hasPaymentLink ? '↻ New payment link' : '🔗 Send payment link'}
          </button>
        </h2>
        <div className="thread-meta">
          {conversation.item ? `Interested in: ${conversation.item}` : 'Item not identified yet'}
        </div>
        {conversation.statusReason && (
          <div className="thread-reason">
            <strong>Why {conversation.status}:</strong> {conversation.statusReason}
          </div>
        )}
        {conversation.hotSummary && (
          <div className="thread-summary">🔥 {conversation.hotSummary}</div>
        )}
      </div>

      <div className="messages" ref={scrollRef}>
        {messages.map((m) =>
          m.isDraft ? (
            <DraftBubble
              key={m.id}
              message={m}
              busy={busy}
              onSend={(text) => onSendDraft(conversation.id, m.id, text)}
              onSave={(text) => onEditDraft(conversation.id, m.id, text)}
            />
          ) : (
            <div key={m.id} className={`row from-${m.sender}`}>
              <div className={`bubble bubble-${m.sender}${m.kind === 'payment_link' ? ' is-pay' : ''}`}>
                {withLinks(m.text)}
                <div className="bubble-meta">
                  {SENDER_LABEL[m.sender]} · {time(m.createdAt)}
                  {m.kind === 'payment_link' && ' · mock link'}
                </div>
              </div>
            </div>
          ),
        )}
      </div>

      <Composer
        conversationId={conversation.id}
        onSendAsBuyer={onSendAsBuyer}
        onSendAsJames={onSendAsJames}
        busy={busy}
      />
    </>
  );
}

function DraftBubble({ message, busy, onSend, onSave }) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(message.text);

  // If the draft changes underneath us (poll refresh) and we're not editing,
  // pick up the new text rather than showing stale content.
  useEffect(() => {
    if (!editing) setText(message.text);
  }, [message.text, editing]);

  return (
    <div className="row from-ai">
      <div className="draft">
        <div className="draft-label">AI draft — needs approval</div>

        {editing ? (
          <textarea
            className="draft-input"
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={4}
            autoFocus
          />
        ) : (
          <div className="draft-text">{message.text}</div>
        )}

        <div className="draft-actions">
          {editing ? (
            <>
              <button
                className="btn btn-small btn-primary"
                disabled={busy || !text.trim()}
                onClick={async () => {
                  await onSend(text);
                  setEditing(false);
                }}
              >
                Save &amp; send
              </button>
              <button
                className="btn btn-small"
                disabled={busy || !text.trim()}
                onClick={async () => {
                  await onSave(text);
                  setEditing(false);
                }}
              >
                Save as draft
              </button>
              <button
                className="btn btn-small btn-quiet"
                onClick={() => {
                  setText(message.text);
                  setEditing(false);
                }}
              >
                Cancel
              </button>
            </>
          ) : (
            <>
              <button
                className="btn btn-small btn-primary"
                disabled={busy}
                onClick={() => onSend()}
              >
                Send
              </button>
              <button className="btn btn-small" disabled={busy} onClick={() => setEditing(true)}>
                Edit
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
