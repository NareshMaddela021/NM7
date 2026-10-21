// The event kiosk (Nm7 for Organizations, Phase 3A): /kiosk/:token, full-screen on a tablet or laptop.
// Welcome → email + 6-digit code (signs in to the candidate's own Nm7 account, made if needed) → consent and the
// group's questions → a guided, step-by-step builder (or "Snap photos") → Print now / Send to my email → wiped.
// Nothing personal stays: after Finish, or 2 minutes idle (with a 20-second warning), the kiosk signs out and
// clears local and session storage, IndexedDB and caches. Leaving the kiosk screen needs the coordinator's exit PIN.
// Also /continue?t=… — the emailed "continue on your phone" link.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { Dialog, Spinner } from '../../components/ui';
import { reloadUser, signOut, useAuth } from '../../lib/auth';
import { HEARTBEAT_MS, KIOSK_STEPS, RETRY_MS, SAVE_FAILED, createIdleTimer, kioskLoadProblem, wipeDevice } from '../../lib/kiosk';
import { BUILD_CHECK_MS, freshImport, newBuildLive } from '../../lib/chunks';
import { brandDesign, prepareBrand } from '../../lib/branding';
import { loadPdfjs } from '../../lib/import';
import { reviewToResume } from '../../lib/photoImport';
import { usePageMeta } from '../../lib/meta';
import { http } from '../../services/http';
import { FieldGrid, SchemaField } from '../builder/Fields';
import PhotoImport from '../builder/PhotoImport';
import SummaryWriter from '../builder/SummaryWriter';
import ResumePreview from '../builder/ResumePreview';
import { designOf } from '../builder/design';
import { EXP_LEVELS, INITIAL, LISTS, PERSONAL_FIELDS, migrateLinks, real } from '../builder/schema';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const big = { fontSize: 18 };
const bigInput = { height: 56, fontSize: 20 };
const shell = { minHeight: '100vh', background: 'var(--bg)', display: 'flex', flexDirection: 'column' };

/** A fresh resume for the candidate (their own name and email; no sample person). */
function blank(who) {
  const d = structuredClone(INITIAL);
  d.personal = { name: who?.name || '', headline: '', email: who?.email || '', phone: '', location: '', level: EXP_LEVELS[0] };
  Object.assign(d, { summary: '', exp: [], proj: [], certs: [], ach: [], custom: [], hobbies: '', strengths: '', langs: [{ name: 'English', level: 'Fluent' }] });
  d.edu = [{ ...LISTS.edu.blank }];
  d.skillGroups = d.skillGroups.map((g) => ({ ...g, value: '' }));
  d.pinfo = { father: '', mother: '', dob: '', gender: '', marital: '', nationality: 'Indian', languages: '', address: '' };
  d.links = { linkedin: '', github: '', portfolio: '', twitter: '', stackoverflow: '', medium: '', resume: '' };
  return migrateLinks(d);
}
const keyId = () => `k${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

/** Prints the candidate's PDF with the browser's print dialog: each page drawn as a picture (by pdf.js, in this
 * browser) into a print-only block, so the kiosk screen never changes and no PDF viewer or pop-up is needed. */
async function printPdf(blob) {
  const pdfjs = await loadPdfjs();
  const doc = await pdfjs.getDocument({ data: new Uint8Array(await blob.arrayBuffer()), isEvalSupported: false, verbosity: 0 }).promise;
  const box = document.createElement('div');
  box.className = 'kiosk-print';
  box.dataset.kioskPrint = '1';
  const pages = doc.numPages;
  try {
    for (let n = 1; n <= pages; n++) {
      const page = await doc.getPage(n);
      const vp = page.getViewport({ scale: 2.5 });
      const canvas = document.createElement('canvas');
      canvas.width = vp.width; canvas.height = vp.height;
      await page.render({ canvasContext: canvas.getContext('2d'), viewport: vp }).promise;
      const img = new Image();
      img.alt = '';
      img.src = canvas.toDataURL('image/png');
      box.appendChild(img);
    }
  } finally {
    await doc.destroy().catch(() => {}); // frees the worker's copy of the PDF (the next print starts clean)
  }
  document.querySelectorAll('[data-kiosk-print]').forEach((x) => x.remove());
  document.body.appendChild(box);
  await Promise.all([...box.querySelectorAll('img')].map((i) => i.decode().catch(() => {})));
  const done = () => { box.remove(); window.removeEventListener('afterprint', done); };
  window.addEventListener('afterprint', done);
  window.print();
  return pages;
}

/** The files Print needs (PDF maker, pdf.js and the resume's fonts), loaded as soon as someone signs in — so a
 * deploy during the event can't leave Print needing a file the new build no longer has. */
const printModules = () => Promise.all([import('../builder/resumePdf'), loadPdfjs()]);
async function preloadPrint(d) {
  try {
    await printModules();
    const { loadFont } = await import('../builder/pdfFonts');
    const ds = designOf(d || {});
    await Promise.all([ds.font, ds.headFont].filter(Boolean).map((f) => loadFont(f).catch(() => {})));
  } catch { /* Print tries again (and recovers) if this didn't work */ }
}

// Where a signed-in candidate is, kept in this tab only: after a reload onto a new build they come back to the same
// step (their resume is saved in their account). Wiped with everything else at Finish / idle / sign-out.
const markerKey = (token) => `nm7-kiosk:${token.slice(0, 12)}`;
const readMarker = (token) => { try { return JSON.parse(sessionStorage.getItem(markerKey(token)) || 'null'); } catch { return null; } };
const writeMarker = (token, m) => { try { sessionStorage.setItem(markerKey(token), JSON.stringify(m)); } catch { /* ignore */ } };

export default function KioskScreen() {
  const { token } = useParams();
  const nav = useNavigate();
  const base = `/api/kiosk/${encodeURIComponent(token)}`;
  const [info, setInfo] = useState(null);
  const [loadError, setLoadError] = useState(null); // the welcome details couldn't load (no internet, a 5xx…)
  const [ended, setEnded] = useState(null);
  const [step, setStep] = useState('welcome'); // welcome · email · code · consent · start · photos · build · finish
  const [email, setEmail] = useState('');
  const [newAccount, setNewAccount] = useState(false);
  const [who, setWho] = useState(null);
  const [resumeId, setResumeId] = useState(null);
  const [d, setD] = useState(null);
  const [approval, setApproval] = useState(null);
  const [warn, setWarn] = useState(null);
  const [exiting, setExiting] = useState(false);
  const [note, setNote] = useState('');
  const [autoPrint, setAutoPrint] = useState(false);
  usePageMeta({ title: info ? `Kiosk · ${info.org.name}` : 'Kiosk', description: 'Build and print your resume at this event.', noindex: true });

  // the welcome details, and a check-in every minute (the coordinator sees the kiosk as active; a revoked or
  // expired link shows "ended" and wipes the device). Any other failure before the details loaded (no internet, a
  // 5xx) is shown with Retry, and tried again every 10 seconds; once loaded, a failed check-in changes nothing.
  const check = useCallback(() => http(base).then((next) => { setLoadError(null); setInfo((cur) => (JSON.stringify(cur) === JSON.stringify(next) ? cur : next)); }, (e) => {
    const problem = kioskLoadProblem(e);
    if (problem.ended) setEnded(problem.ended); else setLoadError(problem.error);
  }), [base]);
  useEffect(() => { check(); const t = setInterval(check, HEARTBEAT_MS); return () => clearInterval(t); }, [check]);
  useEffect(() => {
    if (info || !loadError) return undefined;
    const t = setInterval(check, RETRY_MS);
    return () => clearInterval(t);
  }, [info, loadError, check]);

  // saving: the resume is the candidate's own (in their account); changes are sent shortly after typing stops.
  // A failed save keeps the changes here (so Retry, the next edit, Print and Finish send them again) and says so.
  const pending = useRef(null);
  const [saveFailed, setSaveFailed] = useState(false);
  const save = useCallback(async () => {
    const p = pending.current;
    if (!p) return true;
    clearTimeout(p.t);
    try {
      await http(`/api/me/resumes/${encodeURIComponent(p.id)}`, { method: 'PATCH', body: { data: p.data } });
      if (pending.current === p) pending.current = null; // (newer edits may be waiting already)
      setSaveFailed(false);
      return true;
    } catch {
      setSaveFailed(true);
      return false;
    }
  }, []);
  useEffect(() => {
    if (!resumeId || !d) return;
    if (pending.current) clearTimeout(pending.current.t);
    pending.current = { id: resumeId, data: d, t: setTimeout(save, 800) };
  }, [d, resumeId, save]);

  // `ifUnsaved`: the note when the last changes couldn't be saved even after one more try (never "saved")
  const reset = useCallback(async (msg = '', ifUnsaved = null) => {
    let saved = true;
    for (let n = 0; pending.current && saved && n < 3; n++) saved = await save(); // the last edits, one more try
    document.querySelectorAll('[data-kiosk-print]').forEach((x) => x.remove());
    pending.current = null;
    await signOut().catch(() => {});
    await wipeDevice();
    setStep('welcome'); setEmail(''); setNewAccount(false); setWho(null); setResumeId(null); setD(null); setApproval(null); setWarn(null); setSaveFailed(false);
    setNote(saved || !ifUnsaved ? msg : ifUnsaved);
  }, [save]);

  useEffect(() => { if (ended) reset(); }, [ended]); // eslint-disable-line react-hooks/exhaustive-deps
  // On load: a candidate signed in at this kiosk (the page reloaded onto a new build) comes back to their step;
  // anyone else signed in on this browser (e.g. the coordinator who opened the link) is signed out and wiped first.
  const { user, ready } = useAuth();
  const checkedLoad = useRef(false);
  useEffect(() => {
    if (!ready || checkedLoad.current) return;
    checkedLoad.current = true;
    if (!user) return;
    const m = readMarker(token);
    if (!m || m.userId !== user.id) { reset(); return; }
    (async () => {
      try {
        const st = await http('/api/me/state');
        const r = st.resumes.find((x) => x.id === m.resumeId);
        if (!r) throw new Error('resume');
        const data = migrateLinks({ ...INITIAL, ...r.data });
        setWho(m.who); setResumeId(r.id); setD(data); setApproval(m.approval || null);
        setAutoPrint(!!m.printAfter);
        setStep(m.step);
        preloadPrint(data);
      } catch {
        reset('Please sign in again — your resume is saved in your account.');
      }
    })();
  }, [ready]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!who || !resumeId || !user) return;
    const keep = { photos: 'start', email: null, code: null, welcome: null }[step];
    if (keep === null) return;
    writeMarker(token, { userId: user.id, who, resumeId, approval, step: keep || step });
  }, [who, resumeId, approval, step, user, token]);

  // Nobody signed in: check every few minutes whether a new build is live, and reload onto it quietly.
  useEffect(() => {
    if (step !== 'welcome' || who) return undefined;
    const t = setInterval(async () => {
      try {
        const html = await (await fetch('/', { cache: 'no-store' })).text();
        if (newBuildLive(html, document)) window.location.reload();
      } catch { /* offline: try again later */ }
    }, BUILD_CHECK_MS);
    return () => clearInterval(t);
  }, [step, who]);

  // No sideways jumps when the page grows or shrinks: the scrollbar's space is always kept.
  useEffect(() => {
    const el = document.documentElement;
    const before = [el.style.scrollbarGutter, el.style.overflowY];
    el.style.scrollbarGutter = 'stable';
    el.style.overflowY = 'scroll';
    return () => { [el.style.scrollbarGutter, el.style.overflowY] = before; };
  }, []);

  // nobody touched the screen for 2 minutes: a 20-second warning, then everything is wiped
  useEffect(() => {
    if (step === 'welcome') return undefined;
    const timer = createIdleTimer({ onWarn: setWarn, onIdle: () => reset('Signed out after 2 minutes without a touch. Your resume is saved in your account.', 'Signed out after 2 minutes without a touch. Your last changes couldn’t be saved (no internet) — your account has the earlier version of your resume.') });
    const poke = () => timer.poke();
    const evs = ['pointerdown', 'keydown', 'touchstart', 'wheel', 'nm7-activity']; // nm7-activity: someone is speaking
    evs.forEach((e) => window.addEventListener(e, poke, { passive: true }));
    return () => { timer.stop(); evs.forEach((e) => window.removeEventListener(e, poke)); };
  }, [step === 'welcome', reset]); // eslint-disable-line react-hooks/exhaustive-deps

  // the browser's Back button stays on the kiosk (leaving needs the PIN)
  useEffect(() => {
    window.history.pushState({ kiosk: 1 }, '');
    const stay = () => window.history.pushState({ kiosk: 1 }, '');
    window.addEventListener('popstate', stay);
    return () => window.removeEventListener('popstate', stay);
  }, []);

  const start = () => {
    setNote('');
    document.documentElement.requestFullscreen?.().catch(() => {});
    setStep('email');
  };

  // signed in: find (or make) the resume this kiosk edits, then consent unless they already joined
  const signedIn = async (me) => {
    setWho(me);
    await reloadUser();
    const s = await http('/api/me/state');
    let r = me.membership ? s.resumes.find((x) => x.id === me.membership.resumeId) : null;
    r = r || s.resumes.find((x) => x.active) || s.resumes[0];
    if (!r) {
      const fresh = { id: keyId(), name: `${info.group.name} · kiosk`.slice(0, 80), data: blank(me), active: true };
      r = await http('/api/me/resumes', { method: 'POST', body: fresh });
    }
    setResumeId(r.id);
    const data = migrateLinks({ ...INITIAL, ...r.data });
    setD(data);
    preloadPrint(data);
    if (me.membership) { setApproval(me.membership.approval); setStep('start'); } else setStep(info.closed ? 'start' : 'consent');
  };

  const leave = async () => { await reset(); if (document.fullscreenElement) document.exitFullscreen?.().catch(() => {}); nav('/', { replace: true }); };

  if (ended) {
    return (
      <div style={shell}><main id="main" className="container stack g16" style={{ padding: '15vh 24px', maxWidth: 640, textAlign: 'center' }}>
        <h1 className="display h2">This kiosk has ended</h1>
        <p className="lead">{ended}</p>
        <Link to="/" className="btn btn-outline btn-lg" style={{ alignSelf: 'center' }}>Go to nm7.si</Link>
      </main></div>
    );
  }
  if (!info) {
    return (
      <div style={shell}>
        {loadError ? (
          <main id="main" className="container stack g16" role="alert" data-testid="k-load-error" style={{ padding: '15vh 24px', maxWidth: 640, textAlign: 'center' }}>
            <h1 className="display h2">Can’t load this kiosk</h1>
            <p className="lead">{loadError}</p>
            <p className="small muted">Trying again every 10 seconds.</p>
            <button type="button" className="btn btn-ink btn-xl" style={{ alignSelf: 'center' }} onClick={check}>Retry</button>
          </main>
        ) : <div className="row g12 muted" role="status" style={{ padding: '30vh 24px', justifyContent: 'center' }}><Spinner /> Loading…</div>}
      </div>
    );
  }
  const saveNotice = saveFailed && (
    <p className="error row g12" role="alert" data-testid="k-save-failed" style={{ margin: 0, alignItems: 'center' }}>
      <span>{SAVE_FAILED}</span>
      <button type="button" className="btn btn-outline" onClick={save}>Retry</button>
    </p>
  );

  return (
    <div style={shell} className="kiosk">
      <header className="row between g12" style={{ padding: '14px 20px', borderBottom: '1px solid var(--border)' }}>
        <span className="row g12" style={{ minWidth: 0 }}>
          {info.org.logoUrl && <img src={info.org.logoUrl} alt="" height={36} style={{ maxWidth: 120, objectFit: 'contain' }} />}
          <span className="stack" style={{ minWidth: 0 }}><strong style={{ fontSize: 18 }}>{info.org.name}</strong><span className="small muted">{info.group.name} · {info.label}</span></span>
        </span>
        {who && <button type="button" className="btn btn-outline" onClick={() => reset('Signed out. Your resume is saved in your account.', 'Signed out. Your last changes couldn’t be saved (no internet) — your account has the earlier version of your resume.')}>Sign out</button>}
      </header>
      <main id="main" className="container stack g20" style={{ flex: 1, width: '100%', boxSizing: 'border-box', padding: '28px 20px 40px', maxWidth: step === 'build' || step === 'finish' ? 1100 : 720 }}>
        {step === 'welcome' && (
          <div className="stack g20" style={{ textAlign: 'center', paddingTop: '8vh' }}>
            <h1 className="display" style={{ fontSize: 'clamp(32px,5vw,52px)' }}>Make your resume here</h1>
            <p className="lead">For <strong>{info.org.name}</strong> · {info.group.name}. Build it step by step in about 10 minutes, then print it.</p>
            {note && <p className="well small" role="status">{note}</p>}
            <button type="button" className="btn btn-ink btn-xl" style={{ alignSelf: 'center', minWidth: 260, minHeight: 72, fontSize: 22 }} onClick={start}>Start</button>
            <span className="small muted">Free. You’ll sign in with a code sent to your email. Nothing stays on this screen after you finish.</span>
          </div>
        )}
        {step === 'email' && <EmailStep base={base} email={email} setEmail={setEmail} onSent={(isNew) => { setNewAccount(isNew); setStep('code'); }} onBack={() => setStep('welcome')} />}
        {step === 'code' && <CodeStep base={base} email={email} newAccount={newAccount} onDone={signedIn} onBack={() => setStep('email')} />}
        {step === 'consent' && <ConsentStep base={base} info={info} resumeId={resumeId} onDone={(m) => { setApproval(m.approval); setStep('start'); }} />}
        {step === 'start' && (
          <div className="stack g16">
            <h1 className="display h2">How do you want to start?</h1>
            {approval === 'pending' && <p className="well small">{info.org.name} checks new members first — you’re on the list. You can still build and print your resume now.</p>}
            {info.closed && !approval && <p className="well small">Joining this group is closed ({info.closed}). You can still build and print your resume.</p>}
            <div className="grid-auto g16">
              <button type="button" className="card stack g8 btn" style={{ textAlign: 'left', alignItems: 'flex-start', whiteSpace: 'normal', height: 'auto', padding: 28, border: '2px solid var(--ink)' }} onClick={() => setStep('build')}>
                <strong className="display" style={{ fontSize: 24 }}>{real(d?.personal?.headline) || d?.exp?.length || d?.proj?.length ? 'Continue my resume' : 'Type it in, step by step'}</strong>
                <span className="muted" style={{ fontWeight: 400, ...big }}>Six short steps with big boxes. Skip anything you don’t have.</span>
              </button>
              <button type="button" className="card stack g8 btn" style={{ textAlign: 'left', alignItems: 'flex-start', whiteSpace: 'normal', height: 'auto', padding: 28 }} onClick={() => setStep('photos')}>
                <strong className="display" style={{ fontSize: 24 }}>Snap photos</strong>
                <span className="muted" style={{ fontWeight: 400, ...big }}>Take photos of your marksheets, certificates or work papers. We read them and fill your resume.</span>
              </button>
            </div>
          </div>
        )}
        {step === 'photos' && <PhotoImport embedded title="Snap photos of your papers" onBack={() => setStep('start')} onDone={(review) => { setD((cur) => migrateLinks(reviewToResume(review, cur))); setStep('build'); }} />}
        {(step === 'start' || step === 'build' || step === 'finish') && saveNotice}
        {step === 'build' && d && <GuidedBuilder d={d} setD={setD} onDone={() => setStep('finish')} />}
        {step === 'finish' && d && <Finish base={base} d={d} brand={info.brand} autoPrint={autoPrint} onAutoPrinted={() => setAutoPrint(false)}
          beforeReload={async () => { await save(); const m = readMarker(token); if (m) writeMarker(token, { ...m, step: 'finish', printAfter: true }); }} approval={approval} org={info.org.name} save={save} onEdit={() => setStep('build')}
          onFinish={() => reset('Done! You’re signed out and this screen is clear. Your resume is saved in your Nm7 account.', 'Done! You’re signed out and this screen is clear. Your last changes couldn’t be saved (no internet) — your Nm7 account has the earlier version of your resume.')} />}
      </main>
      <footer className="row between g8" style={{ padding: '10px 20px', borderTop: '1px solid var(--border)' }}>
        <span className="xs faint">Nm7 · your resume is saved in your own account · never asks for Aadhaar, PAN or bank numbers</span>
        <button type="button" className="link-btn xs" onClick={() => setExiting(true)}>Staff: exit kiosk</button>
      </footer>
      {warn != null && (
        <Dialog showTitle title="Are you still there?" onClose={() => setWarn(null)}>
          <div className="stack g12" role="alert">
            <p style={big}>For your privacy this screen clears itself in <strong data-testid="idle-left">{warn}</strong> seconds.</p>
            <button type="button" className="btn btn-ink btn-lg" onClick={() => setWarn(null)}>I’m still here</button>
          </div>
        </Dialog>
      )}
      {exiting && <ExitDialog base={base} onClose={() => setExiting(false)} onOk={leave} />}
    </div>
  );
}

function EmailStep({ base, email, setEmail, onSent, onBack }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const send = async (e) => {
    e.preventDefault();
    setBusy(true); setError('');
    try { const r = await http(`${base}/code`, { method: 'POST', body: { email: email.trim() } }); onSent(r.newAccount); } catch (err) { setError(err.message); } finally { setBusy(false); }
  };
  return (
    <form className="stack g16" onSubmit={send}>
      <h1 className="display h2">Your email</h1>
      <p style={big}>We’ll email you a 6-digit code. Your resume is saved in your free Nm7 account, so you can keep working on it from your phone.</p>
      <div className="field"><label className="label" htmlFor="k-email">Email address</label><input id="k-email" type="email" inputMode="email" autoComplete="off" className="input" style={bigInput} value={email} onChange={(e) => setEmail(e.target.value)} /></div>
      {error && <p className="error" role="alert">{error}</p>}
      <div className="row g12"><button type="submit" className="btn btn-ink btn-xl" disabled={busy || !EMAIL_RE.test(email.trim())}>{busy ? 'Sending…' : 'Send my code'}</button><button type="button" className="btn btn-outline btn-xl" onClick={onBack}>Back</button></div>
    </form>
  );
}

function CodeStep({ base, email, newAccount, onDone, onBack }) {
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [terms, setTerms] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const ok = /^\d{6}$/.test(code) && (!newAccount || (name.trim() && terms));
  const verify = async (e) => {
    e.preventDefault();
    setBusy(true); setError('');
    try { await onDone(await http(`${base}/verify`, { method: 'POST', body: { email: email.trim(), code, name: name.trim(), terms } })); } catch (err) { setError(err.message); setBusy(false); }
  };
  return (
    <form className="stack g16" onSubmit={verify}>
      <h1 className="display h2">Enter your code</h1>
      <p style={big}>We sent a 6-digit code to <strong>{email}</strong>. It works for 10 minutes.</p>
      <div className="field"><label className="label" htmlFor="k-code">6-digit code</label><input id="k-code" inputMode="numeric" autoComplete="one-time-code" maxLength={6} className="input mono" style={{ ...bigInput, letterSpacing: 6 }} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} /></div>
      {newAccount && (
        <>
          <div className="field"><label className="label" htmlFor="k-name">Your full name</label><input id="k-name" autoComplete="off" className="input" style={bigInput} maxLength={80} value={name} onChange={(e) => setName(e.target.value)} /></div>
          <label className="check" style={big}><input type="checkbox" checked={terms} onChange={(e) => setTerms(e.target.checked)} />I agree to Nm7’s Terms and Privacy Policy (at nm7.si/terms and nm7.si/privacy). A free account is made with this email.</label>
        </>
      )}
      {error && <p className="error" role="alert">{error}</p>}
      <div className="row g12"><button type="submit" className="btn btn-ink btn-xl" disabled={busy || !ok}>{busy ? 'Checking…' : 'Continue'}</button><button type="button" className="btn btn-outline btn-xl" onClick={onBack}>Use another email</button></div>
    </form>
  );
}

function ConsentStep({ base, info, resumeId, onDone }) {
  const [consent, setConsent] = useState(false);
  const [recruit, setRecruit] = useState(false); // never ticked for them (same as the join page)
  const [fields, setFields] = useState({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const defs = info.group.customFields || [];
  const missing = defs.some((f) => f.required && !(fields[f.key] || '').trim());
  const join = async (e) => {
    e.preventDefault();
    setBusy(true); setError('');
    try { onDone(await http(`${base}/join`, { method: 'POST', body: { consent, fields, resumeId, recruiterOptIn: !!(recruit && info.group.shareWithRecruiters) } })); } catch (err) { setError(err.message); setBusy(false); }
  };
  return (
    <form className="stack g16" onSubmit={join}>
      <h1 className="display h2">Share with {info.org.name}</h1>
      {defs.map((f) => (
        <div key={f.key} className="field">
          <label className="label" htmlFor={`kf-${f.key}`}>{f.label}{f.required ? ' *' : ''}</label>
          {f.type === 'select'
            ? <select id={`kf-${f.key}`} className="input" style={bigInput} value={fields[f.key] || ''} onChange={(e) => setFields({ ...fields, [f.key]: e.target.value })}><option value="">Choose…</option>{f.options.map((o) => <option key={o} value={o}>{o}</option>)}</select>
            : <input id={`kf-${f.key}`} className="input" style={bigInput} autoComplete="off" maxLength={120} value={fields[f.key] || ''} onChange={(e) => setFields({ ...fields, [f.key]: e.target.value })} />}
        </div>
      ))}
      <label className="check card" style={{ ...big, padding: 16 }}><input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} />{info.consentText}</label>
      {info.group.shareWithRecruiters && (
        <label className="check card" style={{ ...big, padding: 16 }}><input type="checkbox" checked={recruit} onChange={(e) => setRecruit(e.target.checked)} />Allow {info.org.name} to share my resume with recruiters <span className="small muted">(optional — you can change this any time in My groups at nm7.si)</span></label>
      )}
      {info.group.requireApproval && <p className="small muted">{info.org.name} checks new members before printing. You can still print your own copy here.</p>}
      {error && <p className="error" role="alert">{error}</p>}
      <button type="submit" className="btn btn-ink btn-xl" style={{ alignSelf: 'flex-start' }} disabled={busy || !consent || missing}>{busy ? 'Saving…' : 'Agree and continue'}</button>
    </form>
  );
}

/** The kiosk's simple mode of the builder: the same resume, fields and template, six short steps. */
export function GuidedBuilder({ d, setD, onDone }) {
  const [i, setI] = useState(0);
  const [id, label] = KIOSK_STEPS[i];
  const setP = (k, v) => setD((p) => ({ ...p, personal: { ...p.personal, [k]: v } }));
  const setList = (k, arr) => setD((p) => ({ ...p, [k]: arr }));
  const listStep = (k, max = 3) => {
    const list = d[k] || [];
    const schema = LISTS[k];
    const fields = schema.fields.filter((f) => !['employmentType', 'type', 'status', 'tagline'].includes(f.key)); // the essentials only
    return (
      <div className="stack g12">
        {list.map((obj, n) => (
          <div key={n} className="card stack g12" style={{ padding: 18 }}>
            <div className="row between"><strong>{schema.item} {n + 1}</strong><button type="button" className="link-btn small" onClick={() => setList(k, list.filter((_, j) => j !== n))}>Remove</button></div>
            <FieldGrid>{fields.map((f) => <SchemaField key={f.key} field={{ ...f, ai: undefined }} idBase={`k-${k}-${n}`} value={obj[f.key]} disabled={f.disabledBy ? !!obj[f.disabledBy] : false} onChange={(v) => setList(k, list.map((x, j) => (j === n ? { ...x, [f.key]: v } : x)))} />)}</FieldGrid>
          </div>
        ))}
        {list.length < max && <button type="button" className="btn btn-outline btn-lg" style={{ borderStyle: 'dashed' }} onClick={() => setList(k, [...list, { ...schema.blank }])}>+ Add {list.length ? 'another' : 'a'} {schema.item.toLowerCase()}</button>}
      </div>
    );
  };
  const skills = d.skillGroups?.[0]?.value || '';
  const body = {
    about: <div className="card" style={{ padding: 18 }}><FieldGrid>{PERSONAL_FIELDS.map((f) => <SchemaField key={f.key} field={f} idBase="k-p" value={d.personal[f.key]} onChange={(v) => setP(f.key, v)} />)}</FieldGrid></div>,
    edu: listStep('edu'),
    work: <div className="stack g16"><span className="small muted">Jobs, internships or apprenticeships first. No work yet? Add a project, or skip this step.</span>{listStep('exp')}<strong>Projects</strong>{listStep('proj', 2)}</div>,
    skills: (
      <div className="field"><label className="label" htmlFor="k-skills">Your skills (separate them with commas)</label>
        <textarea id="k-skills" className="input" rows={3} style={big} placeholder="e.g. MS Excel, Tally, Customer service, Welding" value={skills} onChange={(e) => setD((p) => ({ ...p, skillGroups: p.skillGroups.map((g, j) => (j === 0 ? { ...g, value: e.target.value } : g)) }))} />
      </div>
    ),
    summary: (
      <div className="stack g16">
        <SummaryWriter big resume={d} note={d.about || ''} onNote={(v) => setD((p) => ({ ...p, about: v }))} value={d.summary} onUse={(t) => setD((p) => ({ ...p, summary: t }))} />
        <div className="field"><label className="label" htmlFor="k-sum">Two or three lines about you (optional)</label>
        <textarea id="k-sum" className="input" rows={4} style={big} maxLength={600} placeholder="e.g. Diploma holder in Mechanical Engineering looking for a production trainee role. Good with machines and quick to learn." value={d.summary} onChange={(e) => setD((p) => ({ ...p, summary: e.target.value }))} />
        </div>
      </div>
    ),
    review: <div className="card" style={{ padding: 12 }}><ResumePreview data={d} design={designOf(d)} /></div>,
  }[id];
  return (
    <div className="stack g16">
      <ol className="steps" aria-label="Steps" style={{ padding: 0, flexWrap: 'wrap' }}>
        {KIOSK_STEPS.map(([k, l], n) => <li key={k} aria-current={n === i ? 'step' : undefined} data-state={n < i ? 'done' : undefined}><span className="mono">{n < i ? '✓' : n + 1}</span>{l}</li>)}
      </ol>
      <h1 className="display h2">{label}</h1>
      {body}
      <div className="row g12">
        {i > 0 && <button type="button" className="btn btn-outline btn-xl" onClick={() => setI(i - 1)}>Back</button>}
        {i < KIOSK_STEPS.length - 1
          ? <button type="button" className="btn btn-ink btn-xl" onClick={() => setI(i + 1)}>Next</button>
          : <button type="button" className="btn btn-ink btn-xl" onClick={onDone} disabled={!real(d.personal?.name)}>My resume is ready</button>}
      </div>
    </div>
  );
}

/** "Your resume is ready". Nothing moves when a button is pressed: labels change inside fixed-size buttons and every
 * message goes into one status area of fixed height. Print and Send don't block each other. */
function Finish({ base, d, brand, approval, org, save, onEdit, onFinish, autoPrint, onAutoPrinted, beforeReload }) {
  const [printing, setPrinting] = useState(false);
  const [sending, setSending] = useState(false);
  const [mailed, setMailed] = useState(false);
  const [status, setStatus] = useState({ text: '', error: false });
  const design = useMemo(() => (brand ? brandDesign(brand) : designOf(d)), [d, brand]); // a branded group prints in the org's template
  const print = async () => {
    if (printing) return;
    setPrinting(true); setStatus({ text: 'Preparing your print…', error: false });
    try {
      await save();
      const [{ buildResumePdf }] = await freshImport(printModules, { beforeReload });
      await printPdf(await buildResumePdf({ data: d, design, photo: null, brand: await prepareBrand(brand) }));
      await http(`${base}/print`, { method: 'POST', body: {} });
      setStatus({ text: 'Sent to the printer. Collect your copy from the printer.', error: false });
    } catch (e) {
      setStatus({ text: e.message || 'Printing didn’t start. Please try again.', error: e.code !== 'stale_build' });
    } finally { setPrinting(false); }
  };
  const mail = async () => {
    if (sending) return;
    setSending(true); setStatus({ text: 'Sending the link to your email…', error: false });
    try {
      if (!await save()) { // the link opens the account's copy: the latest changes must be there first
        setStatus({ text: 'Couldn’t save your latest changes — check the internet, then try again.', error: true });
        return;
      }
      const r = await http(`${base}/send-link`, { method: 'POST', body: {} });
      setMailed(!!r.sent);
      setStatus(r.sent ? { text: 'Check your email for a link to keep going on your phone.', error: false } : { text: 'The email didn’t go out. You can sign in at nm7.si later with this email.', error: true });
    } catch (e) { setStatus({ text: e.message, error: true }); } finally { setSending(false); }
  };
  // back from a reload onto a new build in the middle of Print: print straight away
  const autoDone = useRef(false); // once, even when React runs mount effects twice
  useEffect(() => { if (autoPrint && !autoDone.current) { autoDone.current = true; onAutoPrinted(); print(); } }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const fixed = { minHeight: 72, fontSize: 22, width: '100%', gap: 10 };
  return (
    <div style={{ display: 'grid', width: '100%', gridTemplateColumns: 'repeat(auto-fit, minmax(min(360px, 100%), 1fr))', gap: 24, alignItems: 'start' }}>
      <div className="stack g16" style={{ minWidth: 0 }}>
        <h1 className="display h2">Your resume is ready</h1>
        {approval === 'pending' && <p className="well small">{org} checks new members first. Your own copy prints now.</p>}
        <button type="button" className="btn btn-ink btn-xl" data-testid="k-print" style={fixed} aria-busy={printing} onClick={print}>{printing && <Spinner />}Print now</button>
        <button type="button" className="btn btn-outline btn-xl" data-testid="k-mail" style={{ ...fixed, minHeight: 56, fontSize: 18 }} aria-busy={sending} disabled={mailed} onClick={mail}>{sending && <Spinner />}{mailed ? 'Link sent to your email' : 'Send to my email'}</button>
        <p data-testid="k-status" role={status.error ? 'alert' : 'status'} aria-live="polite" className={status.error ? 'error' : 'small'}
          style={{ margin: 0, minHeight: '3em', lineHeight: 1.5, overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' }}>{status.text}</p>
        <button type="button" className="btn btn-outline btn-lg" data-testid="k-edit" style={{ width: '100%' }} onClick={onEdit}>Make changes</button>
        <button type="button" className="btn btn-ink btn-lg" data-testid="k-finish" style={{ width: '100%' }} onClick={onFinish}>Finish and sign out</button>
      </div>
      <div className="card" style={{ padding: 12, minWidth: 0 }}><ResumePreview data={d} design={design} brand={brand} /></div>
    </div>
  );
}

function ExitDialog({ base, onClose, onOk }) {
  const [pin, setPin] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const go = async (e) => {
    e.preventDefault();
    setBusy(true); setError('');
    try { await http(`${base}/exit`, { method: 'POST', body: { pin } }); await onOk(); } catch (err) { setError(err.message); setBusy(false); }
  };
  return (
    <Dialog showTitle title="Exit the kiosk" onClose={onClose}>
      <form className="stack g12" onSubmit={go}>
        <div className="field"><label className="label" htmlFor="k-pin-exit">Exit PIN</label><input id="k-pin-exit" type="password" inputMode="numeric" autoComplete="off" maxLength={6} className="input" style={bigInput} value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))} /></div>
        {error && <p className="error" role="alert">{error}</p>}
        <div className="row g8"><button type="submit" className="btn btn-ink" disabled={busy || pin.length < 4}>Exit</button><button type="button" className="btn btn-outline" onClick={onClose}>Cancel</button></div>
      </form>
    </Dialog>
  );
}

/** /continue?t=… — the emailed link: signs in on this (the candidate's own) device, once, then opens the builder. */
export function ContinueHere() {
  usePageMeta({ title: 'Continue your resume', description: 'Keep working on the resume you started at an event kiosk.', noindex: true });
  const [params] = useSearchParams();
  const nav = useNavigate();
  const { user } = useAuth();
  const [error, setError] = useState('');
  const tried = useRef(false);
  useEffect(() => {
    if (tried.current) return;
    tried.current = true;
    http('/api/public/continue', { method: 'POST', body: { token: params.get('t') || '' } })
      .then(() => reloadUser()).then(() => nav('/builder', { replace: true, state: { open: 'build' } }), (e) => setError(e.message));
  }, [params, nav]);
  return (
    <main id="main" className="container stack g16" style={{ padding: '96px 24px', maxWidth: 560 }}>
      {error ? (
        <div className="card stack g8" role="alert">
          <h1 className="display" style={{ fontSize: 26 }}>This link doesn’t work any more</h1>
          <p>{error}</p>
          <div className="row g8">{user ? <Link className="btn btn-ink" to="/builder">Open my resume</Link> : <><Link className="btn btn-ink" to="/login?next=%2Fbuilder">Sign in</Link><Link className="btn btn-outline" to="/forgot-password">Set a password</Link></>}</div>
        </div>
      ) : <div className="row g12 muted" role="status"><Spinner /> Signing you in…</div>}
    </main>
  );
}
