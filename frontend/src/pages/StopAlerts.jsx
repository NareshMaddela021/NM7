// /stop-alerts#t=…: the "Stop these emails" link in the resume health email (no sign-in needed). The token is in the
// address fragment, so it never reaches server logs; one tap confirms.
import { useState } from 'react';
import { Link } from 'react-router-dom';
import Header from '../components/Header';
import { http } from '../services/http';

const tokenOf = (hash) => (/(?:^#|&)t=([A-Za-z0-9._-]{10,200})/.exec(hash || '') || [])[1] || '';

export default function StopAlerts() {
  const [token] = useState(() => tokenOf(typeof window !== 'undefined' ? window.location.hash : ''));
  const [st, setSt] = useState({});
  const stop = async () => {
    setSt({ busy: true });
    try { await http('/api/public/health/unsubscribe', { method: 'POST', body: { token } }); setSt({ done: true }); } catch (e) { setSt({ error: e.message }); }
  };
  return (
    <>
      <Header />
      <main id="main" className="container stack g16" style={{ maxWidth: 560, padding: '48px 16px' }}>
        <h1 className="display h2">Resume health emails</h1>
        {st.done ? (
          <p data-testid="stop-done">Done — you won’t get resume health emails any more. You can turn them back on in <Link to="/me/settings">Settings</Link>.</p>
        ) : !token ? (
          <p>This link is incomplete. You can turn these emails off in <Link to="/me/settings">Settings</Link>.</p>
        ) : (
          <>
            <p className="muted">Stop the emails about small fixes for your resume? The tips stay on your dashboard.</p>
            {st.error && <p role="alert" className="error">{st.error}</p>}
            <button type="button" className="btn btn-ink" style={{ alignSelf: 'flex-start' }} disabled={st.busy} onClick={stop} data-testid="stop-confirm">Stop these emails</button>
          </>
        )}
      </main>
    </>
  );
}
