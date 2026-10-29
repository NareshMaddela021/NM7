import { useEffect, useState } from 'react';
import Header from '../../components/Header';
import { Segmented, Spinner } from '../../components/ui';
import { getEarnings, withdraw } from '../../services/api';
import { FEES, PLANS, PROMISES, expertPayout, inr } from '../../lib/pricing';
import { downloadCsv } from '../admin/AdminUI';
import { useExpertOrders } from '../../lib/expertStore';
import { expertStats } from './ExpertHome';

import { LIVE } from '../../services/http';
import { Link } from 'react-router-dom';

/** Live: earnings from this expert's own delivered orders. Payouts are sent by bank/UPI transfer (no online withdraw yet). */
function LiveEarnings() {
  const orders = useExpertOrders();
  const done = orders.filter((o) => ['delivered', 'approved'].includes(o.status));
  const approved = done.filter((o) => o.status === 'approved');
  const pending = done.filter((o) => o.status === 'delivered');
  const sum = (list) => list.reduce((t, o) => t + expertPayout(o.price).net, 0);
  return (
    <>
      <Header variant="expert" />
      <main id="main" className="container stack g24" style={{ maxWidth: 1100, padding: '28px 24px 64px' }}>
        <div className="stack g4"><h1 className="display" style={{ fontSize: 32 }}>Earnings</h1><span className="small muted">You keep everything after a {FEES.platformPct}% platform fee (+ GST) and payment charges.</span></div>
        <div className="grid-auto g16" style={{ '--min': '220px' }}>
          <div className="card-ink stack g4"><span className="xs" style={{ opacity: 0.75 }}>Earned · approved orders, after fees</span><span className="display" style={{ fontSize: 40 }}>{inr(sum(approved))}</span><span className="xs" style={{ opacity: 0.7 }}>{approved.length} order(s)</span></div>
          <div className="card stack g4"><span className="xs muted">Pending · delivered, awaiting approval</span><span className="display" style={{ fontSize: 32 }}>{inr(sum(pending))}</span><span className="xs faint">{pending.length} order(s)</span></div>
        </div>
        <section className="card stack g8">
          <strong>Orders</strong>
          {done.length ? (
            <div className="table-wrap" tabIndex={0} role="region" aria-label="Table — scroll sideways to see all columns"><table className="table"><thead><tr><th>Order</th><th>Plan</th><th>Status</th><th>You get</th></tr></thead>
              <tbody>{done.map((o) => <tr key={o.id}><td className="mono small"><Link to={`/expert/orders/${o.id}`}>{o.id}</Link></td><td className="small">{PLANS[o.plan]?.name}</td><td className="small">{o.status === 'approved' ? 'Approved' : 'Delivered'}</td><td className="small">{inr(expertPayout(o.price).net)}</td></tr>)}</tbody></table></div>
          ) : <span className="small muted">No delivered orders yet. Your earnings show here once you deliver.</span>}
        </section>
        <p className="small muted">Payouts are sent by bank or UPI transfer to the details in your profile, {PROMISES.payoutDays ? `within ${PROMISES.payoutDays}` : 'after approval'}. Questions: <a href="mailto:info@nm7.si">info@nm7.si</a>.</p>
      </main>
    </>
  );
}

const PAYOUT_HISTORY = [['14 Oct', 5614, 'Processing', '—'], ['02 Oct', 8020, 'Paid', 'UTR4419920013'], ['18 Sep', 6416, 'Paid', 'UTR4418810457'], ['01 Sep', 4812, 'Paid', 'UTR4417700921']];

const STATUS = { available: ['Available', 'b-success'], pending: ['Pending', 'b-warning'], refunded: ['Refunded', 'b-danger'] };
const NAMES = { aug: 'August', sep: 'September', oct: 'October' };

export default function Earnings() {
  return LIVE ? <LiveEarnings /> : <PreviewEarnings />;
}

function PreviewEarnings() {
  const [data, setData] = useState(null);
  const [month, setMonth] = useState('oct');
  const [state, setState] = useState('idle'); // idle | sending | done
  const st = expertStats(useExpertOrders());
  useEffect(() => { getEarnings().then(setData); }, []);

  const net = (p) => expertPayout(p).net;
  const rows = data?.[month] || [];
  const earned = rows.filter((r) => r.status === 'available').reduce((s, r) => s + net(r.price), 0);
  const pending = rows.filter((r) => r.status === 'pending').reduce((s, r) => s + net(r.price), 0);
  const delivered = rows.filter((r) => r.status !== 'refunded').length;
  const refunds = rows.length - delivered;
  const onTime = rows.length ? Math.round((rows.filter((r) => r.onTime).length / rows.length) * 100) : 0;
  const hist = data?.history || [];
  const max = Math.max(1, ...hist.map((h) => h[1]));
  const ex = expertPayout(PLANS.expert.price);
  const curM = { oct: 'Oct', sep: 'Sep', aug: 'Aug' }[month];

  const doWithdraw = async () => { setState('sending'); await withdraw(earned); setState('done'); };

  return (
    <>
      <Header variant="expert" />
      <main className="container stack g24" style={{ maxWidth: 1280, padding: '28px 24px 64px' }}>
        <div className="row between g16" style={{ alignItems: 'flex-end' }}>
          <div className="stack g4"><h1 className="display" style={{ fontSize: 32 }}>Earnings</h1><span className="small muted">You keep everything after a {FEES.platformPct}% platform fee (+ GST) and payment transaction charges. Withdraw anytime to your UPI or bank.</span></div>
          <Segmented label="Month" value={month} onChange={setMonth} options={[['aug', 'Aug'], ['sep', 'Sep'], ['oct', 'Oct']]} />
        </div>

        {!data ? <div className="grid-auto g16" style={{ '--min': '220px' }}>{[0, 1, 2, 3].map((i) => <div key={i} className="shimmer" style={{ height: 120, borderRadius: 20 }} />)}</div> : (
          <div className="grid-auto g16" style={{ '--min': '220px' }}>
            <div className="card-ink stack g4"><span className="xs" style={{ opacity: .75 }}>Earned in {NAMES[month]} · after fees</span><span className="display" style={{ fontSize: 40 }}>{inr(earned)}</span><span className="xs" style={{ opacity: .75 }}>{delivered} orders delivered</span></div>
            <div className="card stack g4"><span className="xs muted">Pending · awaiting approval</span><span className="display" style={{ fontSize: 32 }}>{inr(pending)}</span><span className="xs faint">Released on approval, or automatically in {PROMISES.autoApproveDays}</span></div>
            <div className="card stack g4"><span className="xs muted">On-time delivery ({PROMISES.deliveryHours} h)</span><span className="display" style={{ fontSize: 32, color: onTime >= 90 ? 'var(--success)' : 'var(--warning)' }}>{onTime}%</span><span className="xs faint">Below 90% pauses new assignments</span></div>
            <div className="card stack g4"><span className="xs muted">Customer rating</span><span className="display" style={{ fontSize: 32 }}>{st.rating}<span className="faint" style={{ fontSize: 16 }}> / 5</span></span><span className="xs faint">{refunds} refund{refunds === 1 ? '' : 's'} this month</span></div>
          </div>
        )}

        <div className="split">
          <section className="main card" aria-label="Orders" style={{ padding: 0, overflow: 'hidden' }}>
            <div className="row between" style={{ padding: '16px 20px', borderBottom: '1px solid var(--border)' }}><strong>Orders in {NAMES[month]}</strong><button type="button" className="btn btn-outline" style={{ minHeight: 40, fontSize: 13 }} onClick={() => downloadCsv(`asuraa-statement-${month}.csv`, [['Order', 'Customer', 'Plan', 'Price', `Platform fee ${FEES.platformPct}%`, `GST ${FEES.gstPct}% on fee`, `Transaction ${FEES.txPct}%`, 'TDS', 'You earn', 'Status'], ...rows.map((r) => { const b = expertPayout(r.price); return [r.id, r.name, r.plan, r.price, Math.round(b.platform), Math.round(b.gst), Math.round(b.tx), FEES.tdsPct == null ? 'rate pending' : Math.round(b.net * FEES.tdsPct / 100), Math.round(b.net), r.status]; })])}>Download statement</button></div>
            <div className="table-wrap" tabIndex={0} role="region" aria-label="Table — scroll sideways to see all columns">
              <table className="table" style={{ minWidth: 620 }}>
                <thead><tr><th>ORDER</th><th>PLAN</th><th>DELIVERED</th><th>STATUS</th><th style={{ textAlign: 'right' }}>FEE + GST + TX</th><th style={{ textAlign: 'right' }}>YOU EARN</th></tr></thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.id}>
                      <td><div className="stack"><strong>{r.name}</strong><span className="mono faint">{r.id} · {r.role}</span></div></td>
                      <td>{r.plan} <span className="faint">· {inr(r.price)}</span></td>
                      <td style={{ color: r.onTime ? 'var(--text2)' : 'var(--danger)' }}>{r.time}{r.onTime ? '' : ' · late'}</td>
                      <td><span className={`badge ${STATUS[r.status][1]}`}>{STATUS[r.status][0]}</span></td>
                      <td className="xs muted" style={{ textAlign: 'right' }}>− {inr(expertPayout(r.price).platform)} − {inr(expertPayout(r.price).gst)} − {inr(expertPayout(r.price).tx)}</td>
                      <td style={{ textAlign: 'right', fontFamily: 'var(--font-mono)', color: r.status === 'refunded' ? 'var(--text3)' : 'var(--text)', textDecoration: r.status === 'refunded' ? 'line-through' : 'none' }}>{inr(net(r.price))}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <aside className="side stack g16">
            <section className="card stack g12" aria-label="Last 6 months">
              <strong>Last 6 months</strong>
              <div role="img" aria-label={`Monthly earnings: ${hist.map(([m, v]) => `${m} ${inr(net(v))}`).join(', ')}`} style={{ display: 'grid', gridTemplateColumns: 'repeat(6, minmax(0,1fr))', gap: 10, alignItems: 'end', height: 170 }}>
                {hist.map(([m, v]) => (
                  <div key={m} className="stack g4" style={{ alignItems: 'center', height: '100%', justifyContent: 'flex-end' }}>
                    <span className="mono faint" style={{ fontSize: 10 }}>{inr(net(v))}</span>
                    <div style={{ width: '100%', maxWidth: 36, height: `${Math.max(6, (v / max) * 100)}%`, borderRadius: '6px 6px 2px 2px', background: m === curM ? 'var(--ink)' : 'var(--border2)', transition: 'height 400ms var(--ease)' }} />
                    <span className="xs" style={{ color: m === curM ? 'var(--text)' : 'var(--text3)', fontWeight: m === curM ? 700 : 500 }}>{m}</span>
                  </div>
                ))}
              </div>
            </section>

            <section className="card stack g12" aria-label="Withdraw">
              <div className="row between" style={{ alignItems: 'baseline' }}><strong>Available to withdraw</strong><span aria-live="polite" className="display" style={{ fontSize: 26 }}>{inr(state === 'done' ? 0 : earned)}</span></div>
              <div className="row between small muted"><span>To</span><span>expert@okaxis · <button type="button" className="link-btn" style={{ minHeight: 0, padding: 0 }}>Change</button></span></div>
              <div className="row between small muted"><span>TDS</span><span>{FEES.tdsPct == null ? '[rate from your CA]' : `${FEES.tdsPct}%`}</span></div>
              {state === 'done' ? (
                <div role="status" style={{ padding: '12px 14px', borderRadius: 12, background: 'var(--successbg)', color: 'var(--success)', fontWeight: 600, fontSize: 14 }}>Withdrawal started. It reaches your account in {PROMISES.withdrawalDays}.</div>
              ) : (
                <>
                  <button type="button" className="btn btn-ink btn-lg" disabled={state === 'sending' || earned <= 0} onClick={doWithdraw}>{state === 'sending' && <Spinner />}{state === 'sending' ? 'Sending…' : `Withdraw ${inr(earned)}`}</button>
                  <span className="xs faint" style={{ textAlign: 'center' }}>Withdraw anytime · arrives in {PROMISES.withdrawalDays} via {PROMISES.paymentProvider}</span>
                </>
              )}
            </section>

            <section className="card stack g8" aria-label="Payout history">
              <strong>Payout history</strong>
              {PAYOUT_HISTORY.map(([dt, amt, stt, utr]) => <div key={dt} className="row between small"><span>{dt} · {inr(amt)}</span><span className={stt === 'Paid' ? '' : 'muted'}>{stt}{utr !== '—' && <span className="mono xs faint"> · {utr}</span>}</span></div>)}
            </section>

            <section className="well stack g8 small muted" style={{ borderRadius: 20, padding: 20, lineHeight: 1.55 }}>
              <strong style={{ color: 'var(--text)' }}>How earnings work</strong>
              <span>• Platform fee: {FEES.platformPct}% of the order price, plus {FEES.gstPct}% GST on that fee. Transaction charges ({FEES.txPct}%) are also deducted.</span>
              <span>• On a {inr(PLANS.expert.price)} rewrite: {inr(PLANS.expert.price)} − {inr(ex.platform)} fee − {inr(ex.gst)} GST − {inr(ex.tx)} charges = <strong style={{ color: 'var(--text)' }}>{inr(ex.net)}</strong> to you.</span>
              <span>• On Career Launch ({inr(PLANS.launch.price)}), you get <strong style={{ color: 'var(--text)' }}>{inr(expertPayout(PLANS.launch.price).net)}</strong>.</span>
              <span>• Earnings become available once the customer approves, or automatically {PROMISES.autoApproveDays} after delivery.</span>
              <span>• Orders refunded because they were late or not fulfilled aren’t paid.</span>
            </section>
          </aside>
        </div>
      </main>
    </>
  );
}
