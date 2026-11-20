// /for-orgs — Nm7 for Organizations: the plans table (prices and limits come from the server, so Naresh can
// change them in Admin -> Plans), a short FAQ, "Start free" (creates an organization with you as its Owner) and
// "Talk to us" (a support ticket). A ?ref=CODE link from a partner is remembered (Phase 4C). Readable in English,
// Telugu or Hindi (the language switch at the top; strings orgs.* in src/i18n/pages.json); messages from the server and
// the students' stories stay as they are.
import { PageArt } from '../../components/PageHero';
import Stories from '../../components/Stories';
import { useEffect, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import Header from '../../components/Header';
import LangSwitch from '../../components/LangSwitch';
import SiteFooter from '../../components/SiteFooter';
import { LIVE, useAuth } from '../../lib/auth';
import { headerLabels, rich, useLang } from '../../lib/i18n';
import { usePageMeta } from '../../lib/meta';
import { refFromSearch } from '../../lib/orgBilling';
import { PlansSkeleton, PlansTable, orgFaq, useOrgPlans } from './OrgPlans';
import DemoVideo from './DemoVideo';
import { http } from '../../services/http';
import '../../styles/me-kit.css';
import '../../styles/org-signup.css';
import { IcCheck, IcMail } from '../../components/icons';

const ORG_TYPES = ['college', 'institute', 'job_fair', 'skill_centre', 'ngo', 'agency', 'company', 'other']; // names: orgs.type.<k>
const EMAIL = 'info@nm7.si';


/** A partner link (?ref=CODE): the server checks the code and remembers it in a first-party cookie (Billing
 * settings: 90 days), so it is credited when the organization first pays — even if they sign up later. */
function useRef90() {
  const { search } = useLocation();
  const asked = refFromSearch(search);
  const [ref, setRef] = useState(null);
  useEffect(() => {
    if (!asked || !LIVE) return;
    http('/api/public/referral', { method: 'POST', body: { code: asked } }).then((r) => setRef(r.code ? r : null), () => setRef(null));
  }, [asked]);
  return ref;
}

/** Round P, Phase 4: the three steps of starting free (account -> organization -> groups), shown beside the form. */
function StartSteps({ step, t }) {
  const steps = [t('orgs.start.signup'), t('orgs.start.create'), t('orgs.table.l.groups')];
  return (
    <ol className="msteps fo-steps" aria-hidden="true">
      {steps.map((l, i) => (
        <li key={l} className={i < step ? 'done' : i === step ? 'now' : ''}>
          <span className="msteps-dot">{i < step ? <IcCheck size={14} /> : i + 1}</span>
          <span className="fo-step-l">{l}</span>
        </li>
      ))}
    </ol>
  );
}

/** The side card beside the start form: what the Free plan gives, from the FAQ the page already has. */
function StartSide({ t }) {
  return (
    <aside className="fo-side">
      <span className="fo-side-ic" aria-hidden="true"><IcCheck /></span>
      <strong className="fo-side-title">{t('orgs.faq.2.q')}</strong>
      <p className="fo-side-text">{t('orgs.faq.2.a')}</p>
      <p className="fo-side-text fo-side-note">{t('orgs.start.owner')}</p>
    </aside>
  );
}

function StartFree({ open, t }) {
  const { user } = useAuth();
  const nav = useNavigate();
  const [f, setF] = useState({ name: '', type: 'college', city: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  if (!open) return null;
  const here = encodeURIComponent('/for-orgs?start=1#start');
  if (!user) {
    return (
      <div className="fo-start">
        <div className="fo-start-card">
          <StartSteps step={0} t={t} />
          <div className="fo-start-actions">
            <Link className="btn btn-signal btn-lg" to={`/signup?next=${here}`}>{t('orgs.start.signup')}</Link>
            <Link className="btn btn-outline btn-lg" to={`/login?next=${here}`}>{t('orgs.start.signin')}</Link>
          </div>
        </div>
        <StartSide t={t} />
      </div>
    );
  }
  if (user.role !== 'customer') return <p className="small muted fo-note">{t('orgs.start.notCustomer')}</p>;
  const submit = async (e) => {
    e.preventDefault();
    setBusy(true); setError('');
    try {
      const r = await http('/api/me/orgs', { method: 'POST', body: f });
      nav(`/org/${r.orgId}`);
    } catch (err) { setError(err.message); } finally { setBusy(false); }
  };
  return (
    <div className="fo-start">
      <form className="fo-start-card" onSubmit={submit} aria-label={t('org.start')}>
        <StartSteps step={1} t={t} />
        <div className="fo-fields">
          <div className="field fo-full"><label className="label" htmlFor="so-n">{t('orgs.start.name')}</label><input id="so-n" className="input" required minLength={2} maxLength={120} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></div>
          <div className="field"><label className="label" htmlFor="so-t">{t('orgs.start.type')}</label><select id="so-t" className="input" value={f.type} onChange={(e) => setF({ ...f, type: e.target.value })}>{ORG_TYPES.map((k) => <option key={k} value={k}>{t(`orgs.type.${k}`)}</option>)}</select></div>
          <div className="field"><label className="label" htmlFor="so-c">{t('orgs.start.city')}</label><input id="so-c" className="input" maxLength={60} value={f.city} onChange={(e) => setF({ ...f, city: e.target.value })} /></div>
        </div>
        <div className="fo-start-actions">
          <button type="submit" className="btn btn-signal btn-lg" disabled={busy}>{busy ? t('orgs.start.creating') : t('orgs.start.create')}</button>
        </div>
        <span className="xs muted">{t('orgs.start.owner')}</span>
        {error && <p className="small fo-error" role="alert" lang="en">{error}</p>}
      </form>
      <StartSide t={t} />
    </div>
  );
}

function TalkToUs({ refCode, t }) {
  const { user } = useAuth();
  const [text, setText] = useState('');
  const [state, setState] = useState({});
  const here = encodeURIComponent('/for-orgs#talk');
  if (!user) {
    return <p className="small">{rich(t('orgs.talk.guest'), { email: <a href={`mailto:${EMAIL}`}>{EMAIL}</a>, signin: <Link to={`/login?next=${here}`}>{t('orgs.talk.signin')}</Link> })}</p>;
  }
  const send = async (e) => {
    e.preventDefault();
    setState({ busy: true });
    try {
      const note = refCode ? `\n\n(Referred with code ${refCode})` : '';
      await http('/api/me/tickets', { method: 'POST', body: { topic: 'Organizations', orderId: null, text: `${text.trim()}${note}`.slice(0, 2000) } });
      setText(''); setState({ sent: true });
    } catch (err) { setState({ error: err.message }); }
  };
  return state.sent
    ? <p className="small fo-thanks" role="status"><IcCheck size={16} /> {t('orgs.talk.thanks')}</p>
    : (
      <form className="stack g8 fo-talk-form" onSubmit={send} aria-label={t('orgs.talk.title')}>
        <label className="label" htmlFor="tt-x">{t('orgs.talk.label')}</label>
        <textarea id="tt-x" className="input" rows={4} required minLength={10} maxLength={1900} value={text} onChange={(e) => setText(e.target.value)} />
        <button type="submit" className="btn btn-signal" style={{ alignSelf: 'flex-start' }} disabled={state.busy}>{state.busy ? t('orgs.talk.sending') : t('orgs.talk.send')}</button>
        {state.error && <p className="small" role="alert" style={{ color: 'var(--danger)' }} lang="en">{state.error}</p>}
      </form>
    );
}

export default function ForOrgs() {
  usePageMeta({ title: 'Nm7 for Organizations — plans for colleges, institutes and job fairs', description: 'Collect consent-based, ATS-safe resumes from your students or candidates, approve, print and share them with recruiters. Free plan, Drive and Campus plans.', path: '/for-orgs' });
  const { search } = useLocation();
  const refCode = useRef90();
  const [start, setStart] = useState(() => new URLSearchParams(search).get('start') === '1');
  const st = useOrgPlans();
  const [t, lang] = useLang();
  const code = refCode && <strong className="mono" lang="en">{refCode.code}</strong>;
  // The parts in the chosen language carry lang={lang}; main stays "en" (the students' stories are in English).
  return (
    <>
      <Header labels={headerLabels(t)} lang={lang} />
      <main id="main" className="container stack g24 fo-page" lang="en" data-lang={lang}>
        <section className="ph-row fo-hero" lang={lang} aria-labelledby="orgs-h">
          <div className="stack g12">
          <div className="row between g12" style={{ alignItems: 'center' }}>
            <span className="xs muted fo-eyebrow">{t('orgs.hero.eyebrow')}</span>
            <LangSwitch t={t} lang={lang} />
          </div>
          <h1 id="orgs-h" className="display" style={{ fontSize: 'clamp(28px, 6vw, 40px)' }}>{t('orgs.hero.title')}</h1>
          <p className="muted" style={{ maxWidth: 640 }}>{t('orgs.hero.lead')}</p>
          <ul className="fo-feats">
            {['drives', 'offers', 'placementInsights'].map((k) => <li key={k}><span aria-hidden="true"><IcCheck /></span>{t(`orgs.table.f.${k}`)}</li>)}
          </ul>
          <div className="row g8" style={{ flexWrap: 'wrap' }}>
            <button type="button" className="btn btn-signal btn-lg" onClick={() => setStart(true)}>{t('org.start')}</button>
            <a className="btn btn-outline btn-lg" href="#talk">{t('orgs.talk.title')}</a>
          </div>
          {refCode && <span className="xs fo-ref" role="status">{rich(refCode.discountPct ? t('orgs.refOff', { n: refCode.discountPct }) : t('orgs.ref'), { code })}</span>}
          </div>
          <PageArt shape="college" />
        </section>
        <section id="start" className="stack g12" lang={lang}><StartFree open={start} t={t} /></section>
        <DemoVideo t={t} lang={lang} />
        <section className="stack g12 fo-card" aria-labelledby="plans-h" lang={lang}>
          <div className="fo-card-h"><span className="fo-card-ic" aria-hidden="true">₹</span><h2 id="plans-h" className="display h3">{t('orgs.plans.title')}</h2></div>
          {st.loading ? <PlansSkeleton />
            : st.error || !st.data ? <p className="small muted">{rich(t('orgs.plans.offline'), { email: <a href={`mailto:${EMAIL}`}>{EMAIL}</a> })}</p>
              : <>
                <PlansTable data={st.data} t={t} />
                <span className="xs muted">{st.data.gstOn ? t('orgs.plans.gst', { n: st.data.gstRatePct }) : t('orgs.plans.inr')} {t('orgs.plans.grace', { n: st.data.graceDays })}</span>
              </>}
        </section>
        <Stories title="Students who used Nm7" limit={3} headingId="org-stories-h" />
        <section className="stack g12" aria-labelledby="faq-h" lang={lang}>
          <h2 id="faq-h" className="display h3">{t('home.more.faq.title')}</h2>
          <div className="fo-faq">
            {orgFaq(t).map(([q, a]) => <details key={q} className="fo-faq-item"><summary>{q}</summary><p className="small">{a}</p></details>)}
          </div>
        </section>
        <p className="small muted fo-partner" lang={lang}>{rich(t('orgs.partner'), { link: <Link to="/partners">{t('orgs.partner.link')}</Link> })}</p>
        <section id="talk" className="fo-card fo-talk" aria-labelledby="talk-h" lang={lang}>
          <div className="fo-talk-intro">
            <span className="fo-card-ic" aria-hidden="true"><IcMail /></span>
            <h2 id="talk-h" className="display h3">{t('orgs.talk.title')}</h2>
            <p className="small muted">{t('orgs.faq.5.a')}</p>
          </div>
          <div className="fo-talk-body"><TalkToUs refCode={refCode?.code || ''} t={t} /></div>
        </section>
      </main>
      <SiteFooter />
    </>
  );
}
