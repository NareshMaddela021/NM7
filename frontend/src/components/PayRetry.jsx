// A payment that didn't finish: a calm line ("Payment not completed — no money was taken.") and a Try again button.
export default function PayRetry({ error, onRetry, busy = false, testid = 'pay-retry' }) {
  if (!error) return null;
  return (
    <div role="alert" className="well stack g8" data-testid={testid} style={{ margin: 0 }}>
      <span className="small">{error}</span>
      {onRetry && <button type="button" className="btn btn-outline" style={{ alignSelf: 'flex-start', minHeight: 44 }} disabled={busy} onClick={onRetry}>Try again</button>}
    </div>
  );
}
