// The public job board (J3). /jobs: search by role, skill or company, filters (experience, city or remote, job type,
// work type, salary, posted within), newest first, "Show more" for the next 20; the filters live in the URL so a
// filtered list can be shared. /jobs/<slug>: the whole job with "posted 2 days ago", apply, Save, Share on WhatsApp,
// Google JobPosting data while it is open; a closed job says so, drops the markup, isn't indexed, and shows similar
// jobs. English, Telugu and Hindi (pages.json, jobs.*). Company logos aren't loaded (the page only loads images from
// our own site); a letter stands in.
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import Header from '../../components/Header';
import LangSwitch from '../../components/LangSwitch';
import SiteFooter from '../../components/SiteFooter';
import { useAuth } from '../../lib/auth';
import { headerLabels, useLang } from '../../lib/i18n';
import {
  EXPERIENCE, JOB_TYPES, ORIGIN, POSTED, SALARIES, WORK_TYPES, fromQuery, getJob, jobPostingJsonLd, listSaved, loadSaved,
  pageQuery, placeText, postedAgo, salaryText, searchJobs, toggleSaved, useJsonLd, useSaved,
} from '../../lib/jobBoard';
import { usePageMeta } from '../../lib/meta';
import { waShareUrl } from '../../lib/shareLink';

const lakh = (n) => `₹${n / 100000} L`;

/** The facts line: "Acme · Hyderabad, Pune · Fresher · Full-time · ₹3,00,000 – ₹4,50,000 a year". */
function facts(j, t) {
  return [placeText(j, t), t(`jobs.exp.${j.experience}`), t(`jobs.type.${j.jobType}`), j.workType !== 'onsite' && !j.remote ? t(`jobs.work.${j.workType}`) : '', salaryText(j.salary, t)].filter(Boolean).join(' · ');
}

function Logo({ name }) {
  return <span className="job-logo" aria-hidden="true">{(name || '?').trim().charAt(0).toUpperCase()}</span>;
}

function SaveButton({ job, t }) {
  const { user } = useAuth();
  const saved = useSaved();
  const nav = useNavigate();
  const { pathname, search } = useLocation();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const on = saved.has(job.id);
  const click = async () => {
    if (!user) { nav(`/login?next=${encodeURIComponent(pathname + search)}`); return; }
    setBusy(true); setErr('');
    try { await toggleSaved(job.id); } catch { setErr(t('jobs.save.error')); } finally { setBusy(false); }
  };
  return (
    <>
      <button type="button" className="btn btn-outline" aria-pressed={on} disabled={busy} onClick={click} aria-label={`${on ? t('jobs.saved') : t('jobs.save')}: ${job.title}`}>
        <span aria-hidden="true">{on ? '★' : '☆'}</span> {on ? t('jobs.saved') : t('jobs.save')}
      </button>
      {err && <span role="alert" className="xs" style={{ color: 'var(--danger)' }}>{err}</span>}
    </>
  );
}

export function JobCard({ job, t, extra }) {
  return (
    <article className="card-sm job-card" data-testid="job-card">
      <div className="row g12" style={{ alignItems: 'flex-start', flexWrap: 'nowrap' }}>
        <Logo name={job.company?.name} />
        <div className="stack g4" style={{ minWidth: 0, flex: 1 }}>
          <h2 className="job-card-title"><Link to={`/jobs/${job.slug}`}>{job.title}</Link></h2>
          <span className="job-company">{job.company?.name}</span>
          <span className="xs muted job-facts">{facts(job, t)}</span>
          {job.skills?.length > 0 && (
            <ul className="job-skills" aria-label={t('jobs.skills')}>
              {job.skills.slice(0, 5).map((s) => <li key={s} className="badge b-neutral">{s}</li>)}
            </ul>
          )}
          {extra}
          <div className="row g8 job-card-foot">
            <span className="xs muted">{postedAgo(job.postedAt, t)}</span>
            {job.status === 'active' && <SaveButton job={job} t={t} />}
          </div>
        </div>
      </div>
    </article>
  );
}

function Select({ id, label, value, onChange, options }) {
  return (
    <div className="field">
      <label className="label" htmlFor={id}>{label}</label>
      <select id={id} className="input" value={value || ''} onChange={(e) => onChange(e.target.value)}>
        {options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
      </select>
    </div>
  );
}

/* ---------------------------------------- /jobs ---------------------------------------- */

export function JobsList() {
  const [t, lang] = useLang();
  const { user } = useAuth();
  const [params, setParams] = useSearchParams();
  const filters = useMemo(() => fromQuery(params.toString()), [params]);
  const showSaved = params.get('saved') === '1' && !!user;
  const [q, setQ] = useState(filters.q || '');
  const [data, setData] = useState(null); // { items, total, page, pages, cities }
  const [more, setMore] = useState(false);
  const [error, setError] = useState('');
  const savedState = useSaved();
  const key = pageQuery(filters);
  const seq = useRef(0);
  usePageMeta({ title: t('jobs.meta.title'), description: t('jobs.meta.desc'), path: '/jobs' });

  useEffect(() => { setQ(filters.q || ''); }, [filters.q]);
  useEffect(() => { if (user) loadSaved(); }, [user]);
  useEffect(() => {
    const n = ++seq.current;
    setData(null); setError('');
    const load = showSaved ? listSaved().then((r) => ({ items: r.items, total: r.items.length, page: 1, pages: 1, cities: [] })) : searchJobs(filters);
    load.then((r) => { if (n === seq.current) setData(r); }, () => { if (n === seq.current) setError(t('jobs.error')); });
  }, [key, showSaved]); // eslint-disable-line react-hooks/exhaustive-deps

  const set = (patch) => {
    const next = { ...filters, ...patch };
    const qs = pageQuery(next);
    setParams(qs ? new URLSearchParams(qs) : {}, { replace: false });
  };
  const loadMore = async () => {
    setMore(true);
    try {
      const r = await searchJobs(filters, data.page + 1);
      setData((d) => ({ ...r, items: [...d.items, ...r.items], cities: d.cities }));
    } catch { setError(t('jobs.error')); } finally { setMore(false); }
  };
  const cities = data?.cities || [];
  const anyFilter = Object.keys(filters).some((k) => k !== 'sort');

  return (
    <>
      <Header labels={headerLabels(t)} lang={lang} />
      <main id="main" className="container stack g20 jobs-page" lang={lang}>
        <div className="row g12" style={{ justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <div className="stack g8" style={{ minWidth: 0, flex: '1 1 320px' }}>
            <h1 className="display jobs-h1">{showSaved ? t('jobs.savedTitle') : t('jobs.title')}</h1>
            <p className="lead" style={{ margin: 0 }}>{showSaved ? t('jobs.savedSub') : t('jobs.sub')}</p>
          </div>
          <LangSwitch t={t} lang={lang} />
        </div>

        {!showSaved && (
          <form className="stack g12 card-sm" role="search" aria-label={t('jobs.search.form')} onSubmit={(e) => { e.preventDefault(); set({ q: q.trim() }); }}>
            <div className="row g8" style={{ alignItems: 'flex-end', flexWrap: 'nowrap' }}>
              <div className="field" style={{ flex: 1 }}>
                <label className="label" htmlFor="job-q">{t('jobs.search.label')}</label>
                <input id="job-q" className="input" type="search" value={q} maxLength={80} placeholder={t('jobs.search.placeholder')} onChange={(e) => setQ(e.target.value)} />
              </div>
              <button type="submit" className="btn btn-ink">{t('jobs.search.button')}</button>
            </div>
            <div className="jobs-filters">
              <Select id="f-exp" label={t('jobs.f.experience')} value={filters.experience} onChange={(v) => set({ experience: v })}
                options={[['', t('jobs.f.any')], ...EXPERIENCE.map((e) => [e, t(`jobs.exp.${e}`)])]} />
              <Select id="f-city" label={t('jobs.f.city')} value={filters.city} onChange={(v) => set({ city: v })}
                options={[['', t('jobs.f.anywhere')], ['remote', t('jobs.remote')], ...(filters.city && filters.city !== 'remote' && !cities.includes(filters.city) ? [filters.city] : []).concat(cities).map((c) => [c, c])]} />
              <Select id="f-type" label={t('jobs.f.jobType')} value={filters.jobType} onChange={(v) => set({ jobType: v })}
                options={[['', t('jobs.f.any')], ...JOB_TYPES.map((x) => [x, t(`jobs.type.${x}`)])]} />
              <Select id="f-work" label={t('jobs.f.workType')} value={filters.workType} onChange={(v) => set({ workType: v })}
                options={[['', t('jobs.f.any')], ...WORK_TYPES.map((x) => [x, t(`jobs.work.${x}`)])]} />
              <Select id="f-salary" label={t('jobs.f.salary')} value={filters.salary ? String(filters.salary) : ''} onChange={(v) => set({ salary: v ? Number(v) : '' })}
                options={[['', t('jobs.f.any')], ...SALARIES.map((n) => [String(n), t('jobs.f.salaryAtLeast', { amount: lakh(n) })])]} />
              <Select id="f-posted" label={t('jobs.f.posted')} value={filters.posted} onChange={(v) => set({ posted: v })}
                options={[['', t('jobs.f.anyTime')], ...POSTED.map((x) => [x, t(`jobs.f.posted.${x}`)])]} />
            </div>
          </form>
        )}

        <div className="row g12" style={{ justifyContent: 'space-between' }}>
          <p className="xs muted" aria-live="polite" style={{ margin: 0 }} data-testid="jobs-count">
            {data ? t(data.total === 1 ? 'jobs.count.one' : 'jobs.count', { n: data.total.toLocaleString('en-IN') }) : error ? '' : t('jobs.loading')}
          </p>
          <span className="row g12">
            {anyFilter && !showSaved && <button type="button" className="link-btn" onClick={() => setParams({})}>{t('jobs.clear')}</button>}
            {user && (showSaved
              ? <Link to="/jobs">{t('jobs.allJobs')}</Link>
              : <Link to="/jobs?saved=1">{t('jobs.savedLink', { n: savedState.count })}</Link>)}
          </span>
        </div>

        {error && <p role="alert" className="card-sm" style={{ margin: 0 }}>{error}</p>}
        {data && data.items.length === 0 && (
          <div className="card-sm stack g8" data-testid="jobs-empty">
            <strong>{showSaved ? t('jobs.savedEmpty') : anyFilter ? t('jobs.empty') : t('jobs.emptyAll')}</strong>
            {anyFilter && !showSaved && <span className="xs muted">{t('jobs.emptyHint')}</span>}
          </div>
        )}
        {data && data.items.length > 0 && (
          <div className="stack g12" data-testid="jobs-list">
            {data.items.map((j) => <JobCard key={j.id} job={j} t={t} />)}
          </div>
        )}
        {data && data.page < data.pages && !showSaved && (
          <button type="button" className="btn btn-outline" style={{ alignSelf: 'center' }} disabled={more} onClick={loadMore}>
            {more ? t('jobs.loading') : t('jobs.more')}
          </button>
        )}
      </main>
      <SiteFooter />
    </>
  );
}

/* ---------------------------------------- /jobs/<slug> ---------------------------------------- */

function ApplyBox({ job, t }) {
  const { user } = useAuth();
  const { pathname } = useLocation();
  if (job.apply.method === 'link' && job.apply.url) {
    return <a className="btn btn-ink" href={job.apply.url} target="_blank" rel="noopener noreferrer nofollow" data-testid="apply">{t('jobs.apply.link')} <span aria-hidden="true">↗</span></a>;
  }
  if (!user) return <Link className="btn btn-ink" to={`/login?next=${encodeURIComponent(pathname)}`} data-testid="apply">{t('jobs.apply.signin')}</Link>;
  return <p className="xs muted" style={{ margin: 0 }} data-testid="apply">{job.apply.method === 'email' ? t('jobs.apply.emailSoon') : t('jobs.apply.nm7Soon')}</p>;
}

export function JobPage() {
  const [t, lang] = useLang();
  const { slug } = useParams();
  const { user } = useAuth();
  const [job, setJob] = useState(null);
  const [state, setState] = useState('loading'); // loading | ok | gone | error
  useEffect(() => {
    let live = true;
    setState('loading');
    getJob(slug).then((j) => { if (live) { setJob(j); setState('ok'); } }, (e) => { if (live) setState(e?.status === 404 ? 'gone' : 'error'); });
    return () => { live = false; };
  }, [slug]);
  useEffect(() => { if (user) loadSaved(); }, [user]);
  const closed = job?.status !== 'active';
  const title = state === 'ok' ? `${closed ? `${t('jobs.closed')}: ` : ''}${job.title} · ${job.company.name}` : state === 'gone' ? t('jobs.gone.title') : t('jobs.meta.title');
  const desc = state === 'ok' ? `${job.title} at ${job.company.name}${job.locations.length ? `, ${job.locations.join(', ')}` : ''}. ${job.description.replace(/\s+/g, ' ').slice(0, 120)}` : t('jobs.meta.desc');
  usePageMeta({ title, description: desc, noindex: state !== 'ok' || closed, path: `/jobs/${slug}` });
  useJsonLd(state === 'ok' ? jobPostingJsonLd(job) : null);

  const share = job && waShareUrl(t('jobs.share.text', { title: job.title, company: job.company.name, link: `${ORIGIN}/jobs/${job.slug}` }));

  return (
    <>
      <Header labels={headerLabels(t)} lang={lang} />
      <main id="main" className="container stack g20 jobs-page" lang={lang}>
        <nav aria-label={t('jobs.crumbs')} className="xs"><Link to="/jobs">{t('jobs.crumb')}</Link>{job && state === 'ok' ? <> / <span>{job.title}</span></> : null}</nav>
        {state === 'loading' && <p className="muted" aria-live="polite">{t('jobs.loading')}</p>}
        {state === 'error' && <p role="alert" className="card-sm">{t('jobs.error')}</p>}
        {state === 'gone' && (
          <div className="card-sm stack g12" data-testid="job-gone">
            <h1 className="display jobs-h1">{t('jobs.gone.title')}</h1>
            <p style={{ margin: 0 }}>{t('jobs.gone.sub')}</p>
            <Link className="btn btn-ink" to="/jobs" style={{ alignSelf: 'flex-start' }}>{t('jobs.allJobs')}</Link>
          </div>
        )}
        {state === 'ok' && (
          <>
            <article className="card stack g16 job-detail" data-testid="job-detail">
              <div className="row g12" style={{ alignItems: 'flex-start', flexWrap: 'nowrap' }}>
                <Logo name={job.company.name} />
                <div className="stack g4" style={{ minWidth: 0 }}>
                  <h1 className="display jobs-h1">{job.title}</h1>
                  <span className="job-company">
                    {job.company.website ? <a href={job.company.website} target="_blank" rel="noopener noreferrer nofollow">{job.company.name}</a> : job.company.name}
                  </span>
                </div>
              </div>
              <div className="row g8">
                <span className={`badge ${closed ? 'b-danger' : 'b-success'}`} data-testid="job-status">{closed ? t('jobs.closed') : t('jobs.open')}</span>
                <span className="xs muted">{postedAgo(job.postedAt, t)}</span>
                {job.closesAt && !closed && <span className="xs muted">· {t('jobs.closesOn', { date: new Date(job.closesAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) })}</span>}
              </div>
              <dl className="job-facts-grid">
                <div><dt>{t('jobs.f.city')}</dt><dd>{placeText(job, t) || '—'}</dd></div>
                <div><dt>{t('jobs.f.experience')}</dt><dd>{t(`jobs.exp.${job.experience}`)}</dd></div>
                <div><dt>{t('jobs.f.jobType')}</dt><dd>{t(`jobs.type.${job.jobType}`)}</dd></div>
                <div><dt>{t('jobs.f.workType')}</dt><dd>{t(`jobs.work.${job.workType}`)}</dd></div>
                <div><dt>{t('jobs.salary')}</dt><dd>{salaryText(job.salary, t) || t('jobs.salaryNone')}</dd></div>
              </dl>
              {closed ? (
                <p className="card-sm" role="status" style={{ margin: 0 }} data-testid="job-closed-note">{t('jobs.closedNote')}</p>
              ) : (
                <div className="row g8">
                  <ApplyBox job={job} t={t} />
                  <SaveButton job={job} t={t} />
                  <a className="btn btn-outline" href={share} target="_blank" rel="noopener noreferrer" data-testid="share-wa">{t('jobs.share')}</a>
                </div>
              )}
              {job.skills.length > 0 && (
                <section className="stack g8" aria-labelledby="job-skills-h">
                  <h2 id="job-skills-h" className="job-h2">{t('jobs.skills')}</h2>
                  <ul className="job-skills">{job.skills.map((s) => <li key={s} className="badge b-neutral">{s}</li>)}</ul>
                </section>
              )}
              <section className="stack g8" aria-labelledby="job-desc-h">
                <h2 id="job-desc-h" className="job-h2">{t('jobs.about')}</h2>
                <div className="job-description" lang="en">{job.description}</div>
              </section>
            </article>
            {job.similar?.length > 0 && (
              <section className="stack g12" aria-labelledby="job-similar-h" data-testid="similar-jobs">
                <h2 id="job-similar-h" className="job-h2">{t('jobs.similar')}</h2>
                {job.similar.map((j) => <JobCard key={j.id} job={j} t={t} />)}
              </section>
            )}
          </>
        )}
      </main>
      <SiteFooter />
    </>
  );
}
