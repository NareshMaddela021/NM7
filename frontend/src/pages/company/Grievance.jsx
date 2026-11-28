// nm7.si/grievance (Phase 2, C5; DPDP Act): what a company sees when a student applies on Nm7, for how long, the
// student's rights, and how to complain. The contact comes from lib/legal.js (the one place for business details):
// the Grievance Officer when filled in, else our email. English, Telugu and Hindi (gr.*).
import { Link } from 'react-router-dom';
import Header from '../../components/Header';
import LangSwitch from '../../components/LangSwitch';
import SiteFooter from '../../components/SiteFooter';
import { headerLabels, useLang } from '../../lib/i18n';
import { LEGAL } from '../../lib/legal';
import { usePageMeta } from '../../lib/meta';
import { PageArt } from '../../components/PageHero';
import '../../styles/me-kit.css';
import '../../styles/company-signup.css';
import { IcCheck, IcEye, IcMail } from '../../components/icons';
import { showPhone } from '../../lib/phone';

export default function Grievance() {
  const [t, lang] = useLang();
  usePageMeta({ title: t('gr.title'), description: t('gr.meta'), path: '/grievance' });
  const g = LEGAL.grievance;
  const mail = g.email || LEGAL.email;
  return (
    <>
      <Header labels={headerLabels(t)} lang={lang} />
      <main id="main" className="container-wide stack g20 jobs-page cs-page gr-page" lang={lang}>
        <div className="cs-hero">
          <div className="stack g8 cs-hero-text">
            <h1 className="display jobs-h1 co-h1">{t('gr.title')}</h1>
            <p className="lead" style={{ margin: 0 }}>{t('gr.lead')}</p>
          </div>
          <div className="cs-hero-side"><LangSwitch t={t} lang={lang} /></div>
          <div className="cs-hero-art"><PageArt shape="badge" /></div>
        </div>
        <div className="cs-layout">
          <div className="cs-col stack g16">
            <section className="mcard gr-card" aria-labelledby="gr-sees">
              <div className="cs-step-head"><span className="cs-step-badge" aria-hidden="true"><IcEye /></span><h2 id="gr-sees" className="job-h2 cs-step-title">{t('gr.sees.h')}</h2></div>
              <ul className="gr-list">
                <li>{t('gr.sees.1')}</li><li>{t('gr.sees.2')}</li><li>{t('gr.sees.3')}</li><li>{t('gr.sees.4')}</li>
              </ul>
            </section>
            <section className="mcard gr-card" aria-labelledby="gr-long">
              <div className="cs-step-head"><span className="cs-step-badge" aria-hidden="true">⧗</span><h2 id="gr-long" className="job-h2 cs-step-title">{t('gr.long.h')}</h2></div>
              <p style={{ margin: 0 }}>{t('gr.long.1')}</p>
            </section>
            <section className="mcard gr-card" aria-labelledby="gr-rights">
              <div className="cs-step-head"><span className="cs-step-badge" aria-hidden="true"><IcCheck /></span><h2 id="gr-rights" className="job-h2 cs-step-title">{t('gr.rights.h')}</h2></div>
              <ul className="gr-list gr-ticks">
                <li>{t('gr.rights.withdraw')} <Link to="/me/jobs">{t('gr.rights.withdrawLink')}</Link></li>
                <li>{t('gr.rights.download')}</li>
                <li>{t('gr.rights.correct')}</li>
                <li>{t('gr.rights.delete')}</li>
                <li>{t('gr.rights.nominate')}</li>
              </ul>
            </section>
          </div>
          <section className="mcard mcard-accent cs-side gr-contact" aria-labelledby="gr-complain" data-testid="grievance-contact">
            <div className="cs-step-head"><span className="cs-step-badge" aria-hidden="true"><IcMail /></span><h2 id="gr-complain" className="job-h2 cs-step-title">{t('gr.complain.h')}</h2></div>
            <p style={{ margin: 0 }}>{t('gr.complain.1')}</p>
            {g.name ? <p className="gr-mail" style={{ margin: 0 }}><strong>{t('gr.officer')}</strong>: {[g.name, showPhone(g.phone)].filter(Boolean).join(' · ')}{mail ? <> · <a href={`mailto:${mail}`}>{mail}</a></> : null}</p>
              : <p className="gr-mail" style={{ margin: 0 }}><a href={`mailto:${mail}`}>{mail}</a></p>}
            <p style={{ margin: 0 }}>{t('gr.complain.help')} <Link to="/me/help">{t('gr.complain.helpLink')}</Link></p>
            <p className="small muted" style={{ margin: 0 }}>{t('gr.complain.board')}</p>
            <p className="small" style={{ margin: 0 }}><Link to="/privacy">{t('gr.privacy')}</Link></p>
          </section>
        </div>
      </main>
      <SiteFooter />
    </>
  );
}
