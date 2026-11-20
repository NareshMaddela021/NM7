// "What would you like to do?" — right after sign-up (email or Google), and later from the account menu's "Add another
// role" (/welcome?add=1). One account for individuals: job seeker, student and expert are roles of the same account
// (lib/roles.js). A role from the link (?role=jobseeker|student|expert, from the home page buttons and old sign-up
// links) is ticked already. Working as an expert starts the expert application; paid work comes only after Nm7
// approves it.
import { useState } from 'react';
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router-dom';
import { Logo, ThemeToggle } from '../../components/Header';
import { Spinner } from '../../components/ui';
import { homeFor, useAuth } from '../../lib/auth';
import { usePageMeta } from '../../lib/meta';
import { safeNext } from '../../lib/safeNext';
import { ROLES, SETUP, addRoles, afterPick, roleFromLink, rolesOf } from '../../lib/roles';

const CHOICES = {
  jobseeker: ['Find a job', 'Fresher or experienced: your Job Profile, resumes and job applications.'],
  student: ['I’m a student', 'Find the right role for you, learn with free courses and practise for interviews.'],
  expert: ['Work as an expert', 'Write resumes for others and get paid per order, once Nm7 approves your application.'],
};

export default function Welcome() {
  const { user, ready } = useAuth();
  const nav = useNavigate();
  const [params] = useSearchParams();
  const next = safeNext(params.get('next'));
  const adding = params.get('add') === '1';
  const linked = roleFromLink(params.get('role'));
  const have = user && !user.rolesPending ? rolesOf(user) : [];
  const [picked, setPicked] = useState(() => (linked && !have.includes(linked) ? [linked] : []));
  const [terms, setTerms] = useState(false);
  const [agree, setAgree] = useState(false); // a new Google account: the sign-up form's one tick
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  usePageMeta({ title: adding ? 'Add another role' : 'What would you like to do?', noindex: true });
  if (!ready) return <main className="container row g8" style={{ padding: 40 }} aria-busy="true"><Spinner /><span className="muted">Loading…</span></main>;
  if (!user) return <Navigate to={`/login?next=${encodeURIComponent(`/welcome${adding ? '?add=1' : ''}`)}`} replace />;
  if (user.role === 'admin') return <Navigate to="/admin" replace />;
  const open = ROLES.filter((r) => !have.includes(r));
  const needTerms = picked.includes('expert') && !have.includes('expert');
  const needAgree = !!user.rolesPending && user.hasPassword === false; // made with Google: never saw the form
  const toggle = (r) => { setErr(''); setPicked((p) => (p.includes(r) ? p.filter((x) => x !== r) : [...p, r])); };
  const submit = async (e) => {
    e.preventDefault();
    if (!picked.length) { setErr(adding ? 'Pick the role to add.' : 'Pick at least one.'); return; }
    if (needAgree && !agree) { setErr('Please tick the box to agree to the Terms and Privacy Policy.'); return; }
    if (needTerms && !terms) { setErr('Please agree to the Expert Terms to work as an expert.'); return; }
    const active = picked.includes(linked) ? linked : ROLES.find((r) => picked.includes(r));
    setBusy(true); setErr('');
    try {
      const u = await addRoles({ add: picked, active, expertTerms: terms, termsAccepted: agree });
      nav(adding ? next || SETUP[active] : afterPick(u, next), { replace: true });
    } catch (x) { setErr(x.message || 'Please try again.'); setBusy(false); }
  };
  return (
    <>
      <header className="site-header"><div className="bar"><Logo /><ThemeToggle /></div></header>
      <main className="container stack g20" style={{ maxWidth: 560, padding: '40px 16px 64px' }}>
        <div className="stack g4">
          <h1 className="display" style={{ fontSize: 32 }}>{adding ? 'Add another role' : 'What would you like to do?'}</h1>
          <span className="muted">{adding ? 'Each role has its own dashboard. Switch any time from the account menu.' : 'Pick one or more. You can add another later from the account menu.'}</span>
        </div>
        <form className="stack g12" noValidate onSubmit={submit} data-testid="role-picker">
          <fieldset className="stack g12" style={{ border: 0, margin: 0, padding: 0, minWidth: 0 }}>
            <legend className="sr-only">Roles</legend>
            {ROLES.map((r) => {
              const mine = have.includes(r);
              const on = mine || picked.includes(r);
              return (
                <label key={r} className="card row g12" data-role={r} style={{ alignItems: 'flex-start', cursor: mine ? 'default' : 'pointer', minHeight: 44, borderColor: on ? 'var(--ink)' : undefined, opacity: mine ? 0.7 : 1 }}>
                  <input type="checkbox" checked={on} disabled={mine || busy} onChange={() => toggle(r)} style={{ marginTop: 4, width: 20, height: 20, flex: 'none' }} />
                  <span className="stack g4" style={{ minWidth: 0 }}>
                    <strong>{CHOICES[r][0]}{mine && <span className="xs muted"> · already yours</span>}</strong>
                    <span className="small muted">{CHOICES[r][1]}</span>
                  </span>
                </label>
              );
            })}
          </fieldset>
          {needTerms && (
            <label className="check small" style={{ alignItems: 'flex-start' }}>
              <input type="checkbox" checked={terms} onChange={(e) => { setTerms(e.target.checked); setErr(''); }} />
              <span>I agree to the <Link to="/expert-terms" target="_blank">Expert Terms</Link>. I can take paid work only after Nm7 approves my application.</span>
            </label>
          )}
          {needAgree && (
            <>
              <label className="check small" style={{ alignItems: 'flex-start' }}>
                <input type="checkbox" checked={agree} onChange={(e) => { setAgree(e.target.checked); setErr(''); }} aria-describedby="wl-agree-m" />
                <span>I agree to the <Link to="/terms" target="_blank">Terms</Link> and <Link to="/privacy" target="_blank">Privacy Policy</Link>, and I’m 18 or older (or my parent or guardian agrees).</span>
              </label>
              <span id="wl-agree-m" className="help" style={{ marginTop: -8 }}>Under 18? Before skill checks or AI interviews we ask your date of birth, and a parent or guardian confirms by email.</span>
            </>
          )}
          {err && <p role="alert" className="error" style={{ margin: 0 }}>{err}</p>}
          {!open.length && <p className="small muted" style={{ margin: 0 }}>You have every role already.</p>}
          <button type="submit" className="btn btn-ink btn-lg" disabled={busy || !open.length}>{busy && <Spinner />}Continue</button>
          {adding && <Link to={next || homeFor(user)} className="small" style={{ alignSelf: 'flex-start', padding: '10px 0' }}>Cancel</Link>}
        </form>
      </main>
    </>
  );
}
