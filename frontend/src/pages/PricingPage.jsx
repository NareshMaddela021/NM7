// /pricing (round P): prices for job seekers, the free ATS scan, and plans for colleges and organizations, on one page
// in the new design. The sections are the ones the old home page had (home/HomeMore.jsx), so prices, payment mode,
// the annual pass and the plans table work exactly as before. /pricing#scan opens at the scan; a scan that failed
// comes back here with its message.
import { useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import Header from '../components/Header';
import SiteFooter from '../components/SiteFooter';
import PageHero from '../components/PageHero';
import { headerLabels, useLang } from '../lib/i18n';
import { useFlow } from '../lib/flow';
import { OrgPlans, Pricing, ScanBox } from './home/HomeMore';
import '../styles/home.css';

export default function PricingPage() {
  const [t, lang] = useLang();
  const nav = useNavigate();
  const { hash, state } = useLocation();
  const { setAddon } = useFlow();
  const goPlan = (k) => { if (k === 'diy') nav('/builder'); else { setAddon(k === 'launch'); nav('/checkout'); } };
  useEffect(() => {
    if (!hash) return;
    const el = document.getElementById(hash.slice(1));
    if (el) requestAnimationFrame(() => el.scrollIntoView({ block: 'start' }));
  }, [hash]);
  return (
    <>
      <Header labels={headerLabels(t)} lang={lang} />
      <main id="main" tabIndex={-1} className="pp" lang={lang}>
        <PageHero id="pricing-top" kicker="Pricing" title="Prices for job seekers, colleges and organizations" sub="Building your resume, the ATS scan and applying for jobs are free. Pay once for an expert or extras, with a GST invoice." shape="badge" />
        <section id="pricing" className="h-pad" aria-labelledby="pricing-h"><div className="h-wrap stack g32" id="plans"><Pricing goPlan={goPlan} t={t} /></div></section>
        <section className="h-pad tint-lav" aria-label="Free ATS scan"><div className="h-wrap" style={{ maxWidth: 640 }}><ScanBox scanError={state?.scanError || null} t={t} /></div></section>
        <section id="org-plans" className="h-pad" aria-labelledby="orgplans-h"><div className="h-wrap"><OrgPlans t={t} /></div></section>
      </main>
      <SiteFooter />
    </>
  );
}
