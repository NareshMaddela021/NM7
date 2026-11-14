// The new home page, "Blinkit for hiring" (/new-home for now, not indexed). Four equal audiences: companies, colleges,
// job seekers and students. The hero's tabs (?for=company|college|seeker|student) change the headline, the 3D shape,
// the glass widget and the main button. Scrolling morphs the shape to each section's own. Live numbers come only
// from the jobs API. To make this the home page, point the "/" route in App.jsx at this page (see the README).
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { LIVE } from '../../services/http';
import { pageQuery, placeText, postedAgo, salaryText, searchJobs } from '../../lib/jobBoard';
import { translate } from '../../lib/i18n';
import { homeFor, useAuth } from '../../lib/auth';
import { usePageMeta } from '../../lib/meta';
import ParticleStage from './ParticleStage';
import GlassWidget, { reducedMotion } from './GlassWidget';
import { AUDIENCES, EXPERIENCE_TEXT, FAQ, JOB_CHIPS, META, SECTIONS, TRUST, audienceFor, structuredData, widgetFor } from './content';
import './newhome.css';

const en = (k, v) => translate('en', k, v);

/* ---------- live jobs: the totals for the widget, and the newest jobs ---------- */

/** { total, today, city, items, cities } from GET /api/jobs, or { failed: true }; null while loading. */
export function useLiveJobs() {
  const [live, setLive] = useState(null);
  useEffect(() => {
    if (!LIVE) { setLive({ failed: true }); return undefined; }
    let dead = false;
    Promise.all([searchJobs({}), searchJobs({ posted: '24h' })])
      .then(([all, today]) => { if (!dead) setLive({ total: all.total, today: today.total, city: all.cities?.[0] || '', items: all.items || [], cities: all.cities || [] }); })
      .catch(() => { if (!dead) setLive({ failed: true }); });
    return () => { dead = true; };
  }, []);
  return live;
}

/* ---------- which shape the dots show: the section in the middle of the screen ---------- */

const wideScreen = () => typeof window !== 'undefined' && window.matchMedia?.('(min-width: 960px)').matches;

function useSpot(root) {
  const [spot, setSpot] = useState({ id: 'hero', shape: '', side: 1 });
  const [wide, setWide] = useState(wideScreen);
  useEffect(() => {
    const mq = window.matchMedia?.('(min-width: 960px)');
    const on = () => setWide(mq.matches);
    mq?.addEventListener?.('change', on);
    return () => mq?.removeEventListener?.('change', on);
  }, []);
  useEffect(() => {
    if (!root.current || typeof IntersectionObserver === 'undefined') return undefined;
    const io = new IntersectionObserver((entries) => {
      const hit = entries.filter((e) => e.isIntersecting).pop();
      if (hit) {
        const el = hit.target;
        setSpot({ id: el.dataset.spot || '', shape: el.dataset.shape, side: Number(el.dataset.side || 1), dim: el.dataset.dim === '1' });
      }
    }, { rootMargin: '-45% 0px -45% 0px' });
    root.current.querySelectorAll('[data-shape]').forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, [root]);
  return { spot, wide };
}

/** Cards slide in as they reach the screen (shown at once with "reduce motion" or without IntersectionObserver). */
function useReveal(root) {
  useEffect(() => {
    const els = root.current ? [...root.current.querySelectorAll('.nh-reveal')] : [];
    if (reducedMotion() || typeof IntersectionObserver === 'undefined') { els.forEach((el) => el.classList.add('is-in')); return undefined; }
    root.current.classList.add('nh-js');
    const io = new IntersectionObserver((entries) => entries.forEach((e) => {
      if (e.isIntersecting) { e.target.classList.add('is-in'); io.unobserve(e.target); }
    }), { rootMargin: '0px 0px -8% 0px' });
    els.forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, [root]);
}

/** Organization, WebSite search box and FAQ structured data in the page head (removed when the page closes). */
function useStructuredData() {
  useEffect(() => {
    const tags = structuredData().map((d, i) => {
      const s = document.createElement('script');
      s.type = 'application/ld+json';
      s.id = `nh-ld-${i}`;
      s.textContent = JSON.stringify(d);
      document.head.appendChild(s);
      return s;
    });
    return () => tags.forEach((s) => s.remove());
  }, []);
}

/* ---------- pieces ---------- */

function Header() {
  const { user } = useAuth();
  return (
    <header className="nh-header">
      <div className="nh-wrap nh-header-in">
        <Link to="/" className="nh-logo" aria-label="Nm7 home"><span aria-hidden="true">nm</span>7</Link>
        <nav aria-label="Main" className="nh-nav">
          <Link to="/jobs">Jobs</Link>
          <Link to="/for-companies">Companies</Link>
          <Link to="/for-orgs">Colleges</Link>
          {user ? <Link to={homeFor(user)} className="nh-nav-pill">My dashboard</Link> : <Link to="/login" className="nh-nav-pill">Sign in</Link>}
        </nav>
      </div>
    </header>
  );
}

function Tabs({ current, onPick }) {
  const refs = useRef([]);
  const onKey = (e, i) => {
    const n = AUDIENCES.length;
    const to = { ArrowRight: (i + 1) % n, ArrowDown: (i + 1) % n, ArrowLeft: (i - 1 + n) % n, ArrowUp: (i - 1 + n) % n, Home: 0, End: n - 1 }[e.key];
    if (to === undefined) return;
    e.preventDefault();
    onPick(AUDIENCES[to].key);
    refs.current[to]?.focus();
  };
  return (
    <div className="nh-tabs" role="tablist" aria-label="Who are you?">
      {AUDIENCES.map((a, i) => {
        const on = a.key === current;
        return (
          <button key={a.key} ref={(el) => { refs.current[i] = el; }} type="button" role="tab" id={`nh-tab-${a.key}`} aria-selected={on} aria-controls="nh-panel"
            tabIndex={on ? 0 : -1} className="nh-tab" data-testid={`nh-tab-${a.key}`} onClick={() => onPick(a.key)} onKeyDown={(e) => onKey(e, i)}>
            {a.tab}
          </button>
        );
      })}
    </div>
  );
}

function JobSearch({ cities }) {
  const nav = useNavigate();
  const [q, setQ] = useState('');
  const [city, setCity] = useState('');
  const go = (e) => {
    e.preventDefault();
    const qs = pageQuery({ q: q.trim(), city: city.trim() });
    nav(`/jobs${qs ? `?${qs}` : ''}`);
  };
  return (
    <form className="nh-search" role="search" aria-label="Search jobs" onSubmit={go}>
      <label className="nh-field">
        <span>Role or skill</span>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="e.g. Data analyst, Java, Sales" maxLength={80} data-testid="nh-q" />
      </label>
      <label className="nh-field">
        <span>City</span>
        <input value={city} onChange={(e) => setCity(e.target.value)} placeholder="Any city" list="nh-cities" maxLength={60} data-testid="nh-city" />
        <datalist id="nh-cities">{cities.map((c) => <option key={c} value={c} />)}</datalist>
      </label>
      <button type="submit" className="nh-btn nh-btn-solid">Search jobs</button>
    </form>
  );
}

function Hero({ aud, onPick, live }) {
  const w = widgetFor(aud.key, live);
  return (
    <section className="nh-hero" data-shape={aud.shape} data-spot="hero" data-side="1" aria-labelledby="nh-h1">
      <span className="nh-bigword" aria-hidden="true">HIRED</span>
      <div className="nh-wrap nh-hero-in">
        <p className="nh-kicker">Nm7 · hiring, delivered fast</p>
        <h1 id="nh-h1" className="nh-h1">Blinkit for hiring.</h1>
        <Tabs current={aud.key} onPick={onPick} />
        <div className="nh-panel" role="tabpanel" id="nh-panel" aria-labelledby={`nh-tab-${aud.key}`}>
          <div className="nh-panel-text">
            <h2 className="nh-headline" data-testid="nh-headline">{aud.headline}</h2>
            <p className="nh-sub">{aud.sub}</p>
            <Link to={aud.cta.to} className="nh-btn nh-btn-solid nh-btn-big" data-testid="nh-cta">{aud.cta.label}</Link>
          </div>
          <GlassWidget w={w} audience={aud.key} />
        </div>
        <JobSearch cities={live?.cities || []} />
      </div>
    </section>
  );
}

function Cards({ cards }) {
  return (
    <div className="nh-cards">
      {cards.map((c, i) => (
        <article key={c.title} className="nh-card nh-reveal" style={{ '--i': i }}>
          <h3>{c.title}</h3>
          <p>{c.text}</p>
          {c.to && <Link to={c.to} className="nh-card-link">{c.link} <span aria-hidden="true">→</span></Link>}
        </article>
      ))}
    </div>
  );
}

function AudienceSection({ s, side }) {
  return (
    <section id={s.id} className="nh-sec" data-side-layout={side > 0 ? 'right' : 'left'} aria-labelledby={`${s.id}-h`}>
      <div className="nh-wrap nh-sec-grid">
        <div className="nh-sec-body">
          <div data-shape={s.shape} data-side={side} data-spot={s.id}>
            <p className="nh-kicker">{s.kicker}</p>
            <h2 id={`${s.id}-h`} className="nh-h2">{s.title}</h2>
          </div>
          {s.flow && (
            <ol className="nh-flow nh-reveal" aria-label="The 30-minute flow">
              {s.flow.map((f, i) => <li key={f}><span className="nh-flow-n">{i + 1}</span>{f}</li>)}
            </ol>
          )}
          {s.journey && (
            <ol className="nh-journey" aria-label="The 360° journey">
              {s.journey.map((j, i) => (
                <li key={j.step} className="nh-reveal" style={{ '--i': i }} data-shape={j.shape} data-side={side} data-spot={`${s.id}-${i}`}>
                  <Link to={j.to}>
                    <span className="nh-j-n">{String(i + 1).padStart(2, '0')}</span>
                    <span className="nh-j-step">{j.step}</span>
                    <span className="nh-j-text">{j.text}</span>
                  </Link>
                </li>
              ))}
            </ol>
          )}
          <Cards cards={s.cards} />
        </div>
        <div className="nh-sec-slot" aria-hidden="true" />
      </div>
    </section>
  );
}

function LiveJobs({ live }) {
  const [chip, setChip] = useState(null); // [label, filter]
  const [list, setList] = useState(null);
  const [hover, setHover] = useState(null);
  const cityChips = (live?.cities || []).slice(0, 4).map((c) => [c, { city: c }]);
  useEffect(() => {
    if (!chip) { setList(live?.items ? { items: live.items, total: live.total } : null); return undefined; }
    let dead = false;
    setList(null);
    searchJobs(chip[1]).then((r) => { if (!dead) setList({ items: r.items, total: r.total }); }).catch(() => { if (!dead) setList({ items: [], total: 0, failed: true }); });
    return () => { dead = true; };
  }, [chip, live]);
  const rows = (list?.items || []).slice(0, 6);
  const shown = hover && rows.find((j) => j.id === hover) ? rows.find((j) => j.id === hover) : rows[0];
  const all = `/jobs${chip ? `?${pageQuery(chip[1])}` : ''}`;
  return (
    <section id="live-jobs" className="nh-sec" aria-labelledby="live-h">
      <div className="nh-wrap">
        <div data-shape="briefcase" data-side="1" data-dim="1" data-spot="live">
          <p className="nh-kicker">Live jobs</p>
          <h2 id="live-h" className="nh-h2">The newest real jobs</h2>
        </div>
        {live?.failed ? (
          <p className="nh-muted">Live jobs show here. <Link to="/jobs">Open the job board</Link></p>
        ) : (
          <>
            <div className="nh-chips" role="group" aria-label="Filter the live jobs">
              {[...JOB_CHIPS, ...cityChips].map((c) => {
                const on = chip?.[0] === c[0];
                return <button key={c[0]} type="button" className="nh-chip" aria-pressed={on} onClick={() => setChip(on ? null : c)}>{c[0]}</button>;
              })}
            </div>
            <div className="nh-live">
              <ul className="nh-live-list" data-testid="nh-live-list" aria-busy={!list}>
                {!list && [0, 1, 2, 3].map((i) => <li key={i} className="nh-live-skel" aria-hidden="true"><i /><i /></li>)}
                {list && !rows.length && <li className="nh-muted">No jobs for this filter right now. <Link to="/jobs">See all jobs</Link></li>}
                {rows.map((j) => (
                  <li key={j.id}>
                    <Link to={`/jobs/${j.slug}`} className="nh-live-row" data-testid="nh-live-row" onMouseEnter={() => setHover(j.id)} onFocus={() => setHover(j.id)}>
                      <span className="nh-live-title">{j.title}</span>
                      <span className="nh-live-meta">{[j.company?.name, placeText(j, en), EXPERIENCE_TEXT[j.experience]].filter(Boolean).join(' · ')}</span>
                      <span className="nh-live-when">{postedAgo(j.postedAt, en)}</span>
                    </Link>
                  </li>
                ))}
              </ul>
              {shown && (
                <aside className="nh-live-detail nh-glass" aria-label="Job details" data-testid="nh-live-detail">
                  <p className="nh-kicker">{shown.company?.name}{shown.companyTrust?.level === 'verified' ? ' · Verified company' : ''}</p>
                  <h3>{shown.title}</h3>
                  <dl>
                    {placeText(shown, en) && <><dt>Where</dt><dd>{placeText(shown, en)}</dd></>}
                    <dt>Experience</dt><dd>{EXPERIENCE_TEXT[shown.experience] || '—'}</dd>
                    {salaryText(shown.salary) && <><dt>Salary</dt><dd>{salaryText(shown.salary)}</dd></>}
                    {!!shown.skills?.length && <><dt>Skills</dt><dd>{shown.skills.slice(0, 6).join(', ')}</dd></>}
                    {shown.fromCareersPage && <><dt>Source</dt><dd>Company careers page</dd></>}
                  </dl>
                  <Link to={`/jobs/${shown.slug}`} className="nh-card-link">View this job <span aria-hidden="true">→</span></Link>
                </aside>
              )}
            </div>
            <Link to={all} className="nh-btn nh-btn-ghost">{list?.total ? `See all ${list.total.toLocaleString('en-IN')} jobs` : 'See all jobs'}</Link>
          </>
        )}
      </div>
    </section>
  );
}

function Trust() {
  return (
    <section id="trust" className="nh-sec" aria-labelledby="trust-h">
      <div className="nh-wrap">
        <div data-shape="badge" data-side="1" data-dim="1" data-spot="trust">
          <p className="nh-kicker">Trust and safety</p>
          <h2 id="trust-h" className="nh-h2">Safe for everyone who uses it</h2>
        </div>
        <Cards cards={TRUST} />
      </div>
    </section>
  );
}

const NODES = [
  ['Colleges', 'Run drives and share ready resumes, with consent.'],
  ['Students & job seekers', 'Learn, prove skills, build a resume and apply.'],
  ['Nm7', 'Matches, shortlists, interviews and offers.'],
  ['Companies', 'Hire any role in 30 minutes.'],
];

function Connect() {
  return (
    <section id="how" className="nh-sec" aria-labelledby="how-h">
      <div className="nh-wrap">
        <div data-shape="handshake" data-side="-1" data-spot="how">
          <p className="nh-kicker">How it connects</p>
          <h2 id="how-h" className="nh-h2">Colleges, people and companies, through Nm7</h2>
        </div>
        <ol className="nh-connect">
          {NODES.map(([name, text], i) => (
            <li key={name} className={`nh-node nh-reveal${name === 'Nm7' ? ' nh-node-hub' : ''}`} style={{ '--i': i }}>
              <strong>{name}</strong><span>{text}</span>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}

function Faq() {
  return (
    <section id="faq" className="nh-sec" aria-labelledby="faq-h">
      <div className="nh-wrap">
        <div data-shape="sphere" data-side="1" data-dim="1" data-spot="faq">
          <p className="nh-kicker">Questions</p>
          <h2 id="faq-h" className="nh-h2">Answers for each of you</h2>
        </div>
        <div className="nh-faq">
          {FAQ.map(([group, qs]) => (
            <div key={group} className="nh-faq-group">
              <h3>{group}</h3>
              {qs.map(([q, a]) => (
                <details key={q} className="nh-faq-item">
                  <summary>{q}</summary>
                  <p>{a}</p>
                </details>
              ))}
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function FinalCall() {
  return (
    <section className="nh-final" aria-labelledby="final-h" data-shape="sphere" data-side="0" data-spot="final">
      <svg className="nh-wave" viewBox="0 0 1440 320" preserveAspectRatio="none" aria-hidden="true" focusable="false">
        <defs>
          <linearGradient id="nh-wave-g" x1="0" x2="1">
            <stop offset="0" stopColor="#3b5bff" /><stop offset="0.5" stopColor="#8b5cf6" /><stop offset="1" stopColor="#3b5bff" />
          </linearGradient>
        </defs>
        <g className="nh-wave-a"><path d="M0 180 C 240 120 480 240 720 180 S 1200 120 1440 180 S 1920 240 2160 180 S 2640 120 2880 180 V320 H0Z" fill="url(#nh-wave-g)" opacity="0.35" /></g>
        <g className="nh-wave-b"><path d="M0 220 C 240 260 480 160 720 220 S 1200 260 1440 220 S 1920 160 2160 220 S 2640 260 2880 220 V320 H0Z" fill="url(#nh-wave-g)" opacity="0.5" /></g>
      </svg>
      <div className="nh-wrap nh-final-in">
        <h2 id="final-h" className="nh-h2">Hiring, delivered fast.</h2>
        <p className="nh-sub">Pick where you start.</p>
        <div className="nh-final-btns">
          {AUDIENCES.map((a) => <Link key={a.key} to={a.cta.to} className="nh-btn nh-btn-solid">{a.cta.label}<span className="nh-btn-who">{a.who}</span></Link>)}
        </div>
      </div>
    </section>
  );
}

function Footer() {
  return (
    <footer className="nh-footer">
      <div className="nh-wrap nh-footer-in">
        <span>Nm7 · nm7.si</span>
        <nav aria-label="Site links">
          <Link to="/terms">Terms</Link>
          <Link to="/privacy">Privacy</Link>
          <Link to="/contact">Contact</Link>
          <Link to="/contact?topic=job-removal">Request job removal</Link>
          <Link to="/for-companies">For companies</Link>
          <Link to="/for-orgs">For colleges</Link>
          <Link to="/blog">Blog</Link>
          <Link to="/accessibility">Accessibility</Link>
        </nav>
      </div>
    </footer>
  );
}

/* ---------- the page ---------- */

export default function NewHome() {
  const { pathname } = useLocation();
  // not indexed while it is a test page; indexed as soon as it is the home page
  usePageMeta(useMemo(() => ({ ...META, noindex: pathname !== '/' }), [pathname]));
  useStructuredData();
  const [params, setParams] = useSearchParams();
  const aud = audienceFor(params.get('for'));
  const pick = (key) => setParams((p) => { const n = new URLSearchParams(p); n.set('for', key); return n; }, { replace: true, preventScrollReset: true });
  const live = useLiveJobs();
  const root = useRef(null);
  const { spot, wide } = useSpot(root);
  useReveal(root);
  const shape = spot.id === 'hero' || !spot.shape ? aud.shape : spot.shape;
  const side = wide ? spot.side : 0;
  return (
    <div className="nh" ref={root}>
      <Header />
      <ParticleStage shape={shape} side={side} dim={!!spot.dim && wide} />
      <main id="main" className="nh-main">
        <Hero aud={aud} onPick={pick} live={live} />
        {SECTIONS.map((s, i) => <AudienceSection key={s.id} s={s} side={i % 2 === 0 ? 1 : -1} />)}
        <LiveJobs live={live} />
        <Trust />
        <Connect />
        <Faq />
        <FinalCall />
      </main>
      <Footer />
    </div>
  );
}
