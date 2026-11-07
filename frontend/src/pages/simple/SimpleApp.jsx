// The Easy dashboard (Phase 4): /me/simple and its screens, for students who are not comfortable with technology or
// English, often on cheap Android phones with slow internet. One clear next step per screen, big buttons with an
// icon and 1-3 words, large text (18 px and up, 48 px touch targets), no tables, no jargon ("Resume score", never
// "ATS"), every word in English / Telugu / Hindi (src/i18n/pages.json, simple.*). This file and its CSS are their
// own small chunk: nothing from the full dashboard is loaded here.
//   /me/simple            Your next step + 4 tiles + More (the language is asked first, once)
//   /me/simple/language   English / తెలుగు / हिंदी, each with a speaker button
//   /me/simple/more       everything else: links to the full dashboard's pages
import { useState } from 'react';
import { Link, Navigate, Route, Routes, useNavigate } from 'react-router-dom';
import { useLang } from '../../lib/i18n';
import { readAloud } from '../../lib/readAloud';
import { savePrefs, useSimple } from '../../lib/simple';
import '../../styles/simple.css';

export const LANG_NAMES = [['en', 'English', 'en-IN'], ['te', 'తెలుగు', 'te-IN'], ['hi', 'हिंदी', 'hi-IN']];
export const NEXT_ICONS = { resume: '📝', education: '🎓', skills: '🛠️', projects: '💡', fix_score: '📈', auto_apply: '🤖', answer: '💬', jobs: '💼' };
export const TILES = [['resume', '📄', '/builder'], ['jobs', '💼', '/jobs'], ['apps', '📋', '/me/jobs'], ['practice', '🎤', '/me/ats']];
export const MORE = [
  ['resumes', '📄', '/me/resumes'], ['profile', '👤', '/me/profile'], ['ats', '📈', '/me/ats'], ['auto', '🤖', '/me/auto-apply'],
  ['covers', '✉️', '/me/covers'], ['certs', '🏅', '/me/certificates'], ['orders', '🧾', '/me/orders'], ['messages', '💬', '/me/messages'],
  ['share', '🔗', '/me/share'], ['groups', '🏫', '/me/groups'], ['payments', '₹', '/me/payments'], ['settings', '⚙️', '/me/settings'], ['help', '❓', '/me/help'],
];

/** The bar at the top of every simple screen: Nm7 home, the language, Simple / Full. */
function Top({ t, lang }) {
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
        <Link to="/me/simple/language" className="sx-chip" data-testid="sx-lang"><span aria-hidden="true">🌐</span>{LANG_NAMES.find(([c]) => c === lang)?.[1] || 'English'}</Link>
        <span className="sx-seg" role="group" aria-label={t('simple.mode.label')}>
          <button type="button" aria-pressed="true">{t('simple.mode.simple')}</button>
          <button type="button" aria-pressed="false" disabled={busy} onClick={full} data-testid="sx-to-full">{t('simple.mode.full')}</button>
        </span>
      </span>
    </header>
  );
}

function Frame({ t, lang, offline, children }) {
  return (
    <div className="sx" lang={lang}>
      <Top t={t} lang={lang} />
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

function Languages({ t, onPicked }) {
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const pick = async (code) => {
    setBusy(true);
    try { onPicked(await savePrefs({ lang: code })); } catch (e) { setNote(e.message); } finally { setBusy(false); }
  };
  const hear = async (name, voice) => { setNote(''); const r = await readAloud(name, voice); if (!r.ok) setNote(t('simple.voice.none')); };
  return (
    <section className="sx-stack" aria-labelledby="sx-lang-h">
      <h1 id="sx-lang-h" className="sx-h1"><span aria-hidden="true">🌐 </span>{t('simple.lang.title')}</h1>
      {LANG_NAMES.map(([code, name, voice]) => (
        <div key={code} className="sx-langrow">
          <button type="button" className="sx-big sx-lang" lang={code} disabled={busy} onClick={() => pick(code)} data-testid={`sx-pick-${code}`}>{name}</button>
          <button type="button" className="sx-say" aria-label={t('simple.lang.hear', { name })} onClick={() => hear(name, voice)} data-testid={`sx-hear-${code}`}><span aria-hidden="true">🔊</span></button>
        </div>
      ))}
      {note && <p className="sx-note" role="status">{note}</p>}
    </section>
  );
}

function Home({ t, d }) {
  const n = d.next || { key: 'jobs', path: '/me/jobs' };
  const vars = { count: n.count ?? '', score: n.score ?? '', need: n.need ?? '' };
  return (
    <>
      <h1 className="sx-h1">{d.name ? t('simple.hi', { name: d.name }) : t('simple.hiNoName')}</h1>
      <section className="sx-next" aria-labelledby="sx-next-h" data-testid="sx-next" data-key={n.key}>
        <span className="sx-label">{t('simple.nextLabel')}</span>
        <h2 id="sx-next-h" className="sx-h2"><span aria-hidden="true">{NEXT_ICONS[n.key]} </span>{t(`simple.next.${n.key}.title`, vars)}</h2>
        <p className="sx-p">{t(`simple.next.${n.key}.text`, vars)}</p>
        <Big to={n.path} icon="➜" label={t(`simple.next.${n.key}.cta`, vars)} ink testid="sx-next-go" />
      </section>
      <nav className="sx-tiles" aria-label={t('simple.title')}>
        {TILES.map(([k, icon, to]) => <Link key={k} to={to} className="sx-tile" data-testid={`sx-tile-${k}`}><span className="sx-ic" aria-hidden="true">{icon}</span><span>{t(`simple.tile.${k}`)}</span></Link>)}
      </nav>
      <Big to="/me/simple/more" icon="➕" label={t('simple.tile.more')} testid="sx-more" />
    </>
  );
}

function More({ t }) {
  return (
    <section className="sx-stack" aria-labelledby="sx-more-h">
      <h1 id="sx-more-h" className="sx-h1">{t('simple.more.title')}</h1>
      <p className="sx-p">{t('simple.more.sub')}</p>
      <ul className="sx-list">
        {MORE.map(([k, icon, to]) => <li key={k}><Big to={to} icon={icon} label={t(`simple.more.${k}`)} testid={`sx-more-${k}`} /></li>)}
      </ul>
      <Big to="/me" icon="🗂️" label={t('simple.more.full')} testid="sx-more-full" />
      <Big to="/me/simple" icon="←" label={t('simple.back')} />
    </section>
  );
}

export default function SimpleApp() {
  const [t, lang] = useLang();
  const { data, offline, error, reload, setData } = useSimple();
  const nav = useNavigate();
  let body;
  if (!data && error) {
    body = <div className="sx-stack" role="alert"><p className="sx-p">{t('simple.error')}</p><Big icon="↻" label={t('simple.retry')} onClick={reload} /></div>;
  } else if (!data) {
    body = <p className="sx-p" role="status">{t('simple.loading')}</p>;
  } else if (!data.on) {
    body = <div className="sx-stack" role="status"><p className="sx-p">{t('simple.off')}</p><Big to="/me" icon="🗂️" label={t('simple.offLink')} ink /></div>;
  } else {
    const picked = (d) => { setData(d); nav('/me/simple', { replace: true }); };
    body = (
      <Routes>
        <Route index element={data.lang ? <Home t={t} d={data} /> : <Languages t={t} onPicked={setData} />} />
        <Route path="language" element={<Languages t={t} onPicked={picked} />} />
        <Route path="more" element={<More t={t} />} />
        <Route path="*" element={<Navigate to="/me/simple" replace />} />
      </Routes>
    );
  }
  return <Frame t={t} lang={lang} offline={offline}>{body}</Frame>;
}
