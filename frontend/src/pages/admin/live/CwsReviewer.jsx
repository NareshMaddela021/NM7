// Admin -> Auto Apply -> "Chrome Web Store reviewer": the made-up account Google's reviewer signs in with to test the
// Nm7 Apply helper (backend/app/autoapply/reviewer.py). The owner creates it here, sees and copies its password (only
// after "Show password", and each showing is in the audit log) and can make a new one. Other admins don't see the card.
import { useState } from 'react';
import { http, useAction, useApi } from './common';

const BASE = '/api/admin/auto-apply/cws-reviewer';

export function ReviewerCard({ d, password, busy, onShow, onHide, onReset, onCopy }) {
  return (
    <section className="card-sm stack g8 adx-demo" aria-label="Chrome Web Store reviewer" data-testid="aa-cws">
      <strong className="small">Chrome Web Store reviewer</strong>
      <span className="xs muted">A made-up person (Priya Sharma, demo) for Google’s review of the Nm7 Apply helper. She signs in with email and password, always has the same 2 jobs ready, and nothing is ever sent for her. She can’t change her password or email, delete the account or pay. Paste the password into the Test instructions tab of the Chrome Web Store dashboard.</span>
      {!d.exists ? (
        <button type="button" className="btn btn-outline" style={{ alignSelf: 'flex-start' }} disabled={busy} onClick={onReset} data-testid="aa-cws-create">Create the reviewer account</button>
      ) : (
        <div className="stack g8">
          <span className="small">Email: <strong data-testid="aa-cws-email">{d.email}</strong></span>
          <span className="small row g8" style={{ flexWrap: 'wrap', alignItems: 'center' }}>
            Password:{' '}
            {password
              ? <code data-testid="aa-cws-password" style={{ wordBreak: 'break-all', userSelect: 'all' }}>{password}</code>
              : <span className="muted" data-testid="aa-cws-hidden">hidden</span>}
          </span>
          <div className="row g8" style={{ flexWrap: 'wrap' }}>
            {password
              ? <><button type="button" className="btn btn-outline btn-sm" onClick={() => onCopy(password)} data-testid="aa-cws-copy">Copy password</button><button type="button" className="link-btn small" onClick={onHide}>Hide</button></>
              : <button type="button" className="btn btn-outline btn-sm" disabled={busy} onClick={onShow} data-testid="aa-cws-show">Show password</button>}
            <button type="button" className="btn btn-outline btn-sm" disabled={busy} onClick={onReset} data-testid="aa-cws-reset">Reset password</button>
          </div>
          {d.fromServer && <span className="xs muted">The password comes from the server setting CWS_REVIEWER_PASSWORD. Reset password keeps it and signs the reviewer out.</span>}
          <span className="xs muted">Sign-in page: {d.loginUrl}. Practice pages: {d.practice.map((p) => p.url).join(' and ')}. Every sign-in resets her jobs ready and signs her helper out.</span>
        </div>
      )}
    </section>
  );
}

export default function CwsReviewer({ toast }) {
  const st = useApi(BASE);
  const [busy, run] = useAction(toast);
  const [password, setPassword] = useState('');
  if (!st.data) return null; // loading, or not the owner (403): no card
  const show = () => run(async () => setPassword((await http(`${BASE}/password`)).password));
  const reset = () => run(async () => { await http(`${BASE}/password`, { method: 'POST' }); setPassword((await http(`${BASE}/password`)).password); st.reload(); }, st.data.exists ? 'New password made' : 'Reviewer account created');
  const copy = (v) => navigator.clipboard.writeText(v).then(() => toast('Password copied'), () => toast('Couldn’t copy. Select the password and copy it.'));
  return <ReviewerCard d={st.data} password={password} busy={busy} onShow={show} onHide={() => setPassword('')} onReset={reset} onCopy={copy} />;
}
