// Expert home: today's work, offers, revisions, numbers, tier progress, and quick availability switches.
import { Link } from 'react-router-dom';
import { useState } from 'react';
import Header from '../../components/Header';
import { Meter, useToast } from '../../components/ui';
import { useExpertOrders } from '../../lib/expertStore';
import { loadExpert, saveExpert } from '../../lib/expert';
import { expertPayout, inr } from '../../lib/pricing';
import { timeLeft } from './OrderWorkspace';

const TIERS = [['New', 0], ['Trusted', 10], ['Top expert', 40]];
const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

export function expertStats(orders) {
  const done = orders.filter((o) => ['delivered', 'approved'].includes(o.status));
  const rated = done.filter((o) => o.rating);
  const onTime = done.length ? Math.round((done.filter((o) => (o.deliveredAt || 0) <= o.deadline).length / done.length) * 100) : 100;
  const revisions = done.length ? +(done.reduce((s, o) => s + Math.max(0, (o.versions?.length || 1) - 1), 0) / done.length).toFixed(1) : 0;
  const rating = rated.length ? +(rated.reduce((s, o) => s + o.rating, 0) / rated.length).toFixed(1) : null;
  const earned = done.reduce((s, o) => s + expertPayout(o.price).net, 0);
  // history before this preview (sample): 24 delivered orders, 4.7★, 93% on time
  return { delivered: done.length + 24, rating: rating ? +(((rating * rated.length) + 4.7 * 24) / (rated.length + 24)).toFixed(1) : 4.7, onTime: Math.round((onTime * done.length + 93 * 24) / (done.length + 24)), revisions, earned };
}

export default function ExpertHome() {
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

  return (
    <>
      <Header variant="expert" />
      <main className="container-wide stack g20" style={{ padding: '24px 24px 64px' }}>
        <div className="row between g12" style={{ alignItems: 'flex-end' }}>
          <div className="stack g4"><span className="mono faint">EXPERT HOME</span><h1 className="display" style={{ fontSize: 32 }}>Hi {prof?.about?.name?.split(' ')[0] || 'there'} 👋</h1></div>
          {!prof && <Link to="/expert/profile" className="btn btn-ink">Complete your expert profile</Link>}
        </div>

        <div className="kpis">
          <div className="card stack g4" style={{ padding: 16 }}><span className="xs muted">Due in 24 hours</span><strong className="display" style={{ fontSize: 26, color: today.length ? 'var(--warning)' : undefined }}>{today.length}</strong><span className="xs faint">{live.length} in progress</span></div>
          <div className="card stack g4" style={{ padding: 16 }}><span className="xs muted">New offers</span><strong className="display" style={{ fontSize: 26 }}>{offers.length}</strong><span className="xs faint">Accept within 30 min</span></div>
          <div className="card stack g4" style={{ padding: 16 }}><span className="xs muted">Revisions asked</span><strong className="display" style={{ fontSize: 26 }}>{orders.filter((o) => o.status === 'revision').length}</strong><span className="xs faint">Customer left comments</span></div>
          <div className="card stack g4" style={{ padding: 16 }}><span className="xs muted">Earned this month</span><strong className="display" style={{ fontSize: 26 }}>{inr(st.earned + 14436)}</strong><Link to="/expert/earnings" className="xs">Withdraw →</Link></div>
          <div className="card stack g4" style={{ padding: 16 }}><span className="xs muted">Rating · on time</span><strong className="display" style={{ fontSize: 26 }}>★ {st.rating} · {st.onTime}%</strong><span className="xs faint">{st.revisions} revisions / order</span></div>
        </div>

        <div className="row g16" style={{ alignItems: 'flex-start' }}>
          <section className="card stack g8" style={{ flex: '2 1 460px' }}>
            <div className="row between"><strong>Next up</strong><Link to="/expert/orders" className="small">All orders →</Link></div>
            {offers.map((o) => <Link key={o.id} to={`/expert/orders/${o.id}`} className="well row between g8" style={{ textDecoration: 'none', color: 'inherit', borderLeft: '4px solid var(--signal)' }}><span className="small"><strong>New offer · {o.role}</strong> · {o.plan === 'launch' ? 'Career Launch' : 'Expert rewrite'} · earn {inr(expertPayout(o.price).net)}</span><span className="badge b-warning">Accept</span></Link>)}
            {live.map((o) => { const t = timeLeft(o); return <Link key={o.id} to={`/expert/orders/${o.id}`} className="well row between g8" style={{ textDecoration: 'none', color: 'inherit' }}><span className="small"><strong>{o.id}</strong> · {o.customer} · {o.role} · {o.status === 'revision' ? 'revision asked' : o.status === 'waiting' ? 'waiting for customer' : 'writing'}</span><span className="xs strong" style={{ color: t.color }}>{t.label}</span></Link>; })}
            {!offers.length && !live.length && <span className="small muted">Nothing due. New offers appear here.</span>}
          </section>

          <section className="stack g16" style={{ flex: '1 1 320px' }}>
            <div className="card stack g8">
              <div className="row between"><strong>Tier · {tier}</strong><span className="xs muted">{st.delivered} delivered</span></div>
              {next ? <><Meter value={Math.round((st.delivered / next[1]) * 100)} label="Tier progress" /><span className="xs muted">{next[1] - st.delivered} more on-time orders with 4.7★+ to reach <strong>{next[0]}</strong>. Top experts get ₹2,999 orders first.</span></> : <span className="xs muted">You’re at the top tier. Keep on-time above 95%.</span>}
            </div>
            <div className="card stack g12">
              <strong>Availability</strong>
              <label className="check small"><input type="checkbox" checked={!!prof?.services?.paused} onChange={(e) => saveP({ services: { ...(prof?.services || {}), paused: e.target.checked } }, e.target.checked ? 'Holiday mode on — no new offers' : 'Back on — new offers will come')} />Holiday mode (no new offers)</label>
              <div className="row g8" style={{ alignItems: 'center' }}><span className="small">Orders per week</span>
                <button type="button" className="btn btn-outline" aria-label="Fewer" style={{ minHeight: 34 }} onClick={() => saveP({ services: { ...(prof?.services || {}), perWeek: Math.max(1, (prof?.services?.perWeek || 5) - 1) } })}>−</button>
                <strong className="mono">{prof?.services?.perWeek || 5}</strong>
                <button type="button" className="btn btn-outline" aria-label="More" style={{ minHeight: 34 }} onClick={() => saveP({ services: { ...(prof?.services || {}), perWeek: (prof?.services?.perWeek || 5) + 1 } })}>+</button></div>
              <div className="row g4" role="group" aria-label="Working days">{DAYS.map((dd) => { const on = av.days.includes(dd); return <button key={dd} type="button" className="chip" aria-pressed={on} style={{ minHeight: 32, fontSize: 12, padding: '0 10px' }} onClick={() => saveP({ availability: { ...av, days: on ? av.days.filter((x) => x !== dd) : [...av.days, dd] } })}>{dd}</button>; })}</div>
              <div className="row g8" style={{ alignItems: 'center' }}><label htmlFor="avf" className="small">From</label><input id="avf" type="time" className="input" style={{ height: 38, width: 120 }} value={av.from} onChange={(e) => saveP({ availability: { ...av, from: e.target.value } })} /><label htmlFor="avt" className="small">to</label><input id="avt" type="time" className="input" style={{ height: 38, width: 120 }} value={av.to} onChange={(e) => saveP({ availability: { ...av, to: e.target.value } })} /></div>
              <span className="xs faint">Offers only arrive in your working hours, so the 30-minute accept window is fair.</span>
            </div>
          </section>
        </div>
      </main>
    </>
  );
}
