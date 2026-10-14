// Sign in, sign up (customer or expert, confirmed with an email code), forgot password, admin two-step login, and route guards.
import { useState } from 'react';
import { Link, Navigate, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { Logo, ThemeToggle } from '../../components/Header';
import { Spinner, useToast } from '../../components/ui';
import {
  useAuth, signIn, signUp, verifyEmail, resendCode, sendReset, resetPassword, adminPassword, adminVerify, signOut,
  homeFor, passwordIssue, EMAIL_RE, PHONE_RE, DEMO_CODE, SAMPLE_PASSWORD,
} from '../../lib/auth';
import SiteFooter from '../../components/SiteFooter';

const isPreview = import.meta.env.VITE_PREVIEW === '1';
const safeNext = (n) => (n && n.startsWith('/') && !n.startsWith('//') ? n : null);

function Shell({ title, sub, children, wide }) {
  return (
    <>
      <header className="site-header"><div className="bar"><Logo /><ThemeToggle /></div></header>
      <main className="container stack g20" style={{ maxWidth: wide ? 560 : 460, padding: '40px 20px 64px' }}>
        <div className="stack g4"><h1 className="display" style={{ fontSize: 32 }}>{title}</h1>{sub && <span className="muted">{sub}</span>}</div>
        {children}
      </main>
      <SiteFooter />
    </>
  );
}
function Field({ id, label, error, hint, ...p }) {
  return (
    <div className="field">
      <label htmlFor={id} className="label">{label}</label>
      <input id={id} className="input" style={{ height: 46 }} aria-invalid={error ? 'true' : undefined} aria-describedby={`${id}-m`} {...p} />
      {(error || hint) && <span id={`${id}-m`} className={error ? 'error' : 'help'}>{error || hint}</span>}
    </div>
  );
}
function Demo({ children }) {
  if (!isPreview) return null;
  return <div className="well xs" style={{ borderLeft: '3px solid var(--signal)' }}><strong>Preview only:</strong> {children}</div>;
}
function CodeInput({ value, onChange, id = 'otp', label = '6-digit code' }) {
  return <Field id={id} label={label} inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={value} onChange={(e) => onChange(e.target.value.replace(/\D/g, '').slice(0, 6))} style={{ height: 46, letterSpacing: '0.3em', fontFamily: 'var(--font-mono)' }} />;
}

/* ---------- confirm email with the 6-digit code ---------- */
function VerifyEmail({ email, note, onDone, onBack }) {
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [info, setInfo] = useState('');
  const run = async (fn) => { setBusy(true); setErr(''); setInfo(''); try { await fn(); } catch (x) { setErr(x.message); } finally { setBusy(false); } };
  return (
    <Shell title="Confirm your email" sub={note || `We sent a 6-digit code to ${email}. It works for 10 minutes.`}>
      <form className="card stack g16" noValidate onSubmit={(e) => { e.preventDefault(); run(async () => onDone(await verifyEmail(email, code))); }}>
        <CodeInput value={code} onChange={setCode} />
        {err && <p role="alert" className="error" style={{ margin: 0 }}>{err}</p>}
        {info && <p role="status" className="help" style={{ margin: 0 }}>{info}</p>}
        <button type="submit" className="btn btn-ink btn-lg" disabled={busy || code.length !== 6}>{busy && <Spinner />}Confirm & continue</button>
        <span className="row g12 small">
          <button type="button" className="link-btn small" disabled={busy} onClick={() => run(async () => { await resendCode(email); setInfo('A new code is on its way. Check your spam folder too.'); })}>Send the code again</button>
          {onBack && <button type="button" className="link-btn small" onClick={onBack}>Use a different email</button>}
        </span>
      </form>
      <Demo>the code is <code>{DEMO_CODE}</code>.</Demo>
    </Shell>
  );
}

/* ---------- sign in ---------- */
export function Login() {
  const nav = useNavigate();
  const [params] = useSearchParams();
  const next = safeNext(params.get('next'));
  const { user } = useAuth();
  const [f, setF] = useState({ email: '', password: '' });
  const [verify, setVerify] = useState(null); // { email, note } when the account still needs its email code
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [show, setShow] = useState(false);
  const go = (u) => nav(next && !(u.role === 'expert' && next.startsWith('/me')) && !(u.role === 'customer' && next.startsWith('/expert')) ? next : homeFor(u), { replace: true });
  if (verify) return <VerifyEmail email={verify.email} note={verify.note} onDone={go} onBack={() => setVerify(null)} />;
  if (user && user.role !== 'admin') return <Navigate to={next || homeFor(user)} replace />;
  const submit = async () => {
    setBusy(true); setErr('');
    try { go(await signIn(f.email, f.password)); } catch (e) {
      if (e.code === 'email_not_verified') setVerify({ email: f.email.trim(), note: `${e.message} It went to ${f.email.trim()}.` });
      else setErr(e.message);
    } finally { setBusy(false); }
  };
  const fill = (email) => setF({ ...f, email, password: SAMPLE_PASSWORD });
  return (
    <Shell title="Sign in" sub="Track your orders, edit your resumes and chat with your expert.">
      <form className="card stack g16" noValidate onSubmit={(e) => { e.preventDefault(); submit(); }}>
        <Field id="li-e" label="Email" type="email" autoComplete="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} />
        <div className="stack g4">
          <Field id="li-p" label="Password" type={show ? 'text' : 'password'} autoComplete="current-password" value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} />
          <span className="row between"><label className="row g4 xs"><input type="checkbox" checked={show} onChange={(e) => setShow(e.target.checked)} />Show password</label><Link to="/forgot-password" className="xs">Forgot password?</Link></span>
        </div>
        {err && <p role="alert" className="error" style={{ margin: 0 }}>{err}</p>}
        <button type="submit" className="btn btn-ink btn-lg" disabled={busy || !f.email || !f.password}>{busy && <Spinner />}Sign in</button>
      </form>
      <span className="small">New here? <Link to={`/signup${next ? `?next=${encodeURIComponent(next)}` : ''}`}>Create an account</Link> · Experts: <Link to="/signup?as=expert">join as an expert</Link></span>
      <Demo>
        sample accounts use password <code>{SAMPLE_PASSWORD}</code>; every email code is <code>{DEMO_CODE}</code>.{' '}
        <button type="button" className="link-btn xs" onClick={() => fill('saivarsha@example.com')}>Customer · Sai Varsha</button>{' · '}
        <button type="button" className="link-btn xs" onClick={() => fill('naresh@example.com')}>Expert · Naresh</button>{' · '}
        <Link to="/admin/login" className="xs">Admin login</Link>
      </Demo>
    </Shell>
  );
}

/* ---------- sign up ---------- */
export function Signup() {
  const nav = useNavigate();
  const [params] = useSearchParams();
  const next = safeNext(params.get('next'));
  const { user } = useAuth();
  const [role, setRole] = useState(params.get('as') === 'expert' ? 'expert' : 'customer');
  const [f, setF] = useState({ name: '', email: '', phone: '', password: '', confirm: '', agree: false });
  const [showPw, setShowPw] = useState(false);
  const [touched, setTouched] = useState(false);
  const [pending, setPending] = useState(null); // { email } waiting for the email code
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  if (user && !pending) return <Navigate to={homeFor(user)} replace />;
  const errs = {
    name: f.name.trim().length < 2 && 'Enter your full name',
    email: !EMAIL_RE.test(f.email.trim()) && 'Enter a valid email',
    phone: !PHONE_RE.test(f.phone.trim()) && 'Enter a 10-digit Indian mobile number',
    password: passwordIssue(f.password),
    confirm: !f.confirm ? 'Type your password again' : f.confirm !== f.password ? 'Passwords don’t match' : '',
    agree: !f.agree && 'Please accept the terms to continue',
  };
  const ok = !Object.values(errs).some(Boolean);
  const e_ = (k) => (touched ? errs[k] || '' : '');
  const run = async (fn) => { setBusy(true); setErr(''); try { await fn(); } catch (x) { setErr(x.message); } finally { setBusy(false); } };

  if (pending) {
    return <VerifyEmail email={pending.email} onDone={(u) => nav(u.role === 'expert' ? '/expert/profile' : next || '/me', { replace: true })} onBack={() => setPending(null)} />;
  }
  return (
    <Shell title="Create your account" sub={role === 'expert' ? 'Experts write resumes for job seekers and get paid per order.' : 'Free to join. You only pay when you order a service.'} wide>
      <div className="segmented" role="radiogroup" aria-label="I want to" style={{ alignSelf: 'flex-start' }}>
        {[['customer', 'Get my resume done'], ['expert', 'Work as an expert']].map(([k, l]) => <button key={k} type="button" role="radio" aria-checked={role === k} aria-pressed={role === k} onClick={() => setRole(k)}>{l}</button>)}
      </div>
      <form className="card stack g16" noValidate onSubmit={(e) => { e.preventDefault(); setTouched(true); if (!ok) return; run(async () => setPending(await signUp({ role, ...f }))); }}>
        <Field id="su-n" label="Full name" autoComplete="name" value={f.name} error={e_('name')} onChange={(e) => setF({ ...f, name: e.target.value })} />
        <div className="row g12" style={{ alignItems: 'flex-start' }}>
          <div style={{ flex: '1 1 220px' }}><Field id="su-e" label="Email" type="email" autoComplete="email" value={f.email} error={e_('email')} onChange={(e) => setF({ ...f, email: e.target.value })} /></div>
          <div style={{ flex: '1 1 200px' }}><Field id="su-p" label="Mobile (WhatsApp)" hint="For order updates from your expert" type="tel" inputMode="tel" autoComplete="tel" placeholder="98765 43210" value={f.phone} error={e_('phone')} onChange={(e) => setF({ ...f, phone: e.target.value })} /></div>
        </div>
        <div className="row g12" style={{ alignItems: 'flex-start' }}>
          <div style={{ flex: '1 1 220px' }}><Field id="su-pw" label="Password" type={showPw ? 'text' : 'password'} autoComplete="new-password" value={f.password} error={e_('password')} hint="8+ characters, with letters and a number" onChange={(e) => setF({ ...f, password: e.target.value })} /></div>
          <div style={{ flex: '1 1 220px' }}><Field id="su-pw2" label="Re-type password" type={showPw ? 'text' : 'password'} autoComplete="new-password" value={f.confirm} onPaste={(e) => e.preventDefault()}
            error={e_('confirm') || (f.confirm && f.confirm !== f.password && f.confirm.length >= f.password.length ? 'Passwords don’t match' : '')}
            hint={f.confirm && f.confirm === f.password ? '✓ Passwords match' : 'Type it again to be sure'} onChange={(e) => setF({ ...f, confirm: e.target.value })} /></div>
        </div>
        <label className="row g4 xs" style={{ marginTop: -8 }}><input type="checkbox" checked={showPw} onChange={(e) => setShowPw(e.target.checked)} />Show passwords</label>
        <label className="check small" style={{ alignItems: 'flex-start' }}>
          <input type="checkbox" checked={f.agree} onChange={(e) => setF({ ...f, agree: e.target.checked })} />
          <span>I agree to the <Link to="/terms" target="_blank">Terms</Link>{role === 'expert' && <>, <Link to="/expert-terms" target="_blank">Expert Terms</Link></>} and <Link to="/privacy" target="_blank">Privacy Policy</Link>, and I’m 18 or older (or have a parent’s consent).</span>
        </label>
        {e_('agree') && <span className="error">{e_('agree')}</span>}
        {err && <p role="alert" className="error" style={{ margin: 0 }}>{err}</p>}
        <button type="submit" className="btn btn-ink btn-lg" disabled={busy}>{busy && <Spinner />}Create account</button>
      </form>
      <span className="small">Already have an account? <Link to={`/login${next ? `?next=${encodeURIComponent(next)}` : ''}`}>Sign in</Link></span>
    </Shell>
  );
}

/* ---------- forgot password ---------- */
export function ForgotPassword() {
  const nav = useNavigate();
  const toast = useToast();
  const [step, setStep] = useState('email');
  const [f, setF] = useState({ email: '', code: '', password: '', confirm: '' });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const run = async (fn) => { setBusy(true); setErr(''); try { await fn(); } catch (x) { setErr(x.message); } finally { setBusy(false); } };
  return (
    <Shell title="Reset your password" sub={step === 'email' ? 'We’ll email you a code.' : `If ${f.email} has an account, a code is on its way.`}>
      {step === 'email' ? (
        <form className="card stack g16" noValidate onSubmit={(e) => { e.preventDefault(); run(async () => { await sendReset(f.email); setStep('code'); }); }}>
          <Field id="fp-e" label="Email" type="email" autoComplete="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} />
          {err && <p role="alert" className="error" style={{ margin: 0 }}>{err}</p>}
          <button type="submit" className="btn btn-ink btn-lg" disabled={busy || !EMAIL_RE.test(f.email.trim())}>{busy && <Spinner />}Send code</button>
        </form>
      ) : (
        <form className="card stack g16" noValidate onSubmit={(e) => { e.preventDefault(); run(async () => { await resetPassword(f.email, f.code, f.password, f.confirm); toast('Password changed — sign in with the new one'); nav('/login'); }); }}>
          <CodeInput value={f.code} onChange={(code) => setF({ ...f, code })} />
          <Field id="fp-p" label="New password" type="password" autoComplete="new-password" value={f.password} hint="8+ characters, with letters and a number" error={f.password && passwordIssue(f.password)} onChange={(e) => setF({ ...f, password: e.target.value })} />
          <Field id="fp-p2" label="Re-type new password" type="password" autoComplete="new-password" value={f.confirm} onPaste={(e) => e.preventDefault()} error={f.confirm && f.confirm !== f.password && f.confirm.length >= f.password.length ? 'Passwords don’t match' : ''} hint={f.confirm && f.confirm === f.password ? '✓ Passwords match' : ''} onChange={(e) => setF({ ...f, confirm: e.target.value })} />
          {err && <p role="alert" className="error" style={{ margin: 0 }}>{err}</p>}
          <button type="submit" className="btn btn-ink btn-lg" disabled={busy || f.code.length !== 6 || !!passwordIssue(f.password) || f.confirm !== f.password}>{busy && <Spinner />}Change password</button>
        </form>
      )}
      <Demo>the code is <code>{DEMO_CODE}</code>.</Demo>
      <Link to="/login" className="small">← Back to sign in</Link>
    </Shell>
  );
}

/* ---------- admin: password, then authenticator code ---------- */
export function AdminLogin() {
  const nav = useNavigate();
  const [params] = useSearchParams();
  const next = safeNext(params.get('next'));
  const { user, session } = useAuth();
  const [step, setStep] = useState(null); // { userId } after the password
  const [f, setF] = useState({ email: '', password: '', code: '', trust: false });
  const [recovery, setRecovery] = useState(false); // lost phone: one-time recovery code instead
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  if (user?.role === 'admin' && session?.twoStep) return <Navigate to={next?.startsWith('/admin') ? next : '/admin'} replace />;
  const run = async (fn) => { setBusy(true); setErr(''); try { await fn(); } catch (x) { setErr(x.message); } finally { setBusy(false); } };
  return (
    <Shell title="Admin sign in" sub="Two-step login is required for every admin account.">
      {!step ? (
        <form className="card stack g16" noValidate onSubmit={(e) => { e.preventDefault(); run(async () => { const r = await adminPassword(f.email, f.password); if (r.signedIn) nav(next?.startsWith('/admin') ? next : '/admin', { replace: true }); else setStep(r); }); }}>
          <span className="mono xs muted">STEP 1 OF 2 · PASSWORD</span>
          <Field id="ad-e" label="Work email" type="email" autoComplete="username" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} />
          <Field id="ad-p" label="Password" type="password" autoComplete="current-password" value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} />
          {err && <p role="alert" className="error" style={{ margin: 0 }}>{err}</p>}
          <button type="submit" className="btn btn-ink btn-lg" disabled={busy || !f.email || !f.password}>{busy && <Spinner />}Continue</button>
        </form>
      ) : (
        <form className="card stack g16" noValidate onSubmit={(e) => { e.preventDefault(); run(async () => { await adminVerify(step.userId, f.code, f.trust); nav(next?.startsWith('/admin') ? next : '/admin', { replace: true }); }); }}>
          <span className="mono xs muted">STEP 2 OF 2 · AUTHENTICATOR</span>
          <span className="small muted">Open Google Authenticator, Microsoft Authenticator or Authy and enter the 6-digit code for Nm7 admin.</span>
          {recovery
            ? <Field id="ad-r" label="Recovery code" autoComplete="one-time-code" placeholder="ABCD-EFGH" maxLength={9} value={f.code} onChange={(e) => setF({ ...f, code: e.target.value.toUpperCase() })} hint="Each recovery code works once." />
            : <CodeInput id="ad-c" value={f.code} onChange={(code) => setF({ ...f, code })} label="Authenticator code" />}
          <label className="row g8 small"><input type="checkbox" checked={f.trust} onChange={(e) => setF({ ...f, trust: e.target.checked })} />Trust this device for 30 days</label>
          {err && <p role="alert" className="error" style={{ margin: 0 }}>{err}</p>}
          <button type="submit" className="btn btn-ink btn-lg" disabled={busy || (recovery ? f.code.replace(/[^A-Z0-9]/gi, '').length !== 8 : f.code.length !== 6)}>{busy && <Spinner />}Verify & open admin</button>
          <button type="button" className="link-btn small" style={{ alignSelf: 'flex-start' }} onClick={() => { setStep(null); setF({ ...f, code: '' }); }}>← Use a different account</button>
          <span className="xs faint">Lost your phone? <button type="button" className="link-btn xs" onClick={() => { setRecovery(!recovery); setF({ ...f, code: '' }); }}>{recovery ? 'Use the authenticator code' : 'Use a recovery code'}</button> or ask the owner to reset your two-step login.</span>
        </form>
      )}
      <Demo>email <code>admin@nm7.si</code>, password <code>{SAMPLE_PASSWORD}</code>, code <code>{DEMO_CODE}</code>. <button type="button" className="link-btn xs" onClick={() => setF({ ...f, email: 'admin@nm7.si', password: SAMPLE_PASSWORD })}>Fill in</button></Demo>
    </Shell>
  );
}

/* ---------- guards ---------- */
/** role: 'customer' | 'expert' | 'admin'. approved: expert must be approved (orders, earnings…). */
export function RequireAuth({ role, approved, children }) {
  const { user, session, ready } = useAuth();
  const { pathname, search } = useLocation();
  const here = encodeURIComponent(pathname + search);
  if (!ready) return <main className="container row g8" style={{ padding: 40 }} aria-busy="true"><Spinner /><span className="muted">Loading…</span></main>;
  if (role === 'admin') {
    if (!user || user.role !== 'admin' || !session?.twoStep) return <Navigate to={`/admin/login?next=${here}`} replace />;
    return children;
  }
  if (!user) return <Navigate to={`/login?next=${here}`} replace />;
  if (user.role !== role) return <WrongAccount user={user} need={role} />;
  if (approved && user.expertStatus !== 'approved') return <Navigate to="/expert/profile" replace />;
  return children;
}
function WrongAccount({ user, need }) {
  const nav = useNavigate();
  const label = { customer: 'a customer', expert: 'an expert', admin: 'an admin' };
  return (
    <Shell title="Different account needed" sub={`You’re signed in as ${user.name} (${label[user.role]} account). This page is for ${label[need]} account.`}>
      <div className="row g8">
        <button type="button" className="btn btn-ink" onClick={async () => { await signOut(); nav(`/login`); }}>Sign out and switch</button>
        <Link to={homeFor(user)} className="btn btn-outline">Go to my home</Link>
      </div>
    </Shell>
  );
}
