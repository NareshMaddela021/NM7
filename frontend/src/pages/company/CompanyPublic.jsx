// nm7.si/companies/<slug>: a company's public page (Phase 2, C2): logo, name, trust badge (Verified by Nm7 / Emails
// confirmed), about, website, and its open jobs on Nm7. Only companies whose emails are confirmed have a page; demo,
// blocked and unconfirmed ones don't. English, Telugu and Hindi (co.pub.*).
import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import Header from '../../components/Header';
import LangSwitch from '../../components/LangSwitch';
import SiteFooter from '../../components/SiteFooter';
import { headerLabels, useLang } from '../../lib/i18n';
import { usePageMeta } from '../../lib/meta';
import { http } from '../../services/http';
import { JobCard } from '../jobs/Jobs';
import { ReplyBadge, TrustWhy } from '../jobs/Trust';

export default function CompanyPublic() {
  const [t, lang] = useLang();
  const { slug } = useParams();
  const [st, setSt] = useState({ loading: true });
  useEffect(() => {
    let live = true;
    setSt({ loading: true });
    http(`/api/companies/${encodeURIComponent(slug)}`).then((c) => live && setSt({ c }), (e) => live && setSt({ gone: e?.status === 404, error: e }));
    return () => { live = false; };
  }, [slug]);
  const c = st.c;
  usePageMeta({ title: c ? t('co.pub.metaTitle', { name: c.name }) : t('co.pub.goneTitle'), description: c ? (c.about || t('co.pub.metaDesc', { name: c.name })).slice(0, 150) : t('co.pub.goneTitle'), noindex: !c, path: `/companies/${slug}` });
  return (
    <>
      <Header labels={headerLabels(t)} lang={lang} />
      <main id="main" className="container stack g20 jobs-page" lang={lang}>
        <div className="row g12" style={{ justifyContent: 'space-between' }}><nav aria-label={t('jobs.crumbs')} className="xs"><Link to="/jobs">{t('jobs.crumb')}</Link></nav><LangSwitch t={t} lang={lang} /></div>
        {st.loading && <p className="muted">{t('co.loading')}</p>}
        {st.gone && <div className="card-sm stack g8" data-testid="company-gone"><h1 className="display jobs-h1">{t('co.pub.goneTitle')}</h1><Link to="/jobs">{t('jobs.allJobs')}</Link></div>}
        {st.error && !st.gone && <p role="alert" className="card-sm">{t('jobs.error')}</p>}
        {c && (
          <>
            <section className="card stack g12" data-testid="company-public">
              <div className="row g12" style={{ alignItems: 'center', flexWrap: 'nowrap' }}>
                {c.logo ? <img src={c.logo} alt="" width={64} height={64} className="co-logo" /> : <span className="job-logo" aria-hidden="true">{c.name.charAt(0)}</span>}
                <div className="stack g4" style={{ minWidth: 0 }}>
                  <h1 className="display jobs-h1">{c.name}</h1>
                  <span className={`badge ${c.trust === 'verified' ? 'b-success' : 'b-neutral'}`} style={{ alignSelf: 'flex-start' }} data-testid="company-badge">{t(`co.pub.badge.${c.trust}`)}</span>
                  {c.hiredIn30 && <span className="badge b-signal" style={{ alignSelf: 'flex-start' }} data-testid="company-hired30" title={t('co.pub.hired30Why')}>{t('co.speed.badge')}</span>}
                </div>
              </div>
              <p className="xs muted" style={{ margin: 0 }}>{t(`co.pub.why.${c.trust}`)}</p>
              <span className="row g8 xs" style={{ flexWrap: 'wrap' }}>
                {c.score != null && <span className="muted" data-testid="trust-score">{t('jobs.trust.score', { n: c.score })}</span>}
                <ReplyBadge days={c.replyDays} t={t} />
              </span>
              <TrustWhy parts={c.parts} t={t} />
              {c.about && <p style={{ margin: 0, whiteSpace: 'pre-line' }}>{c.about}</p>}
              <p className="small muted" style={{ margin: 0 }}>{[c.industry, c.size && t(`co.size.${c.size}`), c.kind === 'individual' && t('co.cat.individual')].filter(Boolean).join(' · ')}</p>
              {c.website && <a href={c.website} target="_blank" rel="noopener noreferrer nofollow" className="small">{c.website.replace(/^https:\/\//, '')} ↗</a>}
            </section>
            <section className="stack g12" aria-labelledby="cp-jobs">
              <h2 id="cp-jobs" className="job-h2">{t('co.pub.jobs', { n: c.jobs.length })}</h2>
              {c.jobs.length === 0 && <p className="card-sm small muted" style={{ margin: 0 }}>{t('co.pub.noJobs')}</p>}
              {c.jobs.map((j) => <JobCard key={j.id} job={j} t={t} />)}
            </section>
          </>
        )}
      </main>
      <SiteFooter />
    </>
  );
}
