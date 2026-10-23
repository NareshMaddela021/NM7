import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import Header from '../components/Header';
import { Dialog, Icon, Meter, useToast } from '../components/ui';
import { getMatchedJobs } from '../services/api';
import { flushKeepalive, onSaveState } from '../lib/meLive';
import { syncFromBuilder, defaultResume, useMe, activeResume, addResume, openInBuilder, blankResume, updateResume, uniqueName, setResumePages, acceptGuestDraft, discardGuestDraft } from '../lib/customerStore';
import { useJobProfile } from '../lib/profileStore';
import { profileCompleteness, profileToResume, profileUpdates } from '../lib/jobProfile';
import { reviewToResume } from '../lib/photoImport';
import { DownloadBlocked, exportFile, forgetPendingDownload, mayFinishDownload, pendingDownload } from '../lib/downloads';
import { lengthNote, writeSummaries } from '../lib/summary/write';
import { ago, charCount } from '../lib/text'; // not from me/shared: that file loads the PDF library
import { monthsBetween } from '../lib/import/dates';
import PhotoImport from './builder/PhotoImport';
import { FillFromProfile, ProfileHint, ProfileUpdates, SaveToProfile } from './builder/ProfileSync';
import { draftKey, currentUser, LIVE, useAuth } from '../lib/auth';
import { applyImport } from '../lib/import/apply';
import { hasSample, isEmptyResume, stripSample } from '../lib/sampleData';
import { emptyResult } from '../lib/import/shared';

const dayLabel = () => new Date().toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
export { uniqueName }; // kept here for older imports
/** The built-in sample person (shown to guests until they add their own details). */
const START_MODES = {
  resume: { stage: 'import', importMode: 'resume' },
  linkedin: { stage: 'import', importMode: 'linkedin' },
  photos: { stage: 'photos' },
  scratch: { stage: 'templates', blank: true },
  templates: { stage: 'templates' },
  summary: { stage: 'build', sec: 'summary' },
};
const isSampleDraft = (d) => d.personal?.name === INITIAL.personal.name && d.personal?.email === INITIAL.personal.email;
import ResumePreview from './builder/ResumePreview';
import { FieldGrid, LinkFields, SchemaField } from './builder/Fields';
import DesignPanel from './builder/DesignPanel';
import Import from './builder/Import';
import TemplatePicker, { layoutOf, PHOTO_PLACEHOLDER } from './builder/TemplatePicker';
import { listText, templateSuggests } from './builder/templatePick';
import CoverPanel from './builder/CoverPanel';
import { EntryHeader, focusMoved } from './builder/EntryControls';
import LineEntries from './builder/LineEntries';
import { hiddenCount, moveItem, removeItem, toggleItem } from './builder/entries';
import { shorten, atsFriendly } from './builder/aiTools';
import SummaryWriter from './builder/SummaryWriter';
import ReadySummaries from './builder/ReadySummaries';
import FromResume from './builder/FromResume';
import { summaryBasis, writeFromResume } from '../lib/summary/fromResume';
import LinksEditor, { Logo } from './builder/LinksEditor';
import PhotoEditor, { DEFAULT_ADJ, shapePhoto } from './builder/PhotoEditor';
import { DEFAULT_DESIGN, FIT_STEPS, TEMPLATE_PRESETS } from './builder/design';
import {
  AI_SAMPLES, ALL_SKILLS, EXP_LEVELS, FIXED_SECTIONS, INITIAL, LISTS, PERSONAL_FIELDS, PINFO_FIELDS, DECL_FIELDS, DECL_TEXT,
  HOBBY_IDEAS, STRENGTH_IDEAS, PRESET_SECTIONS, completeness, DEFAULT_SKILL_GROUPS, SKILL_GROUP_OF, splitSkills, allSkills,
  PRINTABLE, real, completeResume, resolveOrder, sectionLabel, fieldError, dateOrderError, collectIssues, LINK_SLOTS, LINK_WORDS, LINK_WORD_MAX, migrateLinks, isFresher, SCORE_WEIGHTS, strengthOf,
} from './builder/schema';

const DRAFT_KEY = () => draftKey(); // per signed-in customer (see lib/auth.js)
const STYLES_KEY = 'asuraa-saved-styles';
const loadStyles = () => { try { return JSON.parse(localStorage.getItem(STYLES_KEY) || '[]'); } catch { return []; } };
const nextFrame = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(r, 40))));
/** Live app, signed-in customer: the resume lives on the server (My resumes → the active one), not in this browser. */
const serverCustomer = () => LIVE && currentUser()?.role === 'customer';
const loadDraft = (key = DRAFT_KEY(), initial = defaultResume()) => {
  if (serverCustomer() && key === DRAFT_KEY()) return completeResume(initial);
  try {
    const s = localStorage.getItem(key);
    // a draft from older versions may still hold the sample person: drop exactly those values (never save them)
    if (s) { const d = stripSample(completeResume(JSON.parse(s))); if (!isEmptyResume(d) || !hasSample(JSON.parse(s))) return d; }
  } catch { /* ignore */ }
  return completeResume(initial);
};

function ProfileOnly() {
  return <span className="badge b-neutral" style={{ fontSize: 11 }}>Profile only · not printed</span>;
}

/* ---------- Start & template screens ---------- */
function Start({ onNext, profilePct = null, resume = null, onContinue, customer = false }) {
  const fromProfile = profilePct !== null;
  const opts = [
    ...(fromProfile ? [['profile', 'Start from my Job Profile', `A new resume filled from your Job Profile (${profilePct}% complete). You pick the look next.`, profilePct >= 40]] : []),
    ['scratch', 'Start from scratch', 'Guided, one section at a time.', !fromProfile || profilePct < 40],
    ['linkedin', 'Import LinkedIn', 'Upload your LinkedIn profile PDF. We fill every section we can, and you check it before saving.'],
    ['resume', 'Rebuild my old resume', 'Upload a PDF or Word resume in any layout. We sort it into clean sections and point out what to fix.'],
    ['photos', 'Snap photos', 'Take photos of your Aadhaar, work papers or a handwritten note. We’ll read them and fill your resume.'],
  ];
  return (
    <main id="main" className="container stack g32 rise" style={{ maxWidth: 1100, padding: '72px 24px' }}>
      <div className="stack g12" style={{ maxWidth: 720 }}>
        <h1 className="display h1" style={{ fontSize: 'clamp(36px,5vw,60px)' }}>Build a resume recruiters <span className="hl" style={{ padding: '0 4px' }}>actually read.</span></h1>
        <p className="lead">12 guided sections, plus any section you want to add. Your Nm7 profile and your resume are built together.</p>
        <p className="small muted" style={{ margin: 0 }}><strong>Free to build. Account needed to download.</strong></p>
      </div>
      {resume && (
        <section className="card row between g16" aria-labelledby="continue-h" style={{ padding: 24, border: '2px solid var(--ink)' }}>
          <div className="stack g4" style={{ minWidth: 0 }}>
            <span className="mono xs muted" id="continue-h">CONTINUE EDITING</span>
            <strong className="display" style={{ fontSize: 22, overflowWrap: 'anywhere' }}>{resume.name}</strong>
            <span className="small muted">{resume.updated ? `Edited ${ago(resume.updated)}` : 'Saved in this browser — sign in to keep it'}</span>
          </div>
          <div className="row g8">
            <button type="button" className="btn btn-ink btn-lg" onClick={onContinue}>Continue</button>
            {resume.updated && <Link to="/me/resumes" className="btn btn-outline btn-lg">See all resumes</Link>}
          </div>
        </section>
      )}
      {resume && <h2 style={{ fontSize: 22, margin: '8px 0 -12px' }}>Or start a new resume</h2>}
      <div className="grid-auto g16">
        {opts.map(([k, t, d, rec]) => (
          <button key={t} type="button" className={`card stack g8 btn${k === 'photos' ? ' start-photos' : ''}`} onClick={() => onNext(k)} style={{ textAlign: 'left', alignItems: 'flex-start', whiteSpace: 'normal', height: 'auto', padding: 24, border: rec ? '2px solid var(--ink)' : undefined }}>
            {rec && <span className="badge b-signal">Recommended</span>}
            <strong className="display" style={{ fontSize: 22 }}>{t}</strong>
            <span className="muted" style={{ fontWeight: 400 }}>{d}</span>
            {k === 'photos' && !customer && <span className="xs muted" data-testid="start-photos-signin">Sign in needed — photos are read for your own account only.</span>}
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
    <main id="main" className="container row g48 rise" style={{ maxWidth: 1100, padding: '64px 24px', alignItems: 'center' }}>
      <div className="stack g20" style={{ flex: '1 1 420px' }}>
        <span className="mono" style={{ color: 'var(--success)', fontSize: 13 }}>PROFILE {score}% · RESUME READY</span>
        <h1 className="display" style={{ fontSize: 48 }}>Nice work, {(name || 'there').split(' ')[0]}. Recruiters can now find you.</h1>
        <p className="lead">Your Nm7 profile is live and your resume is ready to download.</p>
        <div className="stack g8" style={{ maxWidth: 420 }}>
          <button type="button" className="btn btn-ink btn-xl" onClick={() => onDownload('pdf')} disabled={pdfBusy}>{pdfBusy ? 'Preparing…' : 'Download PDF'}</button>
          <button type="button" className="btn btn-outline btn-lg" onClick={() => onDownload('docx')} disabled={pdfBusy}>Also download as Word (.docx)</button>
          <button type="button" className="btn btn-outline btn-lg" onClick={onCover}>Write a matching cover letter</button>
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
 * Embedded mode skips the start/template screens and the header.
 */
/** The header's save note. Signed in: what the server has (saving / saved / a failure being retried). Guests: this browser. */
function SaveStatus({ customer, serverIn, save, dirty }) {
  let text = 'Saved in this browser';
  if (customer) {
    if (!serverIn) text = 'Loading your resume…';
    else if (dirty || save.pending > 0) text = 'Saving…';
    else if (save.failed) text = 'Not saved yet — retrying';
    else text = 'All changes saved';
  }
  return <span className="xs faint" aria-live="polite" data-testid="save-status" style={save.failed && customer ? { color: 'var(--danger)' } : undefined}>{text}</span>;
}

export default function Builder({ embedded = null }) {
  const toast = useToast();
  const location = useLocation();
  // back from "Create a free account to download": straight to the editor, where the download starts by itself
  // (the download itself starts once the account and its resume are in: see the effect below)
  // /builder?start=resume|linkedin|photos|scratch|summary opens that mode directly (links from the home page).
  const startAt = embedded ? null : START_MODES[new URLSearchParams(location.search).get('start')] || null;
  const [fromSignIn] = useState(() => !embedded && mayFinishDownload()); // straight back from the download's sign-in
  const [stage, setStage] = useState(embedded || (fromSignIn && pendingDownload()) || location.state?.open === 'build' ? 'build' : location.state?.open === 'photos' ? 'photos' : startAt?.stage || 'start');
  const [missing, setMissing] = useState(false); // after "Snap photos": point at what's still missing (e.g. phone)
  const [importMode, setImportMode] = useState(startAt?.importMode || 'resume');
  const [suggest, setSuggest] = useState(null);
  const [changing, setChanging] = useState(false); // "Change template" from the live preview: the picker on My details
  const [d, setD] = useState(() => (embedded ? loadDraft(embedded.storageKey, embedded.initial) : loadDraft(DRAFT_KEY(), serverCustomer() ? (activeResume()?.data || defaultResume()) : defaultResume())));
  // Live customer: when their resumes arrive from the server, open the active one (unless a scan import is opening).
  const auth = useAuth(); // re-render when the sign-in answer arrives (it can come after this page on a cold start)
  const me = useMe();
  const jp = useJobProfile();
  const customer = !embedded && auth.user?.role === 'customer';
  const profileReady = customer && jp.available && !!jp.data;
  const profile = profileReady ? jp.data : null;
  const edited = useRef(new WeakSet()); // entries changed in this visit: they get "Save this change to my Job Profile"
  const fromServer = useRef(!serverCustomer() || !me.loading);
  const [serverIn, setServerIn] = useState(fromServer.current); // the saved resume (if any) is in `d`
  const unsent = useRef(null); // an edit the autosave wait hasn't handed to the store yet
  const [dirty, setDirty] = useState(false);
  // The sign-in answer arrived after this page opened (the API was waking up): the saved resume must be loaded
  // now, and until it is, nothing from this screen is sent to the server (it would overwrite it).
  const hadCustomer = useRef(!!serverCustomer());
  useEffect(() => {
    if (embedded || hadCustomer.current || !customer) return;
    hadCustomer.current = true;
    fromServer.current = false;
    setServerIn(false);
  }, [customer]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (embedded || fromServer.current || me.loading) return;
    fromServer.current = true;
    setServerIn(true);
    const a = activeResume(me);
    if (a && !location.state?.scanImport) setD(completeResume(a.data));
  }, [me.loading]); // eslint-disable-line react-hooks/exhaustive-deps
  // Saved in another tab or device (the server said 409 and the store reloaded the latest copy): this tab asks
  // "Use latest" (take the other copy) or "Keep mine" (save this tab's copy over it). Same content: nothing to ask.
  const [conflict, setConflict] = useState(null); // the latest copy's data
  useEffect(() => {
    if (embedded || !me.conflict) return;
    const a = activeResume(me);
    if (!a) return;
    if (JSON.stringify(completeResume(a.data)) === JSON.stringify(d)) { setConflict(null); return; }
    setConflict(a.data);
  }, [me.conflict]); // eslint-disable-line react-hooks/exhaustive-deps
  const useLatest = () => { setD(completeResume(conflict)); setConflict(null); toast('Showing the latest copy'); };
  const keepMine = () => { setConflict(null); syncFromBuilder(d); toast('Your copy is saved'); };
  // the signed-in customer's saved resume hasn't arrived yet: the preview shows no page count meanwhile
  const dataLoading = !embedded && serverCustomer() && (me.loading || !serverIn);
  const [sec, setSec] = useState(startAt?.sec || 'personal');
  const [picker, setPicker] = useState(false);
  const [customName, setCustomName] = useState('');
  // The adjusted photo is part of the resume (`d.photo`, a small JPEG), so it is saved with it and survives a reload,
  // and organisation and kiosk prints include it. The original stays in this tab only, for re-cropping.
  const photo = d.photo || null;
  const setPhoto = (p) => setD((x) => ({ ...x, photo: p || '' }));
  const [photoOrig, setPhotoOrig] = useState(null);
  const [photoAdj, setPhotoAdj] = useState(DEFAULT_ADJ);
  const [editingPhoto, setEditingPhoto] = useState(null); // source being edited
  const [photoErr, setPhotoErr] = useState('');
  const [save, setSave] = useState({ pending: 0, failed: null }); // what the server really has (lib/meLive)
  useEffect(() => (LIVE ? onSaveState(setSave) : undefined), []);
  const [pages, setPages] = useState(null); // null until the preview has measured the loaded resume
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
  // Picking a template changes only the look (fonts, colours, columns): never which sections show, their order,
  // titles or content. When the template usually shows a section this resume has off, it is only suggested.
  const [hint, setHint] = useState(null); // { k, items } — shown beside the live preview (never above the picker: picking a card moves nothing)
  const applyTemplate = (k, patch = {}) => {
    applyPreset(k, patch);
    const items = templateSuggests(d, k);
    setHint(items.length ? { k, items } : null);
  };
  const acceptHint = () => {
    const on = hint.items.map((x) => x.id);
    setD((p) => ({ ...p, hidden: { ...p.hidden, ...Object.fromEntries(on.filter((id) => id !== 'photo').map((id) => [id, false])) }, ...(on.includes('photo') ? { showPhoto: true } : {}) }));
    setHint(null);
  };
  const hintBox = hint && TEMPLATE_PRESETS[hint.k] && (
    <div className="card row between g8" role="status" data-testid="template-hint" style={{ padding: '10px 14px', alignItems: 'center' }}>
      <span className="small">This template usually shows {listText(hint.items)}. Turn {hint.items.length > 1 ? 'them' : 'it'} on?</span>
      <span className="row g8">
        <button type="button" className="btn btn-ink" style={{ minHeight: 40 }} onClick={acceptHint}>Turn on</button>
        <button type="button" className="btn btn-outline" style={{ minHeight: 40 }} onClick={() => setHint(null)}>No thanks</button>
      </span>
    </div>
  );
  const history = {
    canUndo: past.length > 0, canRedo: future.length > 0,
    undo: () => { if (!past.length) return; setFuture((f) => [ds, ...f]); setD((p) => ({ ...p, design: past[past.length - 1] })); setPast((p) => p.slice(0, -1)); },
    redo: () => { if (!future.length) return; setPast((p) => [...p, ds]); setD((p) => ({ ...p, design: future[0] })); setFuture((f) => f.slice(1)); },
  };
  const onPages = useMemo(() => (n) => { if (n !== null) pagesRef.current = n; setPages(n); }, []); // null = still measuring
  // the page count goes with the saved resume (organizations it's shared with see it in their print list)
  useEffect(() => { if (!pages || embedded || dataLoading || tab === 'cover') return undefined; const t = setTimeout(() => setResumePages(pages), 1500); return () => clearTimeout(t); }, [pages, embedded, dataLoading, tab]);
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

  // Opened with a template picked (home gallery "Use this template"): apply it once — for a signed-in customer only
  // after their saved resume is in, so loading it doesn't put the old template back.
  const templateAsked = useRef(embedded ? null : location.state?.template);
  useEffect(() => {
    const k = templateAsked.current;
    if (!k || !TEMPLATE_PRESETS[k] || (serverCustomer() && !serverIn)) return;
    templateAsked.current = null;
    applyTemplate(k);
    toast(`${TEMPLATE_PRESETS[k].name} template applied`);
  }, [serverIn]); // eslint-disable-line react-hooks/exhaustive-deps
  // From the scan report ("keep fixing it myself"): load the scanned resume, or start empty instead of the sample.
  useEffect(() => {
    const st = location.state;
    if (startAt?.blank && !st?.scanImport) {
      if (isSampleDraft(d)) setD(applyImport(d, emptyResult('blank').data, 'replace')); // "I have nothing": an empty resume
      return;
    }
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
    if (serverCustomer() && !serverIn) return undefined; // the saved resume hasn't arrived yet: never send the draft over it
    if (serverCustomer()) { unsent.current = d; setDirty(true); } // the "Saved" note counts this wait too
    const t = setTimeout(() => { unsent.current = null; setDirty(false); syncFromBuilder(d); }, 800);
    return () => clearTimeout(t);
  }, [d, serverIn]); // eslint-disable-line react-hooks/exhaustive-deps
  // the tab is closed or hidden before that wait is over: hand the edit to the store now and send it with keepalive
  useEffect(() => {
    if (embedded || !LIVE) return undefined;
    const flushNow = () => { if (unsent.current && serverCustomer()) { syncFromBuilder(unsent.current); unsent.current = null; flushKeepalive(); } };
    const onHide = () => { if (document.visibilityState === 'hidden') flushNow(); };
    window.addEventListener('pagehide', flushNow);
    document.addEventListener('visibilitychange', onHide);
    return () => { window.removeEventListener('pagehide', flushNow); document.removeEventListener('visibilitychange', onHide); };
  }, [embedded]);
  // workspace controls: replace the whole resume (restore a version / reset), or jump to a section
  useEffect(() => { if (embedded?.replace?.n) setD(completeResume(embedded.replace.data)); }, [embedded?.replace?.n]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (embedded?.focus?.n) { setTab('content'); setSec(embedded.focus.id); } }, [embedded?.focus?.n]); // eslint-disable-line react-hooks/exhaustive-deps

  // Steps follow the resume order, so moving a section moves its step too.
  const SECS = useMemo(() => {
    const fixed = Object.fromEntries(FIXED_SECTIONS.map((x) => [x.id, x]));
    const printed = resolveOrder(d).map((id) => {
      const c = d.custom.find((x) => x.id === id);
      return c ? { id, label: c.title, help: 'Add as many entries as you like. Leave any field blank.', custom: true } : fixed[id];
    });
    return [fixed.personal, ...printed, fixed.links, { id: 'review', label: 'Review & Submit', help: 'Check each section, set the order and fix anything flagged.' }];
  }, [d]);
  const idx = Math.max(0, SECS.findIndex((s) => s.id === sec));
  const cur = SECS[idx];
  const { has } = completeness(d);
  const score = strengthOf(has, SECS.map((s) => s.id)); // the ticks shown, nothing else
  const fresher = (d.personal.level || '').startsWith('Fresher');
  const go = (id) => { setSec(id); editorTop.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }); };

  /* data helpers */
  const getList = (k) => (k.startsWith('c_') ? d.custom.find((c) => c.id === k)?.items || [] : d[k]);
  const setList = (k, arr) => setD((p) => (k.startsWith('c_') ? { ...p, custom: p.custom.map((c) => (c.id === k ? { ...c, items: arr } : c)) } : { ...p, [k]: arr }));
  const setItem = (k, i, key, v) => { const a = getList(k).slice(); a[i] = { ...a[i], [key]: v }; edited.current.add(a[i]); setList(k, a); };
  const markSaved = (k, i) => (pid, pv) => setList(k, getList(k).map((x, j) => (j === i ? { ...x, pid, pv } : x)));
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
  // "My resume | Sample" above the live preview: Sample shows the example person in the chosen template, read-only
  // and never saved; a download always makes the person's own resume.
  const [pview, setPview] = useState('mine');
  const sampleView = pview === 'sample' && tab !== 'cover';
  const sampleData = useMemo(() => ({ ...INITIAL, ...layoutOf(ds.preset) }), [ds.preset]);
  const noName = !real(d.personal?.name);
  const [fromSample, setFromSample] = useState(false); // "Downloading your resume, not the sample", for a few seconds
  useEffect(() => { if (!fromSample) return undefined; const t = setTimeout(() => setFromSample(false), 6000); return () => clearTimeout(t); }, [fromSample]);
  const downloadMine = (format) => {
    if (sampleView) { setPview('mine'); setFromSample(true); }
    return download(format);
  };
  const download = async (format = 'pdf', what = tab === 'cover' ? 'cover' : 'resume') => {
    setPdfBusy(true);
    try {
      const cover = what === 'cover' ? (d.cover || {}) : undefined;
      const photoPng = format === 'docx' && d.showPhoto && photo && !cover ? await shapePhoto(photo, ds.photoShape || 'circle') : null;
      await exportFile({ data: d, design: ds, format, cover, photo, photoPng }); // asks the server first (account / plan)
      toast(`${cover ? 'Cover letter' : 'Resume'} ${format === 'docx' ? 'Word file' : 'PDF'} ready`);
    } catch (e) {
      if (e instanceof DownloadBlocked) return; // the "create an account" / "unlock downloads" pop-up is open
      if (e?.code !== 'declined') toast(e?.code === 'unavailable' ? 'Downloads aren’t available in this view.' : 'Couldn’t create the PDF. Please try again.');
    } finally { setPdfBusy(false); }
  };
  // the download a guest clicked before signing up / in: once the account and its resume (carried over) are in —
  // also when the sign-in answer only arrives after a reload on a cold start
  const downloadClaimed = useRef(false);
  useEffect(() => {
    if (embedded || downloadClaimed.current) return;
    if (!fromSignIn) { forgetPendingDownload(); return; } // opened some other way: never start a download by itself
    if (!customer || !serverIn) return;
    const p = pendingDownload(true);
    if (!p) return;
    downloadClaimed.current = true;
    if (p.what === 'cover') setTab('cover');
    download(p.format, p.what);
  }, [customer, serverIn]); // eslint-disable-line react-hooks/exhaustive-deps
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

  // "Education 2", "Extracurricular Activities 1": custom sections use their own title for the entry name
  const itemName = (k, schema) => (k.startsWith('c_') ? d.custom.find((c) => c.id === k)?.title || schema.item : schema.item);
  const listEditor = (k, schema) => {
    const list = getList(k);
    return (
      <div className="stack g12">
        {list.map((obj, i) => {
          const label = `${itemName(k, schema)} ${i + 1}`;
          return (
          <div key={i} className="card stack g16 rise entry-card" data-off={!!obj.off} style={{ padding: 20 }}>
            <EntryHeader list={k} index={i} count={list.length} label={label} off={!!obj.off}
              onMove={(dir) => { setList(k, moveItem(list, i, dir)); focusMoved(k, i + dir, dir); }}
              onToggle={() => setList(k, toggleItem(list, i))}
              onRemove={() => { withUndo(`${label} removed`); setList(k, removeItem(list, i)); }} />
            <div className="entry-body">
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
            {profile && edited.current.has(obj) && <SaveToProfile entry={obj} section={k} profile={profile} onSaved={markSaved(k, i)} />}
            </div>
          </div>
          );
        })}
        <button type="button" className="btn btn-outline btn-lg" style={{ borderStyle: 'dashed' }} onClick={() => setList(k, [...list, { ...schema.blank }])}>+ Add another {schema.item.toLowerCase()}</button>
      </div>
    );
  };
  // personal and pinfo fields: an empty field shows its Job Profile value, one click fills it
  const hintFrom = { personal: profile?.personal, pinfo: profile?.pinfo };
  const objEditor = (k, fields) => (
    <div className="card" style={{ padding: 20 }}>
      <FieldGrid>{fields.map((f) => {
        const field = <SchemaField key={f.key} field={f} idBase={k} value={d[k][f.key]} error={errorFor(k, d[k], f)} onChange={(v) => setObj(k, f.key, v)} />;
        const hint = hintFrom[k]?.[f.key];
        if (!hint || (k === 'pinfo' && f.key === 'nationality')) return field; // (same wrapper while typing, so focus stays)
        return <div key={f.key} className="stack g4" style={{ gridColumn: f.full ? '1 / -1' : 'auto' }}>{field}<ProfileHint value={hint} current={d[k][f.key]} label={f.label.replace(/\s*[*·].*$/, '')} onUse={(v) => setObj(k, f.key, v)} /></div>;
      })}</FieldGrid>
    </div>
  );

  // ready-made summaries written from what the resume holds, in the person's own line of work (the same
  // template engine as the summary writer's cards, without a note), so a driver or a nurse never sees fintech copy
  // reaching the Summary step with an empty summary: write it from the resume (only ever into an empty box)
  useEffect(() => {
    if (embedded || cur.id !== 'summary' || d.summary?.trim()) return;
    const text = writeFromResume(d, 'role_first', { course: !!d.summaryCourse });
    if (text) setD((p) => (p.summary?.trim() ? p : { ...p, summary: text, summaryFrom: { style: 'role_first', text, basis: summaryBasis(p) } }));
  }, [cur.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const summaryOptions = useMemo(() => (cur.id === 'summary' ? writeSummaries(d, '').options.map((o) => [o.text, o.label]) : []), [cur.id, d]);
  const sumLen = charCount(d.summary); // characters as people count them, not UTF-16 units (Telugu, Hindi…)
  const sumNote = lengthNote(sumLen);

  // Signed-in customers: "start a new resume" really makes a new one (kept next to the others). An untouched
  // resume (a new account's empty first one: no headline, summary, job, project or college) is reused instead,
  // so no empty copies pile up; one already started from the Job Profile or a scan counts as touched.
  const hasResumes = customer && !me.loading && me.resumes?.length > 0;
  const latest = hasResumes ? [...me.resumes].sort((a, b) => (b.updated || 0) - (a.updated || 0))[0] : null;
  const untouched = (x) => !real(x.personal?.headline) && !real(x.summary) && !x.exp?.some((e) => real(e.company) || real(e.role)) && !x.proj?.some((p) => real(p.title)) && !x.edu?.some((e) => real(e.institution));
  const openNew = (nd, name) => {
    if (customer && !me.loading && me.resumes?.length) {
      const a = activeResume(me);
      if (a && untouched(a.data)) { if (name) updateResume(a.id, { name: uniqueName(name, me.resumes.filter((r) => r.id !== a.id)) }); } else {
        syncFromBuilder(d); openInBuilder(addResume(uniqueName(name || `New resume · ${dayLabel()}`, me.resumes), nd));
      }
    }
    setD(nd); setPast([]); setFuture([]); setSec('personal');
  };
  const startFromProfile = () => {
    openNew(migrateLinks(profileToResume(jp.data, blankResume())), `${jp.data.personal.headline || 'Resume'} · from Job Profile · ${dayLabel()}`);
    setSuggest(null); setStage('templates');
    toast('New resume filled from your Job Profile — pick a look');
  };
  // "Snap photos" → "Looks right": a new resume in the Work-first template, education off when none was found
  const startFromPhotos = (review) => {
    const nd = migrateLinks(reviewToResume(review, blankResume()));
    const months = nd.exp.reduce((t, e) => t + monthsBetween(e.from, e.current ? '' : e.to), 0);
    nd.personal.level = months >= 120 ? EXP_LEVELS[4] : months >= 72 ? EXP_LEVELS[3] : months >= 36 ? EXP_LEVELS[2] : months >= 12 ? EXP_LEVELS[1] : nd.personal.level;
    const layout = layoutOf('work');
    nd.design = { ...TEMPLATE_PRESETS.work.design, preset: 'work' };
    nd.order = layout.order; nd.titles = { ...layout.titles }; nd.showPhoto = false;
    nd.hidden = { ...layout.hidden, edu: nd.hidden.edu, certs: nd.hidden.certs, langs: nd.hidden.langs, pinfo: nd.hidden.pinfo };
    openNew(nd, `${(nd.personal.name || 'My').split(' ')[0]} · from photos · ${dayLabel()}`);
    setSuggest('work'); setMissing(true); setStage('templates');
    toast('Your resume is filled in — pick a look');
  };
  const continueLatest = () => {
    if (latest && !latest.active) openInBuilder(latest.id);
    if (latest) setD(completeResume(latest.data));
    setStage('build');
  };
  // guests: a draft kept in this browser (not the sample person) is offered back instead of a blank start
  const guestDraft = !customer && !embedded && !isSampleDraft(d) && (real(d.personal?.name) || real(d.summary) || d.exp?.some((e) => real(e.company)));
  const STAGES = ['start', 'templates', 'build', 'done'];
  const stageIdx = stage === 'import' ? 0 : STAGES.indexOf(stage);

  return (
    <>
      {!embedded && <Header variant="builder" right={stage === 'build' && <SaveStatus customer={customer} serverIn={serverIn} save={save} dirty={dirty} />} />}
      {!embedded && (
        <ol className="steps container-wide" aria-label="Builder steps" style={{ padding: '12px 24px 0' }}>
          {['Start', 'Template', 'Build', 'Done'].map((l, i) => (
            <li key={l} aria-current={i === stageIdx ? 'step' : undefined} data-state={i < stageIdx ? 'done' : undefined}><span className="mono">{i < stageIdx ? '✓' : i + 1}</span>{l}</li>
          ))}
        </ol>
      )}

      {customer && me.pendingGuestDraft && !embedded && (
        <div className="container-wide" style={{ padding: '12px 24px 0' }}>
          <div className="card row g12" role="region" aria-label="A draft from this browser" data-testid="guest-draft-ask" style={{ alignItems: 'center', flexWrap: 'wrap', padding: '12px 16px' }}>
            <span className="small" style={{ flex: '1 1 260px' }}>A resume{me.pendingGuestDraft.personal?.name ? ` for “${me.pendingGuestDraft.personal.name}”` : ''} was built on this phone before signing in. Is it yours?</span>
            <button type="button" className="btn btn-ink" style={{ minHeight: 40 }} onClick={async () => { const id = await acceptGuestDraft(); if (id) { openInBuilder(id); setD(completeResume(me.pendingGuestDraft)); setStage('build'); } }}>Yes, add it to my account</button>
            <button type="button" className="btn btn-outline" style={{ minHeight: 40 }} onClick={discardGuestDraft}>No, forget it</button>
          </div>
        </div>
      )}
      {stage === 'start' && <Start profilePct={profileReady ? profileCompleteness(jp.data).pct : null} customer={!!customer}
        resume={latest ? { name: latest.name, updated: latest.updated, data: latest.data } : guestDraft ? { name: d.personal.name ? `${d.personal.name}’s draft` : 'Your draft', updated: null, data: d } : null}
        onContinue={continueLatest}
        onNext={(k) => {
          if (k === 'profile') { startFromProfile(); return; }
          if (k === 'photos') { setStage('photos'); return; }
          if (k === 'scratch') { if (hasResumes) openNew(migrateLinks(blankResume()), null); setStage('templates'); } else { setImportMode(k); setStage('import'); }
        }} />}
      {stage === 'photos' && <PhotoImport onBack={() => setStage('start')} onDone={startFromPhotos} />}
      {stage === 'import' && (
        <Import mode={importMode} d={d} onBack={() => setStage('start')} onPhotos={() => setStage('photos')} onDone={(nd, sug) => {
          // start from the suggested template; Kio brings its section order (empty sections simply don't print)
          const preset = TEMPLATE_PRESETS[sug] ? sug : 'fresher';
          const layout = layoutOf(preset);
          // the template's layout, but never hide a section the file actually had
          const has = { ...completeness(nd).has, decl: nd.hidden?.decl === false, pinfo: nd.hidden?.pinfo === false };
          const keep = (h) => Object.fromEntries(Object.entries(h).filter(([id]) => !has[id]));
          const name = `${(nd.personal?.name || '').trim() || 'Imported'} · ${importMode === 'linkedin' ? 'from LinkedIn' : 'from my file'} · ${dayLabel()}`;
          openNew({ ...nd, design: { ...TEMPLATE_PRESETS[preset].design, preset }, order: layout.order, hidden: { ...keep(layout.hidden), ...Object.fromEntries(Object.entries(nd.hidden || {}).filter(([id, v]) => v && !has[id])) }, titles: { ...layout.titles }, showPhoto: layout.showPhoto }, name);
          setPast([]); setFuture([]);
          setSuggest(preset); setSec('personal'); setStage('templates');
          toast('Details added — pick a look, then check each section');
        }} />
      )}
      {conflict && stage === 'build' && (
        <div className={embedded ? '' : 'container-wide'} style={{ paddingTop: 12 }}>
          <div className="card row between g8" role="alert" data-testid="save-conflict" style={{ padding: '10px 14px', alignItems: 'center', borderColor: 'var(--warning, #B45309)' }}>
            <span className="small">This resume was changed in another tab or device. Which copy do you want?</span>
            <span className="row g8">
              <button type="button" className="btn btn-ink" style={{ minHeight: 40 }} onClick={useLatest}>Use latest</button>
              <button type="button" className="btn btn-outline" style={{ minHeight: 40 }} onClick={keepMine}>Keep mine</button>
            </span>
          </div>
        </div>
      )}
      {stage === 'templates' && <TemplatePicker d={d} ds={ds} suggest={suggest} photo={photo} onPick={applyTemplate} initialView={changing ? 'mine' : undefined} onNext={() => { setChanging(false); setStage('build'); }} />}
      {stage === 'done' && <Done name={d.personal.name} score={score} onEdit={() => setStage('build')} onDownload={(f) => download(f, 'resume')} onCover={() => { setTab('cover'); setStage('build'); }} pdfBusy={pdfBusy} />}

      {stage === 'build' && (
        <main id={embedded ? undefined : 'main'} className={embedded ? 'row g24' : 'container-wide row g24'} style={{ padding: embedded ? '4px 0 32px' : '20px 24px 64px', alignItems: 'flex-start' }}>
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
              const offN = hiddenCount(d, s.id); // entries switched off inside this section
              const label = sectionLabel(d, s.id) && printable ? sectionLabel(d, s.id) : s.label;
              return (
                <div key={s.id} className="row" style={{ flexWrap: 'nowrap', borderRadius: 10, background: a ? 'var(--surface)' : 'transparent', opacity: hidden ? 0.6 : 1 }}>
                  <button type="button" onClick={() => { setTab('content'); go(s.id); }} aria-current={a ? 'step' : undefined} className="row g8"
                    style={{ flex: 1, minWidth: 0, flexWrap: 'nowrap', minHeight: 40, padding: '0 8px 0 10px', border: 0, background: 'transparent', color: a || ok ? 'var(--text)' : 'var(--text2)', fontWeight: a ? 600 : 500, fontSize: 14, textAlign: 'left' }}>
                    <span style={{ width: 20, height: 20, flex: 'none', borderRadius: '50%', boxSizing: 'border-box', border: `2px solid ${ok ? 'var(--success)' : a ? 'var(--ink)' : 'var(--border2)'}`, background: ok ? 'var(--success)' : 'transparent', color: 'var(--onink)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>{ok && <Icon name="check" size={11} stroke={3} />}</span>
                    <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', textDecoration: hidden ? 'line-through' : 'none' }}>{label}{offN > 0 && <span className="xs muted" style={{ fontWeight: 500 }}> · {offN} hidden</span>}{!(s.id in SCORE_WEIGHTS) && !ok && <span className="xs faint" style={{ fontWeight: 500 }}> · optional</span>}</span>
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
              <CoverPanel d={d} profile={profile} setCover={(cover) => setD((p) => ({ ...p, cover }))} onAddSkill={(k) => { addSkill(k); toast(`Added “${k}” to your skills`); }} />
            ) : tab === 'design' ? (
              <DesignPanel d={d} ds={ds} set={setDesign} applyPreset={applyTemplate} setTitle={setTitle} fit={fit} fitting={fitting} pages={pages}
                history={history} savedStyles={savedStyles} saveStyle={saveStyle} applySaved={applySaved} deleteSaved={deleteSaved}
                reset={() => applyPreset(ds.preset && TEMPLATE_PRESETS[ds.preset] ? ds.preset : 'fresher')} />
            ) : (<>
            {profile && <ProfileUpdates d={d} setD={setD} updates={profileUpdates(d, profile)} />}
            {missing && issues.length > 0 && (
              <div className="well stack g8" role="status" style={{ borderLeft: '4px solid var(--warning)' }}>
                <strong>Almost done — please add:</strong>
                <ul className="stack g4" style={{ margin: 0, paddingLeft: 18 }}>{issues.slice(0, 5).map((x) => <li key={x.msg}><button type="button" className="link-btn" onClick={() => { setTab('content'); go(x.sec); }}>{x.msg}</button></li>)}</ul>
              </div>
            )}
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
                {profile && <FillFromProfile id={cur.id} label={cur.label} d={d} setD={setD} profile={profile} />}
                {cur.custom && <button type="button" className="btn btn-outline" style={{ color: 'var(--danger)' }} onClick={removeSection}>Delete section</button>}
              </div>
            </div>
            {d.hidden?.[cur.id] && <p className="well small muted">This section is hidden from your resume. It stays saved on your profile.</p>}
            <p className="muted" style={{ lineHeight: 1.55 }}>{cur.help}</p>
            {cur.fresherTip && fresher && !(d[cur.id] || []).some((e) => real(e.company) || real(e.role)) && <p className="well small muted" data-testid="fresher-tip">{cur.fresherTip}</p>}

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
                      {photo && <button type="button" className="btn btn-outline" onClick={() => setEditingPhoto({ src: photoOrig || photo, fresh: false })}>Adjust photo</button>}
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

            {(cur.id === 'hobbies' || cur.id === 'strengths') && (
              <LineEntries key={cur.id} d={d} setD={setD} k={cur.id} item={cur.id === 'hobbies' ? 'Hobby' : 'Strength'}
                ideas={cur.id === 'hobbies' ? HOBBY_IDEAS : STRENGTH_IDEAS} placeholder={cur.id === 'hobbies' ? 'e.g. Playing cricket' : 'e.g. Team player'} />
            )}

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
                {!embedded && <FromResume d={d} setD={setD} />}
                <SummaryWriter resume={d} note={d.about || ''} onNote={(v) => setD((p) => ({ ...p, about: v }))} value={d.summary} onUse={(t) => setD((p) => ({ ...p, summary: t }))} />
                <label htmlFor="sum" className="label">Your summary</label>
                <textarea id="sum" className="input" rows={5} value={d.summary} onChange={(e) => setD({ ...d, summary: e.target.value })} placeholder="Who you are, your strongest skills, one result with a number, and the role you want." />
                {profile && <ProfileHint value={profile.summaries.find((x) => !x.off && x.text.trim())?.text} current={d.summary} label="summary" onUse={(v) => setD((p) => ({ ...p, summary: v }))} />}
                <div className="row between xs"><span className="faint" data-testid="summary-chars">{sumLen} chars</span><span className="strong" style={{ color: sumNote.ok ? 'var(--success)' : 'var(--warning)' }}>{sumNote.text}</span></div>
                {isFresher(d) && <ReadySummaries d={d} onPick={(t, s) => { setD((p) => ({ ...p, summary: t })); toast(`“${s.heading}” is in your summary — edit anything`); const box = document.getElementById('sum'); box?.focus({ preventScroll: true }); box?.scrollIntoView({ block: 'center', behavior: 'smooth' }); }} />}
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
                  const setGroup = (patch) => setD((p) => ({ ...p, skillGroups: p.skillGroups.map((x, j) => { if (j !== gi) return x; const y = { ...x, ...patch }; edited.current.add(y); return y; }) }));
                  return (
                    <div key={g.id} className="stack g8 entry-card well" data-off={!!g.off} style={{ padding: 12 }}>
                      <EntryHeader list="skills" index={gi} count={d.skillGroups.length} label={`Skills category ${gi + 1}`} title={g.label || `Category ${gi + 1}`} off={!!g.off}
                        onMove={(dir) => { setD((p) => ({ ...p, skillGroups: moveItem(p.skillGroups, gi, dir) })); focusMoved('skills', gi + dir, dir); }}
                        onToggle={() => setD((p) => ({ ...p, skillGroups: toggleItem(p.skillGroups, gi) }))}
                        onRemove={def ? null : () => { withUndo(`“${g.label || 'Category'}” removed`); setD((p) => ({ ...p, skillGroups: removeItem(p.skillGroups, gi) })); }} />
                      <div className="entry-body stack g8">
                        <label htmlFor={`sg-${g.id}-name`} className="sr-only">Category name</label>
                        <input id={`sg-${g.id}-name`} value={g.label} onChange={(e) => setGroup({ label: e.target.value })} placeholder="Category name"
                          style={{ flex: 1, minWidth: 0, border: 0, background: 'transparent', padding: '6px 0', fontSize: 12, fontWeight: 700, letterSpacing: '.08em', textTransform: 'uppercase', color: 'var(--text2)' }} />
                      <label htmlFor={`sg-${g.id}`} className="sr-only">{g.label} — separate items with commas</label>
                      <input id={`sg-${g.id}`} className="input" value={g.value} onChange={(e) => setGroup({ value: e.target.value })} placeholder={def?.ph || 'e.g. item one, item two'} />
                      {profile && edited.current.has(g) && <SaveToProfile entry={g} section="skills" profile={profile} onSaved={(pid, pv) => setD((p) => ({ ...p, skillGroups: p.skillGroups.map((x, j) => (j === gi ? { ...x, pid, pv } : x)) }))} />}
                      </div>
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
            {cur.id === 'links' && (
              <>
                <div className="card stack g12" style={{ padding: 20 }}>
                  <span id="ls-l" className="strong small">How links show on your resume</span>
                  <div role="radiogroup" aria-labelledby="ls-l" className="grid-auto g8" style={{ '--min': '220px' }}>
                    {[['icon', 'Icon + handle', 'Clean and short. Recommended.', <span key="icon" className="row g4" style={{ alignItems: 'center' }}><Logo k="linkedin" size={14} /> saivarsha</span>],
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
                setD((p) => ({ ...p, reviewedAt: p.reviewedAt || Date.now() })); // ticks Review & Submit
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
                {tab !== 'cover' && <button type="button" className="link-btn" style={{ minHeight: 32 }} onClick={() => { setChanging(true); setStage('templates'); window.scrollTo(0, 0); }}>Change template</button>}
                {tab !== 'cover' && (pages === null
                  ? <span className="badge b-neutral" data-testid="page-count">Measuring…</span>
                  : <span className={`badge ${pages > 1 ? 'b-warning' : 'b-success'}`} data-testid="page-count">{pages > 1 ? `${pages} pages · aim for 1` : '1 page ✓'}</span>)}
              </span>
              <span className="row g8" style={{ alignItems: 'center' }}>
                {tab !== 'cover' && (
                  <span role="group" aria-label="Preview shows" className="row" style={{ gap: 0 }}>
                    {[['mine', 'My resume'], ['sample', 'Sample']].map(([v, l]) => (
                      <button key={v} type="button" className="chip" aria-pressed={pview === v} onClick={() => setPview(v)} style={{ minHeight: 36, borderRadius: v === 'mine' ? '999px 0 0 999px' : '0 999px 999px 0' }}>{l}</button>
                    ))}
                  </span>
                )}
                <button type="button" className="link-btn" style={{ minHeight: 32, textDecoration: 'none' }} onClick={() => setTab('design')}>Edit design</button>
                <button type="button" className="btn btn-ink" style={{ minHeight: 36, fontSize: 13 }} onClick={() => downloadMine('pdf')} disabled={pdfBusy || noName} title={noName ? 'Add your name to download' : undefined}>{pdfBusy ? 'Preparing…' : 'Download PDF'}</button>
                <button type="button" className="btn btn-outline" style={{ minHeight: 36, fontSize: 13 }} onClick={() => downloadMine('docx')} disabled={pdfBusy || noName} title={noName ? 'Add your name to download' : 'Word file in one column with Calibri / Cambria'}>Word</button>
              </span>
            </div>
            {noName && <span className="xs muted" data-testid="need-name" style={{ alignSelf: 'flex-end' }}>Add your name to download</span>}
            {fromSample && <span role="status" className="small" data-testid="download-note" style={{ alignSelf: 'flex-end', fontWeight: 600 }}>Downloading your resume, not the sample</span>}
            {tab !== 'cover' && hintBox}
            {tab === 'cover' ? <ResumePreview key="cover" data={d} design={ds} photo={photo} cover={d.cover || {}} />
              : sampleView ? (
                <div className="stack g8" data-testid="sample-view">
                  <div className="card row between g8" style={{ padding: '8px 12px', alignItems: 'center' }}>
                    <strong className="small">Sample: how this template looks when filled</strong>
                    <button type="button" className="btn btn-outline" style={{ minHeight: 36 }} onClick={() => setPview('mine')}>Back to my resume</button>
                  </div>
                  {/* the example person in the chosen template: shown only, never saved or downloaded */}
                  <ResumePreview decorative data={sampleData} design={ds} photo={TEMPLATE_PRESETS[ds.preset]?.photo ? PHOTO_PLACEHOLDER : null} />
                </div>
              ) : <ResumePreview data={d} design={ds} photo={photo} onPages={onPages} loading={dataLoading} hints />}
            <span className="xs faint">Personal information, declaration and your photo print only when you switch them on.</span>
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
