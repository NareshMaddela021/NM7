// Home page, sections 3–12 (loaded just after the first paint): the summary-writer demo, resumes by kind of job,
// templates, "Make it stronger" (line fixer, free ATS scan, expert rewrite), pricing, resume drives, kiosks,
// organization plans, partners, FAQ and the final call. Images are static WebP files (scripts/home-images/make.mjs);
// no builder or resume-preview code is loaded here. Headings, text and buttons follow the chosen language (t, lang from
// Home; strings in src/i18n/pages.json); sample resumes, plan names and the small mock screens stay in English.
import Stories from '../../components/Stories';
import { Suspense, lazy, useEffect, useRef, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { Icon } from '../../components/ui';
import { lazyRetry } from '../../lib/chunks';
import { rich, translate } from '../../lib/i18n';
import { ROLE_MAX, useFlow } from '../../lib/flow';
import { ADDONS, PLANS, PROMISES, inr } from '../../lib/pricing';
import { track } from '../../lib/track';
import { usePayMode } from '../../lib/waPay';
import { ORG_FAQ, PlansSkeleton, PlansTable, orgFaq, useOrgPlans } from '../org/OrgPlans';
import { EXPERT_DEMO } from './expertDemo';
import { EXAMPLES, bulletScore, improveBullet } from './lineFixer';
import { TEMPLATES, TEMPLATE_COUNT } from './templateMeta';

const MAX_MB = 5;
/** "24–48" from "24–48 hours": the strings say "{h} hours" in each language. */
export const HOURS = PROMISES.delivery.replace(/\s*hours$/, '');
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
// tab names and the three tips: home.more.roles.tab.<k> and home.more.roles.<k>.1–3
const ROLES = [
  { k: 'tech', img: 'role-tech', tpl: 'fresher', who: 'Rahul Verma · B.Tech IT fresher · Indore, Madhya Pradesh' },
  { k: 'govt', img: 'role-govt', tpl: 'kio', who: 'Priyanka Das · B.Com, office assistant · Bhubaneswar, Odisha' },
  { k: 'care', img: 'role-care', tpl: 'care', who: 'Lalitha Kumari · Staff nurse, ICU · Kochi, Kerala' },
  { k: 'sales', img: 'role-sales', tpl: 'impact', who: 'Arjun Singh Rathore · Field sales, FMCG · Jaipur, Rajasthan' },
  { k: 'trades', img: 'role-trades', tpl: 'work', who: 'Murugan Selvam · Electrician, ITI · Coimbatore, Tamil Nadu' },
  { k: 'returning', img: 'role-returning', tpl: 'classic', who: 'Meenakshi Iyer · Accountant after a career break · Pune, Maharashtra' },
];
const TPL_NAME = Object.fromEntries(TEMPLATES.map((x) => [x.id, x.name]));
function Roles({ t }) {
  const [cur, tab] = useTabs(ROLES.map((r) => r.k), 'tech');
  const r = ROLES.find((x) => x.k === cur);
  return (
    <div className="stack g24">
      <div className="stack g12" style={{ maxWidth: 680 }}>
        <span className="h-eyebrow">{t('home.more.roles.eyebrow')}</span>
        <h2 id="roles-h" className="h-sec-title">{t('home.more.roles.title')}</h2>
      </div>
      <div className="hx-tabs" role="tablist" aria-label={t('home.more.roles.tabs')}>
        {ROLES.map((x) => <button key={x.k} type="button" className="chip" {...tab(x.k)}>{t(`home.more.roles.tab.${x.k}`)}</button>)}
      </div>
      <div className="hx-role" role="tabpanel" id={`panel-${r.k}`} aria-labelledby={`tab-${r.k}`} tabIndex={0}>
        <img src={`/home/${r.img}.webp`} width="360" height="509" loading="lazy" decoding="async" alt={`Sample resume: ${r.who}, in the ${TPL_NAME[r.tpl]} template`} />
        <div className="stack g12">
          <span className="small muted" lang="en">{r.who}</span>
          <strong style={{ fontSize: 22 }}>{t('home.more.roles.template', { name: TPL_NAME[r.tpl] })}</strong>
          <ul className="stack g8" style={{ listStyle: 'none', margin: 0, padding: 0 }}>{[1, 2, 3].map((i) => <li key={i} className="row g8" style={{ flexWrap: 'nowrap', alignItems: 'flex-start' }}><Check />{t(`home.more.roles.${r.k}.${i}`)}</li>)}</ul>
          <Link to="/builder" state={{ open: 'build', template: r.tpl }} className="btn btn-outline" style={{ alignSelf: 'flex-start' }}>{t('home.more.roles.use')}</Link>
        </div>
      </div>
    </div>
  );
}

/* ---------- 5 · templates ---------- */
const TPL_FILTERS = ['all', 'fresher', 'tech', 'govt', 'photo']; // labels: home.more.tpl.f.<k>
const FIRST = ['fresher', 'campus', 'work', 'kio', 'modern', 'care'];
function Templates({ t: tr }) {
  const [f, setF] = useState('all');
  const [open, setOpen] = useState(null); // the template shown large (a card tap); never a download
  const nav = useNavigate();
  const pick = f === 'all' ? FIRST.map((id) => TEMPLATES.find((x) => x.id === id)) : TEMPLATES.filter((t) => (f === 'fresher' ? t.level === 'fresher' : f === 'photo' ? t.photo : t.ind.includes(f)));
  return (
    <div className="stack g24">
      <div className="row between g16" style={{ alignItems: 'flex-end' }}>
        <div className="stack g12" style={{ maxWidth: 620 }}>
          <span className="h-eyebrow">{tr('home.more.tpl.eyebrow', { n: TEMPLATE_COUNT })}</span>
          <h2 id="tpl-h" className="h-sec-title">{rich(tr('home.more.tpl.title'), { em: (w) => <em style={{ fontStyle: 'normal', color: 'var(--text3)' }}>{w}</em> })}</h2>
        </div>
        <div className="row g8" role="group" aria-label={tr('home.more.tpl.filter')}>{TPL_FILTERS.map((k) => <button key={k} type="button" className="chip" aria-pressed={f === k} onClick={() => setF(k)}>{tr(`home.more.tpl.f.${k}`)}</button>)}</div>
      </div>
      <div className="hx-tpls">
        {pick.slice(0, 6).map((t) => (
          <button key={t.id} type="button" className="hx-tpl" aria-label={tr('home.more.tpl.previewAria', { name: t.name })} aria-haspopup="dialog" onClick={() => setOpen(t.id)}>
            <img src={`/home/tpl-${t.id}.webp`} width="200" height="283" loading="lazy" decoding="async" alt="" />
            <span className="row between g8"><strong>{t.name}</strong><span className="xs faint">{tr('home.more.tpl.preview')}</span></span>
          </button>
        ))}
      </div>
      <Link to="/templates" className="btn btn-outline" style={{ alignSelf: 'flex-start' }}>{tr('home.more.tpl.all', { n: TEMPLATE_COUNT })}</Link>
      {open && (
        <Suspense fallback={<div className="overlay" aria-busy="true" />}>
          <TemplatePreview id={open} onClose={() => setOpen(null)} onUse={() => nav('/builder', { state: { open: 'build', template: open } })} />
        </Suspense>
      )}
    </div>
  );
}

/* ---------- 6 · make it stronger: line fixer, free ATS scan, expert ---------- */
function LineFixer({ t }) {
  const [text, setText] = useState(EXAMPLES[0]);
  const [out, setOut] = useState(null);
  const before = bulletScore(text);
  const after = out ? bulletScore(out.text) : null;
  return (
    <div className="hx-tool stack g12">
      <span className="h-eyebrow">{t('home.more.fix.eyebrow')}</span>
      <strong className="hx-tool-title">{t('home.more.fix.title')}</strong>
      <div className="row g4">{EXAMPLES.map((e) => <button key={e} type="button" className="chip" aria-pressed={text === e} style={{ fontSize: 13 }} onClick={() => { setText(e); setOut(null); }}>{e.length > 26 ? `${e.slice(0, 26)}…` : e}</button>)}</div>
      <div className="field">
        <label htmlFor="try" className="label row between"><span>{t('home.more.fix.label')}</span><span className="faint">{t('home.more.fix.score', { n: before })}</span></label>
        <textarea id="try" aria-label={t('home.more.fix.aria')} lang="en" className="input" rows={3} value={text} maxLength={220} onChange={(e) => { setText(e.target.value); setOut(null); }} />
      </div>
      <button type="button" className="btn btn-ink" disabled={!text.trim()} onClick={() => setOut(improveBullet(text))}><Icon name="spark" size={16} />{t('home.more.fix.button')}</button>
      {out && (
        <div className="stack g8" aria-live="polite">
          <div className="well stack g4" style={{ background: after > before ? 'var(--successbg)' : undefined }}>
            {after > before
              ? <span className="xs" style={{ color: 'var(--success)', fontWeight: 700 }}>{t('home.more.fix.improved', { a: before, b: after })}</span>
              : <span className="xs" style={{ fontWeight: 700 }}>{t('home.more.fix.strong', { n: after })}</span>}
            <span style={{ fontWeight: 600 }} lang="en">• {out.text}</span>
          </div>
          {out.tips.length > 0 && <ul className="stack g4 small" style={{ margin: 0, paddingLeft: 18 }} lang="en">{out.tips.map((x) => <li key={x}>{x}</li>)}</ul>}
          <Link to="/builder" className="small">{t('home.more.fix.rest')}</Link>
        </div>
      )}
    </div>
  );
}

function ScanBox({ scanError, t }) {
  const nav = useNavigate();
  const { role, setRole, setUpload } = useFlow();
  const fileRef = useRef();
  const [err, setErr] = useState(scanError);
  useEffect(() => setErr(scanError), [scanError]);
  const start = async (file) => {
    if (!file) { setErr(t('home.more.scan.choose')); return; } // e.g. the file picker was closed
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
      <span className="h-eyebrow">{t('home.more.scan.eyebrow')}</span>
      <strong className="hx-tool-title">{t('home.more.scan.title')}</strong>
      <span className="small muted">{t('home.more.scan.text')}</span>
      <div className="field">
        <label htmlFor="role" className="label">{t('home.more.scan.role')}</label>
        <input id="role" className="input" value={role} maxLength={ROLE_MAX} onChange={(e) => setRole(e.target.value)} onBlur={(e) => setRole(e.target.value.replace(/\s+/g, ' ').trim())} placeholder="e.g. Data Analyst" lang="en" />
      </div>
      <input ref={fileInput} type="file" accept=".pdf,.docx" className="sr-only" tabIndex={-1} aria-label={t('home.more.scan.file')} onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; start(f || null); }} />
      <button type="button" className="btn btn-ink" onClick={() => fileRef.current.click()}>{t('home.more.scan.button')}</button>
      <span className="xs faint">{t('home.more.scan.note', { n: MAX_MB })}</span>
      <button type="button" className="link-btn xs" style={{ alignSelf: 'flex-start' }} onClick={() => start('sample')}>{t('home.more.scan.sample')}</button>
      {err && <span role="alert" className="error">{err}</span>}
    </div>
  );
}

function Expert({ goExpert, t }) {
  const [view, setView] = useState('before');
  const score = EXPERT_DEMO[view];
  return (
    <div className="hx-tool stack g12">
      <span className="h-eyebrow">{t('home.more.expert.eyebrow')}</span>
      <strong className="hx-tool-title">{t('home.more.expert.title')}</strong>
      <div className="segmented" role="group" aria-label={t('home.more.expert.toggle')} style={{ alignSelf: 'flex-start' }}>
        {['before', 'after'].map((k) => <button key={k} type="button" aria-pressed={view === k} onClick={() => setView(k)}>{t(`home.more.expert.${k}`)}</button>)}
      </div>
      <div className="hx-ba">
        <img src={`/home/expert-${view}.webp`} width="300" height="424" loading="lazy" decoding="async" alt={`Sample resume ${view === 'before' ? 'before' : 'after'} an expert rewrite, ATS score ${score}`} />
        <span className="hx-ba-score" data-good={view === 'after'}>ATS {score}</span>
      </div>
      <span className="xs muted">{t('home.more.expert.note', { a: EXPERT_DEMO.before, b: EXPERT_DEMO.after })}</span>
      <ul className="stack g4 small" style={{ listStyle: 'none', margin: 0, padding: 0 }}>
        {[t('home.more.expert.p1'), t('home.more.expert.p2', { h: HOURS }), t('home.more.expert.p3'), t('home.more.expert.p4')].map((x) => <li key={x} className="row g8" style={{ flexWrap: 'nowrap' }}><Check />{x}</li>)}
      </ul>
      <button type="button" className="btn btn-ink" onClick={goExpert}>{t('home.more.expert.cta', { price: inr(PLANS.expert.price) })}</button>
    </div>
  );
}

/* ---------- 7 · pricing for job seekers ---------- */
// rows of "Compare all features": pricing.f.<n>, then Fix it yourself / Expert rewrite / Career Launch
// (true = included, false = not, 'addon' / 'extra' / 'self' = a word from pricing.*)
const FEATURES = [
  [1, true, true, true],
  [2, true, true, true],
  [3, true, true, true],
  [4, false, true, true],
  [5, false, true, true],
  [6, false, true, true],
  [7, false, 'addon', true],
  [8, 'extra', 'extra', true],
  [9, 'self', 'self', true],
  [10, false, false, true],
];
const PLAN_NAMES = { diy: 'Fix it yourself', expert: 'Expert rewrite', launch: 'Career Launch' }; // product names: not translated
function Pricing({ goPlan, t }) {
  const pm = usePayMode();
  const [table, setTable] = useState(false);
  const plans = [
    ['diy', ['pricing.diy.1', 'pricing.diy.2', 'pricing.diy.3']],
    ['expert', ['home.more.expert.p1', 'pricing.expert.2', 'pricing.expert.3', 'pricing.expert.4']],
    ['launch', ['pricing.launch.1', 'pricing.launch.2', 'pricing.launch.3', 'pricing.launch.4', 'pricing.launch.5']],
  ];
  const extra = t('pricing.extra', { price: inr(PLANS.linkedin_pack.price) });
  const cell = (x) => (x === 'addon' ? t('pricing.addon') : x === 'extra' ? extra : x === 'self' ? t('pricing.self') : x);
  return (
    <>
      <div className="stack g12" style={{ maxWidth: 680 }}>
        <span className="h-eyebrow">{t('pricing.eyebrow')}</span>
        <h2 id="pricing-h" className="h-sec-title">{t('pricing.title')}</h2>
        <p className="small muted" style={{ margin: 0 }}>{t('pricing.sub')}</p>
        {pm?.mode === 'whatsapp' && <p className="small" style={{ margin: 0 }} data-testid="home-wa-pay">{t('pricing.waPay')}</p>}
      </div>
      <div className="h-plans">
        {plans.map(([k, items]) => (
          <div key={k} className="h-plan" data-pop={k === 'expert'}>
            {k === 'expert' && <span className="badge b-signal" style={{ position: 'absolute', top: -13, left: 24 }}>{t('pricing.popular')}</span>}
            <div className="stack g4"><strong style={{ fontSize: 20 }} lang="en">{PLAN_NAMES[k]}</strong><span className="small muted">{t(`pricing.${k}.tag`)}</span></div>
            <div className="row g8" style={{ alignItems: 'baseline' }}><span className="display" style={{ fontSize: 44 }}>{inr(PLANS[k].price)}</span><span className="small muted">{t('pricing.once')}</span></div>
            <ul>{items.map((x) => <li key={x}><Check />{t(x, { h: HOURS })}</li>)}</ul>
            <button type="button" className={`btn btn-lg ${k === 'expert' ? 'btn-ink' : 'btn-outline'}`} style={{ marginTop: 'auto' }} onClick={() => goPlan(k)}>{t(`pricing.${k}.cta`)}</button>
          </div>
        ))}
      </div>
      <div className="card row between g12" data-testid="home-linkedin-pack" style={{ alignItems: 'center', flexWrap: 'wrap' }}>
        <span className="stack g4" style={{ flex: '1 1 320px' }}>
          <strong>{t('pricing.lp.title', { price: inr(PLANS.linkedin_pack.price) })}</strong>
          <span className="small muted">{t('pricing.lp.text')}</span>
        </span>
        <Link to="/linkedin" className="btn btn-outline">{t('pricing.lp.cta')}</Link>
      </div>
      <div className="row between g16">
        <div className="row g12 well" style={{ flex: '1 1 420px', alignItems: 'center', flexWrap: 'nowrap', background: 'var(--successbg)' }}>
          <span style={{ fontSize: 26 }} aria-hidden="true">🛡️</span>
          <span className="small"><strong>{t('pricing.promise.label')}</strong> {t('pricing.promise.text')} <Link to="/refund-policy" hrefLang="en">{t('pricing.refundLink')}</Link></span>
        </div>
        <button type="button" className="btn btn-ghost" aria-expanded={table} onClick={() => setTable(!table)}>{table ? t('pricing.hide') : t('pricing.compare')}</button>
      </div>
      {table && (
        <div className="card table-wrap" tabIndex={0} role="region" aria-label="Table — scroll sideways to see all columns" style={{ padding: 0 }}>
          <table className="table"><thead><tr><th>{t('pricing.feature')}</th>{Object.values(PLAN_NAMES).map((n) => <th key={n} lang="en">{n}</th>)}</tr></thead>
            <tbody>{FEATURES.map(([f, ...v]) => <tr key={f}><td className="small">{t(`pricing.f.${f}`, { n: TEMPLATE_COUNT, h: HOURS })}</td>{v.map((x, i) => <td key={i} className="small">{x === true ? <span aria-label={t('pricing.included')}><Check /></span> : x === false ? <span className="faint" aria-label={t('pricing.notIncluded')}>—</span> : cell(x)}</td>)}</tr>)}</tbody></table>
          <p className="xs muted" style={{ padding: '0 16px 14px', margin: 0 }}>{t('pricing.addons')} <span lang="en">{Object.values(ADDONS).map((a) => `${a.name} ${inr(a.price)}`).join(' · ')}</span></p>
        </div>
      )}
    </>
  );
}

/* ---------- 8 · run your resume drive ---------- */
function DriveSteps({ t }) {
  const steps = [
    ['invite',
      <div key="i" className="hx-mini-invite"><span className="hx-qr" />{['nm7.si/join/SVC26', '312 joined'].map((x) => <span key={x} className="small">{x}</span>)}</div>],
    ['review',
      <div key="r" className="stack g6">{[['Ananya R.', 'Approved', 'b-success'], ['Rahul V.', 'Needs changes', 'b-warning'], ['Kiran M.', 'Reminded', 'b-neutral']].map(([n, s, b]) => <div key={n} className="row between small"><span>{n}</span><span className={`badge ${b}`}>{s}</span></div>)}</div>],
    ['deliver',
      <div key="d" className="hx-mini-pages"><span /><span /><span /><strong className="small">Batch_2026.pdf · 312 resumes</strong></div>],
  ];
  return (
    <div className="stack g32">
      <div className="stack g12" style={{ maxWidth: 680 }}>
        <span className="h-eyebrow">{t('home.more.drive.eyebrow')}</span>
        <h2 id="drive-h" className="h-sec-title">{t('home.more.drive.title')}</h2>
      </div>
      <div className="h-steps">
        {steps.map(([k, mini], i) => (
          <article key={k} className="h-step">
            <span className="h-num" aria-hidden="true">{i + 1}</span>
            <h3 className="hx-step-title">{t(`home.more.drive.${k}.title`)}</h3>
            <span className="muted">{t(`home.more.drive.${k}.text`)}</span>
            <div className="mini" aria-hidden="true" lang="en">{mini}</div>
          </article>
        ))}
      </div>
    </div>
  );
}

/* ---------- 10 · plans for organizations ---------- */
function OrgPlans({ t }) {
  const st = useOrgPlans();
  return (
    <div className="stack g24">
      <div className="row between g16" style={{ alignItems: 'flex-end' }}>
        <div className="stack g12" style={{ maxWidth: 680 }}>
          <span className="h-eyebrow">{t('home.more.orgplans.eyebrow')}</span>
          <h2 id="orgplans-h" className="h-sec-title">{t('home.more.orgplans.title')}</h2>
        </div>
        <span className="row g8">
          <Link to="/for-orgs?start=1#start" className="btn btn-ink" onClick={() => track('hero_org_start')}>{t('org.start')}</Link>
          <Link to="/for-orgs#talk" className="btn btn-outline" onClick={() => track('to_for_orgs')}>{t('orgs.talk.title')}</Link>
        </span>
      </div>
      {st.loading ? <PlansSkeleton />
        : st.data ? <PlansTable data={st.data} t={t} />
          : <p className="small muted">{rich(t('home.more.orgplans.fallback'), { link: <Link to="/for-orgs" onClick={() => track('to_for_orgs')}>{t('home.more.orgplans.link')}</Link> })}</p>}
      <span className="small muted">{st.data?.gstOn ? `${t('home.more.orgplans.gst', { n: st.data.gstRatePct })} ` : ''}{t('home.more.orgplans.invoice')} <Link to="/for-orgs" onClick={() => track('to_for_orgs')}>{t('home.more.orgplans.details')}</Link></span>
    </div>
  );
}

/* ---------- 12 · FAQ ---------- */
/** The job seekers' FAQ (faq.seeker.1–8 in src/i18n/pages.json) in one language; tr = (key, values) → string. */
const SEEKER_VARS = { 1: { n: TEMPLATE_COUNT }, 6: { h: HOURS }, 7: { n: PROMISES.retentionDays }, 8: { p: PROMISES.paymentProvider } };
export const seekerFaq = (tr) => [1, 2, 3, 4, 5, 6, 7, 8].map((i) => [tr(`faq.seeker.${i}.q`), tr(`faq.seeker.${i}.a`, SEEKER_VARS[i])]);
export const SEEKER_FAQ = seekerFaq((k, v) => translate('en', k, v)); // English: Google's FAQ rich results
function Faq({ t }) {
  const [cur, tab] = useTabs(['seekers', 'orgs'], 'seekers');
  const list = cur === 'seekers' ? seekerFaq(t) : orgFaq(t);
  return (
    <div className="stack g24" style={{ maxWidth: 860, margin: '0 auto' }}>
      <h2 id="faq-h" className="h-sec-title">{t('home.more.faq.title')}</h2>
      <div className="segmented" role="tablist" aria-label={t('home.more.faq.from')} style={{ alignSelf: 'flex-start' }}>
        <button type="button" {...tab('seekers')}>{t('home.more.faq.seekers')}</button>
        <button type="button" {...tab('orgs')}>{t('home.more.faq.orgs')}</button>
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
      <section id="roles" className="h-pad" aria-labelledby="roles-h" lang={lang}><div className="h-wrap"><Roles t={t} /></div></section>
      {/* 5 */}
      <section id="templates" className="h-pad h-band" aria-labelledby="tpl-h" lang={lang}><div className="h-wrap"><Templates t={t} /></div></section>
      {/* 6 */}
      <section id="stronger" className="h-pad" aria-labelledby="stronger-h" lang={lang}>
        <div className="h-wrap stack g24">
          <div className="stack g12" style={{ maxWidth: 680 }}>
            <span className="h-eyebrow">{t('home.more.stronger.eyebrow')}</span>
            <h2 id="stronger-h" className="h-sec-title">{t('home.more.stronger.title')}</h2>
          </div>
          <div className="hx-stronger"><LineFixer t={t} /><ScanBox scanError={scanError} t={t} /><Expert goExpert={() => goPlan('expert')} t={t} /></div>
        </div>
      </section>
      {/* 7 */}
      <section id="pricing" className="h-pad h-band" aria-labelledby="pricing-h" lang={lang}><div className="h-wrap stack g32" id="plans"><Pricing goPlan={goPlan} t={t} /></div></section>
      {/* 8 */}
      <section id="drive" className="h-pad" aria-labelledby="drive-h" lang={lang}><div className="h-wrap"><DriveSteps t={t} /></div></section>
      {/* 9 */}
      <section className="h-pad h-dark" aria-labelledby="kiosk-h" lang={lang}>
        <div className="h-wrap h-grid">
          <div className="stack g16">
            <span className="h-eyebrow">{t('home.more.kiosk.eyebrow')}</span>
            <h2 id="kiosk-h" className="h-sec-title" style={{ color: '#F7F6F2' }}>{t('home.more.kiosk.title')}</h2>
            <p className="lead" style={{ margin: 0 }}>{t('home.more.kiosk.lead')}</p>
            <ul className="stack g8" style={{ listStyle: 'none', margin: 0, padding: 0 }}>
              {[1, 2, 3].map((i) => <li key={i} className="row g8" style={{ flexWrap: 'nowrap', alignItems: 'flex-start' }}><Check color="var(--signal)" />{t(`home.more.kiosk.${i}`)}</li>)}
            </ul>
          </div>
          <div className="hx-tablet" aria-hidden="true" lang="en"><div className="hx-tablet-screen"><strong>Welcome to the Nm7 stall</strong><span className="small">Build your resume in 10 minutes. Print it here.</span><span className="hx-tablet-btn">Start</span><span className="xs">Wipes after each person · 2 min idle</span></div></div>
        </div>
      </section>
      {/* 10 */}
      <section id="org-plans" className="h-pad" aria-labelledby="orgplans-h" lang={lang}><div className="h-wrap"><OrgPlans t={t} /></div></section>
      {/* 11 */}
      <section className="h-wrap" aria-labelledby="partner-h" lang={lang}>
        <div className="hx-partner">
          <div className="stack g8">
            <h2 id="partner-h" className="hx-partner-title">{t('home.more.partner.title')}</h2>
            <span className="small muted">{t('home.more.partner.text')}</span>
          </div>
          <Link to="/partners" className="btn btn-ink btn-lg" onClick={() => track('to_partners')}>{t('home.more.partner.cta')}</Link>
        </div>
      </section>
      {/* 12 */}
      <Stories className="h-pad h-band" />
      <section id="faq" className="h-pad" aria-labelledby="faq-h" lang={lang}><div className="h-wrap"><Faq t={t} /></div></section>
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
