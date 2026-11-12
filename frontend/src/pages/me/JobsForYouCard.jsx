// "Jobs for you" on My dashboard (job board J6): the three best matches for the person's resume with their scores and
// plain reasons, one big button to all jobs sorted by best match, and shortcuts to Saved jobs and My applications.
// Without a resume it asks for one. Rules only; never a made-up "AI matches" count.
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useLang } from '../../lib/i18n';
import { jobsForYou, matchReasons, placeText } from '../../lib/jobBoard';

export default function JobsForYouCard() {
  const [t] = useLang();
  const [d, setD] = useState(undefined);
  useEffect(() => {
    let off = false;
    jobsForYou().then((r) => { if (!off) setD(r); }, () => { if (!off) setD(null); });
    return () => { off = true; };
  }, []);
  if (!d) return null;
  return (
    <section className="card stack g12" style={{ flex: '1 1 320px' }} aria-labelledby="jfy-h" data-testid="jobs-for-you">
      <div className="row between"><strong id="jfy-h">{t('jobs.foryou.title')}</strong><Link to="/jobs" className="small">{t('jobs.foryou.all')} →</Link></div>
      {d.state === 'no_resume' ? (
        <span className="small muted">{t('jobs.match.noResume')} <Link to="/builder">{t('jobs.match.noResumeLink')}</Link></span>
      ) : d.items.length === 0 ? (
        <span className="small muted">{t('jobs.foryou.none')}</span>
      ) : (
        <ol className="stack g8" style={{ listStyle: 'none', margin: 0, padding: 0 }}>
          {d.items.map((j) => {
            const { good } = matchReasons(j.match, t);
            return (
              <li key={j.id} className="row g8" style={{ alignItems: 'flex-start', flexWrap: 'nowrap' }} data-testid="jfy-job">
                <span className="badge b-signal" style={{ flex: 'none' }}>{t('jobs.match.pct', { n: j.match.score })}</span>
                <span className="stack g2" style={{ minWidth: 0 }}>
                  <Link to={j.demo ? '/me/simple/jobs' : `/jobs/${j.slug}`} style={{ fontWeight: 600, overflowWrap: 'anywhere' }}>{j.title}</Link>{/* demo jobs have no public page (N3) */}
                  <span className="xs muted" style={{ overflowWrap: 'anywhere' }}>{j.company.name}{placeText(j, t) ? ` · ${placeText(j, t)}` : ''}</span>
                  <span className="xs">{good.join(' · ')}</span>
                </span>
              </li>
            );
          })}
        </ol>
      )}
      <Link to="/jobs?sort=match" className="btn btn-ink" data-testid="jfy-cta">{t('jobs.foryou.cta')}</Link>
      <div className="row g12 small">
        <Link to="/jobs?saved=1" data-testid="jfy-saved">{t('jobs.savedLink', { n: d.saved })}</Link>
        <Link to="/me/jobs" data-testid="jfy-apps">{t('jobs.foryou.apps', { n: d.applications })}</Link>
      </div>
    </section>
  );
}
