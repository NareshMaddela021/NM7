// /demo-student#t=… — opened from Admin → Auto Apply → "Reset and open as student (Auto Apply)" or "(Easy dashboard,
// Telugu)". Signs this browser in as that made-up demo student (the link works once), then opens their page.
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Spinner } from '../../components/ui';
import { http } from '../../services/http';

let started = null; // one sign-in per page load (React runs effects twice in development)

export default function DemoStudentLogin() {
  const [err, setErr] = useState('');
  useEffect(() => {
    if (started) return;
    const token = new URLSearchParams(window.location.hash.slice(1)).get('t') || '';
    window.history.replaceState(null, '', window.location.pathname); // the token never stays in the address bar
    started = http('/api/public/demo-student', { method: 'POST', body: { token } })
      .then((r) => window.location.assign(r.path), (e) => setErr(e.message || 'This demo link didn’t work.'));
  }, []);
  return (
    <main id="main" className="container stack g12" style={{ maxWidth: 560, padding: '48px 16px' }}>
      {err ? (
        <div className="card stack g8" role="alert"><strong>Couldn’t open the demo</strong><span className="small muted">{err}</span><Link to="/admin/auto-apply">Back to Admin → Auto Apply</Link></div>
      ) : <div className="row g12 muted" role="status"><Spinner /> Opening the demo student…</div>}
    </main>
  );
}
