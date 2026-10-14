// Expert orders inbox: tabs by status, deadline colours, offers with a countdown.
import { useState } from 'react';
import { Link } from 'react-router-dom';
import Header from '../../components/Header';
import { useExpertOrders, resetExpertOrders } from '../../lib/expertStore';
import { expertPayout, inr, PLANS } from '../../lib/pricing';
import { timeLeft } from './OrderWorkspace';

const TABS = [['new', 'New', ['offer']], ['progress', 'In progress', ['progress']], ['waiting', 'Waiting for customer', ['waiting']], ['revision', 'Revisions', ['revision']], ['delivered', 'Delivered', ['delivered']], ['approved', 'Approved', ['approved']]];
const LABEL = { offer: ['New offer', 'b-warning'], progress: ['Writing', 'b-neutral'], waiting: ['Waiting for customer', 'b-neutral'], revision: ['Revision asked', 'b-danger'], delivered: ['Delivered', 'b-success'], approved: ['Approved', 'b-success'], declined: ['Declined', 'b-neutral'] };

export default function ExpertOrders() {
  const orders = useExpertOrders();
  const [tab, setTab] = useState('progress');
  const list = orders.filter((o) => TABS.find(([k]) => k === tab)[2].includes(o.status)).sort((a, b) => a.deadline - b.deadline);
  return (
    <>
      <Header variant="expert" />
      <main className="container stack g16" style={{ maxWidth: 1100, padding: '24px 24px 64px' }}>
        <div className="row between g12" style={{ alignItems: 'flex-end' }}>
          <h1 className="display" style={{ fontSize: 32 }}>Orders</h1>
          <button type="button" className="btn btn-ghost xs" onClick={resetExpertOrders} title="Preview only">Reset sample orders</button>
        </div>
        <div className="row g8" role="tablist" aria-label="Order status">
          {TABS.map(([k, l, st]) => { const n = orders.filter((o) => st.includes(o.status)).length; return <button key={k} type="button" role="tab" aria-selected={tab === k} className="chip" aria-pressed={tab === k} style={{ minHeight: 36, fontSize: 13 }} onClick={() => setTab(k)}>{l} <span className="mono xs" style={{ opacity: 0.7 }}>{n}</span></button>; })}
        </div>
        {list.length === 0 && <div className="well small muted" style={{ padding: 24, textAlign: 'center' }}>Nothing here.</div>}
        <div className="stack g8">
          {list.map((o) => {
            const t = timeLeft(o); const live = ['progress', 'revision', 'waiting', 'offer'].includes(o.status);
            return (
              <Link key={o.id} to={`/expert/orders/${o.id}`} className="card row between g12" style={{ textDecoration: 'none', color: 'inherit', borderLeft: live ? `5px solid ${o.status === 'offer' ? 'var(--signal)' : t.color}` : undefined }}>
                <span className="stack g4"><strong>{o.customer} · {o.role}</strong><span className="xs muted">{o.id} · {PLANS[o.plan].name} · {o.domain} · {o.level} · you earn {inr(expertPayout(o.price).net)}</span></span>
                <span className="row g8"><span className={`badge ${LABEL[o.status][1]}`}>{LABEL[o.status][0]}</span>{live && <span className="xs strong" style={{ color: o.status === 'offer' ? 'var(--warning)' : t.color }}>{o.status === 'offer' ? `${Math.max(0, Math.round((o.offerExpires - Date.now()) / 60000))} min to accept` : t.label}</span>}{o.rating && <span className="small">★ {o.rating}</span>}</span>
              </Link>
            );
          })}
        </div>
      </main>
    </>
  );
}
