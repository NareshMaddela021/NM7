// Sign in, sign up (customer or expert, confirmed with an email code), forgot password, admin two-step login, and route guards.
import { useEffect, useRef, useState } from 'react';
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router-dom';
import { Logo, ThemeToggle } from '../../components/Header';
import { Spinner, useToast } from '../../components/ui';
import {
  useAuth, signIn, signUp, verifyEmail, resendCode, sendReset, resetPassword, adminPassword, adminVerify, signOut,
  homeFor, passwordIssue, EMAIL_RE, PHONE_RE, DEMO_CODE, SAMPLE_PASSWORD, LIVE, adminSetupStart, adminSetupVerify, adminSetupStatus,
} from '../../lib/auth';
import SiteFooter from '../../components/SiteFooter';
import { usePageMeta } from '../../lib/meta';

const isPreview = import.meta.env.VITE_PREVIEW === '1';
const safeNext = (n) => (n && n.startsWith('/') && !n.startsWith('//') ? n : null);

/** This page's own tab title (when it differs from the route's). */
function PageTitle({ title }) {
  usePageMeta({ title, noindex: true });
  return null;
}
function Shell({ title, sub, children, wide, meta }) {
  return (
    <>
      {meta && <PageTitle title={title} />}
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
/** Runs one request at a time: a second click while it runs does nothing (no double sign-ups). A request that
 * takes long (the free plan sleeps when idle) shows the site-wide "server is waking up" notice in the header. */
function useRun() {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const flight = useRef(false);
  const run = async (fn) => {
    if (flight.current) return;
    flight.current = true; setBusy(true); setErr('');
    try { await fn(); } catch (x) { setErr(x.message); } finally { flight.current = false; setBusy(false); }
  };
  return { busy, err, setErr, run };
}
/** Seconds left before "Send the code again" works (60 s after each send). */
function useCountdown(start = 60) {
  const [left, setLeft] = useState(start);
  useEffect(() => { if (left <= 0) return undefined; const t = setTimeout(() => setLeft((n) => n - 1), 1000); return () => clearTimeout(t); }, [left]);
  return [left, () => setLeft(start)];
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
  const { busy, err, run } = useRun();
  const [info, setInfo] = useState('');
  const [left, restart] = useCountdown();
  return (
    <Shell title="Confirm your email" sub={note || `We sent a 6-digit code to ${email}. It works for 10 minutes.`}>
      <form className="card stack g16" noValidate onSubmit={(e) => { e.preventDefault(); run(async () => onDone(await verifyEmail(email, code))); }}>
        <CodeInput value={code} onChange={setCode} />
        {err && <p role="alert" className="error" style={{ margin: 0 }}>{err}</p>}
        {info && <p role="status" className="help" style={{ margin: 0 }}>{info}</p>}
        <button type="submit" className="btn btn-ink btn-lg" disabled={busy || code.length !== 6}>{busy && <Spinner />}Confirm & continue</button>
        <span className="row g12 small">
          <button type="button" className="link-btn small" disabled={busy || left > 0} onClick={() => run(async () => { setInfo(''); await resendCode(email); restart(); setInfo('A new code is on its way. Check your spam folder too.'); })}>{left > 0 ? `Send the code again in ${left} s` : 'Send the code again'}</button>
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
  const { busy, err, setErr, run } = useRun();
  const [emailErr, setEmailErr] = useState('');
  const [show, setShow] = useState(false);
  const go = (u) => nav(next && !(u.role === 'expert' && next.startsWith('/me')) && !(u.role === 'customer' && next.startsWith('/expert')) ? next : homeFor(u), { replace: true });
  if (verify) return <VerifyEmail email={verify.email} note={verify.note} onDone={go} onBack={() => setVerify(null)} />;
  if (user && user.role !== 'admin') return <Navigate to={next || homeFor(user)} replace />;
  // Values are read from the form itself, so browser autofill (which may not fire change events) works too.
  const submit = (form) => {
    const email = String(new FormData(form).get('email') || '').trim();
    const password = String(new FormData(form).get('password') || '');
    setF({ email, password });
    setEmailErr('');
    if (!EMAIL_RE.test(email)) { setEmailErr(email ? 'Enter a valid email address, like name@example.com' : 'Enter your email'); return; }
    if (!password) { setErr('Enter your password'); return; }
    run(async () => {
      try { go(await signIn(email, password)); } catch (e) {
        if (e.code === 'email_not_verified') setVerify({ email, note: `${e.message} It went to ${email}.` });
        else throw e;
      }
    });
  };
  const fill = (email) => setF({ ...f, email, password: SAMPLE_PASSWORD });
  return (
    <Shell title="Sign in" sub="Track your orders, edit your resumes and chat with your expert.">
      <form className="card stack g16" noValidate onSubmit={(e) => { e.preventDefault(); submit(e.currentTarget); }}>
        <Field id="li-e" name="email" label="Email" type="email" autoComplete="email" value={f.email} error={emailErr} onChange={(e) => { setF({ ...f, email: e.target.value }); setEmailErr(''); }} />
        <div className="stack g4">
          <Field id="li-p" name="password" label="Password" type={show ? 'text' : 'password'} autoComplete="current-password" value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} />
          <span className="row between"><label className="row g4 xs"><input type="checkbox" checked={show} onChange={(e) => setShow(e.target.checked)} />Show password</label><Link to="/forgot-password" className="xs">Forgot password?</Link></span>
        </div>
        {err && <p role="alert" className="error" style={{ margin: 0 }}>{err}</p>}
        <button type="submit" className="btn btn-ink btn-lg" disabled={busy}>{busy && <Spinner />}Sign in</button>
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
  const { busy, err, run } = useRun();
  if (user && !pending && params.get('as') === 'expert' && user.role !== 'expert') {
    // "Become an expert" while signed in as a customer: experts use a separate account
    return (
      <Shell meta title="Expert accounts are separate" sub={`You’re signed in as ${user.email || user.name}, a customer account.`}>
        <div className="card stack g12" role="note">
          <span className="small">To work as an expert, create a new account with a different email address. Your customer account and its resumes stay as they are.</span>
          <div className="row g8">
            <button type="button" className="btn btn-ink" onClick={async () => { await signOut(); nav('/signup?as=expert', { replace: true }); }}>Sign out and create an expert account</button>
            <Link to={homeFor(user)} className="btn btn-outline">Back to my dashboard</Link>
          </div>
        </div>
      </Shell>
    );
  }
  if (user && !pending) return <Navigate to={homeFor(user)} replace />;
  const errs = {
    name: f.name.trim().length < 2 && 'Enter your full name',
    email: !EMAIL_RE.test(f.email.trim()) && 'Enter a valid email address',
    phone: !!f.phone.trim() && !PHONE_RE.test(f.phone.trim()) && 'Enter a 10-digit Indian mobile number',
    password: passwordIssue(f.password),
    confirm: !f.confirm ? 'Type your password again' : f.confirm !== f.password ? 'Passwords don’t match' : '',
    agree: !f.agree && 'Please accept the terms to continue',
  };
  const ok = !Object.values(errs).some(Boolean);
  const e_ = (k) => (touched ? errs[k] || '' : '');

  if (pending) {
    // The API answers the same way whether or not the address already has an account (nobody can use sign-up to find out).
    return <VerifyEmail email={pending.email} note={`We sent a 6-digit code to ${pending.email}. It works for 10 minutes. If you already have an account, we sent a sign-in reminder instead.`} onDone={(u) => nav(u.role === 'expert' ? '/expert/profile' : next || '/me', { replace: true })} onBack={() => setPending(null)} />;
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
          <div style={{ flex: '1 1 200px' }}><Field id="su-p" label="Mobile (WhatsApp) — optional" hint="Only for order updates from your expert" type="tel" inputMode="tel" autoComplete="tel" placeholder="98765 43210" value={f.phone} error={e_('phone')} onChange={(e) => setF({ ...f, phone: e.target.value })} /></div>
        </div>
        <div className="row g12" style={{ alignItems: 'flex-start' }}>
          <div style={{ flex: '1 1 220px' }}><Field id="su-pw" label="Password" type={showPw ? 'text' : 'password'} autoComplete="new-password" value={f.password} error={e_('password')} hint="8+ characters, with letters and a number" onChange={(e) => setF({ ...f, password: e.target.value })} /></div>
          <div style={{ flex: '1 1 220px' }}><Field id="su-pw2" label="Re-type password" type={showPw ? 'text' : 'password'} autoComplete="new-password" value={f.confirm}
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
  const [emailErr, setEmailErr] = useState('');
  const { busy, err, run } = useRun();
  return (
    <Shell title="Reset your password" sub={step === 'email' ? 'We’ll email you a code.' : `If ${f.email} has an account, a code is on its way.`}>
      {step === 'email' ? (
        <form className="card stack g16" noValidate onSubmit={(e) => {
          e.preventDefault();
          if (!EMAIL_RE.test(f.email.trim())) { setEmailErr('Enter a valid email address'); document.getElementById('fp-e')?.focus(); return; }
          run(async () => { await sendReset(f.email.trim()); setStep('code'); });
        }}>
          <Field id="fp-e" label="Email" type="email" autoComplete="email" value={f.email} error={emailErr} onChange={(e) => { setF({ ...f, email: e.target.value }); setEmailErr(''); }} />
          {err && <p role="alert" className="error" style={{ margin: 0 }}>{err}</p>}
            <button type="submit" className="btn btn-ink btn-lg" disabled={busy}>{busy && <Spinner />}Send code</button>
        </form>
      ) : (
        <form className="card stack g16" noValidate onSubmit={(e) => { e.preventDefault(); run(async () => { await resetPassword(f.email, f.code, f.password, f.confirm); toast('Password changed — sign in with the new one'); nav('/login'); }); }}>
          <CodeInput value={f.code} onChange={(code) => setF({ ...f, code })} />
          <Field id="fp-p" label="New password" type="password" autoComplete="new-password" value={f.password} hint="8+ characters, with letters and a number" error={f.password && passwordIssue(f.password)} onChange={(e) => setF({ ...f, password: e.target.value })} />
          <Field id="fp-p2" label="Re-type new password" type="password" autoComplete="new-password" value={f.confirm} error={f.confirm && f.confirm !== f.password && f.confirm.length >= f.password.length ? 'Passwords don’t match' : ''} hint={f.confirm && f.confirm === f.password ? '✓ Passwords match' : ''} onChange={(e) => setF({ ...f, confirm: e.target.value })} />
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
  const { busy, err, run } = useRun();
  if (user?.role === 'admin' && session?.twoStep) return <Navigate to={next?.startsWith('/admin') ? next : '/admin'} replace />;
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

/* ---------- one-time owner setup: /admin/setup (live only) ---------- */
function QrCode({ text, size = 200 }) {
  const [src, setSrc] = useState('');
  useEffect(() => {
    let on = true;
    // Made in the browser: the authenticator secret never goes to another website.
    import('qrcode').then((m) => m.default.toDataURL(text, { width: size, margin: 1 })).then((u) => on && setSrc(u)).catch(() => {});
    return () => { on = false; };
  }, [text, size]);
  return src ? <img src={src} width={size} height={size} alt="QR code for your authenticator app" style={{ background: '#fff', borderRadius: 8, padding: 6 }} /> : <div style={{ width: size, height: size }} aria-busy="true" />;
}

export function AdminSetup() {
  const [f, setF] = useState({ token: '', email: '', name: '', password: '', confirm: '' });
  const [setup, setSetup] = useState(null); // { otpauthUri, secret, recoveryCodes, expiresInMinutes }
  const [code, setCode] = useState('');
  const [saved, setSaved] = useState(false);
  const [done, setDone] = useState(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [open, setOpen] = useState(null); // null while asking the server whether setup is still possible
  const flight = useRef(false);
  const toast = useToast();
  useEffect(() => { if (LIVE) adminSetupStatus().then((r) => setOpen(r.open), () => setOpen(false)); }, []);
  if (!LIVE) return <Navigate to="/admin/login" replace />;
  if (open === null && !setup && !done) return <Shell title="Admin setup"><div className="row g12 muted" role="status"><Spinner /> Checking…</div></Shell>;
  if (open === false && !setup && !done) {
    return (
      <Shell title="Page not available" sub="Admin setup is closed.">
        <Link to="/" className="btn btn-ink" style={{ alignSelf: 'flex-start' }}>Go to home</Link>
      </Shell>
    );
  }
  const run = async (fn) => {
    if (flight.current) return;
    flight.current = true; setBusy(true); setErr('');
    try { await fn(); } catch (x) {
      setErr(x.status === 404 ? 'Setup is closed: an admin already exists, or ADMIN_SETUP_TOKEN isn’t set on the server. Sign in at /admin/login.' : x.message);
      if (x.code === 'setup_expired') { setSetup(null); setCode(''); setSaved(false); }
    } finally { flight.current = false; setBusy(false); }
  };
  const pwIssue = f.password && passwordIssue(f.password);
  const ready = f.token.trim() && EMAIL_RE.test(f.email.trim()) && f.name.trim().length >= 2 && !passwordIssue(f.password) && f.confirm === f.password;
  const copyCodes = async () => { try { await navigator.clipboard.writeText(setup.recoveryCodes.join('\n')); toast('Recovery codes copied'); } catch { /* ignore */ } };

  if (done) {
    return (
      <Shell title="Owner account ready" sub={`${done.email} is the owner admin. Setup is now closed for good.`}>
        <div className="card stack g12">
          <span className="small">Sign in with your email, password and the 6-digit code from your authenticator app.</span>
          <span className="small muted">On Render, delete <code>ADMIN_SETUP_TOKEN</code> from the API’s environment now.</span>
          <Link to="/admin/login" className="btn btn-ink btn-lg" style={{ alignSelf: 'flex-start' }}>Go to admin sign in</Link>
        </div>
      </Shell>
    );
  }
  if (setup) {
    return (
      <Shell title="Set up two-step login" sub={`Finish within ${setup.expiresInMinutes} minutes. Nothing is saved until you confirm the code.`} wide>
        <div className="card stack g16">
          <span className="mono xs muted">1 · SCAN WITH YOUR AUTHENTICATOR APP</span>
          <div className="row g16" style={{ alignItems: 'center', flexWrap: 'wrap' }}>
            <QrCode text={setup.otpauthUri} />
            <span className="stack g8 small" style={{ flex: '1 1 220px' }}>
              <span>Open Google Authenticator, Microsoft Authenticator or Authy and scan this code.</span>
              <span className="muted">Can’t scan? Add the key by hand:</span>
              <code style={{ wordBreak: 'break-all' }}>{setup.secret}</code>
            </span>
          </div>
        </div>
        <div className="card stack g12">
          <span className="mono xs muted">2 · SAVE YOUR RECOVERY CODES</span>
          <span className="small">Each works once if you lose your phone. They are shown only now.</span>
          <ol className="mono small" style={{ columns: 2, margin: 0, paddingLeft: 24 }}>{setup.recoveryCodes.map((c) => <li key={c}>{c}</li>)}</ol>
          <button type="button" className="btn btn-outline" style={{ alignSelf: 'flex-start' }} onClick={copyCodes}>Copy codes</button>
          <label className="row g8 small"><input type="checkbox" checked={saved} onChange={(e) => setSaved(e.target.checked)} />I saved them somewhere safe</label>
        </div>
        <form className="card stack g16" noValidate onSubmit={(e) => { e.preventDefault(); run(async () => setDone(await adminSetupVerify(code))); }}>
          <span className="mono xs muted">3 · CONFIRM</span>
          <CodeInput id="as-c" value={code} onChange={setCode} label="6-digit code from the app" />
          {err && <p role="alert" className="error" style={{ margin: 0 }}>{err}</p>}
          <button type="submit" className="btn btn-ink btn-lg" disabled={busy || !saved || code.length !== 6}>{busy && <Spinner />}Create owner account</button>
        </form>
      </Shell>
    );
  }
  return (
    <Shell title="Set up the owner admin" sub="One time only. This page stops working as soon as an admin account exists.">
      <form className="card stack g16" noValidate onSubmit={(e) => { e.preventDefault(); if (ready) run(async () => setSetup(await adminSetupStart(f))); }}>
        <Field id="as-t" label="Setup token" type="password" autoComplete="off" value={f.token} hint="The ADMIN_SETUP_TOKEN value from the API’s environment on Render" onChange={(e) => setF({ ...f, token: e.target.value })} />
        <Field id="as-e" label="Work email" type="email" autoComplete="username" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} />
        <Field id="as-n" label="Your name" autoComplete="name" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
        <Field id="as-p" label="Password" type="password" autoComplete="new-password" value={f.password} hint="8+ characters, with letters and a number" error={pwIssue || ''} onChange={(e) => setF({ ...f, password: e.target.value })} />
        <Field id="as-p2" label="Re-type password" type="password" autoComplete="new-password" value={f.confirm} error={f.confirm && f.confirm !== f.password && f.confirm.length >= f.password.length ? 'Passwords don’t match' : ''} hint={f.confirm && f.confirm === f.password ? '✓ Passwords match' : ''} onChange={(e) => setF({ ...f, confirm: e.target.value })} />
        {err && <p role="alert" className="error" style={{ margin: 0 }}>{err}</p>}
        <button type="submit" className="btn btn-ink btn-lg" disabled={busy || !ready}>{busy && <Spinner />}Continue</button>
      </form>
      <Link to="/admin/login" className="small">← Admin sign in</Link>
    </Shell>
  );
}

/* ---------- guards ---------- */
export { RequireAuth } from './RequireAuth'; // kept here for older imports

/** Signed in with the wrong kind of account for the page (loaded by RequireAuth only when needed). */
export function WrongAccount({ user, need }) {
  const nav = useNavigate();
  const label = { customer: 'a customer', expert: 'an expert', admin: 'an admin' };
  return (
    <Shell meta title="Different account needed" sub={`You’re signed in as ${user.name} (${label[user.role]} account). This page is for ${label[need]} account.`}>
      <div className="row g8">
        <button type="button" className="btn btn-ink" onClick={async () => { await signOut(); nav(`/login`); }}>Sign out and switch</button>
        <Link to={homeFor(user)} className="btn btn-outline">Go to my home</Link>
      </div>
    </Shell>
  );
}
