// Sign in, sign up (customer or expert, with mobile OTP), forgot password, admin two-step login, and route guards.
import { useState } from 'react';
import { Link, Navigate, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { Logo, ThemeToggle } from '../../components/Header';
import { Spinner, useToast } from '../../components/ui';
import {
  useAuth, signIn, sendOtp, signInOtp, signUp, verifyPhone, sendReset, resetPassword, adminPassword, adminVerify, signOut,
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

/* ---------- sign in ---------- */
export function Login() {
  const nav = useNavigate();
  const [params] = useSearchParams();
  const next = safeNext(params.get('next'));
  const { user } = useAuth();
  const [tab, setTab] = useState('email');
  const [f, setF] = useState({ email: '', password: '', phone: '', code: '' });
  const [sent, setSent] = useState(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [show, setShow] = useState(false);
  if (user && user.role !== 'admin') return <Navigate to={next || homeFor(user)} replace />;
  const go = (u) => nav(next && !(u.role === 'expert' && next.startsWith('/me')) && !(u.role === 'customer' && next.startsWith('/expert')) ? next : homeFor(u), { replace: true });
  const run = async (fn) => { setBusy(true); setErr(''); try { await fn(); } catch (e) { setErr(e.message); } finally { setBusy(false); } };
  const fill = (email) => setF({ ...f, email, password: SAMPLE_PASSWORD });
  return (
    <Shell title="Sign in" sub="Track your orders, edit your resumes and chat with your expert.">
      <div className="segmented" role="tablist" aria-label="Sign in with" style={{ alignSelf: 'flex-start' }}>
        {[['email', 'Email & password'], ['otp', 'Mobile OTP']].map(([k, l]) => <button key={k} type="button" role="tab" aria-selected={tab === k} onClick={() => { setTab(k); setErr(''); }}>{l}</button>)}
      </div>
      {tab === 'email' ? (
        <form className="card stack g16" noValidate onSubmit={(e) => { e.preventDefault(); run(async () => go(await signIn(f.email, f.password))); }}>
          <Field id="li-e" label="Email" type="email" autoComplete="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} />
          <div className="stack g4">
            <Field id="li-p" label="Password" type={show ? 'text' : 'password'} autoComplete="current-password" value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} />
            <span className="row between"><label className="row g4 xs"><input type="checkbox" checked={show} onChange={(e) => setShow(e.target.checked)} />Show password</label><Link to="/forgot-password" className="xs">Forgot password?</Link></span>
          </div>
          {err && <p role="alert" className="error" style={{ margin: 0 }}>{err}</p>}
          <button type="submit" className="btn btn-ink btn-lg" disabled={busy || !f.email || !f.password}>{busy && <Spinner />}Sign in</button>
        </form>
      ) : (
        <form className="card stack g16" noValidate onSubmit={(e) => { e.preventDefault(); run(async () => { if (!sent) { const r = await sendOtp(f.phone); setSent(r.sentTo); } else go(await signInOtp(f.phone, f.code)); }); }}>
          <Field id="li-ph" label="Mobile number" type="tel" inputMode="tel" autoComplete="tel" placeholder="98765 43210" value={f.phone} disabled={!!sent} onChange={(e) => setF({ ...f, phone: e.target.value })} />
          {sent && <><span className="small muted">We sent a code to {sent} by SMS and WhatsApp. <button type="button" className="link-btn small" onClick={() => { setSent(null); setF({ ...f, code: '' }); }}>Change number</button></span><CodeInput value={f.code} onChange={(code) => setF({ ...f, code })} /></>}
          {err && <p role="alert" className="error" style={{ margin: 0 }}>{err}</p>}
          <button type="submit" className="btn btn-ink btn-lg" disabled={busy || (!sent ? !PHONE_RE.test(f.phone.trim()) : f.code.length !== 6)}>{busy && <Spinner />}{sent ? 'Verify & sign in' : 'Send code'}</button>
        </form>
      )}
      <span className="small">New here? <Link to={`/signup${next ? `?next=${encodeURIComponent(next)}` : ''}`}>Create an account</Link> · Experts: <Link to="/signup?as=expert">join as an expert</Link></span>
      <Demo>
        sample accounts use password <code>{SAMPLE_PASSWORD}</code> and OTP <code>{DEMO_CODE}</code>.{' '}
        <button type="button" className="link-btn xs" onClick={() => { setTab('email'); fill('saivarsha@example.com'); }}>Customer · Sai Varsha</button>{' · '}
        <button type="button" className="link-btn xs" onClick={() => { setTab('email'); fill('naresh@example.com'); }}>Expert · Naresh</button>{' · '}
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
  const [pending, setPending] = useState(null); // user waiting for OTP
  const [code, setCode] = useState('');
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
    return (
      <Shell title="Verify your mobile" sub={`We sent a 6-digit code to ${pending.phone} by SMS and WhatsApp.`}>
        <form className="card stack g16" onSubmit={(e) => { e.preventDefault(); run(async () => { const u = await verifyPhone(pending.id, code); nav(u.role === 'expert' ? '/expert/profile' : next || '/me', { replace: true }); }); }}>
          <CodeInput value={code} onChange={setCode} />
          {err && <p role="alert" className="error" style={{ margin: 0 }}>{err}</p>}
          <button type="submit" className="btn btn-ink btn-lg" disabled={busy || code.length !== 6}>{busy && <Spinner />}Verify & continue</button>
          <button type="button" className="link-btn small" style={{ alignSelf: 'flex-start' }} onClick={() => run(async () => { await sendOtp(pending.phone); })}>Send the code again</button>
        </form>
        <Demo>the code is <code>{DEMO_CODE}</code>.</Demo>
      </Shell>
    );
  }
  return (
    <Shell title="Create your account" sub={role === 'expert' ? 'Experts write resumes for job seekers and get paid per order.' : 'Free to join. You only pay when you order a service.'} wide>
      <div className="segmented" role="radiogroup" aria-label="I want to" style={{ alignSelf: 'flex-start' }}>
        {[['customer', 'Get my resume done'], ['expert', 'Work as an expert']].map(([k, l]) => <button key={k} type="button" role="radio" aria-checked={role === k} aria-pressed={role === k} onClick={() => setRole(k)}>{l}</button>)}
      </div>
      <form className="card stack g16" noValidate onSubmit={(e) => { e.preventDefault(); setTouched(true); if (!ok) return; run(async () => { const { confirm: _c, ...data } = f; const u = await signUp({ role, ...data }); await sendOtp(f.phone); setPending(u); }); }}>
        <Field id="su-n" label="Full name" autoComplete="name" value={f.name} error={e_('name')} onChange={(e) => setF({ ...f, name: e.target.value })} />
        <div className="row g12" style={{ alignItems: 'flex-start' }}>
          <div style={{ flex: '1 1 220px' }}><Field id="su-e" label="Email" type="email" autoComplete="email" value={f.email} error={e_('email')} onChange={(e) => setF({ ...f, email: e.target.value })} /></div>
          <div style={{ flex: '1 1 200px' }}><Field id="su-p" label="Mobile (WhatsApp)" type="tel" inputMode="tel" autoComplete="tel" placeholder="98765 43210" value={f.phone} error={e_('phone')} onChange={(e) => setF({ ...f, phone: e.target.value })} /></div>
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
          <button type="submit" className="btn btn-ink btn-lg" disabled={busy || !EMAIL_RE.test(f.email.trim())}>{busy && <Spinner />}Send code</button>
        </form>
      ) : (
        <form className="card stack g16" noValidate onSubmit={(e) => { e.preventDefault(); run(async () => { await resetPassword(f.email, f.code, f.password); toast('Password changed — sign in with the new one'); nav('/login'); }); }}>
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
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  if (user?.role === 'admin' && session?.twoStep) return <Navigate to={next?.startsWith('/admin') ? next : '/admin'} replace />;
  const run = async (fn) => { setBusy(true); setErr(''); try { await fn(); } catch (x) { setErr(x.message); } finally { setBusy(false); } };
  return (
    <Shell title="Admin sign in" sub="Two-step login is required for every admin account.">
      {!step ? (
        <form className="card stack g16" noValidate onSubmit={(e) => { e.preventDefault(); run(async () => setStep(await adminPassword(f.email, f.password))); }}>
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
          <CodeInput id="ad-c" value={f.code} onChange={(code) => setF({ ...f, code })} label="Authenticator code" />
          <label className="row g8 small"><input type="checkbox" checked={f.trust} onChange={(e) => setF({ ...f, trust: e.target.checked })} />Trust this device for 30 days</label>
          {err && <p role="alert" className="error" style={{ margin: 0 }}>{err}</p>}
          <button type="submit" className="btn btn-ink btn-lg" disabled={busy || f.code.length !== 6}>{busy && <Spinner />}Verify & open admin</button>
          <button type="button" className="link-btn small" style={{ alignSelf: 'flex-start' }} onClick={() => { setStep(null); setF({ ...f, code: '' }); }}>← Use a different account</button>
          <span className="xs faint">Lost your phone? Another owner can reset your two-step login from Team & audit log.</span>
        </form>
      )}
      <Demo>email <code>admin@nm7.si</code>, password <code>{SAMPLE_PASSWORD}</code>, code <code>{DEMO_CODE}</code>. <button type="button" className="link-btn xs" onClick={() => setF({ ...f, email: 'admin@nm7.si', password: SAMPLE_PASSWORD })}>Fill in</button></Demo>
    </Shell>
  );
}

/* ---------- guards ---------- */
/** role: 'customer' | 'expert' | 'admin'. approved: expert must be approved (orders, earnings…). */
export function RequireAuth({ role, approved, children }) {
  const { user, session } = useAuth();
  const { pathname, search } = useLocation();
  const here = encodeURIComponent(pathname + search);
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
        <button type="button" className="btn btn-ink" onClick={() => { signOut(); nav(`/login`); }}>Sign out and switch</button>
        <Link to={homeFor(user)} className="btn btn-outline">Go to my home</Link>
      </div>
    </Shell>
  );
}
