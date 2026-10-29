// Home page (/): two equal pillars, job seekers and organizations. This file is the top of the page (hero and
// "Start from where you are"), kept small so it paints fast; everything below loads from home/HomeMore.jsx just after
// the first paint (or at once when the page is opened at #templates, #pricing …). No builder, PDF or resume-preview
// code loads here until a button is tapped. Hero, section 2 and the header links speak English, Telugu and Hindi.
import { Suspense, lazy, useEffect, useRef, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import Header from '../components/Header';
import SiteFooter from '../components/SiteFooter';
import LangSwitch from '../components/LangSwitch';
import { headerLabels, useLang } from '../lib/i18n';
import { lazyRetry } from '../lib/chunks';
import { track } from '../lib/track';
import { TEMPLATE_COUNT } from './home/templateMeta';
import '../styles/home.css';

const HomeMore = lazy(lazyRetry(() => import('./home/HomeMore')));
const reduced = () => typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

/** The rotating hero sample: one static image at a time (the first is preloaded in index.html). */
export const HERO_SAMPLES = [
  { src: '/home/hero-btech.webp', name: 'Ananya Reddy', role: 'B.Tech fresher, Hyderabad' },
  { src: '/home/hero-delivery.webp', name: 'Mohammed Irfan', role: 'Delivery partner, Bengaluru' },
  { src: '/home/hero-nurse.webp', name: 'Lalitha Kumari', role: 'Staff nurse, Kochi' },
];

const HIGH = { fetchpriority: 'high' }; // React 18 passes the lower-case attribute through to the browser

function HeroSample({ t }) {
  const [i, setI] = useState(0);
  useEffect(() => {
    if (reduced()) return undefined;
    const warm = setTimeout(() => HERO_SAMPLES.slice(1).forEach((s) => { const im = new Image(); im.src = s.src; }), 2500);
    const turn = setInterval(() => setI((n) => (n + 1) % HERO_SAMPLES.length), 4500);
    return () => { clearTimeout(warm); clearInterval(turn); };
  }, []);
  const s = HERO_SAMPLES[i];
  return (
    <figure className="hx-sample">
      <img src={s.src} width="340" height="481" alt={`Sample resume: ${s.name}, ${s.role}`} decoding="async" {...(i === 0 ? HIGH : {})} />
      <figcaption className="xs muted">{t('hero.sample')} · {s.name}, {s.role}</figcaption>
      <span className="hx-dots" aria-hidden="true">{HERO_SAMPLES.map((x, n) => <i key={x.src} data-on={n === i} />)}</span>
    </figure>
  );
}

const START = [
  ['resume', 'start_resume', '📄'],
  ['papers', 'start_papers', '📷', 'photos'],
  ['nothing', 'start_nothing', '✏️', 'scratch'],
  ['linkedin', 'start_linkedin', '🔗', 'linkedin'],
];

export default function Home() {
  const [t, lang] = useLang();
  const location = useLocation();
  const nav = useNavigate();
  const [more, setMore] = useState(() => !!location.hash || !!location.state?.scanError);
  const [scanError, setScanError] = useState(null);
  const sentinel = useRef();

  // The rest of the page: just after the first paint, or as soon as someone scrolls towards it.
  useEffect(() => {
    if (more) return undefined;
    const go = () => setMore(true);
    const idle = window.requestIdleCallback ? window.requestIdleCallback(go, { timeout: 2500 }) : setTimeout(go, 1200);
    const io = 'IntersectionObserver' in window ? new IntersectionObserver((es) => { if (es.some((e) => e.isIntersecting)) go(); }, { rootMargin: '800px 0px' }) : null;
    if (io && sentinel.current) io.observe(sentinel.current);
    return () => { io?.disconnect(); if (window.cancelIdleCallback) window.cancelIdleCallback(idle); else clearTimeout(idle); };
  }, [more]);
  // <html lang> follows the chosen language while the home page is open (first load included, from the saved
  // nm7-lang choice); the rest of the site is English, so it goes back to "en" on leaving. Parts of this page that
  // stay in English carry lang="en" themselves (main, header, footer).
  useEffect(() => {
    document.documentElement.lang = lang;
    return () => { document.documentElement.lang = 'en'; };
  }, [lang]);
  // Opened at /#pricing (header links) or sent back from a failed scan: load the rest and go there.
  useEffect(() => {
    if (location.state?.scanError) { setScanError(location.state.scanError); setMore(true); nav('/#scan', { replace: true, state: null }); return; }
    if (location.hash) setMore(true);
  }, [location.hash, location.state]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <>
      <Header labels={headerLabels(t)} lang={lang} />
      <main id="main" className="home" data-lang={lang} lang="en">
        {/* 1 · two equal pillars */}
        <section className="hx-hero" aria-labelledby="hero-title" lang={lang}>
          <div className="h-wrap">
            <div className="hx-head">
              <h1 id="hero-title" className="hx-title">{t('hero.title')}</h1>
              <LangSwitch t={t} lang={lang} />
            </div>
            <p className="hx-sub">{t('hero.sub')}</p>
            <div className="hx-split">
              <article className="hx-card" data-kind="seeker" aria-labelledby="seeker-h">
                <h2 id="seeker-h" className="hx-card-title">{t('seeker.label')}</h2>
                <p className="hx-card-text">{t('seeker.text')}</p>
                <Link to="/builder" className="btn btn-ink btn-lg hx-cta" onClick={() => track('hero_build')}>{t('seeker.cta')}</Link>
                <span className="hx-links">
                  <Link to="/builder?start=photos" onClick={() => track('hero_snap')}>{t('seeker.snap')}</Link>
                  <Link to="/builder?start=resume" onClick={() => track('hero_import')}>{t('seeker.import')}</Link>
                </span>
                <ul className="hx-chips" aria-label="Why job seekers use Nm7">
                  <li>{t('seeker.chip.photos')}</li><li>{t('seeker.chip.langs')}</li><li>{t('seeker.chip.templates', { n: TEMPLATE_COUNT })}</li><li>{t('seeker.chip.free')}</li>
                </ul>
              </article>
              <article className="hx-card" data-kind="org" aria-labelledby="org-h">
                <h2 id="org-h" className="hx-card-title">{t('org.label')}</h2>
                <p className="hx-card-text">{t('org.text')}</p>
                <span className="hx-btns">
                  <Link to="/for-orgs" className="btn btn-ink btn-lg hx-cta" onClick={() => { track('hero_org_plans'); track('to_for_orgs'); }}>{t('org.plans')}</Link>
                  <Link to="/for-orgs?start=1#start" className="btn btn-outline btn-lg hx-cta" onClick={() => track('hero_org_start')}>{t('org.start')}</Link>
                </span>
                <ul className="hx-chips" aria-label="What organizations get">
                  <li>{t('org.chip.approvals')}</li><li>{t('org.chip.kiosks')}</li><li>{t('org.chip.template')}</li><li>{t('org.chip.recruiters')}</li><li>{t('org.chip.gst')}</li>
                </ul>
              </article>
              <HeroSample t={t} />
            </div>
          </div>
        </section>

        {/* 2 · start from where you are */}
        <section className="h-pad-sm" aria-labelledby="start-h" lang={lang}>
          <div className="h-wrap stack g20">
            <div className="stack g8">
              <h2 id="start-h" className="h-sec-title">{t('start.title')}</h2>
              <p className="muted" style={{ margin: 0 }}>{t('start.sub')}</p>
            </div>
            <div className="hx-start">
              {START.map(([k, ev, icon, mode = k]) => (
                <Link key={k} to={`/builder?start=${mode}`} className="hx-start-card" onClick={() => track(ev)}>
                  <span className="hx-start-icon" aria-hidden="true">{icon}</span>
                  <strong>{t(`start.${k}.title`)}</strong>
                  <span className="small muted">{t(`start.${k}.text`)}</span>
                </Link>
              ))}
            </div>
          </div>
        </section>

        <div ref={sentinel} />
        {more ? <Suspense fallback={<div className="hx-more-wait" />}><HomeMore lang={lang} t={t} scanError={scanError} /></Suspense> : <div className="hx-more-wait" />}
      </main>
      <SiteFooter />
    </>
  );
}
