// /hire/walkin/:token — the QR at a company's walk-in drive (Phase 5, H7). Signed in, the candidate sees the company,
// role, time and place, ticks the box to share their profile, and taps "I'm here". The company then sees them in
// Applicants (Shortlisted) and on the walk-in list.
import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import Header from '../components/Header';
import { http } from '../services/http';

export default function HireWalkin() {
  const { token } = useParams();
  const [w, setW] = useState(null);
  const [agree, setAgree] = useState(false);
  const [st, setSt] = useState({});
  useEffect(() => { http(`/api/hire/walkin/${encodeURIComponent(token)}`).then(setW, (e) => setSt({ error: e.message })); }, [token]);
  const go = async () => {
    setSt({ busy: true });
    try { await http(`/api/hire/walkin/${encodeURIComponent(token)}/checkin`, { method: 'POST', body: { consent: agree } }); setW({ ...w, checkedIn: true }); setSt({}); } catch (e) { setSt({ error: e.message }); }
  };
  return (
    <>
      <Header />
      <main id="main" className="container stack g16" style={{ maxWidth: 560, padding: '48px 16px' }} data-testid="walkin">
        <h1 className="display h2">Walk-in check-in</h1>
        {!w ? (st.error ? <p role="alert" className="error">{st.error}</p> : <p className="muted">Loading…</p>) : (
          <>
            <p><strong>{w.role}</strong> · {w.company}<br /><span className="muted">{new Date(w.at).toLocaleString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Kolkata' })} · {w.place}</span></p>
            {w.checkedIn ? (
              <p data-testid="walkin-done">You’re checked in. Wait for your name to be called. You can follow it in <Link to="/me/jobs">My applications</Link>.</p>
            ) : (
              <>
                <label className="row g8 small" style={{ alignItems: 'flex-start', flexWrap: 'nowrap' }}><input type="checkbox" checked={agree} onChange={(e) => setAgree(e.target.checked)} style={{ marginTop: 3 }} data-testid="walkin-agree" /><span>Share my profile and resume with {w.company} for this role.</span></label>
                {st.error && <p role="alert" className="error">{st.error}</p>}
                <button type="button" className="btn btn-ink" style={{ alignSelf: 'flex-start' }} disabled={st.busy} onClick={go} data-testid="walkin-go">I’m here</button>
              </>
            )}
          </>
        )}
      </main>
    </>
  );
}
