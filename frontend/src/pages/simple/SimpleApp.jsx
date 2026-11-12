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
//   /me/simple/more       everything else: links to the full dashboard's pages, "Read screens aloud automatically"
// 🔊 at the top reads each screen's main words (voice.jsx); each card has its own 🔊.
import { Suspense, lazy, useEffect, useState } from 'react';
import { Link, Navigate, Route, Routes, useNavigate } from 'react-router-dom';
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
export const NEXT_ICONS = { resume: '📝', education: '🎓', skills: '🛠️', projects: '💡', fix_score: '📈', auto_apply: '🤖', answer: '💬', jobs: '💼' };
// every tile opens a simple screen (items 3, 4, 12): the resume as it is, simple jobs, applications as cards, practice
export const TILES = [['resume', '📄', '/me/simple/myresume'], ['jobs', '💼', '/me/simple/jobs'], ['apps', '📋', '/me/simple/apps'], ['practice', '🎤', '/me/simple/practice']];
// "Things left" inside the easy dashboard (item 13), not the full pages
export const READY_PATHS = { resume: '/me/simple/resume', score: '/me/simple/fixes', linkedin: '/me/simple/resume?step=about', interview: '/me/simple/practice', skills: '/me/simple/resume?step=skills', roles: '/me/simple/auto', certs: '/me/simple/resume?step=certs' };
export const READY_ICONS = { resume: '📝', score: '📈', linkedin: '🔗', interview: '🎤', skills: '🛠️', roles: '🎯', certs: '🏅' };
export const MORE = [
  ['resumes', '📄', '/me/resumes'], ['profile', '👤', '/me/profile'], ['ats', '📈', '/me/ats'], ['auto', '🤖', '/me/auto-apply'],
  ['covers', '✉️', '/me/covers'], ['certs', '🏅', '/me/certificates'], ['orders', '🧾', '/me/orders'], ['messages', '💬', '/me/messages'],
  ['share', '🔗', '/me/share'], ['groups', '🏫', '/me/groups'], ['payments', '₹', '/me/payments'], ['settings', '⚙️', '/me/settings'], ['help', '❓', '/me/help'],
];

/** What a screen reads aloud: set once per change of words. */
const useSay = (setSay, items) => { const k = JSON.stringify(items); useEffect(() => { setSay(items); }, [k]); }; // eslint-disable-line react-hooks/exhaustive-deps

/** The bar at the top of every simple screen: Nm7 home, read this screen, the language, Simple / Full. */
function Top({ t, lang, say, langs }) {
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
        {langs && <Link to="/me/simple/language" className="sx-chip" data-testid="sx-lang"><span aria-hidden="true">🌐</span>{LANG_NAMES.find(([c]) => c === lang)?.[1] || 'English'}</Link>}
        <span className="sx-seg" role="group" aria-label={t('simple.mode.label')}>
          <button type="button" aria-pressed="true">{t('simple.mode.simple')}</button>
          <button type="button" aria-pressed="false" disabled={busy} onClick={full} data-testid="sx-to-full">{t('simple.mode.full')}</button>
        </span>
      </span>
    </header>
  );
}

function Frame({ t, lang, offline, say, langs, children }) {
  return (
    <div className="sx" lang={lang}>
      <Top t={t} lang={lang} say={say} langs={langs} />
      {offline && <div className="sx-offline" role="status" data-testid="sx-offline"><span aria-hidden="true">📶</span>{t('simple.offline')}</div>}
      <main id="main" className="sx-main" tabIndex={-1}>{children}</main>
    </div>
  );
}

/** A big button-link with an icon and a short label (never an icon alone). */
export function Big({ to, icon, label, ink, testid, onClick }) {
  const body = <><span className="sx-ic" aria-hidden="true">{icon}</span><span>{label}</span></>;
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
      <h1 id="sx-lang-h" className="sx-h1"><span aria-hidden="true">🌐 </span>{t('simple.lang.title')}</h1>
      {LANG_NAMES.map(([code, name, voice, english]) => (
        <div key={code} className="sx-langrow">
          <button type="button" className="sx-big sx-lang" lang={code} disabled={busy} onClick={() => pick(code)} data-testid={`sx-pick-${code}`}>{name}</button>
          <button type="button" className="sx-say" aria-label={t('simple.lang.hear', { name })} onClick={() => hear(name, voice, english)} data-testid={`sx-hear-${code}`}><span aria-hidden="true">🔊</span></button>
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
        <h2 id="sx-next-h" className="sx-h2"><span aria-hidden="true">{NEXT_ICONS[n.key]} </span>{t(`simple.next.${n.key}.title`, vars)}</h2>
        <p className="sx-p">{t(`simple.next.${n.key}.text`, vars)}</p>
        <Big to={n.path} icon="➜" label={t(`simple.next.${n.key}.cta`, vars)} ink testid="sx-next-go" />
      </section>
      {d.readiness && <Big to="/me/simple/ready" icon="🎯" label={t('simple.ready.big', { score: d.readiness.score })} testid="sx-ready-link" />}
      <nav className="sx-tiles" aria-label={t('simple.title')}>
        {TILES.map(([k, icon, to]) => <Link key={k} to={to} className="sx-tile" data-testid={`sx-tile-${k}`}><span className="sx-ic" aria-hidden="true">{icon}</span><span>{t(`simple.tile.${k}`)}</span></Link>)}
      </nav>
      <Big to="/me/simple/more" icon="➕" label={t('simple.tile.more')} testid="sx-more" />
    </>
  );
}

/** The score as a big ring (no image: one SVG circle), with the number in the middle. */
export function Ring({ score, size = 180 }) {
  const r = 42;
  const c = 2 * Math.PI * r;
  return (
    <svg className="sx-ring" width={size} height={size} viewBox="0 0 100 100" aria-hidden="true">
      <circle cx="50" cy="50" r={r} fill="none" stroke="var(--border2)" strokeWidth="10" />
      <circle cx="50" cy="50" r={r} fill="none" stroke="var(--success)" strokeWidth="10" strokeLinecap="round" strokeDasharray={`${(c * score) / 100} ${c}`} transform="rotate(-90 50 50)" />
      <text x="50" y="57" textAnchor="middle" fontSize="24" fontWeight="800" fill="var(--text)">{score}%</text>
    </svg>
  );
}

function Ready({ t, lang, d, setSay }) {
  const r = d.readiness || { score: 0, left: [] };
  useSay(setSay, [['simple.ready.big', { score: r.score }], r.left.length ? ['simple.ready.left'] : ['simple.ready.done'], ...r.left.map((x) => [`simple.ready.item.${x.key}`])]);
  return (
    <section className="sx-stack" aria-labelledby="sx-ready-h" data-testid="sx-ready">
      <h1 id="sx-ready-h" className="sx-h1">{t('simple.ready.title')}</h1>
      <div className="sx-ringrow"><Ring score={r.score} /><p className="sx-h2" data-testid="sx-ready-score">{t('simple.ready.big', { score: r.score })}</p></div>
      <p className="sx-hint">{t('simple.ready.private')}</p>
      {r.left.length ? (
        <>
          <span className="sx-cardtop"><h2 className="sx-h2">{t('simple.ready.left')}</h2><SayButton items={r.left.map((x) => [`simple.ready.item.${x.key}`])} t={t} lang={lang} label={t('simple.voice.readCard')} /></span>
          <ul className="sx-list">
            {r.left.map((x) => <li key={x.key}><Big to={READY_PATHS[x.key] || x.path} icon={READY_ICONS[x.key]} label={`${t(`simple.ready.item.${x.key}`)} · ${t('simple.ready.points', { points: x.points })}`} testid={`sx-left-${x.key}`} /></li>)}
          </ul>
        </>
      ) : <p className="sx-p">{t('simple.ready.done')}</p>}
      <Big to="/me/simple" icon="←" label={t('simple.back')} />
    </section>
  );
}

function More({ t, d, setData, setSay }) {
  useSay(setSay, [['simple.more.title'], ['simple.more.sub']]);
  const [busy, setBusy] = useState(false);
  const auto = async () => {
    setBusy(true);
    try { setData(await savePrefs({ autoRead: !d.autoRead })); } catch { /* stays as it was */ } finally { setBusy(false); }
  };
  return (
    <section className="sx-stack" aria-labelledby="sx-more-h">
      <h1 id="sx-more-h" className="sx-h1">{t('simple.more.title')}</h1>
      <p className="sx-p">{t('simple.more.sub')}</p>
      <ul className="sx-list">
        {MORE.map(([k, icon, to]) => <li key={k}><Big to={to} icon={icon} label={t(`simple.more.${k}`)} testid={`sx-more-${k}`} /></li>)}
      </ul>
      <button type="button" className="sx-big sx-switch" role="switch" aria-checked={!!d.autoRead} disabled={busy} onClick={auto} data-testid="sx-autoread">
        <span className="sx-ic" aria-hidden="true">🔊</span><span>{t('simple.voice.auto')}</span><span className="sx-onoff" aria-hidden="true">{d.autoRead ? t('simple.voice.on') : t('simple.voice.off')}</span>
      </button>
      <Big to="/me" icon="🗂️" label={t('simple.more.full')} testid="sx-more-full" />
      <Big to="/me/simple" icon="←" label={t('simple.back')} />
    </section>
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
    body = <div className="sx-stack" role="alert"><p className="sx-p">{t('simple.error')}</p><Big icon="↻" label={t('simple.retry')} onClick={reload} /></div>;
  } else if (!data) {
    body = <WaitNote t={t} />;
  } else if (!data.on) {
    body = <div className="sx-stack" role="status"><p className="sx-p">{t('simple.off')}</p><Big to="/me" icon="🗂️" label={t('simple.offLink')} ink /></div>;
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
        <Route path="jobs" element={wait(<Jobs {...screen} />)} />
        <Route path="jobs/:id" element={wait(<Apply {...screen} />)} />
        <Route path="auto" element={wait(<AutoOn {...screen} />)} />
        <Route path="answers" element={wait(<Answers {...screen} />)} />
        <Route path="outside" element={wait(<Outside {...screen} />)} />
        <Route path="ready" element={<Ready t={t} lang={lang} d={data} setSay={setSay} />} />
        <Route path="more" element={<More t={t} d={data} setData={setData} setSay={setSay} />} />
        <Route path="*" element={<Navigate to="/me/simple" replace />} />
      </Routes>
    );
  }
  return <Frame t={t} lang={lang} offline={offline} say={say} langs={!!data?.langs}>{body}</Frame>;
}
