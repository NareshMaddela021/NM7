import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import Header from '../components/Header';
import { Dialog, Icon, Meter, useToast } from '../components/ui';
import { getMatchedJobs, saveProfile } from '../services/api';
import { PLANS, inr } from '../lib/pricing';
import { syncFromBuilder, defaultResume, useMe, activeResume } from '../lib/customerStore';
import { draftKey, currentUser, LIVE } from '../lib/auth';
import { applyImport } from '../lib/import/apply';
import { emptyResult } from '../lib/import/shared';

/** The built-in sample person (shown to guests until they add their own details). */
const isSampleDraft = (d) => d.personal?.name === INITIAL.personal.name && d.personal?.email === INITIAL.personal.email;
import ResumePreview from './builder/ResumePreview';
import { buildResumePdf, savePdf } from './builder/resumePdf';
import { FieldGrid, LinkFields, SchemaField } from './builder/Fields';
import DesignPanel from './builder/DesignPanel';
import Import from './builder/Import';
import TemplatePicker, { layoutOf } from './builder/TemplatePicker';
import CoverPanel from './builder/CoverPanel';
import { buildDocx } from './builder/resumeDocx';
import { shorten, atsFriendly } from './builder/aiTools';
import LinksEditor, { Logo } from './builder/LinksEditor';
import PhotoEditor, { DEFAULT_ADJ, shapePhoto } from './builder/PhotoEditor';
import { DEFAULT_DESIGN, FIT_STEPS, TEMPLATE_PRESETS } from './builder/design';
import {
  AI_SAMPLES, ALL_SKILLS, FIXED_SECTIONS, INITIAL, LINK_FIELDS, LISTS, PERSONAL_FIELDS, PINFO_FIELDS, DECL_FIELDS, DECL_TEXT,
  HOBBY_IDEAS, STRENGTH_IDEAS, splitList, SECTION_LAYOUTS, PREF_FIELDS, PRESET_SECTIONS, completeness, DEFAULT_SKILL_GROUPS, SKILL_GROUP_OF, splitSkills, allSkills,
  PRINTABLE, resolveOrder, sectionLabel, fieldError, dateOrderError, collectIssues, LINK_SLOTS, LINK_WORDS, LINK_WORD_MAX, migrateLinks,
} from './builder/schema';

const DRAFT_KEY = () => draftKey(); // per signed-in customer (see lib/auth.js)
const STYLES_KEY = 'asuraa-saved-styles';
const loadStyles = () => { try { return JSON.parse(localStorage.getItem(STYLES_KEY) || '[]'); } catch { return []; } };
const nextFrame = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(r, 40))));
/** Live app, signed-in customer: the resume lives on the server (My resumes → the active one), not in this browser. */
const serverCustomer = () => LIVE && currentUser()?.role === 'customer';
const loadDraft = (key = DRAFT_KEY(), initial = defaultResume()) => {
  if (serverCustomer() && key === DRAFT_KEY()) return migrateLinks({ ...INITIAL, ...initial });
  try {
    let s = localStorage.getItem(key);
    // drafts still holding the old sample person get the new sample name
    if (s && s.includes('"Priya Raman"')) s = s.replace(/Priya Raman/g, 'Sai Varsha').replace(/PRIYA RAMAN/g, 'SAI VARSHA').replace(/priyaraman/g, 'saivarsha').replace(/priya@example/g, 'saivarsha@example');
    if (s) return migrateLinks({ ...INITIAL, ...JSON.parse(s) });
  } catch { /* ignore */ }
  return migrateLinks({ ...INITIAL, ...initial });
};

function ProfileOnly() {
  return <span className="badge b-neutral" style={{ fontSize: 11 }}>Profile only · not printed</span>;
}

/* ---------- Start & template screens ---------- */
function Start({ onNext }) {
  const opts = [
    ['scratch', 'Start from scratch', 'Guided, one section at a time.', true],
    ['linkedin', 'Import LinkedIn', 'Upload your LinkedIn profile PDF. We fill every section we can, and you check it before saving.'],
    ['resume', 'Rebuild my old resume', 'Upload a PDF or Word resume in any layout. We sort it into clean sections and point out what to fix.'],
  ];
  return (
    <main className="container stack g32 rise" style={{ maxWidth: 1100, padding: '72px 24px' }}>
      <div className="stack g12" style={{ maxWidth: 720 }}>
        <h1 className="display h1" style={{ fontSize: 'clamp(36px,5vw,60px)' }}>Build a resume recruiters <span className="hl" style={{ padding: '0 4px' }}>actually read.</span></h1>
        <p className="lead">12 guided sections, plus any section you want to add. Your Nm7 profile and your resume are built together.</p>
      </div>
      <div className="grid-auto g16">
        {opts.map(([k, t, d, rec]) => (
          <button key={t} type="button" className="card stack g8 btn" onClick={() => onNext(k)} style={{ textAlign: 'left', alignItems: 'flex-start', whiteSpace: 'normal', height: 'auto', padding: 24, border: rec ? '2px solid var(--ink)' : undefined }}>
            {rec && <span className="badge b-signal">Recommended</span>}
            <strong className="display" style={{ fontSize: 22 }}>{t}</strong>
            <span className="muted" style={{ fontWeight: 400 }}>{d}</span>
          </button>
        ))}
      </div>
    </main>
  );
}

/* ---------- Done ---------- */
function Done({ name, score, onEdit, onDownload, onCover, pdfBusy }) {
  const [jobs, setJobs] = useState([]);
  useEffect(() => { getMatchedJobs().then(setJobs); }, []);
  return (
    <main className="container row g48 rise" style={{ maxWidth: 1100, padding: '64px 24px', alignItems: 'center' }}>
      <div className="stack g20" style={{ flex: '1 1 420px' }}>
        <span className="mono" style={{ color: 'var(--success)', fontSize: 13 }}>PROFILE {score}% · RESUME READY</span>
        <h1 className="display" style={{ fontSize: 48 }}>Nice work, {(name || 'there').split(' ')[0]}. Recruiters can now find you.</h1>
        <p className="lead">Your Nm7 profile is live and your resume is ready to download.</p>
        <div className="stack g8" style={{ maxWidth: 420 }}>
          <button type="button" className="btn btn-ink btn-xl" onClick={() => onDownload('pdf')} disabled={pdfBusy}>{pdfBusy ? 'Preparing…' : `Download PDF · ${inr(PLANS.diy.price)}`}</button>
          <button type="button" className="btn btn-outline btn-lg" onClick={() => onDownload('docx')} disabled={pdfBusy}>Also download as Word (.docx)</button>
          <button type="button" className="btn btn-outline btn-lg" onClick={onCover}>Write a matching cover letter</button>
          <span className="xs faint">In the live app this runs after the {inr(PLANS.diy.price)} payment. In this preview it downloads straight away.</span>
          <Link to="/" className="btn btn-outline btn-lg">Scan it against a job · free</Link>
          <button type="button" className="btn btn-ghost" onClick={onEdit}>Keep editing</button>
        </div>
      </div>
      <div className="card stack g12" style={{ flex: '1 1 360px' }}>
        <strong>Matched jobs on Nm7</strong>
        {jobs.length === 0 && [0, 1, 2].map((i) => <div key={i} className="shimmer" style={{ height: 60 }} />)}
        {jobs.map((j) => (
          <div key={j.id} className="row between g12 well">
            <span className="stack"><strong className="small">{j.title}</strong><span className="xs muted">{j.meta}</span></span>
            <a href="https://nm7.si" className="btn btn-ink" style={{ minHeight: 40 }}>Apply</a>
          </div>
        ))}
      </div>
    </main>
  );
}

/* ---------- Main builder ---------- */
/**
 * embedded (optional) — used by the expert workspace:
 *   { storageKey, initial, onChange(d), replace: { n, data }, focus: { n, id } }
 * Embedded mode skips the start/template screens, the header and the job-preference step.
 */
export default function Builder({ embedded = null }) {
  const toast = useToast();
  const location = useLocation();
  const [stage, setStage] = useState(embedded || location.state?.open === 'build' ? 'build' : 'start');
  const [importMode, setImportMode] = useState('resume');
  const [suggest, setSuggest] = useState(null);
  const [d, setD] = useState(() => (embedded ? loadDraft(embedded.storageKey, embedded.initial) : loadDraft(DRAFT_KEY(), serverCustomer() ? (activeResume()?.data || defaultResume()) : defaultResume())));
  // Live customer: when their resumes arrive from the server, open the active one (unless a scan import is opening).
  const me = useMe();
  const fromServer = useRef(!serverCustomer() || !me.loading);
  useEffect(() => {
    if (embedded || fromServer.current || me.loading) return;
    fromServer.current = true;
    const a = activeResume(me);
    if (a && !location.state?.scanImport) setD(migrateLinks({ ...INITIAL, ...a.data }));
  }, [me.loading]); // eslint-disable-line react-hooks/exhaustive-deps
  const [sec, setSec] = useState('personal');
  const [picker, setPicker] = useState(false);
  const [customName, setCustomName] = useState('');
  const [photo, setPhoto] = useState(null); // the adjusted 600×600 photo
  const [photoOrig, setPhotoOrig] = useState(null); // the original, so it can be re-cropped
  const [photoAdj, setPhotoAdj] = useState(DEFAULT_ADJ);
  const [editingPhoto, setEditingPhoto] = useState(null); // source being edited
  const [photoErr, setPhotoErr] = useState('');
  const [saved, setSaved] = useState(true);
  const [pages, setPages] = useState(1);
  const [showIssues, setShowIssues] = useState(false);
  const [pdfBusy, setPdfBusy] = useState(false);
  const [tab, setTab] = useState('content');
  const [fitting, setFitting] = useState(false);
  const [past, setPast] = useState([]);
  const [future, setFuture] = useState([]);
  const [savedStyles, setSavedStyles] = useState(loadStyles);
  const pagesRef = useRef(1);
  const lastEdit = useRef({ key: '', t: 0 });
  const editorTop = useRef();

  /* ---------- design ---------- */
  const ds = { ...DEFAULT_DESIGN, ...(d.design || TEMPLATE_PRESETS.fresher.design), preset: d.design?.preset ?? 'fresher' };
  const commitDesign = (next, key = '') => {
    // group rapid changes to the same control (slider drags) into one undo step
    const now = Date.now();
    const merge = key && lastEdit.current.key === key && now - lastEdit.current.t < 700;
    lastEdit.current = { key, t: now };
    if (!merge) { setPast((p) => [...p.slice(-49), ds]); setFuture([]); }
    setD((p) => ({ ...p, design: next }));
  };
  const setDesign = (patch) => commitDesign({ ...ds, ...patch, preset: ds.preset === 'custom' ? 'custom' : ds.preset }, Object.keys(patch).join());
  const applyPreset = (k, patch = {}) => commitDesign({ ...TEMPLATE_PRESETS[k].design, ...patch, preset: k });
  // Picking a template also brings its section layout (e.g. Kio) — only when the layout actually changes,
  // so switching between look-only templates keeps your own section order and on/off choices.
  const applyTemplate = (k, patch = {}) => {
    const from = layoutOf(ds.preset);
    const to = layoutOf(k);
    const snapshot = d;
    applyPreset(k, patch);
    if (from !== to) {
      setD((p) => ({ ...p, order: to.order, hidden: { ...to.hidden }, titles: { ...to.titles }, showPhoto: to.showPhoto }));
      if (stage === 'build') toast(`${TEMPLATE_PRESETS[k].name} applied — sections rearranged`, () => setD(snapshot));
    }
  };
  const history = {
    canUndo: past.length > 0, canRedo: future.length > 0,
    undo: () => { if (!past.length) return; setFuture((f) => [ds, ...f]); setD((p) => ({ ...p, design: past[past.length - 1] })); setPast((p) => p.slice(0, -1)); },
    redo: () => { if (!future.length) return; setPast((p) => [...p, ds]); setD((p) => ({ ...p, design: future[0] })); setFuture((f) => f.slice(1)); },
  };
  const onPages = useMemo(() => (n) => { pagesRef.current = n; setPages(n); }, []);
  const fit = async () => {
    setFitting(true);
    let cur = ds;
    for (const step of FIT_STEPS) {
      if (pagesRef.current <= 1) break;
      cur = { ...cur, ...step(cur) };
      setD((p) => ({ ...p, design: cur }));
      await nextFrame();
    }
    setPast((p) => [...p, ds]); setFuture([]);
    setFitting(false);
    toast(pagesRef.current <= 1 ? 'Fits on one page now' : 'Still over one page — try hiding a section or trimming bullets', () => setD((p) => ({ ...p, design: ds })));
  };
  const persistStyles = (list) => { setSavedStyles(list); try { localStorage.setItem(STYLES_KEY, JSON.stringify(list)); } catch { /* ignore */ } };
  const saveStyle = (name) => { persistStyles([...savedStyles, { name, design: { ...ds, preset: 'custom' } }]); toast(`Saved “${name}”`); };
  const applySaved = (i) => commitDesign({ ...savedStyles[i].design });
  const deleteSaved = (i) => persistStyles(savedStyles.filter((_, j) => j !== i));
  const setTitle = (id, v) => setD((p) => ({ ...p, titles: { ...p.titles, [id]: v } }));

  // Opened from the home page with a template picked: apply it once.
  useEffect(() => { const k = location.state?.template; if (!embedded && k && TEMPLATE_PRESETS[k]) { applyTemplate(k); toast(`${TEMPLATE_PRESETS[k].name} template applied`); } }, []); // eslint-disable-line react-hooks/exhaustive-deps
  // From the scan report ("keep fixing it myself"): load the scanned resume, or start empty instead of the sample.
  useEffect(() => {
    const st = location.state;
    if (embedded || !st || (!st.scanImport && !st.blank)) return;
    const snapshot = d;
    if (st.scanImport) {
      setD(applyImport(d, st.scanImport, 'replace'));
      toast(`Loaded ${st.fileName || 'your resume'} — check each section`, () => setD(snapshot));
    } else if (isSampleDraft(d)) {
      setD(applyImport(d, emptyResult('blank').data, 'replace'));
    }
    window.history.replaceState({ ...window.history.state, usr: null }, ''); // a refresh shouldn't load it again
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Autosave: browser draft immediately, server (debounced).
  useEffect(() => {
    if (embedded || !serverCustomer()) { try { localStorage.setItem(embedded?.storageKey || DRAFT_KEY(), JSON.stringify(d)); } catch { /* ignore */ } }
    if (embedded) { embedded.onChange?.(d); return undefined; }
    setSaved(false);
    const t = setTimeout(() => { syncFromBuilder(d); saveProfile(d).then(() => setSaved(true)); }, 800);
    return () => clearTimeout(t);
  }, [d]); // eslint-disable-line react-hooks/exhaustive-deps
  // workspace controls: replace the whole resume (restore a version / reset), or jump to a section
  useEffect(() => { if (embedded?.replace?.n) setD(migrateLinks({ ...INITIAL, ...embedded.replace.data })); }, [embedded?.replace?.n]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (embedded?.focus?.n) { setTab('content'); setSec(embedded.focus.id); } }, [embedded?.focus?.n]); // eslint-disable-line react-hooks/exhaustive-deps

  // Steps follow the resume order, so moving a section moves its step too.
  const SECS = useMemo(() => {
    const fixed = Object.fromEntries(FIXED_SECTIONS.map((x) => [x.id, x]));
    const printed = resolveOrder(d).map((id) => {
      const c = d.custom.find((x) => x.id === id);
      return c ? { id, label: c.title, help: 'Add as many entries as you like. Leave any field blank.', custom: true } : fixed[id];
    });
    return [fixed.personal, ...printed, ...(embedded ? [] : [fixed.prefs]), fixed.links, { id: 'review', label: 'Review & Submit', help: 'Check each section, set the order and fix anything flagged.' }];
  }, [d]);
  const idx = Math.max(0, SECS.findIndex((s) => s.id === sec));
  const cur = SECS[idx];
  const { has, score } = completeness(d);
  const fresher = (d.personal.level || '').startsWith('Fresher');
  const go = (id) => { setSec(id); editorTop.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }); };

  /* data helpers */
  const getList = (k) => (k.startsWith('c_') ? d.custom.find((c) => c.id === k)?.items || [] : d[k]);
  const setList = (k, arr) => setD((p) => (k.startsWith('c_') ? { ...p, custom: p.custom.map((c) => (c.id === k ? { ...c, items: arr } : c)) } : { ...p, [k]: arr }));
  const setItem = (k, i, key, v) => { const a = getList(k).slice(); a[i] = { ...a[i], [key]: v }; setList(k, a); };
  const setObj = (k, key, v) => setD((p) => ({ ...p, [k]: { ...p[k], [key]: v } }));
  const withUndo = (msg) => { const snapshot = d; toast(msg, () => setD(snapshot)); };

  const addSection = (title) => {
    const id = `c_${Date.now()}`;
    setD((p) => ({ ...p, custom: [...p.custom, { id, title, items: [{ ...LISTS.custom.blank }] }] }));
    setPicker(false); setCustomName(''); setSec(id);
  };
  const removeSection = () => {
    withUndo(`“${cur.label}” deleted`);
    setD((p) => ({ ...p, custom: p.custom.filter((c) => c.id !== cur.id) }));
    setSec(SECS[Math.max(0, idx - 1)].id);
  };
  const addSkill = (k) => setD((p) => {
    const target = SKILL_GROUP_OF[k] || 'core';
    let groups = p.skillGroups;
    if (!groups.some((g) => g.id === target)) groups = [...groups, { ...DEFAULT_SKILL_GROUPS.find((g) => g.id === target), value: '' }];
    return { ...p, skillGroups: groups.map((g) => (g.id === target ? { ...g, value: [...splitSkills(g.value), k].join(', ') } : g)) };
  });
  const pickPhoto = (e) => {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (!f) return undefined;
    if (!/^image\/(jpeg|png|webp)$/.test(f.type)) return setPhotoErr('Please choose a JPG, PNG or WebP photo.');
    if (f.size > 5 * 1024 * 1024) return setPhotoErr('That photo is over 5 MB. Try a smaller one.');
    setPhotoErr('');
    const r = new FileReader();
    r.onload = () => { setEditingPhoto({ src: r.result, fresh: true }); }; // open the editor straight away
    r.readAsDataURL(f);
    return undefined;
  };
  const savePhoto = (out, adj) => {
    if (editingPhoto?.fresh) setPhotoOrig(editingPhoto.src);
    setPhoto(out); setPhotoAdj(adj); setEditingPhoto(null);
    toast('Photo saved');
  };
  const removePhoto = () => { setPhoto(null); setPhotoOrig(null); setPhotoAdj(DEFAULT_ADJ); };
  const download = async (format = 'pdf', what = tab === 'cover' ? 'cover' : 'resume') => {
    setPdfBusy(true);
    try {
      const cover = what === 'cover' ? (d.cover || {}) : undefined;
      const photoPng = format === 'docx' && d.showPhoto && photo && !cover ? await shapePhoto(photo, ds.photoShape || 'circle') : null;
      const blob = format === 'docx' ? await buildDocx({ data: d, design: ds, cover, photoPng }) : await buildResumePdf({ data: d, design: ds, photo, cover });
      const name = `${(d.personal.name || 'Resume').trim().replace(/\s+/g, '_')}_${cover ? 'Cover_Letter' : 'Resume'}.${format}`;
      await savePdf(blob, name);
      toast(`${cover ? 'Cover letter' : 'Resume'} ${format === 'docx' ? 'Word file' : 'PDF'} ready`);
    } catch (e) {
      if (e?.code !== 'declined') toast(e?.code === 'unavailable' ? 'Downloads aren’t available in this view.' : 'Couldn’t create the PDF. Please try again.');
    } finally { setPdfBusy(false); }
  };
  const issues = collectIssues(d);
  const order = resolveOrder(d);
  const moveSection = (id, dir) => {
    const o = [...order];
    const i = o.indexOf(id);
    const j = i + dir;
    if (j < 0 || j >= o.length) return;
    [o[i], o[j]] = [o[j], o[i]];
    setD((p) => ({ ...p, order: o }));
  };
  const toggleHidden = (id) => setD((p) => ({ ...p, hidden: { ...p.hidden, [id]: !p.hidden?.[id] } }));
  const errorFor = (k, obj, f) => {
    if (['email', 'tel', 'url'].includes(f.type)) return fieldError(f.type, obj[f.key]);
    const pairs = { exp: ['from', 'to', 'current'], edu: ['from', 'to', null], proj: ['from', 'to', 'ongoing'], certs: ['issueDate', 'expiryDate', 'noExpiry'] };
    const p = pairs[k];
    if (p && f.key === p[1]) return dateOrderError(obj[p[0]], obj[p[1]], p[2] && obj[p[2]]);
    return '';
  };

  const listEditor = (k, schema) => {
    const list = getList(k);
    return (
      <div className="stack g12">
        {list.map((obj, i) => (
          <div key={i} className="card stack g16 rise" style={{ padding: 20 }}>
            <div className="row between g8">
              <strong>{schema.item} {i + 1}</strong>
              {(list.length > 1 || k.startsWith('c_')) && (
                <button type="button" className="btn btn-danger-soft" aria-label={`Remove ${schema.item} ${i + 1}`} onClick={() => { withUndo(`${schema.item} ${i + 1} removed`); setList(k, list.filter((_, j) => j !== i)); }}>Remove</button>
              )}
            </div>
            <FieldGrid>
              {schema.fields.map((f, fi) => {
                const kind = k.startsWith('c_') ? 'custom' : k;
                const field = (
                  <SchemaField key={f.key} field={f} idBase={`${k}-${i}`} value={obj[f.key]} disabled={f.disabledBy ? !!obj[f.disabledBy] : false}
                    error={errorFor(k, obj, f)} onChange={(v) => setItem(k, i, f.key, v)} onAi={(kind) => { const v = kind === 'shorten' ? shorten(obj[f.key]) : kind === 'ats' ? atsFriendly(obj[f.key]) : AI_SAMPLES[f.ai]; withUndo(kind === 'rewrite' ? 'Sample rewrite added (AI in the live app)' : kind === 'shorten' ? 'Bullets shortened' : 'Made ATS-friendly'); setItem(k, i, f.key, v); }} />
                );
                // the link + clickable word sits right after the title field
                const titleIdx = kind === 'exp' ? 1 : 0;
                if (!LINK_SLOTS[kind] || fi !== titleIdx) return field;
                return [field, <LinkFields key="links" idBase={`${k}-${i}`} links={obj.links} slots={LINK_SLOTS[kind]} words={LINK_WORDS[kind]} max={LINK_WORD_MAX}
                  error={(u) => fieldError('url', u)} onChange={(v) => setItem(k, i, 'links', v)} />];
              })}
            </FieldGrid>
          </div>
        ))}
        <button type="button" className="btn btn-outline btn-lg" style={{ borderStyle: 'dashed' }} onClick={() => setList(k, [...list, { ...schema.blank }])}>+ Add another {schema.item.toLowerCase()}</button>
      </div>
    );
  };
  const objEditor = (k, fields) => (
    <div className="card" style={{ padding: 20 }}>
      <FieldGrid>{fields.map((f) => <SchemaField key={f.key} field={f} idBase={k} value={d[k][f.key]} error={errorFor(k, d[k], f)} onChange={(v) => setObj(k, f.key, v)} />)}</FieldGrid>
    </div>
  );

  const summaryOptions = [
    [`Data analyst fresher who turns raw sales data into dashboards teams actually use. Skilled in ${allSkills(d.skillGroups).slice(0, 3).join(', ')}. Cut a sales team’s weekly reporting from 5 hours to 30 minutes during my internship. Looking for a Data Analyst role in a product-led team.`, 'Role-first · recommended'],
    [`${d.edu[0]?.degree || 'Graduate'} ${d.edu[0]?.field || ''} graduate with a 6-month analytics internship and hands-on ${allSkills(d.skillGroups).slice(0, 2).join(' and ')} projects. Looking for an entry-level analyst role.`, 'Education-first'],
    ['Analytical problem-solver who learns tools fast and ships useful dashboards. Google Data Analytics certified. Seeking a junior analyst role in fintech or e-commerce.', 'Strengths-first'],
  ];
  const sumLen = d.summary.length;

  const STAGES = ['start', 'templates', 'build', 'done'];
  const stageIdx = stage === 'import' ? 0 : STAGES.indexOf(stage);

  return (
    <>
      {!embedded && <Header variant="builder" right={stage === 'build' && <span className="xs faint" aria-live="polite">{saved ? 'All changes saved' : 'Saving…'}</span>} />}
      {!embedded && (
        <ol className="steps container-wide" aria-label="Builder steps" style={{ padding: '12px 24px 0' }}>
          {['Start', 'Template', 'Build', 'Done'].map((l, i) => (
            <li key={l} aria-current={i === stageIdx ? 'step' : undefined} data-state={i < stageIdx ? 'done' : undefined}><span className="mono">{i < stageIdx ? '✓' : i + 1}</span>{l}</li>
          ))}
        </ol>
      )}

      {stage === 'start' && <Start onNext={(k) => { if (k === 'scratch') setStage('templates'); else { setImportMode(k); setStage('import'); } }} />}
      {stage === 'import' && (
        <Import mode={importMode} d={d} onBack={() => setStage('start')} onDone={(nd, sug) => {
          // start from the suggested template; Kio brings its section order (empty sections simply don't print)
          const preset = TEMPLATE_PRESETS[sug] ? sug : 'fresher';
          const layout = layoutOf(preset);
          // the template's layout, but never hide a section the file actually had
          const has = { ...completeness(nd).has, decl: nd.hidden?.decl === false, pinfo: nd.hidden?.pinfo === false };
          const keep = (h) => Object.fromEntries(Object.entries(h).filter(([id]) => !has[id]));
          setD({ ...nd, design: { ...TEMPLATE_PRESETS[preset].design, preset }, order: layout.order, hidden: { ...keep(layout.hidden), ...Object.fromEntries(Object.entries(nd.hidden || {}).filter(([id, v]) => v && !has[id])) }, titles: { ...layout.titles }, showPhoto: layout.showPhoto });
          setPast([]); setFuture([]);
          setSuggest(preset); setSec('personal'); setStage('templates');
          toast('Details added — pick a look, then check each section');
        }} />
      )}
      {stage === 'templates' && <TemplatePicker d={d} ds={ds} suggest={suggest} photo={photo} onPick={applyTemplate} onNext={() => setStage('build')} />}
      {stage === 'done' && <Done name={d.personal.name} score={score} onEdit={() => setStage('build')} onDownload={(f) => download(f, 'resume')} onCover={() => { setTab('cover'); setStage('build'); }} pdfBusy={pdfBusy} />}

      {stage === 'build' && (
        <main className={embedded ? 'row g24' : 'container-wide row g24'} style={{ padding: embedded ? '4px 0 32px' : '20px 24px 64px', alignItems: 'flex-start' }}>
          {/* Section nav */}
          <nav aria-label="Sections" className="stack" style={{ flex: '1 1 210px', maxWidth: 250, gap: 2 }}>
            <div className="card-sm stack g8" style={{ marginBottom: 10 }}>
              <div className="row between" style={{ alignItems: 'baseline' }}><span className="xs muted">Profile strength</span><span aria-live="polite" className="display" style={{ fontSize: 28 }}>{score}%</span></div>
              <Meter value={score} color={score >= 80 ? 'var(--success)' : score >= 55 ? 'var(--warning)' : 'var(--text3)'} label="Profile strength" />
              <span className="xs faint">{score >= 80 ? 'Excellent — recruiter-ready' : score >= 60 ? 'Good — a few more details help' : 'Keep going'}</span>
            </div>
            {SECS.map((s) => {
              const a = s.id === cur.id && tab === 'content';
              const ok = !!has[s.id];
              const count = Array.isArray(d[s.id]) ? d[s.id].length : null;
              const printable = order.includes(s.id);
              const hidden = !!d.hidden?.[s.id];
              const oi = order.indexOf(s.id);
              const label = sectionLabel(d, s.id) && printable ? sectionLabel(d, s.id) : s.label;
              return (
                <div key={s.id} className="row" style={{ flexWrap: 'nowrap', borderRadius: 10, background: a ? 'var(--surface)' : 'transparent', opacity: hidden ? 0.6 : 1 }}>
                  <button type="button" onClick={() => { setTab('content'); go(s.id); }} aria-current={a ? 'step' : undefined} className="row g8"
                    style={{ flex: 1, minWidth: 0, flexWrap: 'nowrap', minHeight: 40, padding: '0 8px 0 10px', border: 0, background: 'transparent', color: a || ok ? 'var(--text)' : 'var(--text2)', fontWeight: a ? 600 : 500, fontSize: 14, textAlign: 'left' }}>
                    <span style={{ width: 20, height: 20, flex: 'none', borderRadius: '50%', boxSizing: 'border-box', border: `2px solid ${ok ? 'var(--success)' : a ? 'var(--ink)' : 'var(--border2)'}`, background: ok ? 'var(--success)' : 'transparent', color: 'var(--onink)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>{ok && <Icon name="check" size={11} stroke={3} />}</span>
                    <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', textDecoration: hidden ? 'line-through' : 'none' }}>{label}</span>
                    {!printable && count !== null && <span className="mono faint">{count}</span>}
                  </button>
                  {printable && (
                    <span className="row" style={{ flexWrap: 'nowrap', gap: 0 }}>
                      <button type="button" className="nav-ctl" aria-label={`Move ${label} up`} disabled={oi === 0} onClick={() => moveSection(s.id, -1)}>↑</button>
                      <button type="button" className="nav-ctl" aria-label={`Move ${label} down`} disabled={oi === order.length - 1} onClick={() => moveSection(s.id, 1)}>↓</button>
                      <button type="button" role="switch" aria-checked={!hidden} aria-label={`Show ${label} on resume`} className="nav-ctl" onClick={() => toggleHidden(s.id)}>
                        <span aria-hidden="true" style={{ width: 26, height: 15, borderRadius: 999, background: hidden ? 'var(--border2)' : 'var(--success)', position: 'relative', display: 'block' }}>
                          <span style={{ position: 'absolute', top: 2, left: hidden ? 2 : 13, width: 11, height: 11, borderRadius: '50%', background: 'var(--surface)', transition: 'left 160ms var(--ease)' }} />
                        </span>
                      </button>
                    </span>
                  )}
                </div>
              );
            })}
            <button type="button" className="btn btn-outline" style={{ marginTop: 8, borderStyle: 'dashed' }} onClick={() => setPicker(true)}>+ Add a section</button>
          </nav>

          {/* Editor */}
          <section ref={editorTop} aria-label="Section editor" className="stack g16" style={{ flex: '2 1 440px', minWidth: 0, scrollMarginTop: 90 }}>
            <div className="segmented" role="tablist" aria-label="Builder mode" style={{ alignSelf: 'flex-start' }}>
              <button type="button" role="tab" aria-selected={tab === 'content'} onClick={() => setTab('content')}>Content</button>
              <button type="button" role="tab" aria-selected={tab === 'design'} onClick={() => setTab('design')}>Design · fonts, colours, layout</button>
              <button type="button" role="tab" aria-selected={tab === 'cover'} onClick={() => setTab('cover')}>Cover letter</button>
            </div>
            {tab === 'cover' ? (
              <CoverPanel d={d} setCover={(cover) => setD((p) => ({ ...p, cover }))} onAddSkill={(k) => { addSkill(k); toast(`Added “${k}” to your skills`); }} />
            ) : tab === 'design' ? (
              <DesignPanel d={d} ds={ds} set={setDesign} applyPreset={applyTemplate} setTitle={setTitle} fit={fit} fitting={fitting} pages={pages}
                history={history} savedStyles={savedStyles} saveStyle={saveStyle} applySaved={applySaved} deleteSaved={deleteSaved}
                reset={() => applyPreset(ds.preset && TEMPLATE_PRESETS[ds.preset] ? ds.preset : 'fresher')} />
            ) : (<>
            <div className="row between g12" style={{ alignItems: 'flex-end' }}>
              <div className="stack g4"><span className="mono faint">SECTION {idx + 1} OF {SECS.length}</span><h2 style={{ fontSize: 28 }}>{cur.label}</h2></div>
              <div className="row g8">
                {(PRINTABLE[cur.id] || cur.custom) && (
                  <button type="button" role="switch" aria-checked={!d.hidden?.[cur.id]} onClick={() => toggleHidden(cur.id)} className="btn btn-outline" style={{ paddingLeft: 8 }}>
                    <span aria-hidden="true" style={{ width: 34, height: 20, borderRadius: 999, background: d.hidden?.[cur.id] ? 'var(--border2)' : 'var(--success)', position: 'relative', transition: 'background-color 200ms' }}>
                      <span style={{ position: 'absolute', top: 2, left: d.hidden?.[cur.id] ? 2 : 16, width: 16, height: 16, borderRadius: '50%', background: 'var(--surface)', transition: 'left 200ms var(--ease)' }} />
                    </span>
                    Show on resume
                  </button>
                )}
                {cur.custom && <button type="button" className="btn btn-outline" style={{ color: 'var(--danger)' }} onClick={removeSection}>Delete section</button>}
              </div>
            </div>
            {d.hidden?.[cur.id] && <p className="well small muted">This section is hidden from your resume. It stays saved on your profile.</p>}
            <p className="muted" style={{ lineHeight: 1.55 }}>{cur.help}</p>
            {cur.fresherTip && fresher && <p className="well small muted">{cur.fresherTip}</p>}

            {cur.id === 'personal' && (
              <>
                {objEditor('personal', PERSONAL_FIELDS)}
                <div className="row g8"><strong>Profile photo</strong>{d.showPhoto ? <span className="badge b-signal" style={{ fontSize: 11 }}>Also on resume</span> : <ProfileOnly />}</div>
                <div className="card row g20" style={{ padding: 20 }}>
                  <div style={{ width: 80, height: 80, flex: 'none', borderRadius: ds.photoShape === 'square' ? 4 : ds.photoShape === 'rounded' ? 14 : '50%', overflow: 'hidden', background: 'var(--ink)', color: 'var(--onink)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 30 }}>
                    {photo ? <img src={photo} alt="Your profile photo" style={{ width: 80, height: 80, objectFit: 'cover' }} /> : <span aria-hidden="true">{(d.personal.name || '?')[0].toUpperCase()}</span>}
                  </div>
                  <div className="stack g8" style={{ flex: '1 1 220px' }}>
                    <span className="small muted">Shown to recruiters on your Nm7 profile. A clear, front-facing photo works best. JPG, PNG or WebP, up to 5 MB — you can crop and adjust it next.</span>
                    <div className="row g8">
                      <label className="btn btn-outline" style={{ cursor: 'pointer' }}>{photo ? 'Change photo' : 'Choose photo'}<input type="file" accept="image/png,image/jpeg,image/webp" className="sr-only" onChange={pickPhoto} /></label>
                      {photo && photoOrig && <button type="button" className="btn btn-outline" onClick={() => setEditingPhoto({ src: photoOrig, fresh: false })}>Adjust photo</button>}
                      {photo && <button type="button" className="btn btn-ghost" style={{ color: 'var(--danger)' }} onClick={removePhoto}>Remove</button>}
                    </div>
                    {photoErr && <span role="alert" className="error">{photoErr}</span>}
                    <label className="check small" style={{ minHeight: 36 }}><input type="checkbox" checked={!!d.showPhoto} onChange={(e) => setD({ ...d, showPhoto: e.target.checked })} />Show my photo on the resume too</label>
                    {d.showPhoto && !photo && <span className="xs faint">Choose a photo above to see it on the resume.</span>}
                    {d.showPhoto && photo && <button type="button" className="link-btn xs" style={{ alignSelf: 'flex-start', minHeight: 28 }} onClick={() => setTab('design')}>Shape, size, position and border → Design tab › Photo</button>}
                    <span className="xs faint">Most Indian tech and MNC recruiters prefer no photo. Some roles (aviation, hospitality, media) expect one.</span>
                  </div>
                </div>
              </>
            )}

            {(cur.id === 'hobbies' || cur.id === 'strengths') && (() => {
              const k = cur.id;
              const items = splitList(d[k]);
              const ideas = (k === 'hobbies' ? HOBBY_IDEAS : STRENGTH_IDEAS).filter((x) => !items.some((y) => y.toLowerCase() === x.toLowerCase()));
              return (
                <div className="card stack g12" style={{ padding: 20 }}>
                  <label htmlFor={`ta-${k}`} className="label">Your {k} · one per line</label>
                  <textarea id={`ta-${k}`} className="input" rows={5} value={d[k] || ''} onChange={(e) => setD({ ...d, [k]: e.target.value })} placeholder={k === 'hobbies' ? 'Reading\nPlaying cricket' : 'Quick learner\nTeam player'} />
                  <span className="xs faint">{items.length} added{items.length > 6 ? ' · 3–5 is usually enough' : ''}</span>
                  <span className="label">Quick add</span>
                  <div className="row g8">
                    {ideas.map((x) => <button key={x} type="button" className="chip" style={{ minHeight: 36, fontWeight: 500, fontSize: 13 }} onClick={() => setD((p) => ({ ...p, [k]: [...splitList(p[k]), x].join('\n') }))}>+ {x}</button>)}
                  </div>
                </div>
              );
            })()}

            {cur.id === 'pinfo' && objEditor('pinfo', PINFO_FIELDS)}

            {cur.id === 'decl' && (
              <>
                {objEditor('decl', DECL_FIELDS)}
                <div className="row g8">
                  <button type="button" className="btn btn-outline" onClick={() => { const t = new Date(); setObj('decl', 'date', `${String(t.getDate()).padStart(2, '0')}/${String(t.getMonth() + 1).padStart(2, '0')}/${t.getFullYear()}`); }}>Use today’s date</button>
                  {d.decl?.text !== DECL_TEXT && <button type="button" className="btn btn-ghost" onClick={() => setObj('decl', 'text', DECL_TEXT)}>Reset to standard wording</button>}
                </div>
              </>
            )}

            {cur.id === 'summary' && (
              <div className="card stack g12" style={{ padding: 20 }}>
                <label htmlFor="sum" className="label">Your summary</label>
                <textarea id="sum" className="input" rows={5} value={d.summary} onChange={(e) => setD({ ...d, summary: e.target.value })} placeholder="Who you are, your strongest skills, one result with a number, and the role you want." />
                <div className="row between xs"><span className="faint">{sumLen} chars</span><span className="strong" style={{ color: sumLen >= 150 && sumLen <= 400 ? 'var(--success)' : 'var(--warning)' }}>{sumLen < 150 ? `${150 - sumLen} more characters recommended` : sumLen > 400 ? 'Consider trimming' : '✓ Great length'}</span></div>
                <span className="label" style={{ marginTop: 6 }}>Or start from one of these</span>
                {summaryOptions.map(([t, n]) => (
                  <button key={n} type="button" className="option stack g4" onClick={() => setD({ ...d, summary: t })} style={{ fontSize: 14, lineHeight: 1.5 }}>
                    <span>{t}</span><span className="xs faint">{n} · tap to use</span>
                  </button>
                ))}
              </div>
            )}

            {cur.id === 'skills' && (
              <div className="card stack g16" style={{ padding: 20 }}>
                {d.skillGroups.map((g, gi) => {
                  const def = DEFAULT_SKILL_GROUPS.find((x) => x.id === g.id);
                  const setGroup = (patch) => setD((p) => ({ ...p, skillGroups: p.skillGroups.map((x, j) => (j === gi ? { ...x, ...patch } : x)) }));
                  return (
                    <div key={g.id} className="stack g8">
                      <div className="row between g8" style={{ flexWrap: 'nowrap' }}>
                        <label htmlFor={`sg-${g.id}-name`} className="sr-only">Category name</label>
                        <input id={`sg-${g.id}-name`} value={g.label} onChange={(e) => setGroup({ label: e.target.value })} placeholder="Category name"
                          style={{ flex: 1, minWidth: 0, border: 0, background: 'transparent', padding: '6px 0', fontSize: 12, fontWeight: 700, letterSpacing: '.08em', textTransform: 'uppercase', color: 'var(--text2)' }} />
                        {!def && <button type="button" className="btn btn-danger-soft" onClick={() => { withUndo(`“${g.label || 'Category'}” removed`); setD((p) => ({ ...p, skillGroups: p.skillGroups.filter((_, j) => j !== gi) })); }}>Remove</button>}
                      </div>
                      <label htmlFor={`sg-${g.id}`} className="sr-only">{g.label} — separate items with commas</label>
                      <input id={`sg-${g.id}`} className="input" value={g.value} onChange={(e) => setGroup({ value: e.target.value })} placeholder={def?.ph || 'e.g. item one, item two'} />
                    </div>
                  );
                })}
                <button type="button" className="btn btn-outline" style={{ borderStyle: 'dashed', alignSelf: 'flex-start' }}
                  onClick={() => setD((p) => ({ ...p, skillGroups: [...p.skillGroups, { id: `g_${Date.now()}`, label: '', value: '' }] }))}>+ Add a category</button>
                <hr className="divider" />
                <span className="label">Quick add · tap to put it in the right category</span>
                <div className="row g8">
                  {ALL_SKILLS.filter((k) => !allSkills(d.skillGroups).some((x) => x.toLowerCase() === k.toLowerCase())).map((k) => (
                    <button key={k} type="button" className="chip" style={{ minHeight: 36, fontWeight: 500, fontSize: 13 }} onClick={() => addSkill(k)}>+ {k}</button>
                  ))}
                </div>
              </div>
            )}

            {LISTS[cur.id] && listEditor(cur.id, LISTS[cur.id])}
            {cur.id === 'edu' && (
              <div className="row g8">
                <span className="xs faint">Freshers: add school marks if asked for them</span>
                {[['Class 12 (Higher Secondary)', 'Add Class 12'], ['Class 10 (Secondary)', 'Add Class 10']].map(([deg, l]) => (
                  <button key={l} type="button" className="btn btn-outline" style={{ minHeight: 40, fontSize: 14 }} onClick={() => setList('edu', [...d.edu, { ...LISTS.edu.blank, degree: deg, field: 'CBSE / State board', grade: '' }])}>+ {l}</button>
                ))}
              </div>
            )}
            {cur.custom && listEditor(cur.id, LISTS.custom)}
            {cur.id === 'prefs' && <><div className="row g8"><strong>Job matching</strong><ProfileOnly /></div>{objEditor('prefs', PREF_FIELDS)}</>}
            {cur.id === 'links' && (
              <>
                <div className="card stack g12" style={{ padding: 20 }}>
                  <span id="ls-l" className="strong small">How links show on your resume</span>
                  <div role="radiogroup" aria-labelledby="ls-l" className="grid-auto g8" style={{ '--min': '220px' }}>
                    {[['icon', 'Icon + handle', 'Clean and short. Recommended.', <span className="row g4" style={{ alignItems: 'center' }}><Logo k="linkedin" size={14} /> saivarsha</span>],
                      ['url', 'Full link', 'Shows the complete address.', <>linkedin.com/in/saivarsha</>]].map(([v, l, h, ex]) => (
                      <label key={v} className="option" data-on={(d.linkStyle || 'icon') === v}>
                        <input type="radio" name="linkStyle" checked={(d.linkStyle || 'icon') === v} onChange={() => setD({ ...d, linkStyle: v })} />
                        <span className="stack g4"><strong className="small">{l}</strong><span className="xs muted">{h}</span><span className="xs" style={{ marginTop: 2 }}>{ex}</span></span>
                      </label>
                    ))}
                  </div>
                </div>
                <LinksEditor d={d} setD={setD} />
              </>
            )}

            {cur.id === 'review' && (
              <div className="stack g16">
                {issues.length > 0 && (
                  <div className="card stack g8" role={showIssues ? 'alert' : undefined} style={{ borderColor: showIssues ? 'var(--danger)' : undefined, borderWidth: showIssues ? 2 : 1 }}>
                    <strong style={{ color: 'var(--danger)' }}>{issues.length} thing{issues.length === 1 ? '' : 's'} to fix before you submit</strong>
                    {issues.map((it, i) => (
                      <div key={i} className="row between g8 small" style={{ flexWrap: 'nowrap' }}>
                        <span className="muted">{it.msg}</span>
                        <button type="button" className="btn btn-ghost" style={{ minHeight: 36, color: 'var(--accent)' }} onClick={() => go(it.sec)}>Fix</button>
                      </div>
                    ))}
                  </div>
                )}
                {pages > 1 && <p className="well small" style={{ color: 'var(--warning)' }}>Your resume runs to {pages} pages. Freshers and 0–3 years usually do best with 1 page — try hiding or trimming a section.</p>}

                <div className="card stack g8">
                  <div className="stack g4"><strong>Resume order</strong><span className="xs muted">Move sections up or down, or hide one without deleting it.</span></div>
                  {order.map((id, i) => (
                    <div key={id} className="row g8" style={{ flexWrap: 'nowrap', padding: '6px 0', borderTop: i ? '1px solid var(--border)' : 0, opacity: d.hidden?.[id] ? 0.55 : 1 }}>
                      <span className="mono faint" style={{ width: 20 }}>{i + 1}</span>
                      <span className="strong small" style={{ flex: 1 }}>{sectionLabel(d, id)}{d.hidden?.[id] && <span className="faint" style={{ fontWeight: 400 }}> · hidden</span>}</span>
                      <button type="button" className="btn btn-icon" style={{ width: 40, minHeight: 40 }} aria-label={`Move ${sectionLabel(d, id)} up`} disabled={i === 0} onClick={() => moveSection(id, -1)}>↑</button>
                      <button type="button" className="btn btn-icon" style={{ width: 40, minHeight: 40 }} aria-label={`Move ${sectionLabel(d, id)} down`} disabled={i === order.length - 1} onClick={() => moveSection(id, 1)}>↓</button>
                      <button type="button" className="btn btn-outline" style={{ minHeight: 40, fontSize: 13, width: 72 }} aria-pressed={!d.hidden?.[id]} onClick={() => toggleHidden(id)}>{d.hidden?.[id] ? 'Show' : 'Hide'}</button>
                    </div>
                  ))}
                  {d.order && <button type="button" className="btn btn-ghost" style={{ alignSelf: 'flex-start' }} onClick={() => setD({ ...d, order: null })}>Reset to recommended order</button>}
                </div>

                <div className="stack g8">
                  {SECS.filter((s) => s.id !== 'review').map((s) => {
                    const ok = !!has[s.id];
                    const count = Array.isArray(d[s.id]) ? d[s.id].length : null;
                    return (
                      <div key={s.id} className="card-sm row g12" style={{ flexWrap: 'nowrap' }}>
                        <span style={{ width: 22, height: 22, flex: 'none', borderRadius: '50%', boxSizing: 'border-box', border: `2px solid ${ok ? 'var(--success)' : 'var(--border2)'}`, background: ok ? 'var(--success)' : 'transparent', color: 'var(--onink)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>{ok && <Icon name="check" size={12} stroke={3} />}</span>
                        <span className="stack" style={{ flex: 1 }}><strong className="small">{s.label}</strong><span className="xs muted">{ok ? (count ? `${count} added` : 'Complete') : 'Not filled yet — optional unless marked *'}</span></span>
                        <button type="button" className="btn btn-ghost" style={{ color: 'var(--accent)' }} onClick={() => go(s.id)}>Edit</button>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            <div className="row g8" style={{ paddingTop: 4 }}>
              {idx > 0 && <button type="button" className="btn btn-outline btn-lg" onClick={() => go(SECS[idx - 1].id)}>Back</button>}
              {!(embedded && cur.id === 'review') && <button type="button" className="btn btn-ink btn-lg" onClick={() => {
                if (cur.id !== 'review') return go(SECS[idx + 1].id);
                if (issues.length) { setShowIssues(true); editorTop.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }); return undefined; }
                return setStage('done');
              }}>{cur.id === 'review' ? 'Submit profile & finish' : 'Save & continue'}</button>}
              {cur.id !== 'review' && cur.id !== 'personal' && <button type="button" className="btn btn-ghost" onClick={() => go(SECS[idx + 1].id)}>Skip for now</button>}
            </div>
            </>)}
          </section>

          {/* Preview */}
          <section aria-label="Live resume preview" className="stack g8 sticky" style={{ flex: '3 1 440px', minWidth: 0, top: 80 }}>
            <div className="row between g8 xs muted">
              <span className="row g8">{tab === 'cover' ? 'Cover letter · same design · ' : 'Live preview · '}{TEMPLATE_PRESETS[ds.preset]?.name ? `${TEMPLATE_PRESETS[ds.preset].name}${JSON.stringify({ ...TEMPLATE_PRESETS[ds.preset].design, preset: 0 }) === JSON.stringify({ ...ds, preset: 0 }) ? '' : ' (edited)'}` : 'Custom'}
                {tab !== 'cover' && <span className={`badge ${pages > 1 ? 'b-warning' : 'b-success'}`}>{pages > 1 ? `${pages} pages · aim for 1` : '1 page ✓'}</span>}
              </span>
              <span className="row g8">
                <button type="button" className="link-btn" style={{ minHeight: 32, textDecoration: 'none' }} onClick={() => setTab('design')}>Edit design</button>
                <button type="button" className="btn btn-ink" style={{ minHeight: 36, fontSize: 13 }} onClick={() => download('pdf')} disabled={pdfBusy}>{pdfBusy ? 'Preparing…' : 'Download PDF'}</button>
                <button type="button" className="btn btn-outline" style={{ minHeight: 36, fontSize: 13 }} onClick={() => download('docx')} disabled={pdfBusy} title="Word file in one column with Calibri / Cambria">Word</button>
              </span>
            </div>
            {tab === 'cover' ? <ResumePreview key="cover" data={d} design={ds} photo={photo} cover={d.cover || {}} /> : <ResumePreview data={d} design={ds} photo={photo} onPages={onPages} />}
            <span className="xs faint">Job preferences stay on your Nm7 profile — never printed. Personal information, declaration and your photo print only when you switch them on.</span>
          </section>
        </main>
      )}

      {editingPhoto && (
        <PhotoEditor src={editingPhoto.src} initial={editingPhoto.fresh ? DEFAULT_ADJ : photoAdj} shape={ds.photoShape || 'circle'}
          onSave={savePhoto} onClose={() => setEditingPhoto(null)} />
      )}

      {picker && (
        <Dialog title="Add a section" onClose={() => setPicker(false)}>
          <div className="stack g4"><h2 style={{ fontSize: 24 }}>Add a section</h2><span className="small muted">Pick one, or name your own — anything you want on your resume.</span></div>
          <div className="grid-auto g8" style={{ '--min': '220px' }}>
            {PRESET_SECTIONS.map((p) => {
              const added = d.custom.some((c) => c.title === p);
              return <button key={p} type="button" className="btn btn-outline" style={{ justifyContent: 'flex-start' }} disabled={added} onClick={() => addSection(p)}>{added ? '✓' : '+'} {p}</button>;
            })}
          </div>
          <form onSubmit={(e) => { e.preventDefault(); if (customName.trim()) addSection(customName.trim()); }} className="field">
            <label htmlFor="cn" className="label">Or create your own</label>
            <div className="row g8" style={{ flexWrap: 'nowrap' }}>
              <input id="cn" className="input" value={customName} onChange={(e) => setCustomName(e.target.value)} placeholder="e.g. Sports, Research, Freelance gigs" />
              <button type="submit" className="btn btn-ink" style={{ minHeight: 48 }} disabled={!customName.trim()}>Add</button>
            </div>
          </form>
          <button type="button" className="btn btn-ghost" style={{ alignSelf: 'flex-end' }} onClick={() => setPicker(false)}>Cancel</button>
        </Dialog>
      )}
    </>
  );
}
