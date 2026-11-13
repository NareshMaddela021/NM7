// Phase 6 S4: the salary guide, public at /salaries. Ranges by role, city and experience come only from Nm7's own job
// posts (not demo, last 90 days, with a salary): shown only when enough jobs have one (Admin → Settings), with
// "based on X jobs". Otherwise "Not enough data yet". Nothing is estimated. English, Telugu and Hindi (sal.*).
// Round D1: until enough roles have data (Admin → Settings) the page is hidden: no menu link, "noindex, follow", not in
// the sitemap; it still works for anyone who opens it. /salaries/:role shows one role (noindex while it lacks data).
import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import Header from '../../components/Header';
import SiteFooter from '../../components/SiteFooter';
import { headerLabels, useLang } from '../../lib/i18n';
import { http } from '../../services/http';
import { usePageMeta } from '../../lib/meta';
import { indexable, useSalariesStatus } from '../../lib/salaries';

const rupees = (n) => `₹${Math.round(n).toLocaleString('en-IN')}`;

/** "₹22,500–₹27,000 a month in Hyderabad · based on 10 jobs in the last 90 days", or "Not enough data yet". */
export function payText(r, t) {
  if (!r) return t('jobs.pay.none');
  return t('jobs.pay.range', { min: rupees(r.min), max: rupees(r.max), where: r.city ? t('jobs.pay.where', { city: r.city }) : t('jobs.pay.india'), n: r.jobs, days: r.days });
}

/** For a job page: the range for jobs like this one (same role, city, experience). */
export function JobPay({ job, t }) {
  const [r, setR] = useState(undefined);
  useEffect(() => {
    const q = new URLSearchParams({ title: job.title, city: (job.locations || [])[0] || '', experience: job.experience || 'fresher' });
    http(`/api/public/salaries/lookup?${q}`).then(setR, () => setR(null));
  }, [job.title, job.experience, job.locations]);
  const st = useSalariesStatus();
  if (!r || !r.role) return null; // a title outside the guide's roles: say nothing
  return <span className="xs muted" data-testid="job-pay">{t('jobs.pay.title')}: {payText(r.range, t)}{st?.visible && <> · <Link to="/salaries" data-testid="job-pay-link">{t('jobs.pay.link')}</Link></>}</span>;
}

const LEVELS = ['start', '1_3', '3_plus'];

export default function Salaries() {
  const [t, lang] = useLang();
  const { role } = useParams();
  const [city, setCity] = useState('');
  const [asked, setAsked] = useState('');
  const [d, setD] = useState(null);
  const [err, setErr] = useState('');
  const one = role && d ? d.roles.find((r) => r.id === role) : null;
  const rows = d ? (role ? (one ? [one] : []) : d.roles) : [];
  // indexed only while the guide is shown (and, for one role, while that role has enough data)
  usePageMeta({ title: one ? t('sal.roleTitle', { role: one.title }) : t('sal.meta').replace(/\s·\sNm7$/, ''), description: t('sal.title'), noindex: !indexable(d?.visible, role ? one?.ready : true), follow: true });
  useEffect(() => { setD(null); http(`/api/public/salaries${asked ? `?city=${encodeURIComponent(asked)}` : ''}`).then(setD, (e) => setErr(e.message)); }, [asked]);
  return (
    <>
      <Header labels={headerLabels(t)} lang={lang} />
      <main id="main" className="container stack g16" style={{ maxWidth: 900, padding: '24px 16px 64px' }} data-testid="salaries">
        <h1 className="display" style={{ fontSize: 30 }}>{t('sal.title')}</h1>
        <p className="small muted" style={{ margin: 0 }}>{t('sal.intro', { n: d?.minJobs ?? 20, days: d?.days ?? 90 })}</p>
        <form className="row g8" style={{ flexWrap: 'wrap' }} onSubmit={(e) => { e.preventDefault(); setAsked(city.trim()); }}>
          <label className="row g8 small">{t('sal.city')}<input className="input" style={{ height: 38, width: 180 }} maxLength={60} value={city} onChange={(e) => setCity(e.target.value)} placeholder="Hyderabad" data-testid="sal-city" /></label>
          <button type="submit" className="btn btn-outline btn-sm" data-testid="sal-go">{t('sal.show')}</button>
          {asked && <button type="button" className="btn btn-outline btn-sm" onClick={() => { setCity(''); setAsked(''); }}>{t('sal.all')}</button>}
        </form>
        {err && <p className="error" role="alert">{err}</p>}
        {!d && !err && <p className="muted">{t('sal.loading')}</p>}
        {role && <Link to="/salaries" className="small" data-testid="sal-all-roles">{t('sal.allRoles')}</Link>}
        {d && role && !one && <p className="small" data-testid="sal-no-role">{t('sal.noRole')}</p>}
        {d && (
          <ul className="stack g8" style={{ listStyle: 'none', padding: 0, margin: 0 }}>
            {rows.map((r) => (
              <li key={r.id} className="card-sm stack g4" data-testid="sal-role">
                <strong>{role ? r.title : <Link to={`/salaries/${r.id}`}>{r.title}</Link>} <span className="xs muted">· {r.domain}</span></strong>
                {LEVELS.map((lv) => <span key={lv} className="small"><span className="muted">{t(`sal.level.${lv}`)}:</span> {payText(r.levels[lv], t)}</span>)}
              </li>
            ))}
          </ul>
        )}
        <span className="xs muted">{t('sal.note')}</span>
      </main>
      <SiteFooter />
    </>
  );
}
