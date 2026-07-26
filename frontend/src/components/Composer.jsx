import { useEffect, useRef, useState } from 'react';

// Two modes, because "keep the conversation going" means two different things:
//   buyer  — plays the buyer's next DM through the real pipeline (AI reply +
//            reclassification + hot summary). This is the demo lever.
//   james  — James types his own reply; no Claude call, message just joins
//            the thread and informs later drafts.
export default function Composer({ conversationId, onSendAsBuyer, onSendAsJames, busy }) {
  const [mode, setMode] = useState('buyer');
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const inputRef = useRef(null);

  // Clear the box when switching threads so a half-typed message can't be sent
  // to the wrong buyer.
  useEffect(() => {
    setText('');
  }, [conversationId]);

  const disabled = sending || busy;

  async function submit() {
    const body = text.trim();
    if (!body || disabled) return;
    setSending(true);
    try {
      if (mode === 'buyer') await onSendAsBuyer(conversationId, body);
      else await onSendAsJames(conversationId, body);
      setText('');
      inputRef.current?.focus();
    } finally {
      setSending(false);
    }
  }

  function onKeyDown(e) {
    // Enter sends, Shift+Enter makes a newline — chat convention.
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      submit();
    }
  }

  return (
    <div className="composer">
      <div className="composer-modes">
        <button
          className={`mode${mode === 'buyer' ? ' is-active' : ''}`}
          onClick={() => setMode('buyer')}
          disabled={disabled}
          title="Sends as the buyer and runs the full AI pipeline"
        >
          As buyer
          <span className="mode-hint">runs AI</span>
        </button>
        <button
          className={`mode${mode === 'james' ? ' is-active' : ''}`}
          onClick={() => setMode('james')}
          disabled={disabled}
          title="Sends as James — no AI call"
        >
          As James
          <span className="mode-hint">no AI</span>
        </button>
        {sending && (
          <span className="composer-status">
            <span className="spinner" />
            {mode === 'buyer' ? 'Claude is replying…' : 'sending…'}
          </span>
        )}
      </div>

      <div className="composer-row">
        <textarea
          ref={inputRef}
          className="composer-input"
          rows={2}
          value={text}
          disabled={disabled}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder={
            mode === 'buyer'
              ? 'Type as the buyer — e.g. "how do i pay?" (Enter to send)'
              : 'Type your reply as James (Enter to send)'
          }
        />
        <button className="btn btn-primary" onClick={submit} disabled={disabled || !text.trim()}>
          Send
        </button>
      </div>
    </div>
  );
}
