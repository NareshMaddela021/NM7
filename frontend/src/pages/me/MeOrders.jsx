// My orders: list + one order (timeline, countdown, next steps, re-do, refund, add-ons, invoices).
import { useState } from 'react';
import { Link, useLocation, useParams, useSearchParams } from 'react-router-dom';
import { Dialog, Spinner, useToast } from '../../components/ui';
import { LIVE } from '../../services/http';
import { useMe, orderView, buyAddon, upgradeOrder, retentionLeft, getMe, cancelOrder } from '../../lib/customerStore';
import { useExpertOrders, updateOrder } from '../../lib/expertStore';
import { PLANS, ADDONS, PROMISES, inr, upgradePrice } from '../../lib/pricing';
import { MeHead } from './MeLayout';
import { BUY_WA, WA_DELIVERY, WA_PAY_TEXT, WA_SAFETY, WA_WAITING, buyOnWhatsApp, usePayMode } from '../../lib/waPay';
import { countdown, fmtDay, fmtWhen, invoicePdf } from './shared';
import { Chip, Empty, MeCard, Stat } from './kit';
import '../../styles/me-account.css';

/** The order's status as a chip tone. */
export const toneOf = (t) => ({ success: 'ok', warning: 'warn', danger: 'bad' }[t] || 'neutral');
const total = (o) => o.price + o.addons.reduce((t, a) => t + a.price, 0);

/**
 * Adding to a paid order. Preview: a sample payment step. Live, WhatsApp mode: the chat opens with the order number
 * and the item (Nm7 adds it once paid). Live otherwise: not online yet, write to us.
 */
export function PayDialog({ title, amount, onPaid, onClose, orderId, item }) {
  const [m, setM] = useState('UPI');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const pm = usePayMode();
  if (LIVE && pm?.mode === 'whatsapp' && orderId && item) {
    const go = async () => {
      setBusy(true); setErr('');
      try { await buyOnWhatsApp({ item }, `/api/orders/${encodeURIComponent(orderId)}/whatsapp-addon`, { orderLink: false }); onClose(); } catch (e) { setErr(e.message || 'Something went wrong. Please try again.'); setBusy(false); }
    };
    return (
      <Dialog showTitle title={title} onClose={onClose}>
        <div className="stack g12" data-testid="addon-wa">
          <div className="well row between"><span>Amount</span><strong style={{ fontSize: 20 }}>{inr(amount)}</strong></div>
          <span className="small">{WA_PAY_TEXT}</span>
          <span className="xs muted">{WA_SAFETY}</span>
          {err && <p role="alert" className="error" style={{ margin: 0 }}>{err}</p>}
          <button type="button" className="btn btn-ink btn-lg" disabled={busy} onClick={go}>{busy ? 'Opening WhatsApp…' : BUY_WA}</button>
        </div>
      </Dialog>
    );
  }
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
  const active = orders.filter((o) => o.live || o.awaiting).length;
  return (
    <>
      <MeHead title="My orders" sub="Every order, its status and its invoices." right={<Link to="/" className="btn btn-outline">New order</Link>} />
      {orders.length > 0 && (
        <div className="mgrid-3 acc-stats">
          <Stat label="Orders" value={orders.length} />
          <Stat label="In progress" value={active} tone={active ? 'warn' : undefined} />
          <Stat label="Spent" value={inr(orders.filter((o) => o.paidAt).reduce((t, o) => t + total(o), 0))} sub="Prices include GST" />
        </div>
      )}
      {!orders.length && (
        <Empty shape="handshake" title="No orders yet" action={<Link to="/#scan" className="btn btn-signal">Scan my resume</Link>}>
          Scan your resume for free, then pick a plan if you want an expert to rewrite it.
        </Empty>
      )}
      <ul className="mlist acc-orders">
        {orders.map((o) => {
          const done = o.steps.filter((x) => x.state === 'done').length;
          const cd = o.live && o.deadline ? countdown(o.deadline) : null;
          return (
            <li key={o.id}>
              <Link to={`/me/orders/${o.id}`} className="mcard mcard-link acc-order">
                <span className="mavatar" aria-hidden="true">{PLANS[o.plan]?.name?.[0] || '#'}</span>
                <span className="acc-order-main">
                  <strong className="acc-order-title">{o.id} · {PLANS[o.plan].name}</strong>
                  <span className="mitem-meta">{o.paidAt ? `Paid ${fmtDay(o.paidAt)}` : `Ordered on WhatsApp ${fmtDay(o.createdAt)}`} · {inr(total(o))}{o.addons.length ? ` · ${o.addons.length} add-on${o.addons.length > 1 ? 's' : ''}` : ''}</span>
                  {o.steps.length > 0 && (
                    <span className="acc-steps" aria-label={`Step ${Math.min(done + 1, o.steps.length)} of ${o.steps.length}`}>
                      {o.steps.map((x) => <span key={x.label} className={`acc-step acc-step-${x.state}`} />)}
                    </span>
                  )}
                </span>
                <span className="acc-order-side">
                  <Chip tone={toneOf(o.tone)}>{o.label}</Chip>
                  {cd && <span className="xs strong" style={{ color: cd.late ? 'var(--danger)' : 'var(--text2)' }}>⏱ {cd.text}</span>}
                  <span className="acc-chev" aria-hidden="true">›</span>
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </>
  );
}

/** A WhatsApp order that isn't paid yet (or was cancelled unpaid). */
function WaitingOrder({ o }) {
  return (
    <>
      <Link to="/me/orders" className="small">← My orders</Link>
      <MeHead title={`${o.id} · ${PLANS[o.plan]?.name || o.plan}`} sub={`Ordered on WhatsApp ${fmtDay(o.createdAt)} · ${inr(o.price + o.addons.reduce((t, a) => t + a.price, 0))}`} right={<Chip tone={toneOf(o.tone)}>{o.label}</Chip>} />
      {o.awaiting ? (
        <MeCard as="section" tone="warn" icon="⏳" title={WA_WAITING} label="Payment" testid="wa-waiting">
          <span className="small">Send your order number <strong className="mono">{o.id}</strong> in the Nm7 WhatsApp chat. We confirm your payment there and unlock your order.</span>
          <ul className="stack g4 small muted" style={{ margin: 0, paddingLeft: 18 }}>
            <li>{WA_SAFETY}</li>
            <li>{WA_DELIVERY}</li>
          </ul>
        </MeCard>
      ) : (
        <MeCard as="section" icon="✕" title="Cancelled" label="Cancelled" testid="wa-cancelled"><span className="small muted">This order wasn’t paid, so it was cancelled. Nothing was charged. You can place a new order any time.</span></MeCard>
      )}
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
  if (!o.paidAt) return <WaitingOrder o={o} />;
  const cd = o.live && o.deadline ? countdown(o.deadline) : null;
  const left = retentionLeft(o.deliveredAt);
  const owned = o.addons.map((a) => a.id);
  const receipt = !o.invoice && !!o.receipt; // paid on WhatsApp before a GST invoice could be made
  const invoices = [
    { no: o.invoice || o.receipt, receipt, at: o.paidAt, item: `${PLANS[(o.upgrades?.[0]?.from) || o.plan].name} — resume service (${o.id})`, amount: o.price - (o.upgrades || []).reduce((t, u) => t + u.price, 0), payId: o.payId },
    ...(o.upgrades || []).map((u) => ({ no: `${o.invoice}-U`, at: u.at, item: `Upgrade to ${PLANS[u.to].name} (${o.id})`, amount: u.price, payId: u.payId })),
    ...o.addons.map((a, i) => ({ no: `${o.invoice}-A${i + 1}`, at: a.at, item: `${ADDONS[a.id].name} (${o.id})`, amount: a.price, payId: a.payId })),
  ];
  const upTo = o.plan === 'diy' ? 'expert' : o.plan === 'expert' ? 'launch' : null;

  const summary = [['Plan', PLANS[o.plan].name], ['Paid', fmtDay(o.paidAt)], ['Payment', o.method], ['Total', inr(total(o))], ...(o.addons.length ? [['Add-ons', o.addons.map((x) => ADDONS[x.id]?.name).join(', ')]] : [])];
  return (
    <>
      <Link to="/me/orders" className="small acc-back">← My orders</Link>
      {navState?.justPaid && (
        <MeCard tone="ok" icon="✓" title="Payment received. You’re in good hands." label="Payment received">
          <span className="small muted">Order #{o.id} · {receipt ? 'Receipt' : 'GST invoice'} below and in your email. Next: answer 4 quick questions so your expert can start.</span>
        </MeCard>
      )}
      {o.refundRequest?.status === 'declined' && <MeCard tone="warn" className="mcard-tight" label="Refund request"><span className="small"><strong>Refund request not approved:</strong> {o.refundRequest.reply} You can still ask for a free re-do.</span></MeCard>}
      <MeHead title={`${o.id} · ${PLANS[o.plan].name}`} sub={`Paid ${fmtDay(o.paidAt)} · ${o.method}`} right={<Chip tone={toneOf(o.tone)}>{o.label}</Chip>} />

      <div className="mgrid-2">
        <div className="mstack">
          {o.x && (
            <MeCard as="section" label="Progress" icon="✎" title={o.action?.text || o.label} sub={left != null ? `Expert files are kept for ${PROMISES.retentionDays} days — ${left > 0 ? `${left} days left` : 'expired'}. Your copy in “My resumes” stays as long as your account.` : undefined}>
              <ol className="msteps acc-tl">{o.steps.map((x) => <li key={x.label} className={x.state === 'done' ? 'done' : x.state === 'now' ? 'now' : ''} data-state={x.state}><span className="msteps-dot" aria-hidden="true">{x.state === 'done' ? '✓' : ''}</span><span className="acc-tl-l" style={{ fontWeight: x.state === 'now' ? 800 : 600, color: x.state === 'next' ? 'var(--text3)' : 'var(--text)' }}>{x.label}{x.state === 'now' && <span className="sr-only"> (now)</span>}</span></li>)}</ol>
              {cd && (cd.late
                ? <div className="acc-note acc-note-bad small"><strong>{cd.text}.</strong> We promised {PROMISES.delivery}. If the draft doesn’t arrive, a full refund starts automatically ({PROMISES.refundDays} to reach you).</div>
                : <div className="acc-note mspread small"><span>Delivery promise: first draft within {PROMISES.delivery}</span><strong style={{ color: cd.hours < 6 ? 'var(--warning)' : 'var(--text)' }}>⏱ {cd.text}</strong></div>)}
              <div className="mrow">
                {o.action && o.action.to !== `/me/orders/${o.id}` && <Link to={o.action.to} className="btn btn-signal">{o.action.cta}</Link>}
                <Link to={`/me/messages?order=${o.id}`} className="btn btn-outline">Message your expert</Link>
                {o.sent.length > 0 && <Link to={`/orders/${o.id}/review`} className="btn btn-outline">See latest draft</Link>}
              </div>
              <div className="mrow acc-quiet">
                {o.sent.length > 0 && <button type="button" className="btn btn-ghost" onClick={() => setRedo(true)}>Not happy? Free re-do</button>}
                {o.x?.status === 'offer' ? <button type="button" className="btn btn-ghost" disabled={cancelling} onClick={async () => { setCancelling(true); try { if (await cancelOrder(o.id)) toast('Order cancelled — full refund on its way'); } catch (e) { toast(e.message); } finally { setCancelling(false); } }}>{cancelling ? <Spinner /> : 'Cancel order (full refund)'}</button>
                  : <Link to={`/orders/${o.id}/refund`} className="btn btn-ghost">Refund</Link>}
              </div>
            </MeCard>
          )}

          {!o.x && (
            <MeCard as="section" tone={o.refund ? undefined : 'ok'} icon={o.refund ? '↺' : '✓'} title={o.refund ? `Refunded ${inr(o.refund.amount)}` : o.label} label="Status">
              {o.refund
                ? <span className="small muted">{o.refund.reason} · started {fmtDay(o.refund.at)} · reached your account {fmtDay(o.refund.done)} · ref {o.refund.ref}</span>
                : <span className="small">{o.plan === 'diy' ? 'DIY tools unlocked for your account: AI rewrites, every template, PDF and Word download.' : o.plan === 'linkedin_pack' ? <>LinkedIn pack unlocked for your account. <Link to="/linkedin#pack">Open it</Link></> : 'Completed.'}</span>}
            </MeCard>
          )}

          {o.live && (
            <MeCard as="section" label="Add-ons" icon="+" title="Add to this order" sub="Pay only for what you add. Your expert is told straight away.">
              <div className="mgrid-3">
                {Object.values(ADDONS).filter((a) => !(a.id === 'linkedin' && o.plan === 'launch')).map((a) => (
                  <div key={a.id} className="acc-addon">
                    <strong className="small">{a.name}</strong><span className="xs muted">{a.blurb}</span>
                    {owned.includes(a.id) && a.id !== 'revision' ? <Chip tone="ok">Added</Chip>
                      : <button type="button" className="btn btn-outline" disabled={a.id === 'express' && o.sent.length > 0} onClick={() => setPay({ kind: 'addon', id: a.id, amount: a.price, title: a.name })}>Add · {inr(a.price)}</button>}
                    {a.id === 'express' && o.sent.length > 0 && !owned.includes('express') && <span className="xs faint">Only before draft 1.</span>}
                  </div>
                ))}
              </div>
              {upTo && <div className="acc-note mspread small"><span>Upgrade to <strong>{PLANS[upTo].name}</strong> — pay only the difference.</span><button type="button" className="btn btn-signal" onClick={() => setPay({ kind: 'upgrade', id: upTo, amount: upgradePrice(o.plan, upTo), title: `Upgrade to ${PLANS[upTo].name}` })}>Upgrade · {inr(upgradePrice(o.plan, upTo))}</button></div>}
            </MeCard>
          )}
        </div>

        <div className="mstack">
          <MeCard as="section" label="Order summary" title="Summary" className="acc-summary">
            <dl className="acc-dl">{summary.map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}</dl>
          </MeCard>
          <MeCard as="section" label={receipt ? 'Receipts' : 'Invoices'} title={receipt ? 'Receipts' : 'Invoices'} sub={receipt ? 'A payment receipt from Nm7.' : 'Prices include GST.'}>
            <ul className="mlist">
              {invoices.map((v) => (
                <li key={v.no} className="mitem acc-inv">
                  <span className="mitem-main"><span className="mitem-title mono small">{v.no}</span><span className="mitem-meta">{fmtDay(v.at)} · {v.item}</span></span>
                  <span className="mitem-side"><strong className="small">{inr(v.amount)}</strong><button type="button" className="btn btn-outline acc-pdf" onClick={() => invoicePdf({ ...v, name: getMe().account.name, email: getMe().account.email, method: o.method })}>PDF</button></span>
                </li>
              ))}
            </ul>
          </MeCard>
        </div>
      </div>

      {pay && <PayDialog title={pay.title} amount={pay.amount} orderId={o.id} item={pay.kind === 'addon' ? pay.id : `upgrade:${pay.id}`} onClose={() => setPay(null)} onPaid={() => { if (pay.kind === 'addon') buyAddon(o.id, pay.id); else upgradeOrder(o.id, pay.id); setPay(null); toast(pay.kind === 'addon' ? `${pay.title} added — your expert is told` : `Upgraded to ${PLANS[pay.id].name}`); }} />}
      {redo && o.sent?.length > 0 && (
        <Dialog showTitle title="Ask for a free re-do" onClose={() => setRedo(false)}>
          <form className="stack g12" onSubmit={(e) => { e.preventDefault(); updateOrder(o.id, (x) => ({ status: 'revision', comments: [...(x.comments || []), { id: `c${Date.now()}`, section: 'summary', text: `Re-do request: ${redoText.trim()}`, at: Date.now(), resolved: false }], messages: [...(x.messages || []), { from: 'customer', text: `I’d like a re-do: ${redoText.trim()}`, at: Date.now() }] })); setRedo(false); setRedoText(''); toast('Sent — your expert will re-work it'); }}>
            <span className="small muted">For quality issues we fix it first, free. If it still isn’t right, you can ask for a refund — our team reviews it within 24 hours.</span>
            <label htmlFor="redo" className="label">What isn’t right?</label>
            <textarea id="redo" className="input" rows={4} value={redoText} onChange={(e) => setRedoText(e.target.value)} placeholder="e.g. The projects don’t match the Data Analyst role I asked for." />
            <button type="submit" className="btn btn-signal" disabled={redoText.trim().length < 10}>Send re-do request</button>
          </form>
        </Dialog>
      )}
      {o.x?.messages?.length > 0 && <span className="xs faint">Last message {fmtWhen(o.x.messages[o.x.messages.length - 1].at)}</span>}
    </>
  );
}
