// The Easy dashboard (Phase 4): /me/simple and its screens, for students who are not comfortable with technology or
// English, often on cheap Android phones with slow internet. One clear next step per screen, big buttons with an
// icon and 1-3 words, large text (18 px and up, 48 px touch targets), no tables, no jargon ("Resume score", never
// "ATS"), every word in English / Telugu / Hindi (src/i18n/pages.json, simple.*). This file and its CSS are their
// own small chunk: nothing from the full dashboard is loaded here.
//   /me/simple            Your next step + 4 tiles + More (the language is asked first, once)
//   /me/simple/language   English / తెలుగు / हिंदी, each with a speaker button
//   /me/simple/resume     build a resume by talking: one question per screen (GuidedResume.jsx)
//   /me/simple/jobs …     jobs made simple: top 3, Apply, Let Nm7 apply for me, answers, apply on their website
//   /me/simple/ready      the job readiness score: a big ring, "You are 65% ready", up to 3 things left
//   /me/simple/hire       Ready to join (Phase 5): visible until …, Still ready, Pause; details in the full page
//   /me/simple/setup      profile setup P4: every setup step in simple words (SimpleChecklist.jsx, lazy); its card
//                         "Set up your profile" sits under "Your next step" on /me/simple (lazy too)
//   /me/simple/more       everything else: links to the full dashboard's pages, "Read screens aloud automatically"
// The speaker button at the top reads each screen's main words (voice.jsx); each card has its own speaker button.
// Icons: the line icons of components/ui.jsx's Icon (already in the first download, so they cost no extra bytes here).
import { Suspense, lazy, useEffect, useState } from 'react';
import { Link, Navigate, Route, Routes, useNavigate } from 'react-router-dom';
import { Icon } from '../../components/ui';
import { useLang } from '../../lib/i18n';
import { readAloud } from '../../lib/readAloud';
import { savePrefs, useSimple, useWaking } from '../../lib/simple';
import { SayButton, useAutoRead } from './voice';

const GuidedResume = lazy(() => import('./GuidedResume')); // loaded when the resume questions open
const jobs = () => import('./SimpleJobs'); // the jobs screens: one small chunk, loaded when one opens
const Jobs = lazy(() => jobs().then((m) => ({ default: m.Jobs })));
const Apply = lazy(() => jobs().then((m) => ({ default: m.Apply })));
const AutoOn = lazy(() => jobs().then((m) => ({ default: m.AutoOn })));
const Answers = lazy(() => jobs().then((m) => ({ default: m.Answers })));
const Outside = lazy(() => jobs().then((m) => ({ default: m.Outside })));
const more = () => import('./SimpleMore'); // my resume, applications, practice, fixes (fix round, 7 Nov)
const MyResume = lazy(() => more().then((m) => ({ default: m.MyResume })));
const Apps = lazy(() => more().then((m) => ({ default: m.Apps })));
const Practice = lazy(() => more().then((m) => ({ default: m.Practice })));
const Fixes = lazy(() => more().then((m) => ({ default: m.Fixes })));
const Hire = lazy(() => more().then((m) => ({ default: m.Hire })));
const Ready = lazy(() => more().then((m) => ({ default: m.Ready }))); // the readiness ring and More: in that chunk too (Batch C: room in the first download)
const MoreScreen = lazy(() => more().then((m) => ({ default: m.More })));
const Roles = lazy(() => import('./SimpleRoles')); // Phase 6 S1: the role finder
const Setup = lazy(() => import('./SimpleChecklist')); // profile setup P4: the setup card and steps, one lazy chunk
import '../../styles/simple.css';

/** "Loading…", or while a sleeping server wakes up, a plain note that it can take up to a minute (re-test N6). */
export function WaitNote({ t, err }) {
  const waking = useWaking();
  if (err) return <p className="sx-p" role="alert">{err}</p>;
  return (
    <div className="sx-stack" role="status" data-testid="sx-wait">
      <p className="sx-p">{t('simple.loading')}</p>
      {waking && <p className="sx-note" data-testid="sx-waking">{t('simple.waking')}</p>}
    </div>
  );
}

export const LANG_NAMES = [['en', 'English', 'en-IN', 'English'], ['te', 'తెలుగు', 'te-IN', 'Telugu'], ['hi', 'हिंदी', 'hi-IN', 'Hindi']];
// every tile opens a simple screen (items 3, 4, 12): the resume as it is, simple jobs, applications as cards, practice
export const TILES = [['resume', 'file', '/me/simple/myresume'], ['jobs', 'briefcase', '/me/simple/jobs'], ['apps', 'checkc', '/me/simple/apps'], ['practice', 'mic', '/me/simple/practice']];
/** What a screen reads aloud: set once per change of words. */
export const useSay = (setSay, items) => { const k = JSON.stringify(items); useEffect(() => { setSay(items); }, [k]); }; // eslint-disable-line react-hooks/exhaustive-deps

/** The bar at the top of every simple screen: Nm7 home, read this screen, the language, Simple / Full. */
function Top({ t, lang, say, langs, onLang }) {
  const nav = useNavigate();
  const [busy, setBusy] = useState(false);
  const full = async () => {
    setBusy(true);
    try { await savePrefs({ mode: 'full' }); } catch { /* still open the full dashboard */ }
    nav('/me');
  };
  return (
    <header className="sx-top">
      <Link to="/me/simple" className="sx-logo" aria-label={t('simple.home')}>Nm7</Link>
      <span className="sx-top-r">
        <SayButton items={say} t={t} lang={lang} label={t('simple.voice.readScreen')} testid="sx-read-screen" />
        {langs && <label className="sx-chip" data-testid="sx-lang"><Icon name="globe" /><span className="sr-only">{t('lang.label')}</span><select value={lang} onChange={(e) => savePrefs({ lang: e.target.value }).then(onLang, () => {})} data-testid="sx-lang-pick">{LANG_NAMES.map(([c, n]) => <option key={c} value={c} lang={c}>{n}</option>)}</select></label>}
        <span className="sx-seg" role="group" aria-label={t('simple.mode.label')}>
          <button type="button" aria-pressed="true">{t('simple.mode.simple')}</button>
          <button type="button" aria-pressed="false" disabled={busy} onClick={full} data-testid="sx-to-full">{t('simple.mode.full')}</button>
        </span>
      </span>
    </header>
  );
}

function Frame({ t, lang, offline, say, langs, onLang, children }) {
  return (
    <div className="sx" lang={lang}>
      <Top t={t} lang={lang} say={say} langs={langs} onLang={onLang} />
      {offline && <div className="sx-offline" role="status" data-testid="sx-offline">{t('simple.offline')}</div>}
      <main id="main" className="sx-main" tabIndex={-1}>{children}</main>
    </div>
  );
}

/** A big button-link with a short label and, when it helps, one line icon (a ui.jsx Icon name; `after` puts it after
 * the words, for "go on" arrows). Never an icon alone. */
export function Big({ to, icon, label, ink, testid, onClick, after }) {
  const ic = icon && <span className="sx-ic"><Icon name={icon} size={24} /></span>;
  const body = <>{!after && ic}<span>{label}</span>{after && ic}</>;
  return onClick
    ? <button type="button" className={`sx-big${ink ? ' sx-ink' : ''}`} onClick={onClick} data-testid={testid}>{body}</button>
    : <Link to={to} className={`sx-big${ink ? ' sx-ink' : ''}`} data-testid={testid}>{body}</Link>;
}

function Languages({ t, onPicked, setSay }) {
  useSay(setSay, [['simple.lang.title']]);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const pick = async (code) => {
    setBusy(true);
    try { onPicked(await savePrefs({ lang: code })); } catch (e) { setNote(e.message); } finally { setBusy(false); }
  };
  const hear = async (name, voice, english) => { // its own voice, else its English name in an English voice
    setNote('');
    const r = await readAloud(name, voice);
    if (r.ok) return;
    const e = r.reason === 'no_voice' ? await readAloud(english, 'en-IN') : r;
    setNote(e.ok ? t('simple.voice.english') : t('simple.voice.none'));
  };
  return (
    <section className="sx-stack" aria-labelledby="sx-lang-h">
      <h1 id="sx-lang-h" className="sx-h1">{t('simple.lang.title')}</h1>
      {LANG_NAMES.map(([code, name, voice, english]) => (
        <div key={code} className="sx-langrow">
          <button type="button" className="sx-big sx-lang" lang={code} disabled={busy} onClick={() => pick(code)} data-testid={`sx-pick-${code}`}>{name}</button>
          <button type="button" className="sx-say" aria-label={t('simple.lang.hear', { name })} onClick={() => hear(name, voice, english)} data-testid={`sx-hear-${code}`}><Icon name="volume" size={28} /></button>
        </div>
      ))}
      {note && <p className="sx-note" role="status">{note}</p>}
    </section>
  );
}

function Home({ t, lang, d, setSay }) {
  const n = d.next || { key: 'jobs', path: '/me/jobs' };
  const vars = { count: n.count ?? '', score: n.score ?? '', need: n.need ?? '' };
  const card = [['simple.nextLabel'], [`simple.next.${n.key}.title`, vars], [`simple.next.${n.key}.text`, vars], [`simple.next.${n.key}.cta`, vars]];
  useSay(setSay, [d.name ? ['simple.hi', { name: d.name }] : ['simple.hiNoName'], ...card]);
  return (
    <>
      <h1 className="sx-h1">{d.name ? t('simple.hi', { name: d.name }) : t('simple.hiNoName')}</h1>
      <section className="sx-next" aria-labelledby="sx-next-h" data-testid="sx-next" data-key={n.key}>
        <span className="sx-cardtop"><span className="sx-label">{t('simple.nextLabel')}</span><SayButton items={card} t={t} lang={lang} label={t('simple.voice.readCard')} testid="sx-next-say" /></span>
        <h2 id="sx-next-h" className="sx-h2">{t(`simple.next.${n.key}.title`, vars)}</h2>
        <p className="sx-p">{t(`simple.next.${n.key}.text`, vars)}</p>
        <Big to={n.path} icon="arrow" after label={t(`simple.next.${n.key}.cta`, vars)} ink testid="sx-next-go" />
      </section>
      <Suspense fallback={null}><Setup card t={t} lang={lang} /></Suspense>
      {d.readiness && <Big to="/me/simple/ready" label={t('simple.ready.big', { score: d.readiness.score })} testid="sx-ready-link" />}
      <nav className="sx-tiles" aria-label={t('simple.title')}>
        {TILES.map(([k, icon, to]) => <Link key={k} to={to} className="sx-tile" data-testid={`sx-tile-${k}`}><span className="sx-ic"><Icon name={icon} size={30} /></span><span>{t(`simple.tile.${k}`)}</span></Link>)}
      </nav>
      <Big to="/me/simple/more" icon="grid" label={t('simple.tile.more')} testid="sx-more" />
    </>
  );
}

export default function SimpleApp() {
  const [t, lang] = useLang();
  const { data, offline, error, reload, setData } = useSimple();
  const nav = useNavigate();
  const [say, setSay] = useState([]);
  useAutoRead(!!data?.autoRead, say, lang);
  let body;
  if (!data && error) {
    body = <div className="sx-stack" role="alert"><p className="sx-p">{t('simple.error')}</p><Big label={t('simple.retry')} onClick={reload} /></div>;
  } else if (!data) {
    body = <WaitNote t={t} />;
  } else if (!data.on) {
    body = <div className="sx-stack" role="status"><p className="sx-p">{t('simple.off')}</p><Big to="/me" label={t('simple.offLink')} ink /></div>;
  } else {
    const picked = (d) => { setData(d); nav('/me/simple', { replace: true }); };
    const screen = { t, lang, setSay };
    const wait = (el) => <Suspense fallback={<WaitNote t={t} />}>{el}</Suspense>;
    body = (
      <Routes>
        <Route index element={data.lang ? <Home t={t} lang={lang} d={data} setSay={setSay} /> : <Languages t={t} onPicked={setData} setSay={setSay} />} />
        <Route path="language" element={data.langs ? <Languages t={t} onPicked={picked} setSay={setSay} /> : <Navigate to="/me/simple" replace />} />
        <Route path="resume" element={wait(<GuidedResume t={t} lang={lang} setSay={setSay} onDone={reload} />)} />
        <Route path="myresume" element={wait(<MyResume {...screen} />)} />
        <Route path="apps" element={wait(<Apps {...screen} />)} />
        <Route path="practice" element={wait(<Practice {...screen} />)} />
        <Route path="fixes" element={wait(<Fixes {...screen} />)} />
        <Route path="hire" element={wait(<Hire {...screen} />)} />
        <Route path="roles" element={wait(<Roles {...screen} />)} />
        <Route path="setup" element={wait(<Setup {...screen} />)} />
        <Route path="jobs" element={wait(<Jobs {...screen} />)} />
        <Route path="jobs/:id" element={wait(<Apply {...screen} />)} />
        <Route path="auto" element={wait(<AutoOn {...screen} />)} />
        <Route path="answers" element={wait(<Answers {...screen} />)} />
        <Route path="outside" element={wait(<Outside {...screen} />)} />
        <Route path="ready" element={wait(<Ready t={t} lang={lang} d={data} setSay={setSay} />)} />
        <Route path="more" element={wait(<MoreScreen t={t} d={data} setData={setData} setSay={setSay} />)} />
        <Route path="*" element={<Navigate to="/me/simple" replace />} />
      </Routes>
    );
  }
  return <Frame t={t} lang={lang} offline={offline} say={say} langs={!!data?.langs} onLang={setData}>{body}</Frame>;
}
