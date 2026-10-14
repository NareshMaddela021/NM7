// Home / landing page: hero with upload + live scan demo, how it works, try-it bullet improver, templates,
// before/after slider, experts, pricing, reviews, who it's for, FAQ and a final call to action.
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import Header from '../components/Header';
import SiteFooter from '../components/SiteFooter';
import { Icon } from '../components/ui';
import { ROLE_MAX, useFlow } from '../lib/flow';
import { checkFile } from '../lib/scan/extract';
import { PLANS, PROMISES, ADDONS, inr } from '../lib/pricing';
import { STATS, REVIEWS, EXPERTS, visible } from '../lib/homeContent';
import { atsScore } from '../lib/atsScore';
import ResumePreview from './builder/ResumePreview';
import { TEMPLATE_PRESETS, DEFAULT_DESIGN } from './builder/design';
import { INITIAL } from './builder/schema';
import { layoutOf, PHOTO_PLACEHOLDER } from './builder/TemplatePicker';
import { BEFORE, AFTER, DEMO_JD, improveBullet, bulletScore, EXAMPLES } from './home/demoData';
import '../styles/home.css';

const MAX_MB = 5;
const reduced = () => typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

/* ---------- small pieces ---------- */
function Check({ color = 'var(--success)' }) { return <Icon name="check" size={16} stroke={2.6} color={color} />; }
function Sample() { return <span className="badge b-warning h-sample" title="Replace with real data before launch">Sample</span>; }
function useReveal() {
  useEffect(() => {
    const els = document.querySelectorAll('.home .reveal');
    if (!('IntersectionObserver' in window) || reduced()) { els.forEach((e) => e.classList.add('in')); return undefined; }
    const io = new IntersectionObserver((es) => es.forEach((e) => { if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); } }), { rootMargin: '0px 0px -8% 0px' });
    els.forEach((e) => io.observe(e));
    return () => io.disconnect();
  }, []);
}
function Ring({ value, size = 64 }) {
  const r = (size - 8) / 2; const c = 2 * Math.PI * r;
  const color = value >= 80 ? 'var(--success)' : value >= 60 ? 'var(--warning)' : 'var(--danger)';
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-label={`ATS score ${value} out of 100`}>
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--sunken)" strokeWidth="7" />
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={color} strokeWidth="7" strokeLinecap="round" strokeDasharray={c} strokeDashoffset={c * (1 - value / 100)} transform={`rotate(-90 ${size / 2} ${size / 2})`} style={{ transition: 'stroke 300ms' }} />
      <text x="50%" y="54%" textAnchor="middle" dominantBaseline="middle" fontFamily="var(--font-display)" fontWeight="700" fontSize={size * 0.3} fill="var(--text)">{value}</text>
    </svg>
  );
}

/* ---------- hero: animated scan ---------- */
const TAGS = [
  { bad: 'Two columns — ATS may scramble it', good: 'One clean column', style: { top: 70, right: -10 } },
  { bad: 'No numbers in bullets', good: '3 results with numbers', style: { top: 190, left: -18 } },
  { bad: 'Missing: SQL · Tableau', good: 'Matches 8 of 10 job keywords', style: { top: 290, right: -6 } },
  { bad: 'Vague summary', good: 'Summary with one result', style: { top: 380, left: 10 } },
];
function ScanDemo() {
  const [phase, setPhase] = useState(reduced() ? 4 : 0); // 0 idle · 1 scanning · 2 issues · 3 fixing · 4 done
  const [shown, setShown] = useState(reduced() ? 4 : 0);
  const [fixed, setFixed] = useState(reduced() ? 4 : 0);
  const [score, setScore] = useState(reduced() ? 86 : 41);
  useEffect(() => {
    if (reduced()) return undefined;
    let alive = true; const T = [];
    const at = (ms, f) => T.push(setTimeout(() => alive && f(), ms));
    const run = () => {
      setPhase(0); setShown(0); setFixed(0); setScore(41);
      at(600, () => setPhase(1));
      [0, 1, 2, 3].forEach((i) => at(1500 + i * 450, () => { setPhase(2); setShown(i + 1); }));
      [0, 1, 2, 3].forEach((i) => at(4200 + i * 600, () => { setPhase(3); setFixed(i + 1); }));
      at(4200, () => { const t0 = performance.now(); const tick = (now) => { if (!alive) return; const k = Math.min(1, (now - t0) / 2400); setScore(Math.round(41 + 45 * (1 - (1 - k) ** 3))); if (k < 1) requestAnimationFrame(tick); else setPhase(4); }; requestAnimationFrame(tick); });
      at(10500, run);
    };
    run();
    return () => { alive = false; T.forEach(clearTimeout); };
  }, []);
  const twoCol = fixed < 1;
  return (
    <div className="h-scan" data-phase={phase} aria-label="Demo: a resume being scanned, issues found and fixed, score rising from 41 to 86" role="img">
      <div className="h-paper" aria-hidden="true">
        <div className="h-beam" />
        <div style={{ height: 16, width: '46%', borderRadius: 5, background: 'var(--text)', opacity: 0.85 }} />
        <div className="ln" style={{ width: '62%', marginTop: 10 }} />
        <div style={{ height: 1, background: 'var(--border)', margin: '16px 0' }} />
        <div style={{ display: 'grid', gridTemplateColumns: twoCol ? '34% 1fr' : '1fr', gap: 16, transition: 'all 500ms var(--ease)' }}>
          {twoCol && <div style={{ background: 'var(--sunken)', borderRadius: 6, padding: 10 }}>{[70, 90, 60, 80, 50, 75, 65].map((w, i) => <div key={i} className="ln b" style={{ width: `${w}%`, opacity: 0.5 }} />)}</div>}
          <div>
            {['Summary', 'Experience', 'Projects', 'Education'].map((h, j) => (
              <div key={h} style={{ marginBottom: 14 }}>
                <div className="ln b" style={{ width: 90, height: 8 }} />
                {[92, 84, 76].slice(0, j === 3 ? 1 : 3).map((w, i) => (
                  <div key={i} className="ln" style={{ width: `${w - i * 4}%`, background: fixed >= 2 && j > 0 && j < 3 && i === 0 ? 'color-mix(in srgb, var(--signal) 70%, transparent)' : undefined }} />
                ))}
              </div>
            ))}
          </div>
        </div>
      </div>
      {TAGS.map((t, i) => (
        <span key={i} className="h-tag" data-on={shown > i} data-fix={fixed > i} style={t.style} aria-hidden="true">
          {fixed > i ? '✓' : '!'} {fixed > i ? t.good : t.bad}
        </span>
      ))}
      <div className="h-ring" aria-hidden="true">
        <Ring value={score} />
        <div className="stack"><span className="xs muted">ATS score</span><strong style={{ fontSize: 15 }}>{phase === 4 ? 'Ready to apply' : phase >= 3 ? 'Fixing…' : phase >= 1 ? 'Scanning…' : 'Your resume'}</strong></div>
      </div>
    </div>
  );
}

function Upload({ start, role, setRole, compact }) {
  const fileRef = useRef();
  const [drag, setDrag] = useState(false);
  // Closing the file picker without a file: say what to do (instead of silently scanning nothing).
  useEffect(() => {
    const el = fileRef.current;
    const cancel = () => start(null);
    el?.addEventListener('cancel', cancel);
    return () => el?.removeEventListener('cancel', cancel);
  }, [start]);
  return (
    <div className="h-drop">
      <div data-drag={drag} onDragOver={(e) => { e.preventDefault(); setDrag(true); }} onDragLeave={() => setDrag(false)} onDrop={(e) => { e.preventDefault(); setDrag(false); start(e.dataTransfer.files[0]); }} className="stack g12">
        <div className="row g12" style={{ alignItems: 'center', flexWrap: 'nowrap' }}>
          <span style={{ width: 48, height: 48, flex: 'none', borderRadius: 14, background: 'var(--signal)', color: 'var(--signalink)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><Icon name="upload" size={22} /></span>
          <div className="stack"><strong style={{ fontSize: 18 }}>{drag ? 'Release to scan' : 'Drop your resume here'}</strong><span className="xs faint">PDF or DOCX · up to {MAX_MB} MB · free · no sign-up</span></div>
        </div>
        <div className="row g8" style={{ alignItems: 'flex-end' }}>
          <div className="field" style={{ flex: '1 1 180px' }}>
            <label htmlFor={compact ? 'role2' : 'role'} className="label">Role you’re applying for</label>
            <input id={compact ? 'role2' : 'role'} className="input" style={{ height: 48 }} value={role} maxLength={ROLE_MAX} onChange={(e) => setRole(e.target.value)} onBlur={(e) => setRole(e.target.value.replace(/\s+/g, ' ').trim())} placeholder="e.g. Data Analyst" />
          </div>
          <input ref={fileRef} type="file" accept=".pdf,.docx" className="sr-only" tabIndex={-1} aria-label={compact ? 'Resume file to scan (bottom of page)' : 'Resume file to scan'}
            onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; start(f || null); }} />
          <button type="button" className="btn btn-ink btn-lg" style={{ flex: '1 1 160px', minHeight: 48 }} onClick={() => fileRef.current.click()}>Scan my resume — free</button>
        </div>
        <span className="row between g8 xs">
          <button type="button" className="link-btn xs" onClick={() => start('sample')}>No resume handy? Try a sample</button>
          <span className="faint">Read on your device — never uploaded</span>
        </span>
      </div>
    </div>
  );
}

/* ---------- try it: bullet improver ---------- */
function TryIt() {
  const [text, setText] = useState(EXAMPLES[0]);
  const [out, setOut] = useState(null);
  const before = bulletScore(text);
  const after = out ? bulletScore(out.text) : null;
  return (
    <div className="h-grid" style={{ alignItems: 'start' }}>
      <div className="stack g16 reveal">
        <span className="h-eyebrow">Try it now · no sign-up</span>
        <h2 className="h-sec-title">Watch a weak line become one recruiters read.</h2>
        <p className="lead" style={{ margin: 0 }}>Type a line from your resume — or pick one below. We fix the verb, the skill names and tell you exactly what’s missing. Experts go further: they ask you for the numbers.</p>
        <div className="row g8">{EXAMPLES.map((e) => <button key={e} type="button" className="chip" aria-pressed={text === e} style={{ minHeight: 34, fontSize: 13 }} onClick={() => { setText(e); setOut(null); }}>{e.length > 34 ? `${e.slice(0, 34)}…` : e}</button>)}</div>
      </div>
      <div className="card stack g16 reveal" style={{ padding: 24, borderRadius: 22, boxShadow: 'var(--shadow)' }}>
        <div className="field">
          <label htmlFor="try" className="label row between"><span>Your line</span><span className="faint">Line score {before}/100</span></label>
          <textarea id="try" aria-label="Your resume line" className="input" rows={2} value={text} maxLength={220} onChange={(e) => { setText(e.target.value); setOut(null); }} />
        </div>
        <button type="button" className="btn btn-ink btn-lg" disabled={!text.trim()} onClick={() => setOut(improveBullet(text))}><Icon name="spark" size={16} />Improve this line</button>
        {out && (
          <div className="stack g12 rise" aria-live="polite">
            <div className="well stack g4" style={{ background: 'var(--successbg)' }}>
              <span className="xs" style={{ color: 'var(--success)', fontWeight: 700 }}>IMPROVED · {before} → {after}/100</span>
              <span style={{ fontSize: 17, fontWeight: 600 }}>• {out.text}</span>
            </div>
            {out.tips.length > 0 && <ul className="stack g4 small" style={{ margin: 0, paddingLeft: 18 }}>{out.tips.map((t) => <li key={t}>{t}</li>)}</ul>}
            <div className="row g8 small"><Link to="/builder">Fix the rest in the builder →</Link><span className="faint">or</span><button type="button" className="link-btn small" onClick={() => document.getElementById('plans')?.scrollIntoView({ behavior: reduced() ? 'auto' : 'smooth' })}>get an expert to do it</button></div>
          </div>
        )}
      </div>
    </div>
  );
}

/* ---------- templates ---------- */
const TPL_SHOW = ['fresher', 'modern', 'classic', 'kio', 'impact', 'twocol', 'portrait', 'formal', 'stack', 'accent'];
const TPL_FILTERS = [['all', 'All'], ['fresher', 'Freshers'], ['tech', 'Tech'], ['govt', 'Govt & PSU'], ['photo', 'With photo']];
function tplData(k) {
  const L = layoutOf(k);
  return { ...INITIAL, order: L.order, hidden: { ...L.hidden }, titles: { ...L.titles }, showPhoto: L.showPhoto, design: { ...TEMPLATE_PRESETS[k].design, preset: k } };
}
function Templates() {
  const nav = useNavigate();
  const [f, setF] = useState('all');
  const rail = useRef();
  const slide = (d) => rail.current?.scrollBy({ left: d * 476, behavior: reduced() ? 'auto' : 'smooth' });
  const list = TPL_SHOW.filter((k) => { const t = TEMPLATE_PRESETS[k]; return f === 'all' || (f === 'fresher' ? t.level === 'fresher' : f === 'photo' ? t.photo : (t.ind || []).includes(f)); });
  const datas = useMemo(() => Object.fromEntries(TPL_SHOW.map((k) => [k, tplData(k)])), []);
  return (
    <>
      <div className="row between g16 reveal" style={{ alignItems: 'flex-end' }}>
        <div className="stack g12" style={{ maxWidth: 620 }}>
          <span className="h-eyebrow">17 templates · all ATS-tested</span>
          <h2 className="h-sec-title">Templates that look good to people <em style={{ fontStyle: 'normal', color: 'var(--text3)' }}>and</em> to software.</h2>
        </div>
        <div className="row g8" role="tablist" aria-label="Filter templates">{TPL_FILTERS.map(([k, l]) => <button key={k} type="button" role="tab" aria-selected={f === k} className="chip" aria-pressed={f === k} onClick={() => { setF(k); rail.current?.scrollTo({ left: 0 }); }} style={{ minHeight: 36 }}>{l}</button>)}
          <button type="button" className="btn btn-icon" aria-label="Previous templates" onClick={() => slide(-1)}>←</button><button type="button" className="btn btn-icon" aria-label="More templates" onClick={() => slide(1)}>→</button></div>
      </div>
      <div ref={rail} className="h-rail reveal" aria-label="Templates">
        {list.map((k) => (
          <button key={k} type="button" className="h-tpl" onClick={() => nav('/builder', { state: { open: 'build', template: k } })} aria-label={`Use the ${TEMPLATE_PRESETS[k].name} template`}>
            <div className="thumb" style={{ width: 220, height: 311, borderRadius: 10, overflow: 'hidden', background: '#fff', border: '1px solid var(--border)' }} aria-hidden="true">
              <div style={{ width: 220, pointerEvents: 'none' }}><ResumePreview loadFonts={false} data={datas[k]} design={{ ...DEFAULT_DESIGN, ...datas[k].design }} photo={datas[k].showPhoto ? PHOTO_PLACEHOLDER : null} /></div>
            </div>
            <span className="row between g8"><strong>{TEMPLATE_PRESETS[k].name}</strong><span className="xs faint">Use →</span></span>
            <span className="xs muted" style={{ lineHeight: 1.4 }}>{TEMPLATE_PRESETS[k].desc}</span>
          </button>
        ))}
        <Link to="/builder" className="h-tpl" style={{ textDecoration: 'none' }}>
          <div style={{ width: 220, height: 311, borderRadius: 10, border: '2px dashed var(--border2)', display: 'flex', alignItems: 'center', justifyContent: 'center', textAlign: 'center', padding: 20 }}><strong>See all 17 templates in the builder →</strong></div>
        </Link>
      </div>
    </>
  );
}

/* ---------- before / after ---------- */
function BeforeAfter() {
  const [view, setView] = useState('before');
  const [auto, setAuto] = useState(!reduced());
  useEffect(() => { if (!auto) return undefined; const t = setInterval(() => setView((v) => (v === 'before' ? 'after' : 'before')), 3200); return () => clearInterval(t); }, [auto]);
  const b = atsScore(BEFORE, DEMO_JD); const a = atsScore(AFTER, DEMO_JD);
  const dsB = { ...DEFAULT_DESIGN, ...BEFORE.design }; const dsA = { ...DEFAULT_DESIGN, ...AFTER.design };
  return (
    <div className="h-grid">
      <div className="stack g20 reveal">
        <span className="h-eyebrow">Before / after · sample</span>
        <h2 className="h-sec-title">Same person. Same facts. A resume that gets read.</h2>
        <p className="lead" style={{ margin: 0 }}>Switch between the two. Our expert didn’t invent anything — they asked the right questions and put the numbers where recruiters look.</p>
        <div className="row g16">
          {[['Before', b, 'var(--danger)'], ['After', a, 'var(--success)']].map(([l, s, c]) => (
            <div key={l} className="card row g12" style={{ flex: '1 1 200px', padding: 16, alignItems: 'center' }}>
              <Ring value={s.score} size={58} />
              <div className="stack"><strong style={{ color: c }}>{l}</strong><span className="xs muted">Job keywords {s.match.found.length}/{s.match.keywords.length}</span><span className="xs muted">{s.checks.filter((k) => k.ok).length}/{s.checks.length} checks passed</span></div>
            </div>
          ))}
        </div>
        <span className="xs faint">Sample candidate. Scores use the same rules as our scanner, against a Data Analyst job post.</span>
      </div>
      <div className="reveal stack g12" style={{ alignItems: 'center' }}>
        <div className="segmented" role="tablist" aria-label="Show before or after">
          {[['before', 'Before'], ['after', 'After expert rewrite']].map(([k, l]) => <button key={k} type="button" role="tab" aria-selected={view === k} onClick={() => { setView(k); setAuto(false); }}>{l}</button>)}
        </div>
        <div className="h-ba" style={{ width: 'min(520px, 100%)' }}>
          <div style={{ opacity: view === 'before' ? 1 : 0, transition: 'opacity 500ms var(--ease)' }} aria-hidden={view !== 'before'}><ResumePreview loadFonts={false} data={BEFORE} design={dsB} /></div>
          <div className="h-after" style={{ opacity: view === 'after' ? 1 : 0, transition: 'opacity 500ms var(--ease)', background: '#fff' }} aria-hidden={view !== 'after'}><ResumePreview loadFonts={false} data={AFTER} design={dsA} /></div>
          <span className="h-lbl" style={{ right: 12, background: view === 'after' ? 'var(--successbg)' : 'var(--dangerbg)', color: view === 'after' ? 'var(--success)' : 'var(--danger)' }}>{view === 'after' ? `After · ATS ${a.score}` : `Before · ATS ${b.score}`}</span>
        </div>
      </div>
    </div>
  );
}

/* ---------- pricing ---------- */
const FEATURES = [
  ['Free ATS scan & score', true, true, true],
  ['Resume builder · 17 templates · PDF & Word', true, true, true],
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
    ['diy', 'Fix it yourself', 'For confident editors', ['Every template, PDF & Word', 'AI line fixes and live ATS score', 'Cover letters and share link'], 'Start building'],
    ['expert', 'Expert rewrite', 'Most freshers choose this', ['A verified expert from your field', `Draft in ${PROMISES.delivery}, revisions included`, 'Chat and comment on each section', 'Final lands in your builder'], 'Get an expert'],
    ['launch', 'Career Launch', 'For your first big move', ['Everything in Expert rewrite', 'LinkedIn headline, About & top role', 'Cover letter for your first target job', '30-min 1:1 mentor call'], 'Launch my career'],
  ];
  return (
    <>
      <div className="stack g12 reveal" style={{ maxWidth: 680 }}>
        <span className="h-eyebrow">Pricing · GST included</span>
        <h2 className="h-sec-title">The scan is free. Pay only to fix it.</h2>
      </div>
      <div className="h-plans">
        {plans.map(([k, name, tag, items, cta]) => (
          <div key={k} className="h-plan reveal" data-pop={k === 'expert'}>
            {k === 'expert' && <span className="badge b-signal" style={{ position: 'absolute', top: -13, left: 24 }}>Most popular</span>}
            <div className="stack g4"><strong style={{ fontSize: 20 }}>{name}</strong><span className="small muted">{tag}</span></div>
            <div className="row g8" style={{ alignItems: 'baseline' }}><span className="display" style={{ fontSize: 44 }}>{inr(PLANS[k].price)}</span><span className="small muted">one-time</span></div>
            <ul>{items.map((t) => <li key={t}><Check />{t}</li>)}</ul>
            <button type="button" className={`btn btn-lg ${k === 'expert' ? 'btn-ink' : 'btn-outline'}`} style={{ marginTop: 'auto' }} onClick={() => goPlan(k)}>{cta}</button>
          </div>
        ))}
      </div>
      <div className="row between g16 reveal">
        <div className="row g12 well" style={{ flex: '1 1 420px', alignItems: 'center', flexWrap: 'nowrap', background: 'var(--successbg)' }}>
          <span style={{ fontSize: 26 }} aria-hidden="true">🛡️</span>
          <span className="small"><strong>Our promise:</strong> late = automatic full refund. Not happy = free re-do first, then a refund review within 24 hours. <Link to="/refund-policy">Refund policy</Link></span>
        </div>
        <button type="button" className="btn btn-ghost" aria-expanded={table} onClick={() => setTable(!table)}>{table ? 'Hide' : 'Compare all features'}</button>
      </div>
      {table && (
        <div className="card table-wrap rise" style={{ padding: 0 }}>
          <table className="table"><thead><tr><th>Feature</th><th>Fix it yourself</th><th>Expert rewrite</th><th>Career Launch</th></tr></thead>
            <tbody>{FEATURES.map(([f, ...v]) => <tr key={f}><td className="small">{f}</td>{v.map((x, i) => <td key={i} className="small">{x === true ? <span aria-label="Included"><Check /></span> : x === false ? <span className="faint" aria-label="Not included">—</span> : x}</td>)}</tr>)}</tbody></table>
          <p className="xs muted" style={{ padding: '0 16px 14px', margin: 0 }}>Add-ons: {Object.values(ADDONS).map((a) => `${a.name} ${inr(a.price)}`).join(' · ')}</p>
        </div>
      )}
    </>
  );
}

/* ---------- who it's for ---------- */
const AUDIENCE = {
  fresher: { label: 'Freshers', tpl: 'fresher', head: 'No experience? Your projects are your experience.', tips: ['Projects and internships go above education', 'Turn college work into results with numbers', 'Keep it to one page — recruiters skim'] },
  exp: { label: '1–5 years', tpl: 'impact', head: 'Lead with results, not duties.', tips: ['Every bullet starts with a strong verb', 'Numbers in bold so wins jump out', 'Skills matched to the job you want next'] },
  switch: { label: 'Switching careers', tpl: 'stack', head: 'Show the bridge between where you were and where you’re going.', tips: ['A summary that explains the switch in two lines', 'Transferable skills and new certificates up top', 'Projects in the new field before old job titles'] },
  govt: { label: 'Govt, PSU & banks', tpl: 'kio', head: 'The traditional format — done properly.', tips: ['Personal details, hobbies and strengths sections', 'Declaration with place and date', 'Clean serif or Kio layout that prints well'] },
};
function Audiences() {
  const nav = useNavigate();
  const [k, setK] = useState('fresher');
  const a = AUDIENCE[k];
  const data = useMemo(() => tplData(a.tpl), [a.tpl]);
  return (
    <div className="h-grid" style={{ alignItems: 'center' }}>
      <div className="stack g20 reveal">
        <span className="h-eyebrow">Made for your stage</span>
        <h2 className="h-sec-title">Who is it for?</h2>
        <div className="segmented" role="tablist" aria-label="Who it's for" style={{ alignSelf: 'flex-start', flexWrap: 'wrap' }}>
          {Object.entries(AUDIENCE).map(([id, x]) => <button key={id} type="button" role="tab" aria-selected={k === id} onClick={() => setK(id)}>{x.label}</button>)}
        </div>
        <div className="stack g12" role="tabpanel" aria-label={a.label}>
          <strong style={{ fontSize: 22, fontFamily: 'var(--font-display)' }}>{a.head}</strong>
          <ul className="stack g8" style={{ listStyle: 'none', margin: 0, padding: 0 }}>{a.tips.map((t) => <li key={t} className="row g8"><Check />{t}</li>)}</ul>
          <button type="button" className="btn btn-outline" style={{ alignSelf: 'flex-start' }} onClick={() => nav('/builder', { state: { open: 'build', template: a.tpl } })}>Start with the {TEMPLATE_PRESETS[a.tpl].name} template</button>
        </div>
      </div>
      <div className="reveal" style={{ display: 'flex', justifyContent: 'center' }}>
        <div style={{ width: 'min(400px, 100%)', borderRadius: 12, overflow: 'hidden', boxShadow: 'var(--shadow)', border: '1px solid var(--border)', background: '#fff', maxHeight: 520 }} aria-hidden="true">
          <ResumePreview loadFonts={false} key={a.tpl} data={data} design={{ ...DEFAULT_DESIGN, ...data.design }} />
        </div>
      </div>
    </div>
  );
}

/* ---------- FAQ ---------- */
const FAQ = [
  ['Is the scan really free?', 'Yes. Upload your resume, pick the role, and see your score and every issue — no sign-up, no card.'],
  ['I have no work experience. Is this for me?', 'Yes — it’s built for freshers. The scan and your expert turn projects, internships and coursework into evidence recruiters look for.'],
  ['Who are the experts?', 'Working professionals — software, data, finance, marketing, HR, design, operations and more. Each one passes a profile review and a test task before getting orders, and every order is rated.'],
  ['How fast is delivery?', `Your first draft arrives within ${PROMISES.delivery} of you answering 4 quick questions. Add Express for 24 hours.`],
  ['What if it’s late or I’m not happy?', `Late delivery means an automatic full refund. If you’re not happy, comment on each section — your expert re-does it free. Still not right? Ask for a refund; we review it within 24 hours and money reaches you in ${PROMISES.refundDays}.`],
  ['Will the expert make things up?', 'No. Experts use only what you tell them. Where a number is missing they ask you — they never invent jobs, degrees or skills.'],
  ['Is my data safe?', `Your resume is seen only by you and your assigned expert. Expert files are deleted ${PROMISES.retentionDays} days after delivery, and you can download or delete all your data from Settings.`],
  ['Can I edit the final resume myself?', 'Yes. The final opens in your own builder, with all 17 templates, PDF and Word download.'],
  ['Which payment methods work?', `UPI, cards and net banking through ${PROMISES.paymentProvider}. Prices include GST, and you get a GST invoice.`],
];
function Faq() {
  const [q, setQ] = useState('');
  const list = FAQ.filter(([a, b]) => !q.trim() || `${a} ${b}`.toLowerCase().includes(q.trim().toLowerCase()));
  return (
    <div className="stack g24" style={{ maxWidth: 860, margin: '0 auto' }}>
      <div className="row between g16 reveal" style={{ alignItems: 'flex-end' }}>
        <h2 className="h-sec-title">Questions</h2>
        <div className="field" style={{ flex: '0 1 300px' }}><label htmlFor="faq-q" className="sr-only">Search questions</label><input id="faq-q" className="input" style={{ height: 44 }} placeholder="Search — refund, delivery, data…" value={q} onChange={(e) => setQ(e.target.value)} /></div>
      </div>
      <div className="reveal" style={{ borderTop: '1px solid var(--border)' }}>
        {list.length === 0 && <p className="muted" style={{ padding: '20px 0' }}>Nothing matches — write to us from the <Link to="/contact">contact page</Link>.</p>}
        {list.map(([qq, a], i) => (
          <details key={qq} open={!!q.trim() || i === 0} style={{ borderBottom: '1px solid var(--border)', padding: '20px 0' }}>
            <summary style={{ fontWeight: 600, fontSize: 18, cursor: 'pointer' }}>{qq}</summary>
            <p className="muted" style={{ marginTop: 12, lineHeight: 1.65 }}>{a}</p>
          </details>
        ))}
      </div>
    </div>
  );
}

/* ---------- page ---------- */
export default function Home() {
  const nav = useNavigate();
  const { role, setRole, setAddon, setUpload } = useFlow();
  const location = useLocation();
  const [err, setErr] = useState(null); // { msg, at: 'top' | 'bottom' }
  const [past, setPast] = useState(false); // scrolled past the hero
  const heroRef = useRef();
  useReveal();

  useEffect(() => {
    document.title = 'Free ATS Resume Scan, Builder & Expert Rewrite | Nm7';
    const el = heroRef.current;
    if (!el || !('IntersectionObserver' in window)) return undefined;
    const io = new IntersectionObserver(([e]) => setPast(!e.isIntersecting), { threshold: 0 });
    io.observe(el);
    // FAQ rich results for Google
    const s = document.createElement('script'); s.type = 'application/ld+json'; s.id = 'faq-ld';
    s.textContent = JSON.stringify({ '@context': 'https://schema.org', '@type': 'FAQPage', mainEntity: FAQ.map(([q, a]) => ({ '@type': 'Question', name: q, acceptedAnswer: { '@type': 'Answer', text: a } })) });
    document.head.appendChild(s);
    return () => { io.disconnect(); s.remove(); };
  }, []);

  // A scan that failed (unreadable, scanned, password…) comes back here with its message.
  useEffect(() => {
    if (location.state?.scanError) { setErr({ msg: location.state.scanError, at: 'top' }); nav('/', { replace: true, state: null }); }
  }, [location.state]); // eslint-disable-line react-hooks/exhaustive-deps

  const start = (file, at = 'top') => {
    if (!file) { setErr({ msg: 'Choose a PDF or DOCX first.', at }); return; } // e.g. the file picker was closed
    if (file !== 'sample') {
      try { checkFile(file); } catch (e) { setErr({ msg: e.message, at }); return; }
    }
    setErr(null);
    setRole(role.replace(/\s+/g, ' ').trim());
    setUpload(file); // a File or 'sample' — read in the browser on the next page; nothing is uploaded
    nav('/scan');
  };
  const goPlan = (k) => { if (k === 'diy') nav('/builder'); else { setAddon(k === 'launch'); nav('/checkout'); } };
  const toTop = () => { window.scrollTo({ top: 0, behavior: reduced() ? 'auto' : 'smooth' }); setTimeout(() => document.getElementById('role')?.focus(), 400); };
  const stats = visible(STATS); const reviews = visible(REVIEWS); const experts = visible(EXPERTS);

  return (
    <>
      <Header right={<button type="button" className="btn btn-ink h-hdr-cta hide-sm" data-show={past} tabIndex={past ? 0 : -1} style={{ minHeight: 40 }} onClick={toTop}>Free scan</button>} />
      <main className="home home-pad-bottom">
        {/* 1 · hero */}
        <section className="h-hero" ref={heroRef} aria-labelledby="hero-title">
          <div className="h-wrap h-grid">
            <div className="stack g24 rise">
              <span className="h-eyebrow">Free ATS scan · freshers to 5 years</span>
              <h1 id="hero-title" className="h-title">Get your resume past the <mark>6-second skim</mark> — and the ATS.</h1>
              <p className="lead" style={{ maxWidth: 540, margin: 0, fontSize: 19 }}>See your score and every issue in seconds. Then fix it yourself in our builder, or have a verified expert from your field rewrite it in {PROMISES.delivery}.</p>
              <Upload start={(f) => start(f, 'top')} role={role} setRole={setRole} />
              {err?.at === 'top' && <span role="alert" className="error">{err.msg}</span>}
              <ul className="h-trust" aria-label="Why trust us">
                <li><Check />Verified experts</li><li><Check />{PROMISES.delivery} delivery</li><li><Check />Full refund if late</li><li><Check />{PROMISES.paymentProvider} secure</li>
              </ul>
            </div>
            <div className="rise" style={{ animationDelay: '140ms', padding: '10px 18px 30px' }}><ScanDemo /></div>
          </div>
        </section>

        {/* stats: only when there are real numbers to show (a promise alone isn't a stat) */}
        {stats.some((s) => !s.promise) && <section className="h-wrap" aria-label="In numbers" style={{ paddingBottom: 24 }}>
          <div className="h-stats reveal">
            {stats.map((s) => <div key={s.label} style={{ position: 'relative' }}>{s.placeholder && <Sample />}<strong className="display" style={{ fontSize: 34 }}>{s.value}</strong><span className="small muted">{s.label}</span></div>)}
          </div>
        </section>}

        {/* 2 · how it works */}
        <section id="how" className="h-pad" aria-labelledby="how-t">
          <div className="h-wrap stack g32">
            <div className="stack g12 reveal" style={{ maxWidth: 640 }}><span className="h-eyebrow">How it works</span><h2 id="how-t" className="h-sec-title">Scan. Fix. Apply. In one place.</h2></div>
            <div className="h-steps">
              {[
                ['Scan — free', 'Upload your resume and the role. We check what tracking systems and recruiters check: layout, keywords, results, length.', <div key="a" className="stack g8"><div className="row between small"><strong>ATS score</strong><span className="badge b-warning">54</span></div>{['Two columns', 'No numbers', 'Missing SQL'].map((t) => <span key={t} className="badge b-danger" style={{ alignSelf: 'flex-start' }}>! {t}</span>)}</div>],
                ['Fix — your way', `Use the builder with 17 templates and AI line fixes for ${inr(PLANS.diy.price)}, or let a verified expert rewrite it for ${inr(PLANS.expert.price)}.`, <div key="b" className="stack g8"><div className="row g8"><span className="chip" aria-pressed="true" style={{ minHeight: 30, fontSize: 12 }}>Builder</span><span className="chip" style={{ minHeight: 30, fontSize: 12 }}>Expert</span></div><span className="small" style={{ textDecoration: 'line-through', color: 'var(--text3)' }}>made dashboards in power bi</span><span className="small"><strong>Built 6 Power BI dashboards</strong>, cutting reporting from 5 h to 30 min</span></div>],
                ['Apply — and track it', 'Download PDF or Word, share one link that’s always up to date, and track every application from your dashboard.', <div key="c" className="stack g8">{[['Razorpay', 'Interview', 'b-success'], ['Swiggy', 'Applied', 'b-neutral'], ['Zoho', 'Applied', 'b-neutral']].map(([c, s, b]) => <div key={c} className="row between small"><span>{c}</span><span className={`badge ${b}`}>{s}</span></div>)}</div>],
              ].map(([t, d, mini], i) => (
                <article key={t} className="h-step reveal" style={{ transitionDelay: `${i * 90}ms` }}>
                  <span className="h-num" aria-hidden="true">{i + 1}</span>
                  <strong style={{ fontSize: 20, fontFamily: 'var(--font-display)' }}>{t}</strong>
                  <span className="muted">{d}</span>
                  <div className="mini" aria-hidden="true">{mini}</div>
                </article>
              ))}
            </div>
          </div>
        </section>

        {/* 3 · try it */}
        <section id="try" className="h-pad h-band" aria-label="Try it"><div className="h-wrap"><TryIt /></div></section>

        {/* 4 · templates */}
        <section id="templates" className="h-pad" aria-label="Templates"><div className="h-wrap stack g24"><Templates /></div></section>

        {/* 5 · before / after */}
        <section id="checks" className="h-pad h-band" aria-label="Before and after"><div className="h-wrap"><BeforeAfter /></div></section>

        {/* 6 · experts */}
        <section id="experts" className="h-pad" aria-labelledby="ex-t">
          <div className="h-wrap stack g32">
            <div className="row between g16 reveal" style={{ alignItems: 'flex-end' }}>
              <div className="stack g12" style={{ maxWidth: 640 }}><span className="h-eyebrow">Verified experts</span><h2 id="ex-t" className="h-sec-title">People who hire for your role — rewriting your resume.</h2></div>
              <Link to="/signup?as=expert" className="btn btn-outline">Become an expert</Link>
            </div>
            <div className="h-cards">
              {experts.map((x, i) => (
                <article key={i} className="h-card reveal" style={{ transitionDelay: `${i * 70}ms` }}>
                  {x.placeholder && <Sample />}
                  <span className="h-avatar" aria-hidden="true">{x.initials}</span>
                  <strong style={{ fontSize: 17 }}>{x.name} <span className="badge b-success" style={{ fontSize: 10, verticalAlign: 'middle' }}>✓ Verified</span></strong>
                  <span className="small">{x.role}</span>
                  <span className="xs muted">{x.years}</span>
                  <span className="row g4">{x.domains.map((d) => <span key={d} className="badge b-neutral">{d}</span>)}</span>
                  <span className="small" style={{ marginTop: 'auto' }}>★ {x.rating}</span>
                </article>
              ))}
            </div>
            <div className="row g24 reveal small muted">
              {['Profile & experience reviewed', 'Test task scored on 5 criteria', 'Every order rated by customers', 'Never contacts you outside Nm7'].map((t) => <span key={t} className="row g8"><Check />{t}</span>)}
            </div>
          </div>
        </section>

        {/* 7 · pricing */}
        <section id="plans" className="h-pad h-band" aria-label="Pricing"><div className="h-wrap stack g32" id="pricing"><Pricing goPlan={goPlan} /></div></section>

        {/* 8 · reviews */}
        {reviews.length > 0 && (
          <section id="reviews" className="h-pad" aria-labelledby="rv-t">
            <div className="h-wrap stack g32">
              <div className="stack g12 reveal" style={{ maxWidth: 640 }}><span className="h-eyebrow">What job seekers say</span><h2 id="rv-t" className="h-sec-title">Real people. Real interviews.</h2></div>
              <div className="h-cards">
                {reviews.map((r, i) => (
                  <figure key={i} className="h-card reveal" style={{ margin: 0, transitionDelay: `${i * 70}ms` }}>
                    {r.placeholder && <Sample />}
                    <span aria-label={`${r.stars} out of 5 stars`} style={{ color: 'var(--warning)', letterSpacing: 2 }}>{'★'.repeat(r.stars)}{'☆'.repeat(5 - r.stars)}</span>
                    <blockquote style={{ margin: 0, fontSize: 17, lineHeight: 1.55 }}>“{r.text}”</blockquote>
                    <figcaption className="small muted" style={{ marginTop: 'auto' }}><strong style={{ color: 'var(--text)' }}>{r.name}</strong> · {r.role} · {r.city}</figcaption>
                  </figure>
                ))}
              </div>
            </div>
          </section>
        )}

        {/* 9 · who it's for */}
        <section id="who" className="h-pad h-band" aria-label="Who it's for"><div className="h-wrap"><Audiences /></div></section>

        {/* 10 · FAQ */}
        <section id="faq" className="h-pad" aria-label="Questions"><div className="h-wrap"><Faq /></div></section>

        {/* 11 · final CTA */}
        <section className="h-dark h-pad" aria-labelledby="cta-t">
          <div className="h-wrap h-grid">
            <div className="stack g16 reveal">
              <h2 id="cta-t" className="h-sec-title" style={{ color: '#F7F6F2' }}>Your next interview starts with a better resume.</h2>
              <p className="lead" style={{ margin: 0 }}>Free scan in seconds. Fix it today. Apply with confidence.</p>
              <span className="small muted">Are you a recruiter, hiring manager or career coach? <Link to="/signup?as=expert" style={{ color: 'var(--signal)' }}>Earn as an expert →</Link></span>
            </div>
            <div className="reveal"><Upload start={(f) => start(f, 'bottom')} role={role} setRole={setRole} compact />{err?.at === 'bottom' && <span role="alert" className="error">{err.msg}</span>}</div>
          </div>
        </section>
      </main>

      {/* phones: sticky free-scan bar after the hero */}
      <div className="h-mbar" data-show={past}>
        <button type="button" className="btn btn-ink btn-lg" style={{ flex: 1, boxShadow: 'var(--shadow)' }} onClick={toTop}>Free resume scan</button>
        <button type="button" className="btn btn-lg" style={{ background: 'var(--surface)', boxShadow: 'var(--shadow)' }} onClick={() => document.getElementById('plans')?.scrollIntoView({ behavior: reduced() ? 'auto' : 'smooth' })}>Plans</button>
      </div>
      <SiteFooter />
    </>
  );
}
