// /org/demo-login#t=… — opened from Admin -> Organizations -> Demo -> "Reset and open as coordinator". Signs this
// browser in as the demo college's made-up coordinator (the token is used once), then opens the portal.
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Spinner } from '../../components/ui';
import { http } from '../../services/http';
import { Still } from '../newhome/ParticleStage';
import '../../styles/me-kit.css';
import '../../styles/org-signup.css';

let started = null; // one sign-in per page load (React runs effects twice in development)

export default function DemoLogin() {
  const [err, setErr] = useState('');
  useEffect(() => {
    if (started) return;
    const token = new URLSearchParams(window.location.hash.slice(1)).get('t') || '';
    window.history.replaceState(null, '', window.location.pathname); // the token never stays in the address bar
    started = http('/api/public/demo-coordinator', { method: 'POST', body: { token } })
      .then((r) => window.location.assign(`/org/${encodeURIComponent(r.orgId)}`), (e) => setErr(e.message || 'This demo link didn’t work.'));
  }, []);
  return (
    <main id="main" className="container stack g12 od-page" style={{ maxWidth: 560, padding: '48px 16px' }}>
      <div className={`mcard od-card ${err ? 'mcard-bad' : ''}`}>
        <span className="od-art" aria-hidden="true"><Still shape="college" className="od-still" /></span>
        {err ? (
          <div className="stack g8" role="alert" style={{ alignItems: 'center' }}><strong className="od-title">Couldn’t open the demo</strong><span className="small muted">{err}</span><Link to="/admin/orgs" className="btn btn-outline">Back to Admin > Organizations</Link></div>
        ) : <div className="row g12 muted od-wait" role="status"><Spinner /> Opening the demo college as its coordinator…</div>}
      </div>
    </main>
  );
}
