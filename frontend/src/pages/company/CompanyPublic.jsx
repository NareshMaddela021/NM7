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
import { EmployerBadge, FraudReport, NeverPay } from '../jobs/EmployerTrust'; // Vetting Trust T4 (only when the API sends it)
import { Chip, Empty, Skel } from '../me/kit';
import { Still } from '../newhome/ParticleStage';
import '../../styles/me-kit.css';
import '../../styles/company-home.css';
import { IcExternal } from '../../components/icons';

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
      <main id="main" className="container stack g20 jobs-page cpub" lang={lang}>
        <div className="row g12" style={{ justifyContent: 'space-between' }}><nav aria-label={t('jobs.crumbs')} className="xs"><Link to="/jobs">{t('jobs.crumb')}</Link></nav><LangSwitch t={t} lang={lang} /></div>
        {st.loading && <Skel cards={2} lines={3} label={t('co.loading')} />}
        {st.gone && (
          <div className="mempty" data-testid="company-gone">
            <span className="mempty-art" aria-hidden="true"><Still shape="briefcase" tint="company" className="mempty-still" /></span>
            <h1 className="display jobs-h1">{t('co.pub.goneTitle')}</h1>
            <Link to="/jobs" className="btn btn-signal">{t('jobs.allJobs')}</Link>
          </div>
        )}
        {st.error && !st.gone && <p role="alert" className="mcard mcard-bad">{t('jobs.error')}</p>}
        {c && (
          <>
            <section className="mcard cpub-hero" data-testid="company-public">
              <div className="cpub-band" aria-hidden="true"><Still shape="stopwatch" tint="company" className="cpub-band-still" /></div>
              <div className="cpub-id">
                {c.logo ? <img src={c.logo} alt="" width={88} height={88} className="co-logo cpub-logo" /> : <span className="cpub-logo ch-initial" aria-hidden="true">{c.name.charAt(0)}</span>}
                <div className="cpub-name">
                  <h1 className="display jobs-h1">{c.name}</h1>
                  <span className="mrow" style={{ gap: 8 }}>
                    <Chip tone={c.trust === 'verified' ? 'ok' : 'neutral'} data-testid="company-badge">{t(`co.pub.badge.${c.trust}`)}</Chip>
                    {c.hiredIn30 && <Chip tone="info" data-testid="company-hired30" title={t('co.pub.hired30Why')}>{t('co.speed.badge')}</Chip>}
                    <EmployerBadge v={c.employerTrust?.employer} chip full />
                  </span>
                  <p className="small muted" style={{ margin: 0 }}>{[c.industry, c.size && t(`co.size.${c.size}`), c.kind === 'individual' && t('co.cat.individual')].filter(Boolean).join(' · ')}</p>
                </div>
                {c.website && <a href={c.website} target="_blank" rel="noopener noreferrer nofollow" className="btn btn-outline cpub-web">{c.website.replace(/^https:\/\//, '')} <IcExternal size={14} /></a>}
              </div>
              <div className="cpub-body">
                <div className="mstack cpub-about">
                  {c.about && <p style={{ margin: 0, whiteSpace: 'pre-line' }}>{c.about}</p>}
                  <p className="xs muted" style={{ margin: 0 }}>{t(`co.pub.why.${c.trust}`)}</p>
                </div>
                <div className="mcard mcard-flat mcard-tight cpub-trust">
                  <span className="mrow xs" style={{ gap: 8 }}>
                    {c.score != null && <span className="cpub-score" data-testid="trust-score">{t('jobs.trust.score', { n: c.score })}</span>}
                    <ReplyBadge days={c.replyDays} t={t} />
                  </span>
                  <TrustWhy parts={c.parts} t={t} />
                </div>
                {c.employerTrust && (
                  <div className="mstack" data-testid="company-safety" style={{ minWidth: 0 }}>
                    <NeverPay safety={c.employerTrust} />
                    <FraudReport safety={c.employerTrust} context="company" id={c.slug} label="Report this company" />
                  </div>
                )}
              </div>
            </section>
            <section className="mstack" aria-labelledby="cp-jobs">
              <div className="mspread">
                <h2 id="cp-jobs" className="job-h2 cpub-h2">{t('co.pub.jobs', { n: c.jobs.length })}</h2>
              </div>
              {c.jobs.length === 0 && <Empty compact shape="briefcase" tint="company" title={t('co.pub.noJobs')} action={<Link to="/jobs" className="btn btn-outline">{t('jobs.allJobs')}</Link>} />}
              <div className="cpub-jobs">{c.jobs.map((j) => <JobCard key={j.id} job={j} t={t} />)}</div>
            </section>
          </>
        )}
      </main>
      <SiteFooter />
    </>
  );
}
