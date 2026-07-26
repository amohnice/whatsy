export default function SimulationControls({ inFlight, rushRunning, onRush, onOneMore, onReset }) {
  return (
    <div className="sim-controls">
      <button className="btn btn-primary" onClick={onRush} disabled={rushRunning}>
        {rushRunning ? 'Rush in progress…' : '⚡ Simulate morning rush'}
      </button>
      <button className="btn" onClick={onOneMore} disabled={rushRunning}>
        + One more DM
      </button>
      <button className="btn btn-quiet" onClick={onReset} disabled={rushRunning}>
        Reset inbox
      </button>
      {inFlight > 0 && (
        <span className="sim-status">
          <span className="spinner" />
          Claude working on {inFlight} message{inFlight === 1 ? '' : 's'}…
        </span>
      )}
    </div>
  );
}
