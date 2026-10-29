// Recruiter accounts (R1): /recruiter signs a recruiter in with an emailed code (no password), /recruiter/drives is
// "My drives": every college and invite sent to that email, with students viewed, shortlisted, interviewed, selected
// and offers, and the recruiter's own notes. An active invite opens in the portal (/recruiter/i.<id>); a past one
// shows its counts and notes only (names only when that college allows it).
import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Spinner } from '../../components/ui';
import { usePageMeta } from '../../lib/meta';
import { keepAccount, readAccount, STAGE_LABEL } from '../../lib/recruiterPortal';
import { API_BASE, ApiError } from '../../services/http';
import Shell from './RecruiterShell';

async function rq(path, { method = 'GET', body } = {}) {
  let res;
  try {
    res = await fetch(API_BASE + path, {
      method,
      headers: { ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...(readAccount() ? { 'X-Recruiter-Account': readAccount() } : {}) },
      body: body !== undefined ? JSON.stringify(body) : undefined,
      cache: 'no-store',
    });
  } catch {
    throw new ApiError(0, 'network', 'We can’t reach the server. Check your internet and try again.');
  }
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new ApiError(res.status, data?.error?.code || 'error', data?.error?.message || 'Something went wrong. Please try again.');
  return data;
}

const day = (t) => (t ? new Date(t).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '');
const STATE = { active: ['Active', 'badge-success'], expired: ['Ended', ''], revoked: ['Ended by the college', 'badge-warning'] };

export default function RecruiterHome() {
  const [account, setAccount] = useState(readAccount);
  usePageMeta({ title: account ? 'My drives' : 'Recruiter sign-in', description: 'Colleges that invited you on Nm7.', noindex: true });
  return <Shell>{account ? <Drives onSignedOut={() => { keepAccount(''); setAccount(''); }} /> : <SignIn onSession={(s) => { keepAccount(s); setAccount(s); }} />}</Shell>;
}

function SignIn({ onSession }) {
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const send = async (e) => {
    e?.preventDefault(); setBusy(true); setError('');
    try { await rq('/api/recruiter-account/code', { method: 'POST', body: { email } }); setSent(true); } catch (err) { setError(err.message); } finally { setBusy(false); }
  };
  const verify = async (e) => {
    e.preventDefault(); setBusy(true); setError('');
    try {
      const r = await rq('/api/recruiter-account/session', { method: 'POST', body: { email, code } });
      onSession(r.session); navigate('/recruiter/drives', { replace: true });
    } catch (err) { setError(err.message); setBusy(false); }
  };
  return (
    <form className="card stack g12" style={{ maxWidth: 460 }} onSubmit={sent ? verify : send} aria-label="Recruiter sign-in">
      <h1 className="display" style={{ fontSize: 26 }}>Recruiter sign-in</h1>
      <p className="small muted">Use the email a college invited. We email you a one-time code (no password). You’ll see My drives: every college and drive you worked with on Nm7.</p>
      <div className="field"><label className="label" htmlFor="ra-email">Work email</label>
        <input id="ra-email" type="email" className="input" required autoComplete="email" value={email} disabled={sent} onChange={(e) => setEmail(e.target.value)} /></div>
      {!sent ? <button type="submit" className="btn btn-ink" disabled={busy || !email}>{busy ? 'Sending…' : 'Email me a code'}</button> : (
        <>
          <p className="small" role="status">If a college invited this address, a code is on its way.</p>
          <div className="field"><label className="label" htmlFor="ra-code">Code from the email</label>
            <input id="ra-code" className="input mono" inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} /></div>
          <button type="submit" className="btn btn-ink" disabled={busy || code.length !== 6}>Sign in</button>
          <button type="button" className="link-btn small" style={{ alignSelf: 'flex-start' }} disabled={busy} onClick={() => { setSent(false); setCode(''); }}>Use another email</button>
        </>
      )}
      {error && <p className="error" role="alert">{error}</p>}
    </form>
  );
}

function Drives({ onSignedOut }) {
  const [st, setSt] = useState({ loading: true });
  const load = useCallback(() => rq('/api/recruiter-account/drives').then((data) => setSt({ data }), (error) => { if (error.status === 401) onSignedOut(); else setSt({ error }); }), [onSignedOut]);
  useEffect(() => { load(); }, [load]);
  const signOut = async () => { await rq('/api/recruiter-account/sign-out', { method: 'POST', body: {} }).catch(() => {}); onSignedOut(); };
  if (st.loading) return <div className="row g12 muted" role="status"><Spinner /> Loading…</div>;
  if (st.error) return <p className="error" role="alert">{st.error.message}</p>;
  const { data } = st;
  const active = data.drives.filter((d) => d.state === 'active');
  const past = data.drives.filter((d) => d.state !== 'active');
  return (
    <div className="stack g16">
      <div className="row between g8" style={{ flexWrap: 'wrap' }}>
        <div className="stack g4"><h1 className="display" style={{ fontSize: 28 }}>My drives</h1><span className="xs muted">{data.name} · {data.emailHint}</span></div>
        <button type="button" className="btn btn-outline" onClick={signOut}>Sign out</button>
      </div>
      <p className="xs faint">Each college decides who you can see. Students show only while that college’s invite is active; when it ends you keep the counts and your own notes.</p>
      {data.drives.length === 0 && <div className="well small muted">No drives yet. When a college invites this email, it shows here.</div>}
      {active.length > 0 && <section className="stack g12" aria-label="Active drives"><h2 className="small">Active</h2>{active.map((d) => <Drive key={d.id} d={d} />)}</section>}
      {past.length > 0 && <section className="stack g12" aria-label="Past drives"><h2 className="small">Past</h2>{past.map((d) => <Drive key={d.id} d={d} />)}</section>}
    </div>
  );
}

function Drive({ d }) {
  const [label, tone] = STATE[d.state] || STATE.expired;
  const c = d.counts;
  return (
    <article className="card stack g8" data-testid="my-drive">
      <div className="row between g8" style={{ flexWrap: 'wrap' }}>
        <div className="stack g4"><strong>{d.orgName}</strong><span className="xs muted">{d.company} · invited {day(d.createdAt)} · {d.state === 'active' ? 'until' : 'ended'} {day(d.expiresAt)}</span></div>
        <span className={`badge ${tone}`}>{label}</span>
      </div>
      <dl className="row g16 small" style={{ flexWrap: 'wrap', margin: 0 }}>
        {[['Viewed', c.viewed], ['Shortlisted', c.shortlisted], ['Interviewed', c.interviewed], ['Selected', c.selected], ['Offers', c.offers]].map(([k, v]) => (
          <div key={k} className="stack" style={{ minWidth: 70 }}><dt className="xs muted">{k}</dt><dd style={{ margin: 0, fontWeight: 700 }}>{v}</dd></div>
        ))}
      </dl>
      {d.notes.length > 0 && (
        <details>
          <summary className="small">Your notes ({d.notes.length})</summary>
          <ul className="stack g4 small" style={{ paddingLeft: 18, marginTop: 8 }}>
            {d.notes.map((n, i) => <li key={i}><strong>{n.name || 'A student'}</strong> · {STAGE_LABEL[n.stage] || n.stage}: {n.note}</li>)}
          </ul>
        </details>
      )}
      {d.path ? <Link to={d.path} className="btn btn-ink" style={{ alignSelf: 'flex-start' }}>Open students</Link> : <span className="xs faint">This invite has ended: students are no longer shown.</span>}
    </article>
  );
}
