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
import FeedbackForm from './FeedbackForm';
import { Still } from '../newhome/ParticleStage';
import { Chip, Empty } from '../me/kit';
import { IcShield } from '../../components/icons';

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
const STATE = { active: ['Active', 'ok'], expired: ['Ended', 'neutral'], revoked: ['Ended by the college', 'warn'] };
const initial = (s) => (s || '?').trim().charAt(0).toUpperCase();

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
    <form className="mcard rc-signin" onSubmit={sent ? verify : send} aria-label="Recruiter sign-in">
      <span className="rc-signin-art" aria-hidden="true"><Still shape="handshake" tint="company" className="rc-still" /></span>
      <span className="mkicker rc-kicker">Recruiter portal</span>
      <h1 className="display rc-h1">Recruiter sign-in</h1>
      <p className="rc-lead">Use the email a college invited. We email you a one-time code (no password). You’ll see My drives: every college and drive you worked with on Nm7.</p>
      <ol className="rc-steps" aria-hidden="true"><li className={sent ? 'done' : 'now'}>1</li><li className={sent ? 'now' : ''}>2</li></ol>
      <div className="field"><label className="label" htmlFor="ra-email">Work email</label>
        <input id="ra-email" type="email" className="input" required autoComplete="email" value={email} disabled={sent} onChange={(e) => setEmail(e.target.value)} /></div>
      {!sent ? <button type="submit" className="btn btn-signal rc-wide" disabled={busy || !email}>{busy ? 'Sending…' : 'Email me a code'}</button> : (
        <>
          <p className="rc-sent" role="status">If a college invited this address, a code is on its way.</p>
          <div className="field"><label className="label" htmlFor="ra-code">Code from the email</label>
            <input id="ra-code" className="input mono rc-code" inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} /></div>
          <button type="submit" className="btn btn-signal rc-wide" disabled={busy || code.length !== 6}>Sign in</button>
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
  if (st.error) return <p className="error mcard" role="alert">{st.error.message}</p>;
  const { data } = st;
  const active = data.drives.filter((d) => d.state === 'active');
  const past = data.drives.filter((d) => d.state !== 'active');
  return (
    <div className="stack g20">
      <div className="rc-head">
        <div className="rc-head-text">
          <span className="mkicker rc-kicker">Recruiter portal</span>
          <h1 className="display rc-h1">My drives</h1>
          <span className="rc-sub">{data.name} · {data.emailHint}</span>
        </div>
        <button type="button" className="btn btn-outline" onClick={signOut}>Sign out</button>
        <span className="rc-head-art" aria-hidden="true"><Still shape="college" tint="company" className="rc-still" /></span>
      </div>
      <p className="rc-note"><IcShield size={16} /> Each college decides who you can see. Students show only while that college’s invite is active; when it ends you keep the counts and your own notes.</p>
      {data.drives.length === 0 && <Empty shape="college" tint="company">No drives yet. When a college invites this email, it shows here.</Empty>}
      {active.length > 0 && <section className="rc-group" aria-label="Active drives"><h2 className="rc-group-h"><span className="rc-dot rc-dot-ok" aria-hidden="true" />Active <span className="rc-count">{active.length}</span></h2><div className="rc-drive-grid">{active.map((d) => <Drive key={d.id} d={d} onChanged={load} />)}</div></section>}
      {past.length > 0 && <section className="rc-group" aria-label="Past drives"><h2 className="rc-group-h"><span className="rc-dot" aria-hidden="true" />Past <span className="rc-count">{past.length}</span></h2><div className="rc-drive-grid">{past.map((d) => <Drive key={d.id} d={d} onChanged={load} />)}</div></section>}
    </div>
  );
}

function Drive({ d, onChanged }) {
  const [label, tone] = STATE[d.state] || STATE.expired;
  const [fb, setFb] = useState(false);
  const path = `/api/recruiter-account/drives/${d.id}/feedback`;
  const c = d.counts;
  return (
    <article className={`mcard rc-drive rc-drive-${d.state}`} data-testid="my-drive">
      <header className="rc-drive-head">
        <span className="rc-avatar" aria-hidden="true">{initial(d.orgName)}</span>
        <span className="rc-drive-titles"><strong className="rc-drive-name">{d.orgName}</strong><span className="rc-drive-meta">{d.company} · invited {day(d.createdAt)} · {d.state === 'active' ? 'until' : 'ended'} {day(d.expiresAt)}</span></span>
        <Chip tone={tone}>{label}</Chip>
      </header>
      <dl className="rc-funnel">
        {[['Viewed', c.viewed], ['Shortlisted', c.shortlisted], ['Interviewed', c.interviewed], ['Selected', c.selected], ['Offers', c.offers]].map(([k, v]) => (
          <div key={k} className="rc-funnel-step"><dt>{k}</dt><dd>{v}</dd></div>
        ))}
      </dl>
      {d.notes.length > 0 && (
        <details className="rc-notes">
          <summary>Your notes ({d.notes.length})</summary>
          <ul>
            {d.notes.map((n, i) => <li key={i}><strong>{n.name || 'A student'}</strong> · {STAGE_LABEL[n.stage] || n.stage}: {n.note}</li>)}
          </ul>
        </details>
      )}
      <div className="rc-actions">
        {d.path ? <Link to={d.path} className="btn btn-signal">Open students</Link> : <span className="rc-ended">This invite has ended: students are no longer shown.</span>}
        {d.feedbackOn && <button type="button" className="btn btn-outline" onClick={() => setFb(true)}>{d.feedbackGiven ? 'Edit feedback' : 'Give feedback'}</button>}
      </div>
      {fb && <FeedbackForm load={() => rq(path)} save={(body) => rq(path, { method: 'PUT', body })} onClose={() => setFb(false)} onSaved={onChanged} />}
    </article>
  );
}
