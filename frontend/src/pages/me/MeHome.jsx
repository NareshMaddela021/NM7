// Dashboard home: one "do this next" card, summary tiles, the current resume, active order, recent activity.
import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useToast } from '../../components/ui';
import { useMe, activeResume, orderView, openInBuilder, APP_STAGES } from '../../lib/customerStore';
import { useExpertOrders } from '../../lib/expertStore';
import { atsScore } from '../../lib/atsScore';
import { PLANS } from '../../lib/pricing';
import { useJobProfile } from '../../lib/profileStore';
import { profileCompleteness } from '../../lib/jobProfile';
import { Kpi } from '../admin/AdminUI';
import { ResumeThumb, downloadResume, countdown, templateName, ago } from './shared';
import HealthCard from './HealthCard';
import LinkedInCard from './LinkedInCard';
import JobsForYouCard from './JobsForYouCard';
import AutoSummaryCard from './AutoSummaryCard';
import ReadinessCard from './ReadinessCard';
import { HireCard } from './MeHire';
import { http } from '../../services/http';

/** Phase 6 S1: the role finder's top role, or an invitation to take it. */
function RolesCard() {
  const [d, setD] = useState(null);
  useEffect(() => { http('/api/me/roles').then(setD, () => {}); }, []);
  if (!d) return null;
  const top = d.roles?.[0];
  return (
    <section className="card stack g8" style={{ flex: '1 1 300px' }} aria-label="Find my role" data-testid="roles-card">
      <strong>Find my role</strong>
      <span className="small">{top ? `Best fit for you: ${d.roles.map((r) => r.title).join(', ')}.` : 'Not sure which job fits you? Ten simple questions suggest three roles, what to learn for free, and live jobs.'}</span>
      <Link className="btn btn-outline btn-sm" style={{ alignSelf: 'flex-start' }} to="/me/roles">{top ? 'See my roles' : 'Find my role'}</Link>
    </section>
  );
}
import PassOffer, { PassActive } from '../../components/PassOffer';
import { useLang } from '../../lib/i18n';

/** Three numbers measure three different things (fix round item 17): said once, in plain words, where they show. */
export function ScoresExplained() {
  return (
    <details className="card-sm" data-testid="scores-explained">
      <summary className="small"><strong>What do the three scores mean?</strong></summary>
      <ul className="small stack g4" style={{ margin: '8px 0 0', paddingLeft: 18 }}>
        <li><strong>Resume score (ATS)</strong>: how well hiring systems can read this resume. 60 and up is ready to send; 80 and up is strong.</li>
        <li><strong>Job readiness</strong>: your whole job search, not only the resume: the resume score, a job role chosen, practice and applications.</li>
        <li><strong>Profile strength</strong> (in the builder): how many sections of this resume have something in them. A full resume can still score low if hiring systems can’t read it well.</li>
      </ul>
    </details>
  );
}

export default function MeHome() {
  const me = useMe();
  const [t] = useLang();
  useExpertOrders();
  const nav = useNavigate();
  const toast = useToast();
  const r = activeResume(me);
  const score = atsScore(r.data).score;
  const orders = me.orders.map(orderView);
  const live = orders.filter((o) => o.live);
  const next = live.find((o) => o.action) || orders.find((o) => o.action);
  const apps = me.apps.filter((a) => ['applied', 'interview'].includes(a.status));
  const first = me.account.name.split(' ')[0];
  const followUps = me.apps.filter((a) => a.status === 'applied' && Date.now() - a.date > 7 * 864e5 && !a.followed);
  const edit = () => { openInBuilder(r.id); nav('/builder', { state: { open: 'build' } }); };
  const jp = useJobProfile();
  const setUp = jp.available && jp.data && profileCompleteness(jp.data).pct < 40; // new users: the Job Profile first
  const dl = async (f) => { if (await downloadResume(r.data, f)) toast(f === 'pdf' ? 'PDF ready' : 'Word file ready'); };

  return (
    <>
      <div className="stack g4"><span className="mono xs muted">MY DASHBOARD</span><h1 className="display" style={{ fontSize: 32 }}>Hi {first} 👋</h1></div>
      <PassActive />
      {typeof window !== 'undefined' && /[?&]pass=1/.test(window.location.search) && <PassOffer />}

      {next?.action ? (
        <div className="card-ink row between g16">
          <div className="stack g4">
            <span className="mono" style={{ opacity: 0.75, fontSize: 12 }}>DO THIS NEXT · {next.id}</span>
            <strong style={{ fontFamily: 'var(--font-display)', fontSize: 22, fontWeight: 600 }}>{next.action.text}</strong>
            {next.live && next.deadline && <span className="small" style={{ opacity: 0.8 }}>{countdown(next.deadline).late ? 'Past the deadline — an automatic refund starts if nothing arrives.' : `Delivery promise: ${countdown(next.deadline).text}`}</span>}
          </div>
          <Link to={next.action.to} className="btn btn-signal btn-lg">{next.action.cta}</Link>
        </div>
      ) : me.orders.length === 0 && score < 60 && setUp ? (
        <div className="card-ink row between g16">
          <div className="stack g4"><span className="mono" style={{ opacity: 0.75, fontSize: 12 }}>GET STARTED</span><strong style={{ fontFamily: 'var(--font-display)', fontSize: 22, fontWeight: 600 }}>Set up your Job Profile (3 min)</strong><span className="small" style={{ opacity: 0.8 }}>Fill it once — every resume and cover letter starts from it.</span></div>
          <span className="row g8"><Link to="/me/profile" className="btn btn-signal btn-lg">Set up my Job Profile</Link><button type="button" className="btn btn-outline btn-lg" style={{ background: 'transparent', color: 'inherit' }} onClick={edit}>Open the builder</button></span>
        </div>
      ) : me.orders.length === 0 && score < 60 ? (
        <div className="card-ink row between g16">
          <div className="stack g4"><span className="mono" style={{ opacity: 0.75, fontSize: 12 }}>GET STARTED</span><strong style={{ fontFamily: 'var(--font-display)', fontSize: 22, fontWeight: 600 }}>Build your resume — or upload your old one and we’ll rebuild it</strong></div>
          <span className="row g8"><button type="button" className="btn btn-signal btn-lg" onClick={edit}>Open the builder</button><Link to="/" className="btn btn-outline btn-lg" style={{ background: 'transparent', color: 'inherit' }}>Free scan</Link></span>
        </div>
      ) : score < 60 ? (
        // "ready" only from a score of 60 (fix round item 16): below it, the next thing is the fixes
        <div className="card-ink row between g16" data-testid="me-banner" data-state="fix">
          <div className="stack g4"><span className="mono" style={{ opacity: 0.75, fontSize: 12 }}>DO THIS NEXT</span><strong style={{ fontFamily: 'var(--font-display)', fontSize: 22, fontWeight: 600 }}>Your resume scores {score}/100. Fix a few things to reach 60, then apply.</strong></div>
          <button type="button" className="btn btn-signal btn-lg" onClick={edit}>Fix my resume</button>
        </div>
      ) : (
        <div className="card-ink row between g16" data-testid="me-banner" data-state="ready">
          <strong style={{ fontFamily: 'var(--font-display)', fontSize: 22, fontWeight: 600 }}>Your resume is ready. Time to apply.</strong>
          <Link to="/me/jobs" className="btn btn-signal btn-lg">Track applications</Link>
        </div>
      )}

      <HealthCard />

      <div className="row g16" style={{ alignItems: 'stretch' }}><ReadinessCard /><JobsForYouCard /></div>

      <div className="row g16" style={{ alignItems: 'stretch' }}><HireCard /><RolesCard /></div>

      <ScoresExplained />

      <div className="kpis">
        <Kpi label="Resume ATS score" value={score} sub={score >= 80 ? 'Good — recruiters’ systems read it well' : 'Below 80 — see the tips'} tone={score >= 80 ? 'var(--success)' : 'var(--warning)'} />
        <Kpi label="Active order" value={live[0] ? live[0].id : '—'} sub={live[0] ? `${live[0].label} · ${countdown(live[0].deadline).text}` : 'No order in progress'} />
        <Kpi label="My resumes" value={me.resumes.length} sub={`Editing “${r.name}”`} />
        <Kpi label="Applications" value={apps.length} sub={`${me.apps.filter((a) => a.status === 'interview').length} interview · ${me.apps.length} tracked`} />
      </div>

      <div className="row g16" style={{ alignItems: 'stretch' }}>
        <section className="card row g16" style={{ flex: '3 1 440px', alignItems: 'flex-start' }} aria-label="Current resume">
          <ResumeThumb data={r.data} width={140} label={`Preview of ${r.name} resume`} />
          <div className="stack g8" style={{ flex: 1, minWidth: 200 }}>
            <span className="xs muted">CURRENT RESUME</span>
            <strong style={{ fontSize: 18 }}>{r.name}</strong>
            <span className="small muted">{templateName(r.data)} template · edited {ago(r.updated)}</span>
            <span className="small">ATS <strong>{score}</strong>/100</span>
            <div className="row g8" style={{ marginTop: 4 }}>
              <button type="button" className="btn btn-ink" onClick={edit}>Edit</button>
              <button type="button" className="btn btn-outline" onClick={() => dl('pdf')}>PDF</button>
              <button type="button" className="btn btn-outline" onClick={() => dl('docx')}>Word</button>
              <Link to="/me/share" className="btn btn-ghost">Share</Link>
            </div>
            <Link to="/me/resumes" className="small">All resumes and versions →</Link>
          </div>
        </section>

        <section className="card stack g12" style={{ flex: '2 1 300px' }} aria-label="Orders">
          <div className="row between"><strong>My orders</strong><Link to="/me/orders" className="small">All →</Link></div>
          {orders.slice(0, 3).map((o) => (
            <Link key={o.id} to={`/me/orders/${o.id}`} className="well row between g8" style={{ textDecoration: 'none', color: 'inherit' }}>
              <span className="small"><strong>{o.id}</strong> · {PLANS[o.plan].name}</span>
              <span className={`badge b-${o.tone}`}>{o.label}</span>
            </Link>
          ))}
          {me.orders.every((o) => o.plan !== 'launch') && <Link to="/me/upgrade" className="small">Add a LinkedIn makeover or mentor call →</Link>}
        </section>
      </div>

      <div className="row g16" style={{ alignItems: 'stretch' }}>
        <section className="card stack g12" style={{ flex: '1 1 300px' }} aria-label="Applications">
          <div className="row between"><strong>Applications</strong><span className="row g12"><Link to="/me/auto-apply" className="small" data-testid="home-auto-apply">{t('aa.link')}</Link><Link to="/me/jobs" className="small">Board →</Link></span></div>
          <div className="row g8">{APP_STAGES.map(([k, l]) => <span key={k} className="badge b-neutral">{l} · {me.apps.filter((a) => a.status === k).length}</span>)}</div>
          {followUps.length > 0 && <div className="well small">⏰ {followUps.length} application{followUps.length > 1 ? 's' : ''} sent over a week ago — time to follow up. <Link to="/me/jobs">See which</Link></div>}
        </section>
        <AutoSummaryCard />
        <LinkedInCard />
        <section className="card stack g12" style={{ flex: '1 1 300px' }} aria-label="Share link">
          <div className="row between"><strong>Share link</strong><Link to="/me/share" className="small">Settings →</Link></div>
          {me.share.on ? <><span className="small mono">nm7.si/r/{me.share.slug}</span><span className="small muted">Viewed <strong>{me.share.views.filter((t) => Date.now() - t < 7 * 864e5).length}</strong> times this week</span></> : <span className="small muted">Off — turn it on to share your resume as a link.</span>}
        </section>
      </div>
    </>
  );
}
