// Home page, sections 3–12 (loaded just after the first paint): the summary-writer demo, resumes by kind of job,
// templates, "Make it stronger" (line fixer, free ATS scan, expert rewrite), pricing, resume drives, kiosks,
// organization plans, partners, FAQ and the final call. Images are static WebP files (scripts/home-images/make.mjs);
// no builder or resume-preview code is loaded here.
import { Suspense, lazy, useEffect, useRef, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { Icon } from '../../components/ui';
import { lazyRetry } from '../../lib/chunks';
import { ROLE_MAX, useFlow } from '../../lib/flow';
import { ADDONS, PLANS, PROMISES, inr } from '../../lib/pricing';
import { track } from '../../lib/track';
import { ORG_FAQ, PlansSkeleton, PlansTable, useOrgPlans } from '../org/OrgPlans';
import { EXPERT_DEMO } from './expertDemo';
import { EXAMPLES, bulletScore, improveBullet } from './lineFixer';
import { TEMPLATES, TEMPLATE_COUNT } from './templateMeta';

const MAX_MB = 5;
const TemplatePreview = lazy(lazyRetry(() => import('../builder/TemplatePreview'))); // loads on the first card tap
const BlogStrip = lazy(lazyRetry(() => import('../blog/Blog').then((m) => ({ default: m.BlogStrip }))));

/** The blog cards at the very bottom: loaded only when someone scrolls near them. */
function LazyBlogStrip() {
  const ref = useRef();
  const [show, setShow] = useState(false);
  useEffect(() => {
    if (show) return undefined;
    if (!('IntersectionObserver' in window)) { setShow(true); return undefined; }
    const io = new IntersectionObserver((es) => { if (es.some((e) => e.isIntersecting)) setShow(true); }, { rootMargin: '600px 0px' });
    if (ref.current) io.observe(ref.current);
    return () => io.disconnect();
  }, [show]);
  return show ? <Suspense fallback={null}><BlogStrip /></Suspense> : <div ref={ref} style={{ height: 1 }} />;
}
const reduced = () => typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
function Check({ color = 'var(--success)' }) { return <Icon name="check" size={16} stroke={2.6} color={color} />; }

/** Tabs that work with the keyboard: ←/→ (and Home/End) move between them, the panel follows. */
function useTabs(keys, initial) {
  const [cur, setCur] = useState(initial);
  const refs = useRef({});
  const onKeyDown = (e) => {
    const i = keys.indexOf(cur);
    const next = { ArrowRight: keys[(i + 1) % keys.length], ArrowLeft: keys[(i - 1 + keys.length) % keys.length], Home: keys[0], End: keys[keys.length - 1] }[e.key];
    if (!next) return;
    e.preventDefault();
    setCur(next);
    refs.current[next]?.focus();
  };
  const tab = (k) => ({ role: 'tab', id: `tab-${k}`, 'aria-selected': cur === k, 'aria-controls': `panel-${k}`, tabIndex: cur === k ? 0 : -1, onClick: () => setCur(k), onKeyDown, ref: (el) => { refs.current[k] = el; } });
  return [cur, tab];
}

/* ---------- 3 · speak it, we write it ---------- */
const SPEECH_LANGS = [['en', 'English'], ['te', 'తెలుగు'], ['hi', 'हिन्दी'], ['ta', 'தமிழ்'], ['kn', 'ಕನ್ನಡ'], ['ml', 'മലയാളം'], ['mr', 'मराठी'], ['bn', 'বাংলা']];
const NOTES = [
  { lang: 'te', from: 'Telugu, typed in English letters', note: 'naaku 5 years driving experience undi, Ola lo chesanu', cards: [
    ['Clear', 'Driver with 5 years of experience, including work with Ola. Safe, on time and good with customers. Looking for a full-time driving job.'],
    ['Friendly', 'Experienced cab driver — 5 years on city routes with Ola, known for careful driving and polite service.'],
    ['Short', '5 years of driving experience. Ready for a company driver or delivery driver role.'],
  ] },
  { lang: 'hi', from: 'Hindi, typed in English letters', note: 'maine 3 saal kirana dukaan mein billing aur stock sambhala', cards: [
    ['Clear', 'Billing and stock assistant with 3 years in a busy grocery store. Handles daily billing, stock checks and supplier orders. Looking for a retail store job.'],
    ['Friendly', 'Retail assistant (3 years) — quick, accurate billing and careful stock keeping in a neighbourhood store.'],
    ['Short', '3 years of billing and stock work. Ready for a cashier or store assistant role.'],
  ] },
];
function SpeakDemo({ t, lang }) {
  const [n, setN] = useState(0);
  const [typed, setTyped] = useState(reduced() ? NOTES[0].note.length : 0);
  const [shown, setShown] = useState(reduced() ? 3 : 0);
  const note = NOTES[n];
  useEffect(() => {
    if (reduced()) return undefined;
    let alive = true; const T = [];
    const at = (ms, f) => T.push(setTimeout(() => alive && f(), ms));
    setTyped(0); setShown(0);
    const len = note.note.length;
    for (let i = 1; i <= len; i++) at(300 + i * 45, () => setTyped(i));
    const done = 300 + len * 45 + 700;
    [0, 1, 2].forEach((k) => at(done + k * 450, () => setShown(k + 1)));
    at(done + 6000, () => setN((x) => (x + 1) % NOTES.length));
    return () => { alive = false; T.forEach(clearTimeout); };
  }, [n]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div className="h-grid" style={{ alignItems: 'start' }}>
      <div className="stack g16" lang={lang}>
        <h2 id="speak-h" className="h-sec-title">{t('speak.title')}</h2>
        <p className="lead" style={{ margin: 0 }}>{t('speak.sub')}</p>
        <span className="xs muted">{t('speak.langs')}</span>
        <ul className="hx-chips" aria-label={t('speak.langs')}>{SPEECH_LANGS.map(([c, l]) => <li key={c} lang={c}>{l}</li>)}</ul>
        <Link to="/builder?start=summary" className="btn btn-ink btn-lg" style={{ alignSelf: 'flex-start' }} onClick={() => track('demo_summary')}>{t('speak.cta')}</Link>
      </div>
      <div className="hx-speak" role="img" aria-label={`Demo: the note “${note.note}” (${note.from}) becomes three English summaries to pick from`}>
        <div className="hx-note" aria-hidden="true">
          <span className="xs muted" lang={lang}>🎙 {t('speak.note')} · {note.from}</span>
          <span className="hx-note-text">{note.note.slice(0, typed)}<i className="hx-caret" /></span>
        </div>
        <span className="xs muted" aria-hidden="true" lang={lang}>↓ {t('speak.cards')}</span>
        <div className="stack g8" aria-hidden="true">
          {note.cards.map(([label, text], i) => (
            <div key={label} className="hx-sum" data-on={shown > i}><span className="badge b-neutral">{label}</span><span className="small">{text}</span></div>
          ))}
        </div>
      </div>
    </div>
  );
}

/* ---------- 4 · resumes for every kind of job ---------- */
const ROLES = [
  { k: 'tech', tab: 'Fresher (tech)', img: 'role-tech', tpl: 'fresher', who: 'Rahul Verma · B.Tech IT fresher · Indore, Madhya Pradesh', tips: ['Projects with numbers above a short internship', 'Skills grouped the way tech recruiters search', 'One page, ATS-safe single column'] },
  { k: 'govt', tab: 'Govt / PSU', img: 'role-govt', tpl: 'kio', who: 'Priyanka Das · B.Com, office assistant · Bhubaneswar, Odisha', tips: ['Traditional format with personal details', 'Hobbies, strengths and a signed declaration', 'Prints cleanly for bank and PSU forms'] },
  { k: 'care', tab: 'Healthcare', img: 'role-care', tpl: 'care', who: 'Lalitha Kumari · Staff nurse, ICU · Kochi, Kerala', tips: ['Licences and certificates first', 'Patient numbers and safety results in bullets', 'Calm, readable layout for hospital HR'] },
  { k: 'sales', tab: 'Sales', img: 'role-sales', tpl: 'impact', who: 'Arjun Singh Rathore · Field sales, FMCG · Jaipur, Rajasthan', tips: ['Numbers in bullets printed in bold', 'Territory growth and new outlets up front', 'Awards that prove you hit targets'] },
  { k: 'trades', tab: 'Skilled trades', img: 'role-trades', tpl: 'work', who: 'Murugan Selvam · Electrician, ITI · Coimbatore, Tamil Nadu', tips: ['Skills and work on top, education small', 'Licences and safety training listed clearly', 'Simple words, one page, made on a phone'] },
  { k: 'returning', tab: 'Returning to work', img: 'role-returning', tpl: 'classic', who: 'Meenakshi Iyer · Accountant after a career break · Pune, Maharashtra', tips: ['The break explained in one honest line', 'Recent courses show your skills are current', 'Earlier results that still count'] },
];
const TPL_NAME = Object.fromEntries(TEMPLATES.map((x) => [x.id, x.name]));
function Roles() {
  const [cur, tab] = useTabs(ROLES.map((r) => r.k), 'tech');
  const r = ROLES.find((x) => x.k === cur);
  return (
    <div className="stack g24">
      <div className="stack g12" style={{ maxWidth: 680 }}>
        <span className="h-eyebrow">Real-looking samples · invented people</span>
        <h2 id="roles-h" className="h-sec-title">Resumes for every kind of job</h2>
      </div>
      <div className="hx-tabs" role="tablist" aria-label="Kind of job">
        {ROLES.map((x) => <button key={x.k} type="button" className="chip" {...tab(x.k)}>{x.tab}</button>)}
      </div>
      <div className="hx-role" role="tabpanel" id={`panel-${r.k}`} aria-labelledby={`tab-${r.k}`} tabIndex={0}>
        <img src={`/home/${r.img}.webp`} width="360" height="509" loading="lazy" decoding="async" alt={`Sample resume: ${r.who}, in the ${TPL_NAME[r.tpl]} template`} />
        <div className="stack g12">
          <span className="small muted">{r.who}</span>
          <strong style={{ fontSize: 22, fontFamily: 'var(--font-display)' }}>{TPL_NAME[r.tpl]} template</strong>
          <ul className="stack g8" style={{ listStyle: 'none', margin: 0, padding: 0 }}>{r.tips.map((x) => <li key={x} className="row g8" style={{ flexWrap: 'nowrap', alignItems: 'flex-start' }}><Check />{x}</li>)}</ul>
          <Link to="/builder" state={{ open: 'build', template: r.tpl }} className="btn btn-outline" style={{ alignSelf: 'flex-start' }}>Use this template</Link>
        </div>
      </div>
    </div>
  );
}

/* ---------- 5 · templates ---------- */
const TPL_FILTERS = [['all', 'All'], ['fresher', 'Freshers'], ['tech', 'Tech'], ['govt', 'Govt & PSU'], ['photo', 'With photo']];
const FIRST = ['fresher', 'campus', 'work', 'kio', 'modern', 'care'];
function Templates() {
  const [f, setF] = useState('all');
  const [open, setOpen] = useState(null); // the template shown large (a card tap); never a download
  const nav = useNavigate();
  const pick = f === 'all' ? FIRST.map((id) => TEMPLATES.find((x) => x.id === id)) : TEMPLATES.filter((t) => (f === 'fresher' ? t.level === 'fresher' : f === 'photo' ? t.photo : t.ind.includes(f)));
  return (
    <div className="stack g24">
      <div className="row between g16" style={{ alignItems: 'flex-end' }}>
        <div className="stack g12" style={{ maxWidth: 620 }}>
          <span className="h-eyebrow">{TEMPLATE_COUNT} templates · all ATS-tested</span>
          <h2 id="tpl-h" className="h-sec-title">Templates that look good to people <em style={{ fontStyle: 'normal', color: 'var(--text3)' }}>and</em> to software.</h2>
        </div>
        <div className="row g8" role="group" aria-label="Filter templates">{TPL_FILTERS.map(([k, l]) => <button key={k} type="button" className="chip" aria-pressed={f === k} onClick={() => setF(k)}>{l}</button>)}</div>
      </div>
      <div className="hx-tpls">
        {pick.slice(0, 6).map((t) => (
          <button key={t.id} type="button" className="hx-tpl" aria-label={`Preview the ${t.name} template`} aria-haspopup="dialog" onClick={() => setOpen(t.id)}>
            <img src={`/home/tpl-${t.id}.webp`} width="200" height="283" loading="lazy" decoding="async" alt="" />
            <span className="row between g8"><strong>{t.name}</strong><span className="xs faint">Preview</span></span>
          </button>
        ))}
      </div>
      <Link to="/builder?start=templates" className="btn btn-outline" style={{ alignSelf: 'flex-start' }}>See all {TEMPLATE_COUNT} →</Link>
      {open && (
        <Suspense fallback={<div className="overlay" aria-busy="true" />}>
          <TemplatePreview id={open} onClose={() => setOpen(null)} onUse={() => nav('/builder', { state: { open: 'build', template: open } })} />
        </Suspense>
      )}
    </div>
  );
}

/* ---------- 6 · make it stronger: line fixer, free ATS scan, expert ---------- */
function LineFixer() {
  const [text, setText] = useState(EXAMPLES[0]);
  const [out, setOut] = useState(null);
  const before = bulletScore(text);
  const after = out ? bulletScore(out.text) : null;
  return (
    <div className="hx-tool stack g12">
      <span className="h-eyebrow">Try it now · no sign-up</span>
      <strong className="hx-tool-title">Fix a weak line</strong>
      <div className="row g4">{EXAMPLES.map((e) => <button key={e} type="button" className="chip" aria-pressed={text === e} style={{ fontSize: 13 }} onClick={() => { setText(e); setOut(null); }}>{e.length > 26 ? `${e.slice(0, 26)}…` : e}</button>)}</div>
      <div className="field">
        <label htmlFor="try" className="label row between"><span>Your line</span><span className="faint">Line score {before}/100</span></label>
        <textarea id="try" aria-label="Your resume line" className="input" rows={3} value={text} maxLength={220} onChange={(e) => { setText(e.target.value); setOut(null); }} />
      </div>
      <button type="button" className="btn btn-ink" disabled={!text.trim()} onClick={() => setOut(improveBullet(text))}><Icon name="spark" size={16} />Improve this line</button>
      {out && (
        <div className="stack g8" aria-live="polite">
          <div className="well stack g4" style={{ background: after > before ? 'var(--successbg)' : undefined }}>
            {after > before
              ? <span className="xs" style={{ color: 'var(--success)', fontWeight: 700 }}>IMPROVED · {before} → {after}/100</span>
              : <span className="xs" style={{ fontWeight: 700 }}>Already strong — add the result · {after}/100</span>}
            <span style={{ fontWeight: 600 }}>• {out.text}</span>
          </div>
          {out.tips.length > 0 && <ul className="stack g4 small" style={{ margin: 0, paddingLeft: 18 }}>{out.tips.map((x) => <li key={x}>{x}</li>)}</ul>}
          <Link to="/builder" className="small">Fix the rest in the builder →</Link>
        </div>
      )}
    </div>
  );
}

function ScanBox({ scanError }) {
  const nav = useNavigate();
  const { role, setRole, setUpload } = useFlow();
  const fileRef = useRef();
  const [err, setErr] = useState(scanError);
  useEffect(() => setErr(scanError), [scanError]);
  const start = async (file) => {
    if (!file) { setErr('Choose a PDF or DOCX first.'); return; } // e.g. the file picker was closed
    if (file !== 'sample') {
      try { const { checkFile } = await import('../../lib/scan/extract'); checkFile(file); } catch (e) { setErr(e.message); return; }
    }
    setErr(null);
    setRole(role.replace(/\s+/g, ' ').trim());
    setUpload(file); // read in the browser on the next page; nothing is uploaded
    nav('/scan');
  };
  // closing the file picker without a file: say what to do (instead of silently scanning nothing). Attached as the
  // input mounts, so a cancel straight away is never missed.
  const startRef = useRef(start);
  startRef.current = start;
  const fileInput = (el) => {
    fileRef.current = el;
    if (el && !el.dataset.cancelHooked) { el.dataset.cancelHooked = '1'; el.addEventListener('cancel', () => startRef.current(null)); }
  };
  return (
    <div className="hx-tool stack g12" id="scan">
      <span className="h-eyebrow">Free · no sign-up</span>
      <strong className="hx-tool-title">Free ATS score</strong>
      <span className="small muted">See how hiring software reads your resume: layout, keywords, results and length.</span>
      <div className="field">
        <label htmlFor="role" className="label">Role you’re applying for</label>
        <input id="role" className="input" value={role} maxLength={ROLE_MAX} onChange={(e) => setRole(e.target.value)} onBlur={(e) => setRole(e.target.value.replace(/\s+/g, ' ').trim())} placeholder="e.g. Data Analyst" />
      </div>
      <input ref={fileInput} type="file" accept=".pdf,.docx" className="sr-only" tabIndex={-1} aria-label="Resume file to scan" onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; start(f || null); }} />
      <button type="button" className="btn btn-ink" onClick={() => fileRef.current.click()}>Scan my resume — free</button>
      <span className="xs faint">PDF or DOCX · up to {MAX_MB} MB · Read on your device — never uploaded</span>
      <button type="button" className="link-btn xs" style={{ alignSelf: 'flex-start' }} onClick={() => start('sample')}>No resume handy? Try a sample</button>
      {err && <span role="alert" className="error">{err}</span>}
    </div>
  );
}

function Expert({ goExpert }) {
  const [view, setView] = useState('before');
  const score = EXPERT_DEMO[view];
  return (
    <div className="hx-tool stack g12">
      <span className="h-eyebrow">Verified experts</span>
      <strong className="hx-tool-title">Want an expert to rewrite it?</strong>
      <div className="segmented" role="group" aria-label="Show before or after" style={{ alignSelf: 'flex-start' }}>
        {[['before', 'Before'], ['after', 'After expert rewrite']].map(([k, l]) => <button key={k} type="button" aria-pressed={view === k} onClick={() => setView(k)}>{l}</button>)}
      </div>
      <div className="hx-ba">
        <img src={`/home/expert-${view}.webp`} width="300" height="424" loading="lazy" decoding="async" alt={`Sample resume ${view === 'before' ? 'before' : 'after'} an expert rewrite, ATS score ${score}`} />
        <span className="hx-ba-score" data-good={view === 'after'}>ATS {score}</span>
      </div>
      <span className="xs muted">Same person, same facts: ATS score {EXPERT_DEMO.before} → {EXPERT_DEMO.after} against a Data Analyst job post (sample).</span>
      <ul className="stack g4 small" style={{ listStyle: 'none', margin: 0, padding: 0 }}>
        {[`A verified expert from your field`, `Draft in ${PROMISES.delivery}`, 'Full refund if it’s late', 'Never contacts you outside Nm7'].map((x) => <li key={x} className="row g8" style={{ flexWrap: 'nowrap' }}><Check />{x}</li>)}
      </ul>
      <button type="button" className="btn btn-ink" onClick={goExpert}>Get an expert — {inr(PLANS.expert.price)}</button>
    </div>
  );
}

/* ---------- 7 · pricing for job seekers ---------- */
const FEATURES = [
  ['Free ATS scan & score', true, true, true],
  [`Resume builder · ${TEMPLATE_COUNT} templates · PDF & Word`, true, true, true],
  ['AI line fixes you approve', true, true, true],
  ['Verified expert from your field rewrites it', false, true, true],
  [`Delivered in ${PROMISES.delivery} · revisions included`, false, true, true],
  ['Chat & section comments with your expert', false, true, true],
  ['LinkedIn makeover', false, 'Add-on', true],
  ['Cover letter for your target job', 'Self-serve', 'Self-serve', true],
  ['1:1 mentor call (30 min)', false, false, true],
];
function Pricing({ goPlan }) {
  const [table, setTable] = useState(false);
  const plans = [
    ['diy', 'Fix it yourself', 'For confident editors', ['Every template, PDF & Word export', 'AI line fixes and live ATS score', 'Cover letters and share link'], 'Start building'],
    ['expert', 'Expert rewrite', 'Most freshers choose this', ['A verified expert from your field', `Draft in ${PROMISES.delivery}, revisions included`, 'Chat and comment on each section', 'Final lands in your builder'], 'Get an expert'],
    ['launch', 'Career Launch', 'For your first big move', ['Everything in Expert rewrite', 'LinkedIn headline, About & top role', 'Cover letter for your first target job', '30-min 1:1 mentor call'], 'Launch my career'],
  ];
  return (
    <>
      <div className="stack g12" style={{ maxWidth: 680 }}>
        <span className="h-eyebrow">Pricing for job seekers · GST included</span>
        <h2 id="pricing-h" className="h-sec-title">Free to build. Pay only for what you need.</h2>
        <p className="small muted" style={{ margin: 0 }}>Building is free. A free account is needed to download.</p>
      </div>
      <div className="h-plans">
        {plans.map(([k, name, tag, items, cta]) => (
          <div key={k} className="h-plan" data-pop={k === 'expert'}>
            {k === 'expert' && <span className="badge b-signal" style={{ position: 'absolute', top: -13, left: 24 }}>Most popular</span>}
            <div className="stack g4"><strong style={{ fontSize: 20 }}>{name}</strong><span className="small muted">{tag}</span></div>
            <div className="row g8" style={{ alignItems: 'baseline' }}><span className="display" style={{ fontSize: 44 }}>{inr(PLANS[k].price)}</span><span className="small muted">one-time</span></div>
            <ul>{items.map((x) => <li key={x}><Check />{x}</li>)}</ul>
            <button type="button" className={`btn btn-lg ${k === 'expert' ? 'btn-ink' : 'btn-outline'}`} style={{ marginTop: 'auto' }} onClick={() => goPlan(k)}>{cta}</button>
          </div>
        ))}
      </div>
      <div className="row between g16">
        <div className="row g12 well" style={{ flex: '1 1 420px', alignItems: 'center', flexWrap: 'nowrap', background: 'var(--successbg)' }}>
          <span style={{ fontSize: 26 }} aria-hidden="true">🛡️</span>
          <span className="small"><strong>Our promise:</strong> late = automatic full refund. Not happy = free re-do first, then a refund review within 24 hours. <Link to="/refund-policy">Refund policy</Link></span>
        </div>
        <button type="button" className="btn btn-ghost" aria-expanded={table} onClick={() => setTable(!table)}>{table ? 'Hide' : 'Compare all features'}</button>
      </div>
      {table && (
        <div className="card table-wrap" style={{ padding: 0 }}>
          <table className="table"><thead><tr><th>Feature</th><th>Fix it yourself</th><th>Expert rewrite</th><th>Career Launch</th></tr></thead>
            <tbody>{FEATURES.map(([f, ...v]) => <tr key={f}><td className="small">{f}</td>{v.map((x, i) => <td key={i} className="small">{x === true ? <span aria-label="Included"><Check /></span> : x === false ? <span className="faint" aria-label="Not included">—</span> : x}</td>)}</tr>)}</tbody></table>
          <p className="xs muted" style={{ padding: '0 16px 14px', margin: 0 }}>Add-ons: {Object.values(ADDONS).map((a) => `${a.name} ${inr(a.price)}`).join(' · ')}</p>
        </div>
      )}
    </>
  );
}

/* ---------- 8 · run your resume drive ---------- */
function DriveSteps() {
  const steps = [
    ['Invite', 'Share one join link or a QR code on a slide, a poster or WhatsApp. Students join with their own free account.',
      <div key="i" className="hx-mini-invite"><span className="hx-qr" />{['nm7.si/join/SVC26', '312 joined'].map((x) => <span key={x} className="small">{x}</span>)}</div>],
    ['Review', 'Every shared resume in one table. Approve, send reminders, or mark “needs changes” with a note.',
      <div key="r" className="stack g6">{[['Ananya R.', 'Approved', 'b-success'], ['Rahul V.', 'Needs changes', 'b-warning'], ['Kiran M.', 'Reminded', 'b-neutral']].map(([n, s, b]) => <div key={n} className="row between small"><span>{n}</span><span className={`badge ${b}`}>{s}</span></div>)}</div>],
    ['Deliver', 'Print the batch in your college’s template, download one combined PDF, or share a shortlist link with recruiters.',
      <div key="d" className="hx-mini-pages"><span /><span /><span /><strong className="small">Batch_2026.pdf · 312 resumes</strong></div>],
  ];
  return (
    <div className="stack g32">
      <div className="stack g12" style={{ maxWidth: 680 }}>
        <span className="h-eyebrow">For colleges, institutes and job fairs</span>
        <h2 id="drive-h" className="h-sec-title">Run your resume drive on Nm7</h2>
      </div>
      <div className="h-steps">
        {steps.map(([title, text, mini], i) => (
          <article key={title} className="h-step">
            <span className="h-num" aria-hidden="true">{i + 1}</span>
            <h3 className="hx-step-title">{title}</h3>
            <span className="muted">{text}</span>
            <div className="mini" aria-hidden="true">{mini}</div>
          </article>
        ))}
      </div>
    </div>
  );
}

/* ---------- 10 · plans for organizations ---------- */
function OrgPlans() {
  const st = useOrgPlans();
  return (
    <div className="stack g24">
      <div className="row between g16" style={{ alignItems: 'flex-end' }}>
        <div className="stack g12" style={{ maxWidth: 680 }}>
          <span className="h-eyebrow">Plans for organizations</span>
          <h2 id="orgplans-h" className="h-sec-title">Start free. Upgrade for your drive.</h2>
        </div>
        <span className="row g8">
          <Link to="/for-orgs?start=1#start" className="btn btn-ink" onClick={() => track('hero_org_start')}>Start free</Link>
          <Link to="/for-orgs#talk" className="btn btn-outline" onClick={() => track('to_for_orgs')}>Talk to us</Link>
        </span>
      </div>
      {st.loading ? <PlansSkeleton />
        : st.data ? <PlansTable data={st.data} />
          : <p className="small muted">See the plans on <Link to="/for-orgs" onClick={() => track('to_for_orgs')}>Nm7 for Organizations</Link>.</p>}
      <span className="small muted">{st.data?.gstOn ? `Prices exclude GST (${st.data.gstRatePct}%). ` : ''}Every payment gets a GST invoice you can download. Pay online, or by bank transfer or purchase order. <Link to="/for-orgs" onClick={() => track('to_for_orgs')}>All details →</Link></span>
    </div>
  );
}

/* ---------- 12 · FAQ ---------- */
export const SEEKER_FAQ = [
  ['Is it really free to build a resume?', `Yes. The builder, all ${TEMPLATE_COUNT} templates and the ATS scan are free. You need a free account to download, and you pay only if you want downloads unlocked or an expert rewrite.`],
  ['Can I use Nm7 in Telugu or Hindi?', 'Yes. Speak or type your details in Telugu, Hindi or any of 8 Indian languages — the summary writer turns them into clear English. The home page can be read in English, Telugu or Hindi, and more of the site is coming.'],
  ['I don’t have a resume — can I still use it?', 'Yes. Start from scratch with simple questions, or take photos of your certificates and papers and we fill in the details. You can also import your LinkedIn profile PDF.'],
  ['Is my Aadhaar saved?', 'No. If a photo of your Aadhaar or another ID card is used to read your name or address, the ID number itself is removed and never saved or printed.'],
  ['Who are the experts?', 'Working professionals — software, data, finance, marketing, HR, design, operations and more. Each one passes a profile review and a test task, and every order is rated.'],
  ['How fast is delivery, and what if it’s late?', `Your first draft arrives within ${PROMISES.delivery}. Late delivery means an automatic full refund; if you’re not happy, your expert re-does it free first.`],
  ['Is my data safe?', `Your resume is seen only by you and, if you order one, your assigned expert. Expert files are deleted ${PROMISES.retentionDays} days after delivery, and you can download or delete all your data from Settings.`],
  ['Which payment methods work?', `UPI, cards and net banking through ${PROMISES.paymentProvider}. Prices include GST, and you get a GST invoice.`],
];
function Faq() {
  const [cur, tab] = useTabs(['seekers', 'orgs'], 'seekers');
  const list = cur === 'seekers' ? SEEKER_FAQ : ORG_FAQ;
  return (
    <div className="stack g24" style={{ maxWidth: 860, margin: '0 auto' }}>
      <h2 id="faq-h" className="h-sec-title">Questions</h2>
      <div className="segmented" role="tablist" aria-label="Questions from" style={{ alignSelf: 'flex-start' }}>
        <button type="button" {...tab('seekers')}>Job seekers</button>
        <button type="button" {...tab('orgs')}>Organizations</button>
      </div>
      <div role="tabpanel" id={`panel-${cur}`} aria-labelledby={`tab-${cur}`} style={{ borderTop: '1px solid var(--border)' }}>
        {list.map(([q, a], i) => (
          <details key={q} open={i === 0} style={{ borderBottom: '1px solid var(--border)', padding: '18px 0' }}>
            <summary style={{ fontWeight: 600, fontSize: 18, cursor: 'pointer', minHeight: 32 }}>{q}</summary>
            <p className="muted" style={{ marginTop: 12, lineHeight: 1.65 }}>{a}</p>
          </details>
        ))}
      </div>
    </div>
  );
}

/* ---------- the page below the fold ---------- */
export default function HomeMore({ t, lang, scanError }) {
  const nav = useNavigate();
  const { hash } = useLocation();
  const { setAddon } = useFlow();
  const goPlan = (k) => { if (k === 'diy') nav('/builder'); else { setAddon(k === 'launch'); nav('/checkout'); } };
  // opened at /#pricing, /#templates … (or the hash changed): go there once this part is on the page
  useEffect(() => {
    if (!hash) return;
    const el = document.getElementById(hash.slice(1));
    if (el) requestAnimationFrame(() => el.scrollIntoView({ behavior: reduced() ? 'auto' : 'smooth', block: 'start' }));
  }, [hash]);
  // FAQ rich results for Google
  useEffect(() => {
    const s = document.createElement('script'); s.type = 'application/ld+json'; s.id = 'faq-ld';
    s.textContent = JSON.stringify({ '@context': 'https://schema.org', '@type': 'FAQPage', mainEntity: [...SEEKER_FAQ, ...ORG_FAQ].map(([q, a]) => ({ '@type': 'Question', name: q, acceptedAnswer: { '@type': 'Answer', text: a } })) });
    document.head.appendChild(s);
    return () => s.remove();
  }, []);
  return (
    <>
      {/* 3 */}
      <section className="h-pad h-band" aria-labelledby="speak-h"><div className="h-wrap"><SpeakDemo t={t} lang={lang} /></div></section>
      {/* 4 */}
      <section id="roles" className="h-pad" aria-labelledby="roles-h"><div className="h-wrap"><Roles /></div></section>
      {/* 5 */}
      <section id="templates" className="h-pad h-band" aria-labelledby="tpl-h"><div className="h-wrap"><Templates /></div></section>
      {/* 6 */}
      <section id="stronger" className="h-pad" aria-labelledby="stronger-h">
        <div className="h-wrap stack g24">
          <div className="stack g12" style={{ maxWidth: 680 }}>
            <span className="h-eyebrow">Already have a resume?</span>
            <h2 id="stronger-h" className="h-sec-title">Make it stronger</h2>
          </div>
          <div className="hx-stronger"><LineFixer /><ScanBox scanError={scanError} /><Expert goExpert={() => goPlan('expert')} /></div>
        </div>
      </section>
      {/* 7 */}
      <section id="pricing" className="h-pad h-band" aria-labelledby="pricing-h"><div className="h-wrap stack g32" id="plans"><Pricing goPlan={goPlan} /></div></section>
      {/* 8 */}
      <section id="drive" className="h-pad" aria-labelledby="drive-h"><div className="h-wrap"><DriveSteps /></div></section>
      {/* 9 */}
      <section className="h-pad h-dark" aria-labelledby="kiosk-h">
        <div className="h-wrap h-grid">
          <div className="stack g16">
            <span className="h-eyebrow">Built for events</span>
            <h2 id="kiosk-h" className="h-sec-title" style={{ color: '#F7F6F2' }}>Kiosk mode for job fairs and campus drives</h2>
            <p className="lead" style={{ margin: 0 }}>Set up a tablet at your stall. Candidates sign in with a code sent to their email, build their resume step by step and print it on the spot.</p>
            <ul className="stack g8" style={{ listStyle: 'none', margin: 0, padding: 0 }}>
              {['Each tablet wipes itself after every person — nothing stays on the device', 'Resumes are saved in each candidate’s own account', 'You see sign-ins and prints per kiosk, and can stop one at once'].map((x) => <li key={x} className="row g8" style={{ flexWrap: 'nowrap', alignItems: 'flex-start' }}><Check color="var(--signal)" />{x}</li>)}
            </ul>
          </div>
          <div className="hx-tablet" aria-hidden="true"><div className="hx-tablet-screen"><strong>Welcome to the Nm7 stall</strong><span className="small">Build your resume in 10 minutes. Print it here.</span><span className="hx-tablet-btn">Start</span><span className="xs">Wipes after each person · 2 min idle</span></div></div>
        </div>
      </section>
      {/* 10 */}
      <section id="org-plans" className="h-pad" aria-labelledby="orgplans-h"><div className="h-wrap"><OrgPlans /></div></section>
      {/* 11 */}
      <section className="h-wrap" aria-labelledby="partner-h">
        <div className="hx-partner">
          <div className="stack g8">
            <h2 id="partner-h" className="hx-partner-title">Bring Nm7 to colleges — earn as a partner</h2>
            <span className="small muted">Placement consultants and trainers earn commission on every organization they refer.</span>
          </div>
          <Link to="/partners" className="btn btn-ink btn-lg" onClick={() => track('to_partners')}>Become a partner</Link>
        </div>
      </section>
      {/* 12 */}
      <section id="faq" className="h-pad" aria-labelledby="faq-h"><div className="h-wrap"><Faq /></div></section>
      <section className="h-dark h-pad" aria-labelledby="cta-h" lang={lang}>
        <div className="h-wrap stack g20" style={{ alignItems: 'flex-start' }}>
          <h2 id="cta-h" className="h-sec-title" style={{ color: '#F7F6F2', maxWidth: 820 }}>{t('final.title')}</h2>
          <p className="lead" style={{ margin: 0 }}>{t('final.sub')}</p>
          <span className="row g12">
            <Link to="/builder" className="btn btn-lg hx-cta-light">{t('final.seeker')}</Link>
            <Link to="/for-orgs" className="btn btn-lg btn-outline hx-cta-dark" onClick={() => track('to_for_orgs')}>{t('final.org')}</Link>
          </span>
        </div>
      </section>
      <LazyBlogStrip />
    </>
  );
}
