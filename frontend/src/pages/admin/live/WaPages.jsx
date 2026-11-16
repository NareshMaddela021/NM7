// Payments, admin side (the server checks every rule again: app/wapay, app/payments):
//   PaymentSettings      Admin → Settings & prices → Payments: the payment method, Razorpay or Off (pause payments),
//                        and whether the Razorpay keys are set on the server.
//   LiveWhatsAppPayments Admin → WhatsApp payments (old): the orders from the old WhatsApp payments, read-only.
//                        Actions: Send payment link (a Razorpay link by email), Send links to all pending, Cancel,
//                        Record refund (an old paid one, refunded outside Razorpay). Shown in the menu only while
//                        some still wait for money (GET /api/admin/whatsapp/pending).
//   WaReport             Admin → Reports: money in, Razorpay vs old (WhatsApp), CSV.
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Dialog, useToast } from '../../../components/ui';
import { savePdf } from '../../builder/resumePdf';
import { API_BASE } from '../../../services/http';
import { PageHead, Tabs } from '../AdminUI';
import '../../../styles/me-kit.css';
import '../../../styles/admin-ops.css';
import { Loading, emptyIf, http, rupees, useAction, useApi, when } from './common';

export const MODES = [['razorpay', 'Razorpay'], ['off', 'Off (pause payments)']];
const METHODS = [['upi', 'UPI'], ['bank', 'Bank transfer'], ['cash', 'Cash']];
export const OLD_WA = 'old (WhatsApp)';
export const KEYS_HINT = 'Naresh adds RAZORPAY_KEY_ID, RAZORPAY_KEY_SECRET, RAZORPAY_WEBHOOK_SECRET in Render.';

/* ---------- Settings → Payments ---------- */
export function PaymentSettings() {
  const toast = useToast();
  const st = useApi('/api/admin/payment-settings');
  const [busy, run] = useAction(toast);
  const [mode, setMode] = useState(null);
  const [saved, setSaved] = useState(null);
  useEffect(() => { if (st.data) { setMode(st.data.mode); setSaved(st.data); } }, [st.data]);
  const save = () => run(async () => {
    const r = await http('/api/admin/payment-settings', { method: 'PUT', body: { mode } });
    setSaved(r); setMode(r.mode);
  }, mode === 'off' ? 'Payments paused' : 'Payment method saved');
  const f = saved;
  return (
    <section className="ops-card" aria-label="Payments" data-testid="pay-settings">
      <div className="ops-card-h"><strong>Payments</strong></div>
      <Loading st={st}>{() => f && (
        <>
          <fieldset className="stack g8" style={{ border: 0, padding: 0, margin: 0 }}>
            <legend className="label">Payment method</legend>
            <div className="segmented" role="radiogroup" aria-label="Payment method" style={{ alignSelf: 'flex-start' }}>
              {MODES.map(([v, l]) => (
                <button key={v} type="button" role="radio" aria-checked={mode === v} style={{ minHeight: 44 }} data-testid={`pay-mode-${v}`}
                  disabled={v === 'razorpay' && !f.razorpayReady} onClick={() => setMode(v)}>{l}</button>
              ))}
            </div>
          </fieldset>
          <span className="xs muted">
            {mode === 'off' ? 'Payments are paused: paid buttons show “Coming soon” and downloads stay free.'
              : 'Customers pay with Razorpay’s checkout (UPI, cards, netbanking, wallets). A GST invoice is emailed after each payment.'}
            {' '}Now active: <strong className="ops-pay-active" data-testid="pay-active">{f.active === 'razorpay' ? 'Razorpay' : 'Off'}</strong>
          </span>
          {!f.razorpayReady && <div className="well xs" role="note" data-testid="pay-keys" style={{ borderLeft: '3px solid var(--warning)' }}>Razorpay keys are missing, so payments stay off. {KEYS_HINT}</div>}
          {!f.businessReady && <span className="xs" data-testid="pay-business">Business details (name, address, GSTIN) aren’t set: invoices carry no GST lines yet. Add them in <Link to="/admin/billing-settings">Billing settings</Link>.</span>}
          {f.pendingWhatsapp > 0 && <span className="xs" data-testid="pay-old-wa">{f.pendingWhatsapp} old WhatsApp order(s) still wait for money: <Link to="/admin/whatsapp-payments">send them a payment link</Link>.</span>}
          <button type="button" className="btn btn-signal" style={{ alignSelf: 'flex-start', minHeight: 44 }} disabled={busy || mode === f.mode || (mode === 'razorpay' && !f.razorpayReady)} onClick={save}>Save payment method</button>
        </>
      )}</Loading>
    </section>
  );
}

/* ---------- WhatsApp payments (old) ---------- */
const VIEWS = [['awaiting', 'Waiting for payment'], ['paid', 'Paid'], ['cancelled', 'Cancelled'], ['all', 'All']];
const LABEL = { awaiting_payment: 'Waiting for payment', cancelled: 'Cancelled', refunded: 'Refunded' };

export function LiveWhatsAppPayments() {
  const toast = useToast();
  const [view, setView] = useState('awaiting');
  const st = useApi(`/api/admin/whatsapp/orders?status=${view}`);
  const [busy, run] = useAction(toast);
  const [dlg, setDlg] = useState(null); // { kind: 'refund' | 'cancel' | 'all', row }
  const link = (r) => run(async () => {
    const out = await http(`/api/admin/whatsapp/orders/${encodeURIComponent(r.id)}/payment-link`, { method: 'POST' });
    st.reload();
    toast(out.emailed ? `Payment link emailed to ${out.to}` : 'Payment link made, but the email didn’t go out. Copy it from the row.');
  });
  return (
    <>
      <PageHead title="WhatsApp payments (old)" sub={`Orders from the old WhatsApp payments, read-only. Payments are Razorpay only now: send a pending one a Razorpay payment link.`} right={<Link to="/admin/payments" className="btn btn-outline">Payments &amp; invoices</Link>} />
      <div className="ad-toolbar ops-toolbar">
        <Tabs label="Show" tabs={VIEWS} value={view} onChange={setView} />
        <button type="button" className="btn btn-signal" style={{ minHeight: 44 }} disabled={busy} data-testid="wa-links-all" onClick={() => setDlg({ kind: 'all' })}>Send links to all pending</button>
      </div>
      <Loading st={st} empty={emptyIf((d) => !d.length, view === 'awaiting' ? 'No old WhatsApp orders waiting for payment.' : 'Nothing here.')}>{(rows) => (
        <div className="card table-wrap ops-table" tabIndex={0} role="region" aria-label="Table — scroll sideways to see all columns">
          <table className="table mtable" data-testid="wa-table"><thead><tr><th>Order</th><th>Customer</th><th>Item</th><th>Amount</th><th>Age</th><th>Status</th><th><span className="sr-only">Actions</span></th></tr></thead>
            <tbody>{rows.map((r) => (
              <tr key={r.id} data-testid="wa-row">
                <td className="ops-mono" data-label="Order"><span>{r.id}<span className="ops-sub">{r.label || OLD_WA}</span></span></td>
                <td className="small" data-label="Customer"><span>{r.customer.name}<span className="ops-sub">{r.customer.email}</span></span></td>
                <td className="small" data-label="Item">{r.item}</td>
                <td className="small" data-label="Amount"><strong>{rupees(r.amount)}</strong></td>
                <td className="small" data-label="Age">{r.ageHours < 48 ? `${r.ageHours} h` : `${Math.round(r.ageHours / 24)} d`}</td>
                <td className="small" data-label="Status"><span><span className={`mchip mchip-${r.status === 'awaiting_payment' ? 'warn' : r.status === 'cancelled' ? 'neutral' : r.status === 'refunded' ? 'info' : r.payment ? 'ok' : 'neutral'}`} style={{ whiteSpace: 'normal' }}>{LABEL[r.status] || (r.payment ? `Paid · ${r.payment.method.toUpperCase()} ${r.payment.reference}` : r.status)}</span>{r.paymentLink && <span className="ops-sub" data-testid="wa-link-sent">Link sent {when(r.paymentLink.sentAt)}</span>}{r.receiptNo && <span className="ops-sub">{r.receiptNo}</span>}{r.invoiceNo && <span className="ops-sub">{r.invoiceNo}</span>}</span></td>
                <td>
                  <span className="ops-actions">
                    {r.status === 'awaiting_payment' && <button type="button" className="btn btn-signal" style={{ minHeight: 44 }} disabled={busy} onClick={() => link(r)}>{r.paymentLink ? 'Send link again' : 'Send payment link'}</button>}
                    {r.status === 'awaiting_payment' && <button type="button" className="btn btn-ghost" style={{ minHeight: 44 }} onClick={() => setDlg({ kind: 'cancel', row: r })}>Cancel</button>}
                    {r.payment && r.status !== 'refunded' && <button type="button" className="btn btn-ghost" style={{ minHeight: 44 }} onClick={() => setDlg({ kind: 'refund', row: r })}>Record refund</button>}
                  </span>
                </td>
              </tr>
            ))}</tbody></table>
        </div>
      )}</Loading>
      {dlg?.kind === 'refund' && <RefundDlg row={dlg.row} busy={busy} onClose={() => setDlg(null)} onSave={(body) => run(async () => { await http(`/api/admin/whatsapp/orders/${dlg.row.id}/refund`, { method: 'POST', body }); setDlg(null); st.reload(); }, `${dlg.row.id} refund recorded`)} />}
      {dlg?.kind === 'all' && (
        <Dialog showTitle title="Send payment links to all pending?" onClose={() => setDlg(null)}>
          <p className="small" style={{ margin: 0 }}>Every old WhatsApp order still waiting for money, that hasn’t had a link yet, gets a Razorpay payment link by email (valid 7 days).</p>
          <div className="row g8">
            <button type="button" className="btn btn-signal" style={{ minHeight: 44 }} disabled={busy} data-testid="wa-links-all-yes" onClick={() => run(async () => { const r = await http('/api/admin/whatsapp/payment-links', { method: 'POST' }); setDlg(null); st.reload(); toast(`${r.sent} link(s) sent${r.failed ? ` · ${r.failed} failed` : ''}`); })}>Send links</button>
            <button type="button" className="btn btn-outline" style={{ minHeight: 44 }} onClick={() => setDlg(null)}>Not now</button>
          </div>
        </Dialog>
      )}
      {dlg?.kind === 'cancel' && (
        <Dialog showTitle title={`Cancel ${dlg.row.id}?`} onClose={() => setDlg(null)}>
          <p className="small" style={{ margin: 0 }}>The customer sees it as cancelled and can place a new order.</p>
          <div className="row g8">
            <button type="button" className="btn btn-ink" style={{ minHeight: 44 }} disabled={busy} onClick={() => run(async () => { await http(`/api/admin/whatsapp/orders/${dlg.row.id}/cancel`, { method: 'POST', body: { reason: 'Cancelled by Nm7' } }); setDlg(null); st.reload(); }, `${dlg.row.id} cancelled`)}>Cancel order</button>
            <button type="button" className="btn btn-outline" style={{ minHeight: 44 }} onClick={() => setDlg(null)}>Keep it</button>
          </div>
        </Dialog>
      )}
    </>
  );
}

function RefundDlg({ row, busy, onClose, onSave }) {
  const [f, setF] = useState({ method: row.payment?.method || 'upi', reference: '', amountText: '', note: '' });
  const amount = f.amountText.trim() ? Math.round(Number(f.amountText) * 100) : null;
  const ok = f.reference.replace(/\s/g, '').length >= 4 && (amount === null || amount > 0);
  return (
    <Dialog showTitle title={`Record refund · ${row.id}`} onClose={onClose}>
      <span className="small">An {OLD_WA} payment was made outside Razorpay: send the money back to the same UPI / bank account first, then record it here. A full refund removes access.</span>
      <div className="field"><label className="label" htmlFor="rf-method">Method</label>
        <select id="rf-method" className="input" value={f.method} onChange={(e) => setF({ ...f, method: e.target.value })}>{METHODS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></div>
      <div className="field"><label className="label" htmlFor="rf-ref">Refund UTR or reference</label>
        <input id="rf-ref" className="input" autoComplete="off" value={f.reference} onChange={(e) => setF({ ...f, reference: e.target.value })} /></div>
      <div className="field"><label className="label" htmlFor="rf-amt">Amount (₹) <span className="xs muted" style={{ fontWeight: 400 }}>· empty = the full amount</span></label>
        <input id="rf-amt" className="input" inputMode="decimal" placeholder={String(row.amount / 100)} value={f.amountText} onChange={(e) => setF({ ...f, amountText: e.target.value })} /></div>
      <div className="field"><label className="label" htmlFor="rf-note">Note</label>
        <input id="rf-note" className="input" maxLength={300} value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} /></div>
      <div className="row g8">
        <button type="button" className="btn btn-ink" style={{ minHeight: 44 }} disabled={busy || !ok} onClick={() => onSave({ method: f.method, reference: f.reference.trim(), ...(amount ? { amount } : {}), note: f.note.trim() })}>Save refund</button>
        <button type="button" className="btn btn-outline" style={{ minHeight: 44 }} onClick={onClose}>Close</button>
      </div>
    </Dialog>
  );
}

/* ---------- Reports ---------- */
export function WaReport({ days }) {
  const toast = useToast();
  const st = useApi(`/api/admin/whatsapp/report?days=${days}`);
  const [busy, run] = useAction(toast);
  const csv = () => run(async () => {
    const r = await fetch(`${API_BASE}/api/admin/whatsapp/report.csv?days=${days}`, { credentials: 'include' });
    if (!r.ok) throw new Error('Could not make the file. Please try again.');
    await savePdf(await r.blob(), `nm7-payments-${days}d.csv`);
  }, 'CSV downloaded');
  return (
    <section className="ops-card" aria-label="Payments by method" data-testid="wa-report">
      <div className="ops-card-h"><strong>Payments by method</strong><button type="button" className="btn btn-outline" disabled={busy} onClick={csv}>Download payments CSV</button></div>
      <Loading st={st}>{(r) => (
        <div className="ops-kpis">
          <div className="ops-kpi"><span className="ops-kpi-l">Money in · Razorpay</span><strong className="ops-kpi-v">{rupees(r.moneyIn.razorpay)}</strong></div>
          <div className="ops-kpi"><span className="ops-kpi-l">Money in · {OLD_WA}</span><strong className="ops-kpi-v">{rupees(r.moneyIn.whatsapp)}</strong></div>
          <div className="ops-kpi"><span className="ops-kpi-l">Orders · {OLD_WA}</span><strong className="ops-kpi-v">{r.counts.paid}</strong><span className="ops-kpi-s">{`${r.counts.pending} waiting · ${r.counts.cancelled} cancelled`}</span></div>
        </div>
      )}</Loading>
    </section>
  );
}

