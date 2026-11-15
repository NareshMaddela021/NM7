// Payments & refunds, and Upgrade & add-ons.
import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useFlow } from '../../lib/flow';
import { useToast } from '../../components/ui';
import { useMe, payments, orderView, buyAddon, upgradeOrder, getMe } from '../../lib/customerStore';
import { useExpertOrders } from '../../lib/expertStore';
import { PLANS, ADDONS, PROMISES, RESUME_PLANS, inr, upgradePrice } from '../../lib/pricing';
import { COMING_SOON, buyPack, packStatus } from '../../lib/linkedin/pack';
import { BUY_WA } from '../../lib/waPay';
import { MeHead } from './MeLayout';
import { PayDialog } from './MeOrders';
import { fmtDay, invoicePdf } from './shared';
import { Chip, Empty, MeCard, Stat } from './kit';
import '../../styles/me-account.css';

/** A plan's short text as a list of points (its own words, split at commas, "+" and "and"). */
const points = (blurb) => blurb.split(/,\s*|\s\+\s|\s+and\s+/).map((x) => x.trim()).filter(Boolean).map((x) => x[0].toUpperCase() + x.slice(1));

export function MePayments() {
  const me = useMe();
  const rows = payments(me);
  const paid = rows.filter((r) => r.kind === 'payment').reduce((t, r) => t + r.amount, 0);
  const refunded = rows.filter((r) => r.kind === 'refund').reduce((t, r) => t - r.amount, 0);
  return (
    <>
      <MeHead title="Payments & refunds" sub={`All payments go through ${PROMISES.paymentProvider}. Prices include GST.`} />
      <div className="mgrid-3 acc-stats">
        <Stat label="Paid" value={inr(paid)} sub={`${rows.filter((r) => r.kind === 'payment').length} payments`} />
        <Stat label="Refunded" value={inr(refunded)} sub={refunded ? 'to your original payment method' : 'no refunds'} tone={refunded ? 'ok' : undefined} />
      </div>
      <MeCard as="section" title="Your payments" sub="Tap an item to open its order. Invoices and receipts download as PDF." label="Payments">
        {!rows.length ? (
          <Empty shape="handshake" compact title="No payments yet" action={<Link to="/pricing" className="btn btn-signal">See plans</Link>}>When you buy a plan, the payment and its GST invoice show here.</Empty>
        ) : (
          <div className="table-wrap mtable-wrap" tabIndex={0} role="region" aria-label="Table — scroll sideways to see all columns">
            <table className="table mtable acc-pay"><thead><tr><th>Date</th><th>What</th><th>Amount</th><th>Method</th><th>Status</th><th><span className="sr-only">Download</span></th></tr></thead>
              <tbody>{rows.map((r, i) => (
                <tr key={i}>
                  <td className="small" data-label="Date">{fmtDay(r.at)}</td>
                  <td className="small acc-pay-what" data-label="What"><span><Link to={`/me/orders/${r.orderId}`}>{r.what}</Link><span className="xs faint mono acc-payid">{r.payId}</span></span></td>
                  <td className="small strong" data-label="Amount" style={{ color: r.amount < 0 ? 'var(--success)' : undefined }}>{r.amount < 0 ? `+ ${inr(-r.amount)}` : inr(r.amount)}</td>
                  <td className="small" data-label="Method">{r.method}</td>
                  <td data-label="Status">{r.kind === 'refund' ? (r.done ? <Chip tone="ok">Refunded {fmtDay(r.done)}</Chip> : <Chip tone="warn">On the way · {PROMISES.refundDays}</Chip>) : <Chip>Paid</Chip>}</td>
                  <td className="acc-pay-dl">{r.invoice && <button type="button" className="btn btn-outline acc-pdf" onClick={() => invoicePdf({ no: r.invoice, at: r.at, item: r.what, amount: r.amount, payId: r.payId, method: r.method, receipt: r.receipt, name: getMe().account.name, email: getMe().account.email })}>{r.receipt ? 'Receipt' : 'Invoice'}</button>}</td>
                </tr>
              ))}</tbody></table>
          </div>
        )}
      </MeCard>
      <MeCard as="section" title="How refunds work" icon="↺" className="acc-howto" label="How refunds work">
        <ol className="msteps">
          <li><span className="msteps-dot" aria-hidden="true">1</span><span className="small"><strong>Late delivery</strong> — if your first draft doesn’t arrive within {PROMISES.delivery}, the refund starts automatically. You don’t need to ask.</span></li>
          <li><span className="msteps-dot" aria-hidden="true">2</span><span className="small"><strong>Not happy with the quality</strong> — we first re-do it free with your comments. If it’s still not right, ask for a refund; our team reviews it within 24 hours.</span></li>
          <li><span className="msteps-dot" aria-hidden="true">3</span><span className="small">Refunds reach your original payment method in {PROMISES.refundDays}.</span></li>
        </ol>
      </MeCard>
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
      <div className="mgrid acc-plans">
        {RESUME_PLANS.map((id) => PLANS[id]).map((p) => {
          const mine = o?.plan === p.id;
          const can = o && p.price > PLANS[o.plan].price;
          return (
            <section key={p.id} className={`mcard mplan acc-plan ${mine ? 'acc-plan-mine' : ''} ${p.id === 'expert' ? 'acc-plan-mid' : ''}`} aria-label={p.name}>
              {mine && <span className="mplan-best"><Chip tone="accent">Your plan</Chip></span>}
              <span className="mkicker">{p.id === 'diy' ? 'Do it yourself' : p.id === 'expert' ? 'With an expert' : 'Full launch'}</span>
              <h2 className="mcard-title">{p.name}</h2>
              <span className="mplan-price">{inr(p.price)}</span>
              <ul className="mplan-feat">{points(p.blurb).map((x) => <li key={x}>{x}</li>)}</ul>
              <span className="acc-plan-cta">
                {mine ? <span className="xs muted">You have this plan.</span>
                  : can ? <button type="button" className="btn btn-signal" onClick={() => setPay({ kind: 'upgrade', id: p.id, amount: upgradePrice(o.plan, p.id), title: `Upgrade ${o.id} to ${p.name}` })}>Upgrade · pay {inr(upgradePrice(o.plan, p.id))}</button>
                    : o ? <span className="xs faint">Included in your plan</span>
                    : p.id === 'diy' ? <Link to="/builder" className="btn btn-outline">Open the builder</Link>
                    : <button type="button" className="btn btn-signal" onClick={() => { setAddon(p.id === 'launch'); nav('/checkout'); }}>Get {p.name} · {inr(p.price)}</button>}
              </span>
            </section>
          );
        })}
      </div>
      <PackCard />
      {o && (
        <MeCard as="section" label="Add-ons" icon="+" title={`Add-ons for ${o.id}`} sub="Small extras for the order in progress.">
          <ul className="mlist">
            {Object.values(ADDONS).filter((a) => !(a.id === 'linkedin' && o.plan === 'launch')).map((a) => (
              <li key={a.id} className="mitem">
                <span className="mitem-main"><span className="mitem-title">{a.name} · {inr(a.price)}</span><span className="mitem-meta">{a.blurb}</span></span>
                <span className="mitem-side">{owned.includes(a.id) && a.id !== 'revision' ? <Chip tone="ok">Added</Chip>
                  : <button type="button" className="btn btn-outline" disabled={a.id === 'express' && o.sent.length > 0} title={a.id === 'express' && o.sent.length > 0 ? 'Only before draft 1' : undefined} onClick={() => setPay({ kind: 'addon', id: a.id, amount: a.price, title: a.name })}>Add</button>}</span>
              </li>
            ))}
          </ul>
        </MeCard>
      )}
      {pay && <PayDialog title={pay.title} amount={pay.amount} orderId={o.id} item={pay.kind === 'addon' ? pay.id : `upgrade:${pay.id}`} onClose={() => setPay(null)} onPaid={() => { if (pay.kind === 'addon') buyAddon(o.id, pay.id); else upgradeOrder(o.id, pay.id); setPay(null); toast(pay.kind === 'addon' ? `${pay.title} added — your expert is told` : `Upgraded to ${PLANS[pay.id].name}`); }} />}
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
    try { const r = await buyPack(st.mode); if (!r?.whatsapp) { toast('LinkedIn pack unlocked'); setSt(await packStatus()); } } catch (e) { toast(e.message || 'Payment didn’t go through. You haven’t been charged.'); } finally { setBusy(false); }
  };
  return (
    <section className="mcard mcard-accent acc-pack" aria-label="LinkedIn pack" data-testid="up-li-pack">
      <span className="mcard-ic blue" aria-hidden="true">in</span>
      <span className="stack g4" style={{ flex: '1 1 240px', minWidth: 0 }}>
        <strong className="mserif acc-pack-t">LinkedIn pack · {inr(st.price)}</strong>
        <span className="small muted">Headlines, About in 3 styles, experience, skills, a banner and URL ideas, from your own details. Included in Career Launch.</span>
      </span>
      {st.owned ? <Link to="/linkedin#pack" className="btn btn-signal">Open my LinkedIn pack</Link>
        : st.onSale ? <button type="button" className="btn btn-signal" onClick={buy} disabled={busy}>{st.mode === 'whatsapp' ? (busy ? 'Opening WhatsApp…' : BUY_WA) : busy ? 'Waiting for your payment…' : `Buy ${inr(st.price)}`}</button>
          : <span className="btn btn-outline" aria-disabled="true" style={{ opacity: 0.7, cursor: 'not-allowed' }}>{COMING_SOON}</span>}
    </section>
  );
}
