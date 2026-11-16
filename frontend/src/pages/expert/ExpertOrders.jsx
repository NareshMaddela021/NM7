// Expert orders inbox: tabs by status, deadline colours, offers with a countdown.
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { ExpertPage } from './ExpertFrame';
import { Empty } from '../me/kit';
import { useExpertOrders, resetExpertOrders } from '../../lib/expertStore';
import { LIVE } from '../../services/http';
import { expertPayout, inr, PLANS } from '../../lib/pricing';
import { timeLeft } from './OrderWorkspace';

const TABS = [['new', 'New', ['offer']], ['progress', 'In progress', ['progress']], ['waiting', 'Waiting for customer', ['waiting']], ['revision', 'Revisions', ['revision']], ['delivered', 'Delivered', ['delivered']], ['approved', 'Approved', ['approved']]];
const LABEL = { offer: ['New offer', 'b-warning'], progress: ['Writing', 'b-neutral'], waiting: ['Waiting for customer', 'b-neutral'], revision: ['Revision asked', 'b-danger'], delivered: ['Delivered', 'b-success'], approved: ['Approved', 'b-success'], declined: ['Declined', 'b-neutral'] };

export default function ExpertOrders() {
  const orders = useExpertOrders();
  const [picked, setTab] = useState(null);
  const tab = picked || (orders.some((o) => o.status === 'offer') ? 'new' : 'progress'); // open on new offers when there are any
  const list = orders.filter((o) => TABS.find(([k]) => k === tab)[2].includes(o.status)).sort((a, b) => a.deadline - b.deadline);
  return (
    <ExpertPage width="wide" kicker="Your work" title="Orders" sub="Offers first. Colours show how close each deadline is." shape="resume"
      right={!LIVE && <button type="button" className="btn btn-ghost xs" onClick={resetExpertOrders} title="Preview only">Reset sample orders</button>}>
      <div className="ex-tabs" role="tablist" aria-label="Order status">
        {TABS.map(([k, l, st]) => { const n = orders.filter((o) => st.includes(o.status)).length; return <button key={k} type="button" role="tab" aria-selected={tab === k} className="ex-tab" onClick={() => setTab(k)}>{l} <span className="ex-tab-n">{n}</span></button>; })}
      </div>
      {list.length === 0 && <Empty shape="resume" title="Nothing here.">Orders in this tab show up here.</Empty>}
      <div className="ex-orders">
        {list.map((o) => {
          const t = timeLeft(o); const live = ['progress', 'revision', 'waiting', 'offer'].includes(o.status);
          return (
            <Link key={o.id} to={`/expert/orders/${o.id}`} className="ex-order" style={live ? { borderTopColor: o.status === 'offer' ? 'var(--accent)' : t.color } : undefined}>
              <span className="ex-order-top">
                <span className="ex-av" aria-hidden="true">{(o.customer || '').replace(/[^A-Za-z]/g, '').charAt(0).toUpperCase() || '•'}</span>
                <span className="stack g4" style={{ minWidth: 0 }}><strong className="ex-order-name">{o.customer} · {o.role}</strong><span className="ex-order-meta">{o.id} · {PLANS[o.plan].name} · {o.domain} · {o.level} · you earn {inr(expertPayout(o.price).net)}</span></span>
              </span>
              <span className="ex-order-foot">
                <span className={`badge ${LABEL[o.status][1]}`}>{LABEL[o.status][0]}</span>
                {live && <span className="ex-time" style={{ color: o.status === 'offer' ? 'var(--warning)' : t.color }}>{o.status === 'offer' ? `${Math.max(0, Math.round((o.offerExpires - Date.now()) / 60000))} min to accept` : t.label}</span>}
                {o.rating && <span className="small">★ {o.rating}</span>}
              </span>
            </Link>
          );
        })}
      </div>
    </ExpertPage>
  );
}
