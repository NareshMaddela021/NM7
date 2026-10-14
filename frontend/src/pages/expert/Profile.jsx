// Expert profile: join with an asuraa.ai profile link, an uploaded document, or from scratch; then edit, preview and submit.
import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { currentUser } from '../../lib/auth';
import Header from '../../components/Header';
import { Icon, Meter, useToast } from '../../components/ui';
import PhotoEditor, { DEFAULT_ADJ } from '../builder/PhotoEditor';
import { Logo } from '../builder/LinksEditor';
import { getAsuraaAiProfile, sendAsuraaAiCode, verifyAsuraaAiCode, submitExpertProfile } from '../../services/api';
import { PLANS, expertPayout, inr, FEES, PROMISES } from '../../lib/pricing';
import {
  BLANK, DOMAINS, LEVELS, LANGS, STATUS, loadExpert, saveExpert, clearExpert, fromAsuraaAi, fromDocument, suggestDomains,
  expertIssues, expertStrength, payoutError, PAN_RE,
} from '../../lib/expert';

const SECTIONS = [['about', 'About you'], ['expertise', 'Expertise'], ['proof', 'Experience & proof'], ['samples', 'Sample work'], ['services', 'Services & capacity'], ['payout', 'Payouts & tax'], ['agree', 'Agreement']];
const AI_PICKS = [['name', 'Name'], ['headline', 'Headline'], ['bio', 'Bio'], ['city', 'City'], ['languages', 'Languages'], ['experience', 'Experience'], ['links', 'LinkedIn link']];
const mask = (s, keep = 4) => (s ? `${'•'.repeat(Math.max(0, s.length - keep))}${s.slice(-keep)}` : '');

/* ---------- small field helpers ---------- */
function Text({ id, label, value, onChange, ph, hint, error, area, rows = 4, max, type = 'text' }) {
  return (
    <div className="field">
      <label htmlFor={id} className="label row between"><span>{label}</span>{max && <span className="faint">{(value || '').length}/{max}</span>}</label>
      {area ? <textarea id={id} className="input" rows={rows} value={value || ''} maxLength={max} placeholder={ph} onChange={(e) => onChange(e.target.value)} />
        : <input id={id} className="input" type={type} value={value || ''} maxLength={max} placeholder={ph} onChange={(e) => onChange(e.target.value)} aria-invalid={error ? 'true' : undefined} />}
      {error ? <span role="alert" className="error">{error}</span> : hint && <span className="xs faint">{hint}</span>}
    </div>
  );
}
function Chips({ label, options, value, onChange }) {
  return (
    <div className="field">
      <span className="label">{label}</span>
      <div className="row g8" role="group" aria-label={label}>
        {options.map((o) => { const [v, l] = Array.isArray(o) ? o : [o, o]; const on = value.includes(v); return <button key={v} type="button" className="chip" aria-pressed={on} style={{ minHeight: 36, fontSize: 13 }} onClick={() => onChange(on ? value.filter((x) => x !== v) : [...value, v])}>{on ? '✓ ' : ''}{l}</button>; })}
      </div>
    </div>
  );
}

/* ---------- start: 3 ways in ---------- */
function Start({ onAi, onDoc, onFresh, busy, error }) {
  const fileRef = useRef();
  return (
    <main className="container stack g24 rise" style={{ maxWidth: 1100, padding: '56px 24px' }}>
      <div className="stack g8" style={{ maxWidth: 760 }}>
        <span className="mono faint">EXPERTS · NM7 RESUME SERVICES</span>
        <h1 className="display" style={{ fontSize: 'clamp(34px,4.6vw,52px)' }}>Become a resume expert on <span className="hl" style={{ padding: '0 4px' }}>Nm7</span></h1>
        <p className="lead">Rewrite resumes for freshers and early-career job seekers, delivered in {PROMISES.delivery}. Start from what you already have — no need to type it all again.</p>
      </div>
      <div className="grid-auto g16" style={{ '--min': '280px' }}>
        <button type="button" className="card stack g8 btn" onClick={onAi} style={{ textAlign: 'left', alignItems: 'flex-start', whiteSpace: 'normal', height: 'auto', padding: 24, border: '2px solid var(--ink)' }}>
          <span className="badge b-signal">Already on asuraa.ai? · Fastest</span>
          <strong className="display" style={{ fontSize: 22 }}>Use my asuraa.ai profile link</strong>
          <span className="muted" style={{ fontWeight: 400 }}>Paste asuraa.ai/yourname. We fill your name, bio, languages and experience — you confirm with a code.</span>
        </button>
        <button type="button" className="card stack g8 btn" onClick={() => fileRef.current?.click()} disabled={busy} style={{ textAlign: 'left', alignItems: 'flex-start', whiteSpace: 'normal', height: 'auto', padding: 24 }}>
          <strong className="display" style={{ fontSize: 22 }}>{busy ? 'Reading your file…' : 'Upload LinkedIn PDF or CV'}</strong>
          <span className="muted" style={{ fontWeight: 400 }}>PDF or Word. We read your experience, certifications, languages and links, and suggest your domains.</span>
          <input ref={fileRef} type="file" accept=".pdf,.docx,application/pdf" className="sr-only" onChange={(e) => { onDoc(e.target.files?.[0]); e.target.value = ''; }} />
        </button>
        <button type="button" className="card stack g8 btn" onClick={onFresh} style={{ textAlign: 'left', alignItems: 'flex-start', whiteSpace: 'normal', height: 'auto', padding: 24 }}>
          <strong className="display" style={{ fontSize: 22 }}>Start fresh</strong>
          <span className="muted" style={{ fontWeight: 400 }}>A short guided form. About 10 minutes.</span>
        </button>
      </div>
      {error && <p role="alert" className="card small" style={{ borderColor: 'var(--danger)', color: 'var(--danger)', padding: 16 }}>{error}</p>}
      <p className="xs faint">Your ID, PAN and bank details are never read from documents or copied from asuraa.ai — you add them yourself in a secure step.</p>
    </main>
  );
}

/* ---------- asuraa.ai link flow: link → preview & pick → code → done ---------- */
function AiLink({ onBack, onDone, initial = '' }) {
  const [step, setStep] = useState('link');
  const [link, setLink] = useState(initial);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [ai, setAi] = useState(null);
  const [picks, setPicks] = useState(Object.fromEntries(AI_PICKS.map(([k]) => [k, true])));
  const [sent, setSent] = useState(null);
  const [code, setCode] = useState('');

  const fetchIt = async (e) => {
    e?.preventDefault();
    setErr(''); setBusy(true);
    try { setAi(await getAsuraaAiProfile(link)); setStep('pick'); } catch (x) {
      setErr(x.code === 'bad-link' ? 'That doesn’t look like an asuraa.ai profile link. It should look like asuraa.ai/yourname.' : 'We couldn’t find that asuraa.ai profile. Check the link, or make sure the profile is public.');
    } finally { setBusy(false); }
  };
  const send = async () => { setBusy(true); setSent(await sendAsuraaAiCode(ai.username)); setBusy(false); setStep('code'); };
  const check = async (e) => {
    e.preventDefault(); setBusy(true); setErr('');
    const r = await verifyAsuraaAiCode(ai.username, code.trim());
    setBusy(false);
    if (r.ok) onDone(ai, picks); else setErr('That code isn’t right. Check the latest code we sent, or send a new one.');
  };

  return (
    <main className="container stack g20 rise" style={{ maxWidth: 760, padding: '48px 24px 72px' }}>
      <button type="button" className="btn btn-ghost" style={{ alignSelf: 'flex-start', paddingLeft: 0 }} onClick={onBack}><Icon name="back" size={16} />Back</button>
      <ol className="steps" aria-label="Link asuraa.ai">
        {['Paste link', 'Pick details', 'Confirm it’s you'].map((l, i) => { const at = ['link', 'pick', 'code'].indexOf(step); return <li key={l} aria-current={i === at ? 'step' : undefined} data-state={i < at ? 'done' : undefined}><span className="mono">{i < at ? '✓' : i + 1}</span>{l}</li>; })}
      </ol>

      {step === 'link' && (
        <form className="card stack g16" style={{ padding: 24 }} onSubmit={fetchIt}>
          <h1 className="display" style={{ fontSize: 30 }}>Paste your asuraa.ai profile link</h1>
          <Text id="ai-link" label="Profile link" value={link} onChange={setLink} ph="asuraa.ai/yourname" error={err} hint="Open your profile on asuraa.ai → Share profile → copy link." />
          <div className="row g8"><button type="submit" className="btn btn-ink btn-lg" disabled={busy || !link.trim()}>{busy ? 'Finding your profile…' : 'Find my profile'}</button></div>
          <span className="xs faint">Preview: try asuraa.ai/nareshmaddela or asuraa.ai/saivarsha.</span>
        </form>
      )}

      {step === 'pick' && ai && (
        <div className="card stack g16" style={{ padding: 24 }}>
          <div className="row g16" style={{ alignItems: 'center', flexWrap: 'nowrap' }}>
            <span style={{ width: 64, height: 64, flex: 'none', borderRadius: '50%', background: 'var(--ink)', color: 'var(--onink)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 26 }}>{ai.name[0]}</span>
            <div className="stack g4"><strong style={{ fontSize: 20 }}>{ai.name}</strong><span className="muted small">{ai.headline} · {ai.location}</span><span className="xs faint">{ai.url} · ★ {ai.rating} ({ai.reviews} review{ai.reviews === 1 ? '' : 's'})</span></div>
          </div>
          <strong>Bring these details over</strong>
          <div className="stack g8">
            {AI_PICKS.map(([k, l]) => {
              const preview = { name: ai.name, headline: ai.headline, bio: ai.bio, city: ai.location, languages: ai.languages.join(', '), experience: ai.experience.map((e) => [e.role, e.company].filter(Boolean).join(' · ')).join(' / '), links: ai.links.linkedin || '—' }[k];
              return (
                <label key={k} className="option" data-on={picks[k]} style={{ padding: '10px 14px' }}>
                  <input type="checkbox" checked={picks[k]} onChange={(e) => setPicks((p) => ({ ...p, [k]: e.target.checked }))} />
                  <span className="stack g4" style={{ minWidth: 0 }}><strong className="small">{l}</strong><span className="xs muted" style={{ overflowWrap: 'anywhere' }}>{preview}</span></span>
                </label>
              );
            })}
          </div>
          <div className="well xs muted stack g4">
            <span>Not copied: your asuraa.ai ratings and reviews (Nm7 ratings start fresh — you can show an “Also on asuraa.ai” badge), your offerings and prices, and your payout details.</span>
            {!ai.photo && <span>Your asuraa.ai profile has no photo we can copy — you can add one in the next step.</span>}
          </div>
          <div className="row g8">
            <button type="button" className="btn btn-ink btn-lg" onClick={send} disabled={busy || !Object.values(picks).some(Boolean)}>{busy ? 'Sending code…' : 'Next: confirm it’s me'}</button>
            <button type="button" className="btn btn-ghost" onClick={() => setStep('link')}>Use a different link</button>
          </div>
        </div>
      )}

      {step === 'code' && (
        <form className="card stack g16" style={{ padding: 24 }} onSubmit={check}>
          <h1 className="display" style={{ fontSize: 28 }}>Enter the 6-digit code</h1>
          <p className="muted">We sent it to the email on this asuraa.ai account: <strong>{sent?.sentTo}</strong>. This makes sure only the owner can copy this profile.</p>
          <Text id="ai-code" label="Code" value={code} onChange={(v) => setCode(v.replace(/\D/g, '').slice(0, 6))} ph="••••••" error={err} />
          {sent?.demoCode && <span className="xs" style={{ color: 'var(--accent)' }}>Preview only — your code is {sent.demoCode}. The live app sends it by email.</span>}
          <div className="row g8">
            <button type="submit" className="btn btn-ink btn-lg" disabled={busy || code.length !== 6}>{busy ? 'Checking…' : 'Confirm & fill my profile'}</button>
            <button type="button" className="btn btn-ghost" onClick={send} disabled={busy}>Send a new code</button>
          </div>
        </form>
      )}
    </main>
  );
}

/* ---------- main page ---------- */
export default function Profile() {
  const toast = useToast();
  const [p, setP] = useState(loadExpert);
  const [mode, setMode] = useState(() => (loadExpert() ? 'edit' : 'start'));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [photoSrc, setPhotoSrc] = useState(null);
  const [showIssues, setShowIssues] = useState(false);
  const [notes, setNotes] = useState([]);

  useEffect(() => { if (p) saveExpert(p); }, [p]);
  const set = (path, v) => setP((prev) => {
    const next = structuredClone(prev);
    const keys = path.split('.');
    let o = next; keys.slice(0, -1).forEach((k) => { o = o[k]; });
    o[keys[keys.length - 1]] = v;
    return next;
  });

  const fromDoc = async (file) => {
    if (!file) return;
    setBusy(true); setErr('');
    try {
      const { importResume } = await import('../../lib/import/index');
      const R = await importResume(file, 'resume', () => {});
      setP((prev) => fromDocument(prev || structuredClone(BLANK), R));
      setNotes([`Read from ${file.name}: ${R.data.exp.length} roles, ${R.data.certs.length} certifications, ${R.data.langs.length} languages.`, 'Pick your domains under Expertise — we’ve suggested some from your experience.']);
      setMode('edit');
      toast('Details filled from your document — please check them');
    } catch (e) { setErr(e?.code ? e.message : 'We couldn’t read that file. Try another copy, or start fresh.'); } finally { setBusy(false); }
  };

  if (mode === 'ai') {
    return (<><Header variant="expert" />
      <AiLink initial={p?.ai?.url || ''} onBack={() => setMode(p?.about?.name ? 'edit' : 'start')} onDone={(ai, picks) => {
        setP((prev) => fromAsuraaAi(prev || structuredClone(BLANK), ai, picks));
        setNotes([`Filled from ${ai.url}. Pick your domains under Expertise — we’ve suggested some.`, 'Add the Nm7 parts: sample work, services, payout and PAN.']);
        setMode('edit'); toast('Profile filled from asuraa.ai');
      }} /></>);
  }

  if (mode === 'start' || !p) {
    return (<><Header variant="expert" />
      <Start busy={busy} error={err} onAi={() => setMode('ai')} onDoc={fromDoc} onFresh={() => { const b = structuredClone(BLANK); b.about.name = currentUser()?.name || ''; setP(b); setMode('edit'); }} /></>);
  }
  const issues = expertIssues(p);
  const strength = expertStrength(p);
  const [stLabel, stBadge, stText] = STATUS[p.status] || STATUS.draft;
  const locked = ['review', 'test', 'testReview', 'rejected'].includes(p.status);
  const suggested = suggestDomains(p).filter((dm) => !p.expertise.domains.includes(dm));
  const errFor = (sec) => showIssues && issues.filter((i) => i.sec === sec);
  const go = (id) => document.getElementById(`ex-${id}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  const submit = async () => {
    if (issues.length) { setShowIssues(true); go(issues[0].sec); return; }
    setBusy(true);
    const r = await submitExpertProfile(p);
    setP({ ...r, note: '' }); setBusy(false);
    toast('Submitted — we’ll review it in 1–2 working days');
  };
  const SecHead = ({ id, title, sub }) => (
    <div className="stack g4" id={`ex-${id}`} style={{ scrollMarginTop: 90 }}>
      <h2 style={{ fontSize: 22 }}>{title}</h2>{sub && <span className="small muted">{sub}</span>}
      {errFor(id)?.length > 0 && <ul className="error" role="alert" style={{ margin: 0, paddingLeft: 18 }}>{errFor(id).map((i) => <li key={i.msg}>{i.msg}</li>)}</ul>}
    </div>
  );
  const net = (price) => expertPayout(price).net;

  return (
    <>
      <Header variant="expert" />
      <main className="container-wide row g24" style={{ padding: '24px 24px 72px', alignItems: 'flex-start' }}>
        {/* section nav */}
        <nav aria-label="Profile sections" className="stack sticky" style={{ flex: '1 1 190px', maxWidth: 220, gap: 2, top: 88 }}>
          {SECTIONS.map(([id, l]) => {
            const bad = issues.some((i) => i.sec === id);
            return <button key={id} type="button" onClick={() => go(id)} className="row g8" style={{ minHeight: 40, border: 0, background: 'transparent', textAlign: 'left', padding: '0 10px', borderRadius: 10, fontWeight: 500, color: 'var(--text)' }}>
              <span aria-hidden="true" style={{ width: 8, height: 8, borderRadius: '50%', background: bad ? 'var(--warning)' : 'var(--success)' }} />{l}</button>;
          })}
          <hr className="divider" />
          <button type="button" className="btn btn-ghost" style={{ justifyContent: 'flex-start' }} onClick={() => setMode('ai')}><Icon name="spark" size={14} />{p.ai ? 'Refresh from asuraa.ai' : 'Fill from asuraa.ai'}</button>
          <label className="btn btn-ghost" style={{ justifyContent: 'flex-start', cursor: 'pointer' }}><Icon name="upload" size={14} />{busy ? 'Reading…' : 'Fill from a document'}<input type="file" accept=".pdf,.docx,application/pdf" className="sr-only" onChange={(e) => { fromDoc(e.target.files?.[0]); e.target.value = ''; }} /></label>
        </nav>

        {/* form */}
        <section aria-label="Expert profile form" className="stack g20" style={{ flex: '3 1 520px', minWidth: 0 }}>
          <div className="row between g12" style={{ alignItems: 'flex-end' }}>
            <div className="stack g4"><span className="mono faint">EXPERT PROFILE</span><h1 className="display" style={{ fontSize: 34 }}>Your expert profile</h1></div>
            <span className={`badge ${stBadge}`}>{stLabel}</span>
          </div>
          <p className="well small" style={{ margin: 0 }}>{stText}{['changes', 'rejected'].includes(p.status) && p.note ? <><br /><strong>Reviewer note:</strong> {p.note}</> : null}</p>
          {p.status === 'test' && <div className="card-ink row between g12"><span className="stack g4"><strong style={{ fontSize: 18 }}>Your test task is ready</strong><span className="small" style={{ opacity: 0.8 }}>Rewrite one sample resume in the real expert workspace. Due {p.test?.due ? new Date(p.test.due).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }) : 'within 48 hours'}.</span></span><Link to="/expert/test" className="btn btn-signal btn-lg">Start test task</Link></div>}
          {notes.length > 0 && <div className="card stack g4 small" style={{ borderColor: 'var(--accent)' }}>{notes.map((n) => <span key={n}>✦ {n}</span>)}<button type="button" className="btn btn-ghost" style={{ alignSelf: 'flex-start', minHeight: 32 }} onClick={() => setNotes([])}>Got it</button></div>}
          <fieldset disabled={locked} className="stack g20" style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}>

            <div className="card stack g16" style={{ padding: 24 }}>
              <SecHead id="about" title="About you" sub="This is what job seekers see on your expert card." />
              <div className="row g16" style={{ alignItems: 'center' }}>
                <span style={{ width: 84, height: 84, flex: 'none', borderRadius: '50%', overflow: 'hidden', background: 'var(--ink)', color: 'var(--onink)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 30 }}>
                  {p.photo ? <img src={p.photo} alt="Your photo" style={{ width: 84, height: 84, objectFit: 'cover' }} /> : (p.about.name || '?')[0].toUpperCase()}
                </span>
                <div className="stack g8">
                  <label className="btn btn-outline" style={{ cursor: 'pointer' }}>{p.photo ? 'Change photo' : 'Add a photo'}<input type="file" accept="image/png,image/jpeg,image/webp" className="sr-only" onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (!f) return; if (f.size > 5 * 1024 * 1024) { toast('That photo is over 5 MB'); return; } const r = new FileReader(); r.onload = () => setPhotoSrc(r.result); r.readAsDataURL(f); }} /></label>
                  <span className="xs faint">A clear, front-facing photo builds trust. You can crop and adjust it.</span>
                </div>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(240px, 100%), 1fr))', gap: 14 }}>
                <Text id="ex-name" label="Full name *" value={p.about.name} onChange={(v) => set('about.name', v)} />
                <Text id="ex-city" label="City" value={p.about.city} onChange={(v) => set('about.city', v)} ph="Bengaluru" />
              </div>
              <Text id="ex-head" label="Headline *" value={p.about.headline} max={80} onChange={(v) => set('about.headline', v)} ph="Senior Data Analyst · 6 yrs · 300+ resumes reviewed" />
              <Text id="ex-bio" label="Bio * (150–600 characters)" area value={p.about.bio} max={600} onChange={(v) => set('about.bio', v)} ph="Who you are, your hiring experience, and how you help job seekers." hint={p.about.bio.length < 150 ? `${150 - p.about.bio.length} more characters needed` : '✓ Good length'} />
              <Chips label="Languages you can work in *" options={LANGS} value={p.about.languages} onChange={(v) => set('about.languages', v)} />
            </div>

            <div className="card stack g16" style={{ padding: 24 }}>
              <SecHead id="expertise" title="Expertise" sub="We match orders to you by domain and level." />
              <Chips label="Domains *" options={DOMAINS} value={p.expertise.domains} onChange={(v) => set('expertise.domains', v)} />
              {suggested.length > 0 && (
                <div className="well stack g8"><span className="xs strong" style={{ color: 'var(--accent)' }}>✦ Suggested from your profile — tap to add the ones that fit</span>
                  <div className="row g8">{suggested.map((dm) => <button key={dm} type="button" className="chip" style={{ minHeight: 32, fontSize: 12, borderStyle: 'dashed' }} onClick={() => set('expertise.domains', [...p.expertise.domains, dm])}>+ {dm}</button>)}</div></div>
              )}
              <Text id="ex-roles" label="Roles you can write for" value={p.expertise.roles} onChange={(v) => set('expertise.roles', v)} ph="Data Analyst, Business Analyst, MIS Executive" hint="Separate with commas." />
              <Chips label="Experience levels you serve *" options={LEVELS} value={p.expertise.levels} onChange={(v) => set('expertise.levels', v)} />
            </div>

            <div className="card stack g16" style={{ padding: 24 }}>
              <SecHead id="proof" title="Experience & proof" sub="Recruiters and job seekers trust experts with real hiring or industry experience." />
              {p.proof.experience.map((e, i) => (
                <div key={i} className="well row g8" style={{ alignItems: 'flex-end' }}>
                  <div style={{ flex: '2 1 180px' }}><Text id={`ex-r${i}`} label="Role" value={e.role} onChange={(v) => set('proof.experience', p.proof.experience.map((x, j) => (j === i ? { ...x, role: v } : x)))} /></div>
                  <div style={{ flex: '2 1 180px' }}><Text id={`ex-c${i}`} label="Company" value={e.company} onChange={(v) => set('proof.experience', p.proof.experience.map((x, j) => (j === i ? { ...x, company: v } : x)))} /></div>
                  <div style={{ flex: '1 1 110px' }}><Text id={`ex-p${i}`} label="Years" value={e.period} ph="2021–now" onChange={(v) => set('proof.experience', p.proof.experience.map((x, j) => (j === i ? { ...x, period: v } : x)))} /></div>
                  <button type="button" className="btn btn-danger-soft" onClick={() => set('proof.experience', p.proof.experience.filter((_, j) => j !== i))}>Remove</button>
                </div>
              ))}
              <button type="button" className="btn btn-outline" style={{ borderStyle: 'dashed', alignSelf: 'flex-start' }} onClick={() => set('proof.experience', [...p.proof.experience, { role: '', company: '', period: '' }])}>+ Add a role</button>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(220px, 100%), 1fr))', gap: 14 }}>
                <div className="field">
                  <label htmlFor="ex-li" className="label row g8" style={{ alignItems: 'center' }}><Logo k="linkedin" size={16} />LinkedIn</label>
                  <input id="ex-li" className="input" value={p.proof.linkedin} onChange={(e) => set('proof.linkedin', e.target.value)} placeholder="linkedin.com/in/you" />
                </div>
                <Text id="ex-ry" label="Years as recruiter / hiring manager" value={p.proof.recruiterYears} onChange={(v) => set('proof.recruiterYears', v.replace(/[^\d.]/g, ''))} ph="0 if none" />
                <Text id="ex-rw" label="Resumes written or reviewed before" value={p.proof.resumesWritten} onChange={(v) => set('proof.resumesWritten', v)} ph="e.g. 300+" />
              </div>
              {p.proof.certs.length > 0 && <span className="small"><strong>Certifications:</strong> {p.proof.certs.map((c) => [c.name, c.issuer].filter(Boolean).join(' · ')).join(' / ')} <button type="button" className="link-btn xs" onClick={() => set('proof.certs', [])}>Clear</button></span>}
            </div>

            <div className="card stack g16" style={{ padding: 24 }}>
              <SecHead id="samples" title="Sample work" sub="1–3 before/after resumes you wrote. Remove names, phone numbers and emails first." />
              {p.samples.map((s, i) => (
                <div key={i} className="well row between g8">
                  <span className="stack"><strong className="small">{s.name}</strong><span className="xs faint">{Math.round(s.size / 1024)} KB · stays private, only our review team sees it</span></span>
                  <label className="check small"><input type="checkbox" checked={s.anonymised} onChange={(e) => set('samples', p.samples.map((x, j) => (j === i ? { ...x, anonymised: e.target.checked } : x)))} />Personal details removed</label>
                  <button type="button" className="btn btn-danger-soft" onClick={() => set('samples', p.samples.filter((_, j) => j !== i))}>Remove</button>
                </div>
              ))}
              {p.samples.length < 3 && <label className="btn btn-outline" style={{ borderStyle: 'dashed', alignSelf: 'flex-start', cursor: 'pointer' }}>+ Upload a sample (PDF or Word)<input type="file" accept=".pdf,.docx" className="sr-only" onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) set('samples', [...p.samples, { name: f.name, size: f.size, anonymised: false }]); }} /></label>}
              <span className="xs faint">Optional, but experts with samples are approved much faster.</span>
            </div>

            <div className="card stack g16" style={{ padding: 24 }}>
              <SecHead id="services" title="Services & capacity" />
              <div className="stack g8">
                {[['expert', PLANS.expert], ['launch', PLANS.launch]].map(([k, pl]) => (
                  <label key={k} className="option" data-on={p.services.plans.includes(k)}>
                    <input type="checkbox" checked={p.services.plans.includes(k)} onChange={(e) => set('services.plans', e.target.checked ? [...p.services.plans, k] : p.services.plans.filter((x) => x !== k))} />
                    <span className="stack g4"><strong className="small">{pl.name} · {inr(pl.price)}</strong><span className="xs muted">You receive about {inr(net(pl.price))} per order after the platform fee, GST and transaction charges.</span></span>
                  </label>
                ))}
              </div>
              <div className="field">
                <label htmlFor="ex-cap" className="label">Orders per week you can take</label>
                <select id="ex-cap" className="input" value={p.services.perWeek} onChange={(e) => set('services.perWeek', +e.target.value)}>{[2, 3, 5, 8, 10, 15, 20].map((n) => <option key={n} value={n}>{n}</option>)}</select>
              </div>
              <label className="check small"><input type="checkbox" checked={p.services.rush} onChange={(e) => set('services.rush', e.target.checked)} />I can take 24-hour rush orders</label>
              <label className="check small"><input type="checkbox" checked={p.services.paused} onChange={(e) => set('services.paused', e.target.checked)} />Pause new orders (holiday mode)</label>
            </div>

            <div className="card stack g16" style={{ padding: 24 }}>
              <SecHead id="payout" title="Payouts & tax" sub={`Withdraw anytime; money arrives in ${PROMISES.withdrawalDays}.`} />
              {p.ai?.verified && (
                <label className="option" data-on={p.payout.reuseAi}>
                  <input type="checkbox" checked={p.payout.reuseAi} onChange={(e) => set('payout.reuseAi', e.target.checked)} />
                  <span className="stack g4"><strong className="small">Use the same payout account as my asuraa.ai profile</strong><span className="xs muted">Available because you confirmed your asuraa.ai account with a code.</span></span>
                </label>
              )}
              {!p.payout.reuseAi && (<>
                <div className="segmented" role="tablist" aria-label="Payout method" style={{ alignSelf: 'flex-start' }}>
                  <button type="button" role="tab" aria-selected={p.payout.method === 'upi'} onClick={() => set('payout.method', 'upi')}>UPI</button>
                  <button type="button" role="tab" aria-selected={p.payout.method === 'bank'} onClick={() => set('payout.method', 'bank')}>Bank account</button>
                </div>
                {p.payout.method === 'upi' ? <Text id="ex-upi" label="UPI ID" value={p.payout.upi} onChange={(v) => set('payout.upi', v.trim())} ph="name@okhdfcbank" error={payoutError(p.payout)} />
                  : (<div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(200px, 100%), 1fr))', gap: 14 }}>
                    <Text id="ex-bank" label="Bank name" value={p.payout.bankName} onChange={(v) => set('payout.bankName', v)} />
                    <Text id="ex-acc" label="Account number" type="password" value={p.payout.account} onChange={(v) => set('payout.account', v.replace(/\D/g, ''))} hint={p.payout.account ? `Saved as ${mask(p.payout.account)}` : 'Shown masked after you type it.'} error={/account/i.test(payoutError(p.payout)) ? payoutError(p.payout) : ''} />
                    <Text id="ex-ifsc" label="IFSC" value={p.payout.ifsc} onChange={(v) => set('payout.ifsc', v.toUpperCase())} ph="HDFC0001234" error={/IFSC/.test(payoutError(p.payout)) ? payoutError(p.payout) : ''} />
                  </div>)}
              </>)}
              <Text id="ex-pan" label="PAN *" value={p.payout.pan} onChange={(v) => set('payout.pan', v.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 10))} ph="ABCDE1234F"
                error={p.payout.pan && p.payout.pan.length === 10 && !PAN_RE.test(p.payout.pan) ? 'PAN should look like ABCDE1234F.' : ''} hint={`Needed for tax on payouts. TDS: ${FEES.tdsPct == null ? '[rate from your CA]' : `${FEES.tdsPct}%`}.`} />
              <span className="xs faint">In the live app these are stored encrypted and never shown in full again.</span>
            </div>

            <div className="card stack g12" style={{ padding: 24 }}>
              <SecHead id="agree" title="Expert agreement" />
              <ul className="small muted stack g4" style={{ margin: 0, paddingLeft: 18 }}>
                <li>Deliver within {PROMISES.delivery}. Late delivery means an automatic full refund to the customer.</li>
                <li>If a customer raises a quality complaint, you do one free re-do within 24 hours.</li>
                <li>Platform keeps {FEES.platformPct}% + GST on the fee + transaction charges; payouts after the order auto-approves ({PROMISES.autoApproveDays} after delivery).</li>
                <li>Customer resumes are confidential: no copying, sharing or contacting customers outside Nm7.</li>
              </ul>
              <label className="check small"><input type="checkbox" checked={p.agree} onChange={(e) => set('agree', e.target.checked)} />I agree to the expert terms above and the full <Link to="/expert-terms" target="_blank">Expert Terms</Link></label>
            </div>
          </fieldset>
        </section>

        {/* right: strength, card preview, submit */}
        <aside aria-label="Profile summary" className="stack g16 sticky" style={{ flex: '2 1 300px', maxWidth: 380, top: 88 }}>
          <div className="card stack g8">
            <div className="row between" style={{ alignItems: 'baseline' }}><span className="xs muted">Profile strength</span><span className="display" style={{ fontSize: 26 }}>{strength}%</span></div>
            <Meter value={strength} color={strength >= 80 ? 'var(--success)' : strength >= 55 ? 'var(--warning)' : 'var(--text3)'} label="Profile strength" />
          </div>
          <div className="card stack g12">
            <span className="xs muted strong">How job seekers see you</span>
            <div className="row g12" style={{ flexWrap: 'nowrap' }}>
              <span style={{ width: 56, height: 56, flex: 'none', borderRadius: '50%', overflow: 'hidden', background: 'var(--sunken)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700 }}>{p.photo ? <img src={p.photo} alt="" style={{ width: 56, height: 56, objectFit: 'cover' }} /> : (p.about.name || '?')[0]}</span>
              <span className="stack g4" style={{ minWidth: 0 }}>
                <strong className="row g4">{p.about.name || 'Your name'}{p.status === 'approved' && <span className="badge b-success" style={{ fontSize: 10 }}>✓ Verified</span>}</strong>
                <span className="xs muted" style={{ overflowWrap: 'anywhere' }}>{p.about.headline || 'Your headline'}</span>
              </span>
            </div>
            {p.expertise.domains.length > 0 && <div className="row g4">{p.expertise.domains.slice(0, 3).map((dm) => <span key={dm} className="badge b-neutral">{dm}</span>)}</div>}
            <span className="xs muted">{[p.about.city, p.about.languages.join(', ')].filter(Boolean).join(' · ')}</span>
            <span className="xs faint">Rating and resumes delivered appear after your first orders.</span>
            {p.ai && (
              <label className="check xs" style={{ minHeight: 28 }}><input type="checkbox" checked={p.ai.showBadge} onChange={(e) => set('ai', { ...p.ai, showBadge: e.target.checked })} />
                Show “Also on asuraa.ai · ★ {p.ai.rating}” badge</label>
            )}
            {p.ai?.showBadge && <span className="badge b-signal" style={{ alignSelf: 'flex-start' }}>Also on asuraa.ai · ★ {p.ai.rating}</span>}
          </div>
          {p.ai && <div className="card xs stack g4"><span><strong>Linked:</strong> {p.ai.url} · confirmed with a code</span><span className="faint">Last copied {new Date(p.ai.syncedAt).toLocaleDateString('en-IN')}. Use “Refresh from asuraa.ai” to bring changes over.</span><button type="button" className="link-btn xs" style={{ alignSelf: 'flex-start', color: 'var(--danger)' }} onClick={() => set('ai', null)}>Unlink asuraa.ai</button></div>}
          {!['review', 'approved', 'test', 'testReview', 'rejected'].includes(p.status) && (
            <div className="card stack g8">
              {issues.length > 0 && <span className="xs" style={{ color: 'var(--warning)' }}>{issues.length} thing{issues.length > 1 ? 's' : ''} left to fill</span>}
              <button type="button" className="btn btn-ink btn-lg" onClick={submit} disabled={busy}>{busy ? 'Submitting…' : p.status === 'changes' ? 'Submit again' : 'Submit for review'}</button>
              <span className="xs faint">Saved automatically as you type.</span>
            </div>
          )}
          {p.status === 'review' && <button type="button" className="btn btn-outline" onClick={() => set('status', 'draft')}>Withdraw and edit</button>}
          <button type="button" className="btn btn-ghost xs" style={{ color: 'var(--danger)' }} onClick={() => { if (window.confirm?.('Start over? This clears your expert profile in this browser.') !== false) { clearExpert(); setP(null); setMode('start'); } }}>Start over</button>
        </aside>
      </main>

      {photoSrc && <PhotoEditor src={photoSrc} initial={DEFAULT_ADJ} shape="circle" onClose={() => setPhotoSrc(null)} onSave={(out) => { set('photo', out); setPhotoSrc(null); toast('Photo saved'); }} />}
    </>
  );
}
