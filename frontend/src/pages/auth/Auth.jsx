// Sign in, sign up (customer or expert, confirmed with an email code), forgot password, admin two-step login, and route guards.
import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { Link, Navigate, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { Logo, ThemeToggle } from '../../components/Header';
import { Spinner, useToast } from '../../components/ui';
import {
  useAuth, signIn, signUp, verifyEmail, resendCode, sendReset, resetPassword, adminPassword, adminVerify, signOut,
  homeFor, passwordIssue, EMAIL_RE, PHONE_RE, DEMO_CODE, SAMPLE_PASSWORD, LIVE, adminSetupStart, adminSetupVerify, adminSetupStatus,
} from '../../lib/auth';
import SiteFooter from '../../components/SiteFooter';
import LangSwitch from '../../components/LangSwitch';
import { useLang } from '../../lib/i18n';
import { usePageMeta } from '../../lib/meta';
import { safeNext } from '../../lib/safeNext';
import { addRoles, fits, roleFor, roleFromLink, rolesOf, switchRole } from '../../lib/roles';
import '../../styles/admin-ops.css';
import { IcCheck, IcKey, IcShield } from '../../components/icons';

const isPreview = import.meta.env.VITE_PREVIEW === '1';
// "Continue with Google": its own small chunk; it renders nothing while the server has no Google client ID.
const GoogleButtonLazy = lazy(() => import('../../components/GoogleButton'));
function Google(props) {
  return <Suspense fallback={null}><GoogleButtonLazy note={<GoogleTerms />} {...props} /></Suspense>;
}
/** A new account made with Google gives the sign-up form's one tick on the next step ("What would you like to do?"). */
function GoogleTerms() {
  return <>New here? Continuing with Google creates a free account. Next you tick to agree to the <Link to="/terms" target="_blank">Terms</Link> and <Link to="/privacy" target="_blank">Privacy Policy</Link> and confirm you’re 18 or older (or your parent or guardian agrees).</>;
}
/** Where a new account goes after sign-up — email (after the code) and Google alike: "What would you like to do?"
 * (/welcome, the role from the link ticked). A page that sent them here to finish something (a download, a checkout,
 * their college's group) gets them straight back, with the role that fits. An existing account: `next` or its home. */
const ORG_NEXT = /^\/(for-orgs|org\/|college-group\/)/; // a college's own flow: no role question on the way
const JOIN_NEXT = /^\/join\//; // a student joining their college's placement group
async function afterSignup(nav, u, next, role = '') {
  if (!u.rolesPending) { nav(next || homeFor(u), { replace: true }); return; }
  // a new Google account never saw the form's one tick: it gives it on the picker, so it always goes there
  if (next && role !== 'expert' && u.hasPassword !== false) {
    const add = role ? [role] : JOIN_NEXT.test(next) ? ['student'] : ORG_NEXT.test(next) ? [] : ['jobseeker'];
    try { await addRoles({ add }); } catch { /* the account menu can add roles later */ }
    nav(next, { replace: true });
    return;
  }
  const q = new URLSearchParams(Object.entries({ role, next }).filter(([, v]) => v)).toString();
  nav(`/welcome${q ? `?${q}` : ''}`, { replace: true });
}

/** This page's own tab title (when it differs from the route's). */
function PageTitle({ title }) {
  usePageMeta({ title, noindex: true });
  return null;
}
/** lang / top: sign-in passes its language and the language switch (the other screens are English only). */
function Shell({ title, sub, children, wide, meta, lang, top, footer }) {
  return (
    <>
      {meta && <PageTitle title={title} />}
      <header className="site-header"><div className="bar"><Logo /><ThemeToggle /></div></header>
      <main className="container stack g20" style={{ maxWidth: wide ? 560 : 460, padding: '40px 20px 64px' }} lang={lang} data-lang={lang}>
        {top}
        <div className="stack g4"><h1 className="display" style={{ fontSize: 32 }}>{title}</h1>{sub && <span className="muted">{sub}</span>}</div>
        {children}
      </main>
      {footer || <SiteFooter />}
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
  const [t, lang] = useLang();
  // a new account answers "What would you like to do?" first; `next` must suit one of the person's roles (the page
  // then switches to that role by itself, see WrongAccount)
  const go = (u) => nav(u.rolesPending ? `/welcome${next ? `?next=${encodeURIComponent(next)}` : ''}` : next && !(next.startsWith('/me') && !fits(u, 'customer')) && !(next.startsWith('/expert') && !fits(u, 'expert')) ? next : homeFor(u), { replace: true });
  if (verify) return <VerifyEmail email={verify.email} note={verify.note} onDone={go} onBack={() => setVerify(null)} />;
  if (user && user.role !== 'admin') return <Navigate to={next || homeFor(user)} replace />;
  // Values are read from the form itself, so browser autofill (which may not fire change events) works too.
  const submit = (form) => {
    const email = String(new FormData(form).get('email') || '').trim();
    const password = String(new FormData(form).get('password') || '');
    setF({ email, password });
    setEmailErr('');
    if (!EMAIL_RE.test(email)) { setEmailErr(email ? t('signin.err.emailBad', { example: 'name@example.com' }) : t('signin.err.email')); return; }
    if (!password) { setErr(t('signin.err.password')); return; }
    run(async () => {
      try { go(await signIn(email, password)); } catch (e) {
        if (e.code === 'email_not_verified') setVerify({ email, note: `${e.message} It went to ${email}.` });
        else throw e;
      }
    });
  };
  const fill = (email) => setF({ ...f, email, password: SAMPLE_PASSWORD });
  return (
    // A server message (wrong password, too many tries …) is shown as the server wrote it, in English.
    <Shell title={t('signin.title')} sub={t('signin.sub')} lang={lang} top={<LangSwitch t={t} lang={lang} style={{ alignSelf: 'flex-end' }} />}>
      {LIVE && <Google mode="signin" next={next} onDone={(u) => (u.isNew ? afterSignup(nav, u, next) : go(u))} />}
      <form className="card stack g16" noValidate onSubmit={(e) => { e.preventDefault(); submit(e.currentTarget); }}>
        <Field id="li-e" name="email" label={t('signin.email')} type="email" autoComplete="email" value={f.email} error={emailErr} onChange={(e) => { setF({ ...f, email: e.target.value }); setEmailErr(''); }} />
        <div className="stack g4">
          <Field id="li-p" name="password" label={t('signin.password')} type={show ? 'text' : 'password'} autoComplete="current-password" value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} />
          <span className="row between"><label className="row g4 xs"><input type="checkbox" checked={show} onChange={(e) => setShow(e.target.checked)} />{t('signin.show')}</label><Link to="/forgot-password" className="xs">{t('signin.forgot')}</Link></span>
        </div>
        {err && <p role="alert" className="error" style={{ margin: 0 }}>{err}</p>}
        <button type="submit" className="btn btn-ink btn-lg" disabled={busy}>{busy && <Spinner />}{t('signin.button')}</button>
      </form>
      <span className="small">{t('signin.new')} <Link to={`/signup${next ? `?next=${encodeURIComponent(next)}` : ''}`}>{t('signin.create')}</Link> · {t('signin.experts')} <Link to="/signup?role=expert">{t('signin.joinExpert')}</Link></span>
      <Link to="/for-orgs" className="xs" data-testid="org-link">Hiring or placements? Go to Nm7 for companies / colleges</Link>
      <Demo>
        sample accounts use password <code>{SAMPLE_PASSWORD}</code>; every email code is <code>{DEMO_CODE}</code>.{' '}
        <button type="button" className="link-btn xs" onClick={() => fill('saivarsha@example.com')}>Customer · Sai Varsha</button>{' · '}
        <button type="button" className="link-btn xs" onClick={() => fill('naresh@example.com')}>Expert · Naresh</button>{' · '}
        <Link to="/admin/login" className="xs">Admin login</Link>
      </Demo>
    </Shell>
  );
}

/* ---------- sign up: one account for individuals (job seekers, students, experts) ---------- */
// Companies and colleges have their own sign-up and sign-in (/for-companies, /for-orgs): this page names them only in
// the one small link at the bottom. Old links (the tabs: ?as=expert, ?tab=…, /signup/expert, /expert/signup) come here
// with the role preselected for the "What would you like to do?" step that follows the email code.
function SignupFooter() {
  return (
    <footer className="site-footer" lang="en" style={{ borderTop: '1px solid var(--border)' }}>
      <div className="container stack g12 small faint" style={{ padding: '24px 20px' }}>
        <Link to="/for-orgs" className="small" data-testid="org-link">Hiring or placements? Go to Nm7 for companies / colleges</Link>
        <nav aria-label="Site links" className="row g16" style={{ flexWrap: 'wrap' }}>
          <Link to="/terms">Terms</Link><Link to="/privacy">Privacy</Link><Link to="/refund-policy">Refunds & cancellation</Link>
          <Link to="/delivery-policy">Delivery</Link><Link to="/contact">Contact us</Link><Link to="/accessibility">Accessibility</Link>
        </nav>
        <span>Nm7 · nm7.si</span>
      </div>
    </footer>
  );
}
export { default as Welcome } from './Welcome'; // the step after sign-up, in this chunk
/** Each role's quick start (/start/<role>): its own chunk, loaded through this one so the main bundle stays small. */
const QuickStartPage = lazy(() => import('../start/QuickStart'));
export const QuickStart = () => <QuickStartPage />;
export function Signup() {
  const nav = useNavigate();
  const [params] = useSearchParams();
  const next = safeNext(params.get('next'));
  const { user } = useAuth();
  const old = useParams()['*']; // an old link by path: /signup/expert, /signup/student …
  const role = roleFromLink(params.get('role') || params.get('as') || params.get('tab') || old);
  const [f, setF] = useState({ name: '', email: '', phone: '', password: '', confirm: '', agree: false });
  const [showPw, setShowPw] = useState(false);
  const [touched, setTouched] = useState(false);
  const [pending, setPending] = useState(null); // { email } waiting for the email code
  const { busy, err, setErr, run } = useRun();
  const qs = (o) => { const p = new URLSearchParams(Object.entries(o).filter(([, v]) => v)); const t = p.toString(); return t ? `?${t}` : ''; };
  // the old tab links: same page, with the role preselected for the next step
  if (!params.get('role') && (params.get('as') || params.get('tab') || old)) return <Navigate to={`/signup${qs({ role, next })}`} replace />;
  if (user && !pending) {
    // signed in: a role from a link means "add this role" (one account), else their own dashboard
    if (role && user.role !== 'admin' && !rolesOf(user).includes(role)) return <Navigate to={`/welcome${qs({ add: '1', role, next })}`} replace />;
    return <Navigate to={next || homeFor(user)} replace />;
  }
  const after = (u) => afterSignup(nav, u, next, role); // after the email code, or Google
  const errs = {
    name: f.name.trim().length < 2 && 'Enter your full name',
    email: !EMAIL_RE.test(f.email.trim()) && 'Enter a valid email address',
    phone: !!f.phone.trim() && !PHONE_RE.test(f.phone.trim()) && 'Enter a 10-digit Indian mobile number',
    password: passwordIssue(f.password),
    confirm: !f.confirm ? 'Type your password again' : f.confirm !== f.password ? 'Passwords don’t match' : '',
    agree: !f.agree && 'Please tick the box to continue',
  };
  const ok = !Object.values(errs).some(Boolean);
  const e_ = (k) => (touched ? errs[k] || '' : '');

  if (pending) {
    // The API answers the same way whether or not the address already has an account (nobody can use sign-up to find out).
    return <VerifyEmail email={pending.email} note={`We sent a 6-digit code to ${pending.email}. It works for 10 minutes. If you already have an account, we sent a sign-in reminder instead.`} onDone={(u) => run(() => after(u))} onBack={() => setPending(null)} />;
  }
  return (
    <Shell title="Create your free Nm7 account" sub="Find jobs, build your career, or work as an expert, all in one account." wide footer={<SignupFooter />}>
      {LIVE && <Google mode="signup" role="customer" next={next} onDone={(u) => run(() => after(u))} />}
      <form className="card stack g16" noValidate onSubmit={(e) => { e.preventDefault(); setTouched(true); setErr(''); if (!ok) return; run(async () => setPending(await signUp({ role: 'customer', pickRoles: true, ...f }))); }}>
        <Field id="su-n" label="Full name" autoComplete="name" value={f.name} error={e_('name')} onChange={(e) => setF({ ...f, name: e.target.value })} />
        <div className="row g12" style={{ alignItems: 'flex-start' }}>
          <div style={{ flex: '1 1 220px', minWidth: 0 }}><Field id="su-e" label="Email" type="email" autoComplete="email" value={f.email} error={e_('email')} onChange={(e) => setF({ ...f, email: e.target.value })} /></div>
          <div style={{ flex: '1 1 200px', minWidth: 0 }}><Field id="su-p" label="Mobile (WhatsApp) — optional" hint="For updates about your account" type="tel" inputMode="tel" autoComplete="tel" placeholder="98765 43210" value={f.phone} error={e_('phone')} onChange={(e) => setF({ ...f, phone: e.target.value })} /></div>
        </div>
        <div className="row g12" style={{ alignItems: 'flex-start' }}>
          <div style={{ flex: '1 1 220px', minWidth: 0 }}><Field id="su-pw" label="Password" type={showPw ? 'text' : 'password'} autoComplete="new-password" value={f.password} error={e_('password')} hint="8+ characters, with letters and a number" onChange={(e) => setF({ ...f, password: e.target.value })} /></div>
          <div style={{ flex: '1 1 220px', minWidth: 0 }}><Field id="su-pw2" label="Re-type password" type={showPw ? 'text' : 'password'} autoComplete="new-password" value={f.confirm}
            error={e_('confirm') || (f.confirm && f.confirm !== f.password && f.confirm.length >= f.password.length ? 'Passwords don’t match' : '')}
            hint={f.confirm && f.confirm === f.password ? 'Passwords match' : 'Type it again to be sure'} onChange={(e) => setF({ ...f, confirm: e.target.value })} /></div>
        </div>
        <label className="row g4 xs" style={{ marginTop: -8, minHeight: 44 }}><input type="checkbox" checked={showPw} onChange={(e) => setShowPw(e.target.checked)} />Show passwords</label>
        {/* The one tick. The per-purpose privacy consents (Vetting Trust T1) are asked one by one later, when a
            feature needs them, and the date of birth with a parent's confirmation for under-18s then, as before. */}
        <label className="check small" style={{ alignItems: 'flex-start' }}>
          <input type="checkbox" checked={f.agree} onChange={(e) => setF({ ...f, agree: e.target.checked })} aria-describedby="su-agree-m" />
          <span>I agree to the <Link to="/terms" target="_blank">Terms</Link> and <Link to="/privacy" target="_blank">Privacy Policy</Link>, and I’m 18 or older (or my parent or guardian agrees).</span>
        </label>
        <span id="su-agree-m" className={e_('agree') ? 'error' : 'help'} style={{ marginTop: -8 }}>{e_('agree') || 'Under 18? Before skill checks or AI interviews we ask your date of birth, and a parent or guardian confirms by email.'}</span>
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
  const [params] = useSearchParams();
  const setting = params.get('set') === '1'; // Settings -> "Set a password" (an account made with Google)
  const [step, setStep] = useState('email');
  const [f, setF] = useState({ email: params.get('email') || '', code: '', password: '', confirm: '' });
  const [emailErr, setEmailErr] = useState('');
  const { busy, err, run } = useRun();
  return (
    <Shell title={setting ? 'Set a password' : 'Reset your password'} sub={step === 'email' ? 'We’ll email you a code.' : `If ${f.email} has an account, a code is on its way.`}>
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
        <form className="card stack g16" noValidate onSubmit={(e) => { e.preventDefault(); run(async () => { await resetPassword(f.email, f.code, f.password, f.confirm); toast(setting ? 'Password set — sign in with it once' : 'Password changed — sign in with the new one'); nav(setting ? '/login?next=%2Fme%2Fsettings' : '/login'); }); }}>
          <CodeInput value={f.code} onChange={(code) => setF({ ...f, code })} />
          <Field id="fp-p" label="New password" type="password" autoComplete="new-password" value={f.password} hint="8+ characters, with letters and a number" error={f.password && passwordIssue(f.password)} onChange={(e) => setF({ ...f, password: e.target.value })} />
          <Field id="fp-p2" label="Re-type new password" type="password" autoComplete="new-password" value={f.confirm} error={f.confirm && f.confirm !== f.password && f.confirm.length >= f.password.length ? 'Passwords don’t match' : ''} hint={f.confirm && f.confirm === f.password ? 'Passwords match' : ''} onChange={(e) => setF({ ...f, confirm: e.target.value })} />
          {err && <p role="alert" className="error" style={{ margin: 0 }}>{err}</p>}
            <button type="submit" className="btn btn-ink btn-lg" disabled={busy || f.code.length !== 6 || !!passwordIssue(f.password) || f.confirm !== f.password}>{busy && <Spinner />}Change password</button>
        </form>
      )}
      <Demo>the code is <code>{DEMO_CODE}</code>.</Demo>
      <Link to="/login" className="small">Back to sign in</Link>
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
  const { busy, err, setErr, run } = useRun();
  if (user?.role === 'admin' && session?.twoStep) return <Navigate to={next?.startsWith('/admin') ? next : '/admin'} replace />;
  return (
    <Shell title="Admin sign in" sub="Two-step login is required for every admin account.">
      {!step ? (
        <form className="ad-auth" noValidate onSubmit={(e) => {
          e.preventDefault();
          // read from the form itself: browser autofill may not fire change events (fix round item 27)
          const fd = new FormData(e.currentTarget);
          const email = String(fd.get('email') || '').trim();
          const password = String(fd.get('password') || '');
          setF({ ...f, email, password });
          if (!email || !password) { setErr('Enter your work email and password.'); return; }
          run(async () => { const r = await adminPassword(email, password); if (r.signedIn) nav(next?.startsWith('/admin') ? next : '/admin', { replace: true }); else setStep(r); });
        }}>
          <span className="ad-auth-top"><span className="ad-auth-ic"><IcKey size={22} /></span><span className="ad-auth-kicker">STEP 1 OF 2 · PASSWORD</span><span className="ad-auth-steps" aria-hidden="true"><i className="on" /><i /></span></span>
          <p className="ad-auth-help">Use your Nm7 work email. After the password you’ll enter a code from your authenticator app.</p>
          <Field id="ad-e" name="email" label="Work email" type="email" autoComplete="username" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} />
          <Field id="ad-p" name="password" label="Password" type="password" autoComplete="current-password" value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} />
          {err && <p role="alert" className="error" style={{ margin: 0 }}>{err}</p>}
            <button type="submit" className="btn btn-signal btn-lg" disabled={busy} data-testid="admin-continue">{busy && <Spinner />}Continue</button>
        </form>
      ) : (
        <form className="ad-auth" noValidate onSubmit={(e) => { e.preventDefault(); run(async () => { await adminVerify(step.userId, f.code, f.trust); nav(next?.startsWith('/admin') ? next : '/admin', { replace: true }); }); }}>
          <span className="ad-auth-top"><span className="ad-auth-ic"><IcShield size={22} /></span><span className="ad-auth-kicker">STEP 2 OF 2 · AUTHENTICATOR</span><span className="ad-auth-steps" aria-hidden="true"><i className="on" /><i className="on" /></span></span>
          <span className="ad-auth-help">Open Google Authenticator, Microsoft Authenticator or Authy and enter the 6-digit code for Nm7 admin.</span>
          {recovery
            ? <Field id="ad-r" label="Recovery code" autoComplete="one-time-code" placeholder="ABCD-EFGH" maxLength={9} value={f.code} onChange={(e) => setF({ ...f, code: e.target.value.toUpperCase() })} hint="Each recovery code works once." />
            : <CodeInput id="ad-c" value={f.code} onChange={(code) => setF({ ...f, code })} label="Authenticator code" />}
          <label className="ad-auth-trust"><input type="checkbox" checked={f.trust} onChange={(e) => setF({ ...f, trust: e.target.checked })} />Trust this device for 30 days</label>
          {err && <p role="alert" className="error" style={{ margin: 0 }}>{err}</p>}
            <button type="submit" className="btn btn-signal btn-lg" disabled={busy || (recovery ? f.code.replace(/[^A-Z0-9]/gi, '').length !== 8 : f.code.length !== 6)}>{busy && <Spinner />}Verify & open admin</button>
          <div className="ad-auth-foot">
          <button type="button" className="link-btn small" style={{ alignSelf: 'flex-start' }} onClick={() => { setStep(null); setF({ ...f, code: '' }); }}>Use a different account</button>
          <span className="xs faint">Lost your phone? <button type="button" className="link-btn xs" onClick={() => { setRecovery(!recovery); setF({ ...f, code: '' }); }}>{recovery ? 'Use the authenticator code' : 'Use a recovery code'}</button> or ask the owner to reset your two-step login.</span>
          </div>
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
        <div className="ad-auth">
          <span className="ad-auth-top"><span className="ad-auth-ic"><IcCheck size={22} /></span><span className="ad-auth-kicker">SETUP DONE</span></span>
          <span className="small">Sign in with your email, password and the 6-digit code from your authenticator app.</span>
          <span className="small muted">On Render, delete <code>ADMIN_SETUP_TOKEN</code> from the API’s environment now.</span>
          <Link to="/admin/login" className="btn btn-signal btn-lg">Go to admin sign in</Link>
        </div>
      </Shell>
    );
  }
  if (setup) {
    return (
      <Shell title="Set up two-step login" sub={`Finish within ${setup.expiresInMinutes} minutes. Nothing is saved until you confirm the code.`} wide>
        <div className="ad-auth">
          <span className="ad-auth-top"><span className="ad-auth-ic" aria-hidden="true">1</span><span className="ad-auth-kicker">1 · SCAN WITH YOUR AUTHENTICATOR APP</span><span className="ad-auth-steps" aria-hidden="true"><i className="on" /><i /><i /></span></span>
          <div className="ad-auth-qr">
            <QrCode text={setup.otpauthUri} />
            <span className="stack g8 small" style={{ flex: '1 1 220px' }}>
              <span>Open Google Authenticator, Microsoft Authenticator or Authy and scan this code.</span>
              <span className="muted">Can’t scan? Add the key by hand:</span>
              <code className="ad-auth-secret">{setup.secret}</code>
            </span>
          </div>
        </div>
        <div className="ad-auth">
          <span className="ad-auth-top"><span className="ad-auth-ic" aria-hidden="true">2</span><span className="ad-auth-kicker">2 · SAVE YOUR RECOVERY CODES</span><span className="ad-auth-steps" aria-hidden="true"><i className="on" /><i className="on" /><i /></span></span>
          <span className="small">Each works once if you lose your phone. They are shown only now.</span>
          <ol className="mono small ad-auth-codes">{setup.recoveryCodes.map((c) => <li key={c}>{c}</li>)}</ol>
          <button type="button" className="btn btn-outline" style={{ alignSelf: 'flex-start' }} onClick={copyCodes}>Copy codes</button>
          <label className="ad-auth-trust"><input type="checkbox" checked={saved} onChange={(e) => setSaved(e.target.checked)} />I saved them somewhere safe</label>
        </div>
        <form className="ad-auth" noValidate onSubmit={(e) => { e.preventDefault(); run(async () => setDone(await adminSetupVerify(code))); }}>
          <span className="ad-auth-top"><span className="ad-auth-ic" aria-hidden="true">3</span><span className="ad-auth-kicker">3 · CONFIRM</span><span className="ad-auth-steps" aria-hidden="true"><i className="on" /><i className="on" /><i className="on" /></span></span>
          <CodeInput id="as-c" value={code} onChange={setCode} label="6-digit code from the app" />
          {err && <p role="alert" className="error" style={{ margin: 0 }}>{err}</p>}
          <button type="submit" className="btn btn-signal btn-lg" disabled={busy || !saved || code.length !== 6}>{busy && <Spinner />}Create owner account</button>
        </form>
      </Shell>
    );
  }
  return (
    <Shell title="Set up the owner admin" sub="One time only. This page stops working as soon as an admin account exists.">
      <form className="ad-auth" noValidate onSubmit={(e) => { e.preventDefault(); if (ready) run(async () => setSetup(await adminSetupStart(f))); }}>
        <span className="ad-auth-top"><span className="ad-auth-ic"><IcKey size={22} /></span><span className="ad-auth-kicker">OWNER ACCOUNT</span></span>
        <p className="ad-auth-help">You need the setup token from the API’s environment. After this you’ll scan a QR code and save recovery codes.</p>
        <Field id="as-t" label="Setup token" type="password" autoComplete="off" value={f.token} hint="The ADMIN_SETUP_TOKEN value from the API’s environment on Render" onChange={(e) => setF({ ...f, token: e.target.value })} />
        <Field id="as-e" label="Work email" type="email" autoComplete="username" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} />
        <Field id="as-n" label="Your name" autoComplete="name" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
        <Field id="as-p" label="Password" type="password" autoComplete="new-password" value={f.password} hint="8+ characters, with letters and a number" error={pwIssue || ''} onChange={(e) => setF({ ...f, password: e.target.value })} />
        <Field id="as-p2" label="Re-type password" type="password" autoComplete="new-password" value={f.confirm} error={f.confirm && f.confirm !== f.password && f.confirm.length >= f.password.length ? 'Passwords don’t match' : ''} hint={f.confirm && f.confirm === f.password ? 'Passwords match' : ''} onChange={(e) => setF({ ...f, confirm: e.target.value })} />
        {err && <p role="alert" className="error" style={{ margin: 0 }}>{err}</p>}
        <button type="submit" className="btn btn-signal btn-lg" disabled={busy || !ready}>{busy && <Spinner />}Continue</button>
      </form>
      <Link to="/admin/login" className="small">Admin sign in</Link>
    </Shell>
  );
}

/* ---------- guards ---------- */
export { RequireAuth } from './RequireAuth'; // kept here for older imports

/** Signed in with the wrong kind of account for the page (loaded by RequireAuth only when needed). A person who has a
 * role for this page (one account: job seeker / student / expert) is switched to it here, and the page opens. */
export function WrongAccount({ user, need }) {
  const nav = useNavigate();
  const can = need !== 'admin' && fits(user, need);
  const [failed, setFailed] = useState('');
  useEffect(() => { if (can) switchRole(roleFor(user, need)).catch((e) => setFailed(e.message || 'Please try again.')); }, [can, need, user]);
  if (can && !failed) return <main className="container row g8" style={{ padding: 40 }} aria-busy="true"><Spinner /><span className="muted">Switching to your {need === 'expert' ? 'expert' : 'job seeker'} dashboard…</span></main>;
  if (can) return <Shell meta title="Couldn’t switch" sub={failed}><Link to={homeFor(user)} className="btn btn-outline">Go to my home</Link></Shell>;
  const label = { customer: 'a customer', expert: 'an expert', admin: 'an admin' };
  const add = need === 'expert' ? 'expert' : need === 'customer' ? 'jobseeker' : '';
  return (
    <Shell meta title="Different account needed" sub={`You’re signed in as ${user.name} (${label[user.role]} account). This page is for ${label[need]} account.`}>
      <div className="row g8">
        {add && user.role !== 'admin' && <Link to={`/welcome?add=1&role=${add}`} className="btn btn-ink">Add this role to my account</Link>}
        <button type="button" className={add && user.role !== 'admin' ? 'btn btn-outline' : 'btn btn-ink'} onClick={async () => { await signOut(); nav(`/login`); }}>Sign out and switch</button>
        <Link to={homeFor(user)} className="btn btn-outline">Go to my home</Link>
      </div>
    </Shell>
  );
}
