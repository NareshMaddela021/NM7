// Payments & refunds, and Upgrade & add-ons.
import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useFlow } from '../../lib/flow';
import { useToast } from '../../components/ui';
import { useMe, payments, orderView, buyAddon, upgradeOrder, getMe } from '../../lib/customerStore';
import { useExpertOrders } from '../../lib/expertStore';
import { PLANS, ADDONS, PROMISES, RESUME_PLANS, inr, upgradePrice } from '../../lib/pricing';
import { Kpi } from '../admin/AdminUI';
import { COMING_SOON, buyPack, packStatus } from '../../lib/linkedin/pack';
import { MeHead } from './MeLayout';
import { PayDialog } from './MeOrders';
import { fmtDay, invoicePdf } from './shared';

export function MePayments() {
  const me = useMe();
  const rows = payments(me);
  const paid = rows.filter((r) => r.kind === 'payment').reduce((t, r) => t + r.amount, 0);
  const refunded = rows.filter((r) => r.kind === 'refund').reduce((t, r) => t - r.amount, 0);
  return (
    <>
      <MeHead title="Payments & refunds" sub={`All payments go through ${PROMISES.paymentProvider}. Prices include GST.`} />
      <div className="kpis">
        <Kpi label="Paid" value={inr(paid)} sub={`${rows.filter((r) => r.kind === 'payment').length} payments`} />
        <Kpi label="Refunded" value={inr(refunded)} sub={refunded ? 'to your original payment method' : 'no refunds'} />
      </div>
      <div className="card table-wrap" style={{ padding: 0 }}>
        <table className="table"><thead><tr><th>Date</th><th>What</th><th>Amount</th><th>Method</th><th>Status</th><th /></tr></thead>
          <tbody>{!rows.length && <tr><td colSpan={6} className="small muted" style={{ padding: 20 }}>No payments yet. When you buy a plan, the payment and its GST invoice show here.</td></tr>}{rows.map((r, i) => (
            <tr key={i}>
              <td className="small">{fmtDay(r.at)}</td>
              <td className="small"><Link to={`/me/orders/${r.orderId}`}>{r.what}</Link><div className="xs faint mono">{r.payId}</div></td>
              <td className="small" style={{ color: r.amount < 0 ? 'var(--success)' : undefined }}>{r.amount < 0 ? `+ ${inr(-r.amount)}` : inr(r.amount)}</td>
              <td className="small">{r.method}</td>
              <td>{r.kind === 'refund' ? (r.done ? <span className="badge b-success">Refunded {fmtDay(r.done)}</span> : <span className="badge b-warning">On the way · {PROMISES.refundDays}</span>) : <span className="badge b-neutral">Paid</span>}</td>
              <td>{r.invoice && <button type="button" className="link-btn small" onClick={() => invoicePdf({ no: r.invoice, at: r.at, item: r.what, amount: r.amount, payId: r.payId, method: r.method, name: getMe().account.name, email: getMe().account.email })}>Invoice</button>}</td>
            </tr>
          ))}</tbody></table>
      </div>
      <section className="card stack g8">
        <strong>How refunds work</strong>
        <ul className="small stack g4" style={{ margin: 0, paddingLeft: 18 }}>
          <li><strong>Late delivery</strong> — if your first draft doesn’t arrive within {PROMISES.delivery}, the refund starts automatically. You don’t need to ask.</li>
          <li><strong>Not happy with the quality</strong> — we first re-do it free with your comments. If it’s still not right, ask for a refund; our team reviews it within 24 hours.</li>
          <li>Refunds reach your original payment method in {PROMISES.refundDays}.</li>
        </ul>
      </section>
    </>
  );
}

export function MeUpgrade() {
  const me = useMe();
  useExpertOrders();
  const toast = useToast();
  const nav = useNavigate();
  const { setAddon } = useFlow();
  const [pay, setPay] = useState(null);
  const live = me.orders.map(orderView).filter((o) => o.live);
  const o = live[0];
  const owned = o ? o.addons.map((a) => a.id) : [];
  return (
    <>
      <MeHead title="Upgrade & add-ons" sub={o ? `For your active order ${o.id}. Pay only the difference.` : 'Add-ons work with an order in progress.'} />
      <div className="row g16" style={{ alignItems: 'stretch' }}>
        {RESUME_PLANS.map((id) => PLANS[id]).map((p) => {
          const mine = o?.plan === p.id;
          const can = o && p.price > PLANS[o.plan].price;
          return (
            <section key={p.id} className="card stack g8" style={{ flex: '1 1 220px', borderColor: mine ? 'var(--ink)' : undefined, borderWidth: mine ? 2 : undefined }} aria-label={p.name}>
              <strong>{p.name}</strong><span className="display" style={{ fontSize: 26 }}>{inr(p.price)}</span>
              <span className="small muted" style={{ flex: 1 }}>{p.blurb}</span>
              {mine ? <span className="badge b-signal" style={{ alignSelf: 'flex-start' }}>Your plan</span>
                : can ? <button type="button" className="btn btn-ink" onClick={() => setPay({ kind: 'upgrade', id: p.id, amount: upgradePrice(o.plan, p.id), title: `Upgrade ${o.id} to ${p.name}` })}>Upgrade · pay {inr(upgradePrice(o.plan, p.id))}</button>
                  : o ? <span className="xs faint">Included in your plan</span>
                  : p.id === 'diy' ? <Link to="/builder" className="btn btn-outline">Open the builder</Link>
                  : <button type="button" className="btn btn-ink" onClick={() => { setAddon(p.id === 'launch'); nav('/checkout'); }}>Get {p.name} · {inr(p.price)}</button>}
            </section>
          );
        })}
      </div>
      <PackCard />
      {o && (
        <section className="card stack g12" aria-label="Add-ons">
          <strong>Add-ons for {o.id}</strong>
          {Object.values(ADDONS).filter((a) => !(a.id === 'linkedin' && o.plan === 'launch')).map((a) => (
            <div key={a.id} className="row between g12 well">
              <span className="stack"><strong className="small">{a.name} · {inr(a.price)}</strong><span className="xs muted">{a.blurb}</span></span>
              {owned.includes(a.id) && a.id !== 'revision' ? <span className="badge b-success">Added</span>
                : <button type="button" className="btn btn-outline" style={{ minHeight: 38 }} disabled={a.id === 'express' && o.sent.length > 0} title={a.id === 'express' && o.sent.length > 0 ? 'Only before draft 1' : undefined} onClick={() => setPay({ kind: 'addon', id: a.id, amount: a.price, title: a.name })}>Add</button>}
            </div>
          ))}
        </section>
      )}
      {pay && <PayDialog title={pay.title} amount={pay.amount} onClose={() => setPay(null)} onPaid={() => { if (pay.kind === 'addon') buyAddon(o.id, pay.id); else upgradeOrder(o.id, pay.id); setPay(null); toast(pay.kind === 'addon' ? `${pay.title} added — your expert is told` : `Upgraded to ${PLANS[pay.id].name}`); }} />}
    </>
  );
}

/** The LinkedIn pack on Upgrade & add-ons: open it, buy it (payments on) or "Coming soon". */
function PackCard() {
  const toast = useToast();
  const [st, setSt] = useState(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { packStatus().then(setSt); }, []);
  if (!st) return null;
  const buy = async () => {
    setBusy(true);
    try { await buyPack(); toast('LinkedIn pack unlocked'); setSt(await packStatus()); } catch (e) { toast(e.message || 'Payment didn’t go through. You haven’t been charged.'); } finally { setBusy(false); }
  };
  return (
    <section className="card row between g12" aria-label="LinkedIn pack" data-testid="up-li-pack" style={{ alignItems: 'center', flexWrap: 'wrap' }}>
      <span className="stack g4" style={{ flex: '1 1 260px' }}>
        <strong>LinkedIn pack · {inr(st.price)}</strong>
        <span className="small muted">Headlines, About in 3 styles, experience, skills, a banner and URL ideas, from your own details. Included in Career Launch.</span>
      </span>
      {st.owned ? <Link to="/linkedin#pack" className="btn btn-ink">Open my LinkedIn pack</Link>
        : st.onSale ? <button type="button" className="btn btn-ink" onClick={buy} disabled={busy}>{busy ? 'Waiting for your payment…' : `Buy ${inr(st.price)}`}</button>
          : <span className="btn btn-outline" aria-disabled="true" style={{ opacity: 0.7, cursor: 'not-allowed' }}>{COMING_SOON}</span>}
    </section>
  );
}
