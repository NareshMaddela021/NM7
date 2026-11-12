// /hire/still-ready#t=…: the one-tap "Still ready" link in the Ready to join reminder email (no sign-in needed).
// The token is in the address fragment, so it never reaches server logs. One tap keeps the candidate visible to
// companies hiring now for another week.
import { useState } from 'react';
import { Link } from 'react-router-dom';
import Header from '../components/Header';
import { http } from '../services/http';

const tokenOf = (hash) => (/(?:^#|&)t=([A-Za-z0-9._-]{10,200})/.exec(hash || '') || [])[1] || '';

export default function HireStillReady() {
  const [token] = useState(() => tokenOf(typeof window !== 'undefined' ? window.location.hash : ''));
  const [st, setSt] = useState({});
  const yes = async () => {
    setSt({ busy: true });
    try { await http('/api/public/hire/still-ready', { method: 'POST', body: { token } }); setSt({ done: true }); } catch (e) { setSt({ error: e.message }); }
  };
  return (
    <>
      <Header />
      <main id="main" className="container stack g16" style={{ maxWidth: 560, padding: '48px 16px' }}>
        <h1 className="display h2">Still ready to join?</h1>
        {st.done ? (
          <p data-testid="still-done">Thanks: companies hiring now can see you for another week. You can change the details or pause in <Link to="/me/hire">Ready to join</Link>.</p>
        ) : !token ? (
          <p>This link is incomplete. You can tap Still ready in <Link to="/me/hire">Ready to join</Link>.</p>
        ) : (
          <>
            <p className="muted">Tap below to stay visible to companies hiring now for another week. Your phone number and email stay hidden until you accept an invite.</p>
            {st.error && <p role="alert" className="error">{st.error}</p>}
            <button type="button" className="btn btn-ink" style={{ alignSelf: 'flex-start' }} disabled={st.busy} onClick={yes} data-testid="still-confirm">Still ready</button>
          </>
        )}
      </main>
    </>
  );
}
