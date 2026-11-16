import { useEffect, useState } from 'react';
import { ExpertPage } from './ExpertFrame';
import { Chip, Empty, MeCard } from '../me/kit';
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
    <ExpertPage width="mid" kicker="Your money" title="Earnings" sub={`You keep everything after a ${FEES.platformPct}% platform fee (+ GST) and payment charges.`} shape="sphere">
      <div className="ex-tiles">
        <div className="ex-tile ex-tile-ink"><span className="ex-tile-l">Earned · approved orders, after fees</span><span className="ex-tile-v">{inr(sum(approved))}</span><span className="ex-tile-s">{approved.length} order(s)</span></div>
        <div className="ex-tile"><span className="ex-tile-l">Pending · delivered, awaiting approval</span><span className="ex-tile-v">{inr(sum(pending))}</span><span className="ex-tile-s">{pending.length} order(s)</span></div>
      </div>
      <MeCard title="Orders" icon="₹" sub="Delivered and approved orders, with what you get from each.">
        {done.length ? (
          <div className="table-wrap mtable-wrap" tabIndex={0} role="region" aria-label="Table — scroll sideways to see all columns"><table className="table mtable"><thead><tr><th>Order</th><th>Plan</th><th>Status</th><th>You get</th></tr></thead>
            <tbody>{done.map((o) => <tr key={o.id}><td data-label="Order" className="mono small"><Link to={`/expert/orders/${o.id}`}>{o.id}</Link></td><td data-label="Plan" className="small">{PLANS[o.plan]?.name}</td><td data-label="Status" className="small"><Chip tone={o.status === 'approved' ? 'ok' : 'warn'}>{o.status === 'approved' ? 'Approved' : 'Delivered'}</Chip></td><td data-label="You get" className="small strong">{inr(expertPayout(o.price).net)}</td></tr>)}</tbody></table></div>
        ) : <Empty compact shape="sphere" title="No delivered orders yet">No delivered orders yet. Your earnings show here once you deliver.</Empty>}
      </MeCard>
      <p className="small muted">Payouts are sent by bank or UPI transfer to the details in your profile, {PROMISES.payoutDays ? `within ${PROMISES.payoutDays}` : 'after approval'}. Questions: <a href="mailto:info@nm7.si">info@nm7.si</a>.</p>
    </ExpertPage>
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
    <ExpertPage width="wide" kicker="Your money" title="Earnings" sub={`You keep everything after a ${FEES.platformPct}% platform fee (+ GST) and payment transaction charges. Withdraw anytime to your UPI or bank.`} shape="sphere"
      right={<Segmented label="Month" value={month} onChange={setMonth} options={[['aug', 'Aug'], ['sep', 'Sep'], ['oct', 'Oct']]} />}>

        {!data ? <div className="ex-tiles">{[0, 1, 2, 3].map((i) => <div key={i} className="shimmer" style={{ height: 120, borderRadius: 18 }} />)}</div> : (
          <div className="ex-tiles">
            <div className="ex-tile ex-tile-ink"><span className="ex-tile-l">Earned in {NAMES[month]} · after fees</span><span className="ex-tile-v">{inr(earned)}</span><span className="ex-tile-s">{delivered} orders delivered</span></div>
            <div className="ex-tile"><span className="ex-tile-l">Pending · awaiting approval</span><span className="ex-tile-v">{inr(pending)}</span><span className="ex-tile-s">Released on approval, or automatically in {PROMISES.autoApproveDays}</span></div>
            <div className={`ex-tile ${onTime >= 90 ? 'ex-tile-ok' : 'ex-tile-warn'}`}><span className="ex-tile-l">On-time delivery ({PROMISES.deliveryHours} h)</span><span className="ex-tile-v">{onTime}%</span><span className="ex-tile-s">Below 90% pauses new assignments</span></div>
            <div className="ex-tile"><span className="ex-tile-l">Customer rating</span><span className="ex-tile-v">{st.rating}<span className="faint" style={{ fontSize: 16 }}> / 5</span></span><span className="ex-tile-s">{refunds} refund{refunds === 1 ? '' : 's'} this month</span></div>
          </div>
        )}

        <div className="ex-cols">
          <section className="mcard" aria-label="Orders" style={{ padding: 0, overflow: 'hidden' }}>
            <div className="mspread" style={{ padding: '16px 20px', borderBottom: '1px solid var(--border)' }}><strong className="mcard-title">Orders in {NAMES[month]}</strong><button type="button" className="btn btn-outline" style={{ minHeight: 40, fontSize: 13 }} onClick={() => downloadCsv(`asuraa-statement-${month}.csv`, [['Order', 'Customer', 'Plan', 'Price', `Platform fee ${FEES.platformPct}%`, `GST ${FEES.gstPct}% on fee`, `Transaction ${FEES.txPct}%`, 'TDS', 'You earn', 'Status'], ...rows.map((r) => { const b = expertPayout(r.price); return [r.id, r.name, r.plan, r.price, Math.round(b.platform), Math.round(b.gst), Math.round(b.tx), FEES.tdsPct == null ? 'rate pending' : Math.round(b.net * FEES.tdsPct / 100), Math.round(b.net), r.status]; })])}>Download statement</button></div>
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

          <aside className="mstack">
            <section className="mcard" aria-label="Last 6 months">
              <strong className="mcard-title">Last 6 months</strong>
              <div role="img" aria-label={`Monthly earnings: ${hist.map(([m, v]) => `${m} ${inr(net(v))}`).join(', ')}`} className="ex-bars">
                {hist.map(([m, v]) => (
                  <div key={m} className="ex-bar">
                    <span className="mono faint" style={{ fontSize: 10 }}>{inr(net(v))}</span>
                    <div className={`ex-bar-fill ${m === curM ? 'on' : ''}`} style={{ height: `${Math.max(6, (v / max) * 100)}%` }} />
                    <span className="xs" style={{ color: m === curM ? 'var(--text)' : 'var(--text3)', fontWeight: m === curM ? 700 : 500 }}>{m}</span>
                  </div>
                ))}
              </div>
            </section>

            <section className="mcard mcard-accent" aria-label="Withdraw">
              <div className="mspread" style={{ alignItems: 'baseline' }}><strong className="mcard-title">Available to withdraw</strong><span aria-live="polite" className="display" style={{ fontSize: 30 }}>{inr(state === 'done' ? 0 : earned)}</span></div>
              <div className="ex-kv"><span>To</span><span>expert@okaxis · <button type="button" className="link-btn" style={{ minHeight: 0, padding: 0 }}>Change</button></span></div>
              <div className="ex-kv"><span>TDS</span><span>{FEES.tdsPct == null ? '[rate from your CA]' : `${FEES.tdsPct}%`}</span></div>
              {state === 'done' ? (
                <div role="status" style={{ padding: '12px 14px', borderRadius: 12, background: 'var(--successbg)', color: 'var(--success)', fontWeight: 600, fontSize: 14 }}>Withdrawal started. It reaches your account in {PROMISES.withdrawalDays}.</div>
              ) : (
                <>
                  <button type="button" className="btn btn-signal btn-lg" disabled={state === 'sending' || earned <= 0} onClick={doWithdraw}>{state === 'sending' && <Spinner />}{state === 'sending' ? 'Sending…' : `Withdraw ${inr(earned)}`}</button>
                  <span className="xs faint" style={{ textAlign: 'center' }}>Withdraw anytime · arrives in {PROMISES.withdrawalDays} via {PROMISES.paymentProvider}</span>
                </>
              )}
            </section>

            <section className="mcard" aria-label="Payout history">
              <strong className="mcard-title">Payout history</strong>
              <div className="mlist">{PAYOUT_HISTORY.map(([dt, amt, stt, utr]) => <div key={dt} className="mitem"><span className="mitem-main"><span className="mitem-title">{dt} · {inr(amt)}</span>{utr !== '—' && <span className="mitem-meta mono">{utr}</span>}</span><Chip tone={stt === 'Paid' ? 'ok' : 'warn'}>{stt}</Chip></div>)}</div>
            </section>

            <section className="mcard ex-how">
              <strong className="mcard-title">How earnings work</strong>
              <span>• Platform fee: {FEES.platformPct}% of the order price, plus {FEES.gstPct}% GST on that fee. Transaction charges ({FEES.txPct}%) are also deducted.</span>
              <span>• On a {inr(PLANS.expert.price)} rewrite: {inr(PLANS.expert.price)} − {inr(ex.platform)} fee − {inr(ex.gst)} GST − {inr(ex.tx)} charges = <strong style={{ color: 'var(--text)' }}>{inr(ex.net)}</strong> to you.</span>
              <span>• On Career Launch ({inr(PLANS.launch.price)}), you get <strong style={{ color: 'var(--text)' }}>{inr(expertPayout(PLANS.launch.price).net)}</strong>.</span>
              <span>• Earnings become available once the customer approves, or automatically {PROMISES.autoApproveDays} after delivery.</span>
              <span>• Orders refunded because they were late or not fulfilled aren’t paid.</span>
            </section>
          </aside>
        </div>
    </ExpertPage>
  );
}
