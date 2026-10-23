// My orders: list + one order (timeline, countdown, next steps, re-do, refund, add-ons, invoices).
import { useState } from 'react';
import { Link, useLocation, useParams, useSearchParams } from 'react-router-dom';
import { Dialog, Spinner, useToast } from '../../components/ui';
import { LIVE } from '../../services/http';
import { useMe, orderView, buyAddon, upgradeOrder, retentionLeft, getMe, cancelOrder } from '../../lib/customerStore';
import { useExpertOrders, updateOrder } from '../../lib/expertStore';
import { PLANS, ADDONS, PROMISES, inr, upgradePrice } from '../../lib/pricing';
import { MeHead } from './MeLayout';
import { countdown, fmtDay, fmtWhen, invoicePdf } from './shared';

/** Sample Razorpay step: pick a method and pay. Live app: Razorpay Checkout opens here. */
export function PayDialog({ title, amount, onPaid, onClose }) {
  const [m, setM] = useState('UPI');
  const [busy, setBusy] = useState(false);
  if (LIVE) {
    return (
      <Dialog showTitle title={title} onClose={onClose}>
        <div className="stack g12">
          <span className="small">Adding to a paid order isn’t available online yet. Write to <a href="mailto:info@nm7.si">info@nm7.si</a> with your order number and we’ll set it up for you.</span>
          <button type="button" className="btn btn-outline" style={{ alignSelf: 'flex-start' }} onClick={onClose}>OK</button>
        </div>
      </Dialog>
    );
  }
  return (
    <Dialog showTitle title={title} onClose={onClose}>
      <div className="stack g16">
        <div className="well row between"><span>Amount</span><strong style={{ fontSize: 20 }}>{inr(amount)}</strong></div>
        <div className="segmented" role="radiogroup" aria-label="Payment method">{['UPI', 'Card', 'Net banking'].map((x) => <button key={x} type="button" role="radio" aria-checked={m === x} aria-pressed={m === x} onClick={() => setM(x)}>{x}</button>)}</div>
        <span className="xs muted">Secure payment by {PROMISES.paymentProvider}. Prices include GST. Preview: no money moves.</span>
        <button type="button" className="btn btn-ink btn-lg" disabled={busy} onClick={async () => { setBusy(true); await new Promise((r) => setTimeout(r, 700)); onPaid(m); }}>{busy ? <Spinner /> : `Pay ${inr(amount)}`}</button>
      </div>
    </Dialog>
  );
}

export function OrdersList() {
  const me = useMe();
  useExpertOrders();
  const orders = me.orders.map(orderView);
  return (
    <>
      <MeHead title="My orders" sub="Every order, its status and its invoices." right={<Link to="/" className="btn btn-outline">New order</Link>} />
      <div className="stack g12">
        {!orders.length && <div className="card stack g8"><strong>No orders yet</strong><span className="small muted">Scan your resume for free, then pick a plan if you want an expert to rewrite it.</span><Link to="/#scan" className="btn btn-ink" style={{ alignSelf: 'flex-start' }}>Scan my resume</Link></div>}
        {orders.map((o) => (
          <Link key={o.id} to={`/me/orders/${o.id}`} className="card row between g12" style={{ textDecoration: 'none', color: 'inherit' }}>
            <div className="stack g4">
              <strong>{o.id} · {PLANS[o.plan].name}</strong>
              <span className="small muted">Paid {fmtDay(o.paidAt)} · {inr(o.price + o.addons.reduce((t, a) => t + a.price, 0))}{o.addons.length ? ` · ${o.addons.length} add-on${o.addons.length > 1 ? 's' : ''}` : ''}</span>
            </div>
            <span className="row g8">
              {o.live && o.deadline && <span className="xs strong" style={{ color: countdown(o.deadline).late ? 'var(--danger)' : 'var(--text2)' }}>⏱ {countdown(o.deadline).text}</span>}
              <span className={`badge b-${o.tone}`}>{o.label}</span>
            </span>
          </Link>
        ))}
      </div>
    </>
  );
}

export function OrderDetail() {
  const { id } = useParams();
  const me = useMe();
  useExpertOrders();
  const toast = useToast();
  const [pay, setPay] = useState(null);
  const [params] = useSearchParams();
  const { state: navState } = useLocation();
  const [redo, setRedo] = useState(params.get('redo') === '1');
  const [redoText, setRedoText] = useState('');
  const [cancelling, setCancelling] = useState(false);
  const raw = me.orders.find((o) => o.id === id);
  if (!raw) return <><MeHead title="Order not found" /><Link to="/me/orders">Back to my orders</Link></>;
  const o = orderView(raw);
  const cd = o.live && o.deadline ? countdown(o.deadline) : null;
  const left = retentionLeft(o.deliveredAt);
  const owned = o.addons.map((a) => a.id);
  const invoices = [
    { no: o.invoice, at: o.paidAt, item: `${PLANS[(o.upgrades?.[0]?.from) || o.plan].name} — resume service (${o.id})`, amount: o.price - (o.upgrades || []).reduce((t, u) => t + u.price, 0), payId: o.payId },
    ...(o.upgrades || []).map((u) => ({ no: `${o.invoice}-U`, at: u.at, item: `Upgrade to ${PLANS[u.to].name} (${o.id})`, amount: u.price, payId: u.payId })),
    ...o.addons.map((a, i) => ({ no: `${o.invoice}-A${i + 1}`, at: a.at, item: `${ADDONS[a.id].name} (${o.id})`, amount: a.price, payId: a.payId })),
  ];
  const upTo = o.plan === 'diy' ? 'expert' : o.plan === 'expert' ? 'launch' : null;

  return (
    <>
      <Link to="/me/orders" className="small">← My orders</Link>
      {navState?.justPaid && (
        <div className="row g12" style={{ padding: '16px 20px', borderRadius: 16, background: 'var(--successbg)', flexWrap: 'nowrap' }}>
          <span aria-hidden="true" style={{ width: 36, height: 36, flex: 'none', borderRadius: '50%', background: 'var(--success)', color: 'var(--onink)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700 }}>✓</span>
          <div className="stack"><strong>Payment received. You’re in good hands.</strong><span className="small muted">Order #{o.id} · GST invoice below and in your email. Next: answer 4 quick questions so your expert can start.</span></div>
        </div>
      )}
      {o.refundRequest?.status === 'declined' && <div className="well small"><strong>Refund request not approved:</strong> {o.refundRequest.reply} You can still ask for a free re-do.</div>}
      <MeHead title={`${o.id} · ${PLANS[o.plan].name}`} sub={`Paid ${fmtDay(o.paidAt)} · ${o.method}`} right={<span className={`badge b-${o.tone}`} style={{ fontSize: 13 }}>{o.label}</span>} />

      {o.x && (
        <section className="card stack g16" aria-label="Progress">
          <ol className="tl">{o.steps.map((s) => <li key={s.label} data-state={s.state}><span className="dot2">{s.state === 'done' ? '✓' : ''}</span><span style={{ fontWeight: s.state === 'now' ? 700 : 500, color: s.state === 'next' ? 'var(--text3)' : 'var(--text)' }}>{s.label}</span></li>)}</ol>
          {cd && (cd.late
            ? <div className="well small" style={{ background: 'var(--dangerbg)', color: 'var(--danger)' }}><strong>{cd.text}.</strong> We promised {PROMISES.delivery}. If the draft doesn’t arrive, a full refund starts automatically ({PROMISES.refundDays} to reach you).</div>
            : <div className="well row between g8 small"><span>Delivery promise: first draft within {PROMISES.delivery}</span><strong style={{ color: cd.hours < 6 ? 'var(--warning)' : 'var(--text)' }}>⏱ {cd.text}</strong></div>)}
          <div className="row g8">
            {o.action && o.action.to !== `/me/orders/${o.id}` && <Link to={o.action.to} className="btn btn-ink">{o.action.cta}</Link>}
            <Link to={`/me/messages?order=${o.id}`} className="btn btn-outline">Message your expert</Link>
            {o.sent.length > 0 && <Link to={`/orders/${o.id}/review`} className="btn btn-ghost">See latest draft</Link>}
            {o.sent.length > 0 && <button type="button" className="btn btn-ghost" onClick={() => setRedo(true)}>Not happy? Free re-do</button>}
            {o.x?.status === 'offer' ? <button type="button" className="btn btn-ghost" disabled={cancelling} onClick={async () => { setCancelling(true); try { if (await cancelOrder(o.id)) toast('Order cancelled — full refund on its way'); } catch (e) { toast(e.message); } finally { setCancelling(false); } }}>{cancelling ? <Spinner /> : 'Cancel order (full refund)'}</button>
              : <Link to={`/orders/${o.id}/refund`} className="btn btn-ghost">Refund</Link>}
          </div>
          {left != null && <span className="xs muted">Expert files are kept for {PROMISES.retentionDays} days — {left > 0 ? `${left} days left` : 'expired'}. Your copy in “My resumes” stays as long as your account.</span>}
        </section>
      )}

      {!o.x && (
        <section className="card stack g8">
          {o.refund ? (
            <>
              <strong>Refunded {inr(o.refund.amount)}</strong>
              <span className="small muted">{o.refund.reason} · started {fmtDay(o.refund.at)} · reached your account {fmtDay(o.refund.done)} · ref {o.refund.ref}</span>
            </>
          ) : <span className="small">{o.plan === 'diy' ? 'DIY tools unlocked for your account: AI rewrites, every template, PDF and Word download.' : o.plan === 'linkedin_pack' ? <>LinkedIn pack unlocked for your account. <Link to="/linkedin#pack">Open it</Link></> : 'Completed.'}</span>}
        </section>
      )}

      {o.live && (
        <section className="card stack g12" aria-label="Add-ons">
          <strong>Add to this order</strong>
          <div className="row g12">
            {Object.values(ADDONS).filter((a) => !(a.id === 'linkedin' && o.plan === 'launch')).map((a) => (
              <div key={a.id} className="well stack g4" style={{ flex: '1 1 200px' }}>
                <strong className="small">{a.name}</strong><span className="xs muted">{a.blurb}</span>
                {owned.includes(a.id) && a.id !== 'revision' ? <span className="badge b-success" style={{ alignSelf: 'flex-start' }}>Added</span>
                  : <button type="button" className="btn btn-outline" style={{ minHeight: 36, alignSelf: 'flex-start' }} disabled={a.id === 'express' && o.sent.length > 0} onClick={() => setPay({ kind: 'addon', id: a.id, amount: a.price, title: a.name })}>Add · {inr(a.price)}</button>}
                {a.id === 'express' && o.sent.length > 0 && !owned.includes('express') && <span className="xs faint">Only before draft 1.</span>}
              </div>
            ))}
          </div>
          {upTo && <div className="row between g8 small" style={{ paddingTop: 4 }}><span>Upgrade to <strong>{PLANS[upTo].name}</strong> — pay only the difference.</span><button type="button" className="btn btn-ink" style={{ minHeight: 38 }} onClick={() => setPay({ kind: 'upgrade', id: upTo, amount: upgradePrice(o.plan, upTo), title: `Upgrade to ${PLANS[upTo].name}` })}>Upgrade · {inr(upgradePrice(o.plan, upTo))}</button></div>}
        </section>
      )}

      <section className="card stack g8" aria-label="Invoices">
        <strong>Invoices</strong>
        <div className="table-wrap"><table className="table"><thead><tr><th>Invoice</th><th>Date</th><th>For</th><th>Amount</th><th /></tr></thead>
          <tbody>{invoices.map((v) => <tr key={v.no}><td className="mono small">{v.no}</td><td className="small">{fmtDay(v.at)}</td><td className="small">{v.item}</td><td className="small">{inr(v.amount)}</td><td><button type="button" className="link-btn small" onClick={() => invoicePdf({ ...v, name: getMe().account.name, email: getMe().account.email, method: o.method })}>PDF</button></td></tr>)}</tbody></table></div>
        <span className="xs faint">Prices include GST.</span>
      </section>

      {pay && <PayDialog title={pay.title} amount={pay.amount} onClose={() => setPay(null)} onPaid={() => { if (pay.kind === 'addon') buyAddon(o.id, pay.id); else upgradeOrder(o.id, pay.id); setPay(null); toast(pay.kind === 'addon' ? `${pay.title} added — your expert is told` : `Upgraded to ${PLANS[pay.id].name}`); }} />}
      {redo && o.sent?.length > 0 && (
        <Dialog showTitle title="Ask for a free re-do" onClose={() => setRedo(false)}>
          <form className="stack g12" onSubmit={(e) => { e.preventDefault(); updateOrder(o.id, (x) => ({ status: 'revision', comments: [...(x.comments || []), { id: `c${Date.now()}`, section: 'summary', text: `Re-do request: ${redoText.trim()}`, at: Date.now(), resolved: false }], messages: [...(x.messages || []), { from: 'customer', text: `I’d like a re-do: ${redoText.trim()}`, at: Date.now() }] })); setRedo(false); setRedoText(''); toast('Sent — your expert will re-work it'); }}>
            <span className="small muted">For quality issues we fix it first, free. If it still isn’t right, you can ask for a refund — our team reviews it within 24 hours.</span>
            <label htmlFor="redo" className="label">What isn’t right?</label>
            <textarea id="redo" className="input" rows={4} value={redoText} onChange={(e) => setRedoText(e.target.value)} placeholder="e.g. The projects don’t match the Data Analyst role I asked for." />
            <button type="submit" className="btn btn-ink" disabled={redoText.trim().length < 10}>Send re-do request</button>
          </form>
        </Dialog>
      )}
      {o.x?.messages?.length > 0 && <span className="xs faint">Last message {fmtWhen(o.x.messages[o.x.messages.length - 1].at)}</span>}
    </>
  );
}
