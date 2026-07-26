import Badge from './Badge.jsx';

export default function ConversationList({ conversations, activeId, onSelect }) {
  if (conversations.length === 0) {
    return (
      <div className="empty">
        <h3>Inbox is empty</h3>
        <p>No DMs yet. Messages will drip in shortly.</p>
      </div>
    );
  }

  return (
    <>
      {conversations.map((c) => (
        <button
          key={c.id}
          className={`conv${c.id === activeId ? ' is-active' : ''}`}
          onClick={() => onSelect(c.id)}
        >
          <div className="conv-top">
            <span className="conv-name">{c.buyerName}</span>
            <span className="conv-handle">{c.buyerHandle}</span>
            {c.hasPendingDraft && <span className="draft-dot" title="AI draft awaiting approval" />}
            <Badge status={c.status} />
          </div>
          <div className={`conv-item${c.item ? '' : ' is-empty'}`}>
            {c.item || 'item not identified yet'}
          </div>
          {c.lastMessage && <div className="conv-preview">{c.lastMessage}</div>}
        </button>
      ))}
    </>
  );
}
