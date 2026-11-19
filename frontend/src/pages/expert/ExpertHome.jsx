// Expert home: today's work, offers, revisions, numbers, tier progress, and quick availability switches.
import { Link } from 'react-router-dom';
import { useEffect, useState } from 'react';
import { http } from '../../services/http';
import { Meter, useToast } from '../../components/ui';
import { useExpertOrders } from '../../lib/expertStore';
import { loadExpert, saveExpert, useExpertReady } from '../../lib/expert';
import { LIVE } from '../../services/http';
import { expertPayout, inr } from '../../lib/pricing';
import { timeLeft } from './OrderWorkspace';
import { ExpertLoading, ExpertPage } from './ExpertFrame';
import { Chip, Empty, MeCard, ScoreRing } from '../me/kit';

const TIERS = [['New', 0], ['Trusted', 10], ['Top expert', 40]];
const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

export function expertStats(orders) {
  const done = orders.filter((o) => ['delivered', 'approved'].includes(o.status));
  const rated = done.filter((o) => o.rating);
  const onTime = done.length ? Math.round((done.filter((o) => (o.deliveredAt || 0) <= o.deadline).length / done.length) * 100) : 100;
  const revisions = done.length ? +(done.reduce((s, o) => s + Math.max(0, (o.versions?.length || 1) - 1), 0) / done.length).toFixed(1) : 0;
  const rating = rated.length ? +(rated.reduce((s, o) => s + o.rating, 0) / rated.length).toFixed(1) : null;
  const earned = done.reduce((s, o) => s + expertPayout(o.price).net, 0);
  if (LIVE) return { delivered: done.length, rating: rating ?? '—', onTime: done.length ? onTime : '—', revisions, earned };
  // preview only: sample history before this preview — 24 delivered orders, 4.7★, 93% on time
  return { delivered: done.length + 24, rating: rating ? +(((rating * rated.length) + 4.7 * 24) / (rated.length + 24)).toFixed(1) : 4.7, onTime: Math.round((onTime * done.length + 93 * 24) / (done.length + 24)), revisions, earned };
}

/** Vetting V4: the reviewer workspace link, only for experts the vetting engine is open to (Admin -> Skill checks -> Launch). */
function ReviewerLink() {
  const [on, setOn] = useState(false);
  useEffect(() => { if (LIVE) http('/api/reviewer/access').then((x) => setOn(!!x?.on), () => {}); }, []);
  return on ? <Link to="/expert/reviewer" className="btn btn-outline" data-testid="ex-reviewer-link">Nm7 checks (reviewer)</Link> : null;
}

export default function ExpertHome() {
  const ready = useExpertReady();
  if (!ready) return <ExpertLoading />;
  return <ExpertHomePage />;
}

function ExpertHomePage() {
  const toast = useToast();
  const orders = useExpertOrders();
  const [prof, setProf] = useState(loadExpert);
  const st = expertStats(orders);
  const offers = orders.filter((o) => o.status === 'offer');
  const live = orders.filter((o) => ['progress', 'revision', 'waiting'].includes(o.status)).sort((a, b) => a.deadline - b.deadline);
  const today = live.filter((o) => timeLeft(o).h < 24);
  const next = TIERS.find(([, n]) => n > st.delivered) || null;
  const tier = [...TIERS].reverse().find(([, n]) => st.delivered >= n)[0];
  const av = prof?.availability || { days: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'], from: '10:00', to: '19:00' };
  const saveP = (patch, msg) => { const p = { ...(prof || {}), ...patch }; setProf(p); saveExpert(p); if (msg) toast(msg); };
  const first = prof?.about?.name?.split(' ')[0] || 'there';
  const tierPct = next ? Math.round((st.delivered / next[1]) * 100) : 100;

  return (
    <ExpertPage width="wide" kicker="Expert home" title={<>Hi {first} 👋</>} sub={offers.length ? `${offers.length} new offer${offers.length > 1 ? 's' : ''} waiting — accept within 30 minutes.` : 'Your orders, offers and numbers in one place.'} shape="sphere"
      right={<>{!prof && <Link to="/expert/profile" className="btn btn-signal">Complete your expert profile</Link>}<ReviewerLink /></>}>
      <div className="ex-tiles">
        <div className={`ex-tile ${today.length ? 'ex-tile-warn' : ''}`}><span className="ex-tile-l">Due in 24 hours</span><strong className="ex-tile-v">{today.length}</strong><span className="ex-tile-s">{live.length} in progress</span></div>
        <div className="ex-tile"><span className="ex-tile-l">New offers</span><strong className="ex-tile-v">{offers.length}</strong><span className="ex-tile-s">Accept within 30 min</span></div>
        <div className="ex-tile"><span className="ex-tile-l">Revisions asked</span><strong className="ex-tile-v">{orders.filter((o) => o.status === 'revision').length}</strong><span className="ex-tile-s">Customer left comments</span></div>
        <div className="ex-tile ex-tile-ink"><span className="ex-tile-l">Earned this month</span><strong className="ex-tile-v" style={{ fontSize: 32 }}>{inr(st.earned + 14436)}</strong><Link to="/expert/earnings" className="xs" style={{ color: '#fff' }}>Withdraw →</Link></div>
        <div className="ex-tile"><span className="ex-tile-l">Rating · on time</span><strong className="ex-tile-v" style={{ fontSize: 26 }}>★ {st.rating} · {st.onTime}%</strong><span className="ex-tile-s">{st.revisions} revisions / order</span></div>
      </div>

      <div className="ex-cols">
        <MeCard title="Next up" sub="Offers first, then the closest deadline." icon="⏱" actions={<Link to="/expert/orders" className="btn btn-outline btn-sm">All orders →</Link>}>
          <div className="mlist">
            {offers.map((o) => (
              <Link key={o.id} to={`/expert/orders/${o.id}`} className="ex-link-row ex-offer-row">
                <span className="ex-av" aria-hidden="true">✦</span>
                <span className="mitem-main"><span className="mitem-title">New offer · {o.role}</span><span className="mitem-meta">{o.plan === 'launch' ? 'Career Launch' : 'Expert rewrite'} · earn {inr(expertPayout(o.price).net)}</span></span>
                <Chip tone="warn">Accept</Chip>
              </Link>
            ))}
            {live.map((o) => {
              const t = timeLeft(o);
              return (
                <Link key={o.id} to={`/expert/orders/${o.id}`} className="ex-link-row">
                  <span className="ex-av" aria-hidden="true">{(o.customer || '').replace(/[^A-Za-z]/g, '').charAt(0).toUpperCase() || '•'}</span>
                  <span className="mitem-main"><span className="mitem-title">{o.id} · {o.customer}</span><span className="mitem-meta">{o.role} · {o.status === 'revision' ? 'revision asked' : o.status === 'waiting' ? 'waiting for customer' : 'writing'}</span></span>
                  <span className="ex-time" style={{ color: t.color }}>{t.label}</span>
                </Link>
              );
            })}
            {!offers.length && !live.length && <Empty compact shape="sphere" title="All clear">Nothing due. New offers appear here.</Empty>}
          </div>
        </MeCard>

        <div className="mstack">
          <MeCard title={`Tier · ${tier}`} icon="★" actions={<Chip tone="accent">{st.delivered} delivered</Chip>}>
            <div className="ex-tier">
              <ScoreRing value={tierPct} size={96} label="Tier progress" sub="%" good={100} fair={50} />
              <span className="stack g8">
                {next ? <><Meter value={tierPct} label="Tier progress" /><span className="small muted">{next[1] - st.delivered} more on-time orders with 4.7★+ to reach <strong>{next[0]}</strong>. Top experts get ₹2,999 orders first.</span></> : <span className="small muted">You’re at the top tier. Keep on-time above 95%.</span>}
              </span>
            </div>
          </MeCard>
          <MeCard title="Availability" sub="Offers only arrive in your working hours, so the 30-minute accept window is fair." icon="☼">
            <label className="check"><input type="checkbox" checked={!!prof?.services?.paused} onChange={(e) => saveP({ services: { ...(prof?.services || {}), paused: e.target.checked } }, e.target.checked ? 'Holiday mode on — no new offers' : 'Back on — new offers will come')} />Holiday mode (no new offers)</label>
            <div className="mspread"><span className="small strong">Orders per week</span>
              <span className="ex-stepper">
                <button type="button" className="btn btn-outline" aria-label="Fewer" onClick={() => saveP({ services: { ...(prof?.services || {}), perWeek: Math.max(1, (prof?.services?.perWeek || 5) - 1) } })}>−</button>
                <strong>{prof?.services?.perWeek || 5}</strong>
                <button type="button" className="btn btn-outline" aria-label="More" onClick={() => saveP({ services: { ...(prof?.services || {}), perWeek: (prof?.services?.perWeek || 5) + 1 } })}>+</button>
              </span>
            </div>
            <div className="ex-days" role="group" aria-label="Working days">{DAYS.map((dd) => { const on = av.days.includes(dd); return <button key={dd} type="button" className="chip" aria-pressed={on} onClick={() => saveP({ availability: { ...av, days: on ? av.days.filter((x) => x !== dd) : [...av.days, dd] } })}>{dd}</button>; })}</div>
            <div className="ex-times"><label htmlFor="avf" className="small strong">From</label><input id="avf" type="time" className="input" value={av.from} onChange={(e) => saveP({ availability: { ...av, from: e.target.value } })} /><label htmlFor="avt" className="small strong">to</label><input id="avt" type="time" className="input" value={av.to} onChange={(e) => saveP({ availability: { ...av, to: e.target.value } })} /></div>
          </MeCard>
        </div>
      </div>
    </ExpertPage>
  );
}
