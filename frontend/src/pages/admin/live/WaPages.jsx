// Pay via WhatsApp, admin side (the server checks every rule again: app/wapay):
//   PaymentSettings      Admin → Settings & prices → Payments: Off | WhatsApp | Razorpay, the WhatsApp number (+91),
//                        reply hours, auto-cancel hours. A UPI ID is never entered or shown here.
//   LiveWhatsAppPayments Admin → WhatsApp payments: orders waiting for payment, Open chat, Mark as paid (method,
//                        UTR / reference, amount received, date; a reason when the amount differs), Cancel, Refund.
//   WaReport             Admin → Reports: money in by method, pending / paid / cancelled, CSV with UTRs.
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Dialog, useToast } from '../../../components/ui';
import { savePdf } from '../../builder/resumePdf';
import { API_BASE } from '../../../services/http';
import { Kpi, PageHead, Tabs } from '../AdminUI';
import { Loading, emptyIf, http, rupees, useAction, useApi } from './common';

export const MODES = [['off', 'Off'], ['whatsapp', 'WhatsApp'], ['razorpay', 'Razorpay']];
const METHODS = [['upi', 'UPI'], ['bank', 'Bank transfer'], ['cash', 'Cash']];
export const PHONE_RE = /^(\+?91[\s-]?)?[6-9]\d{4}[\s-]?\d{5}$/;
const today = () => new Date(Date.now() + 5.5 * 3600e3).toISOString().slice(0, 10); // India date

/* ---------- Settings → Payments ---------- */
export function PaymentSettings() {
  const toast = useToast();
  const st = useApi('/api/admin/payment-settings');
  const [busy, run] = useAction(toast);
  const [f, setF] = useState(null);
  useEffect(() => { if (st.data) setF({ ...st.data, hoursText: String(st.data.cancelAfterHours) }); }, [st.data]);
  const numberErr = f && f.whatsappNumber.trim() && !PHONE_RE.test(f.whatsappNumber.trim()) ? 'Enter an Indian mobile number, like +91 98765 43210.' : '';
  const hoursErr = f && !(/^\d+$/.test(f.hoursText) && +f.hoursText >= 1 && +f.hoursText <= 720) ? 'Enter 1–720 hours.' : '';
  const needNumber = f && f.mode === 'whatsapp' && !f.whatsappNumber.trim();
  const save = () => run(async () => {
    const r = await http('/api/admin/payment-settings', { method: 'PUT', body: { mode: f.mode, whatsappNumber: f.whatsappNumber.trim(), replyHours: f.replyHours, cancelAfterHours: Number(f.hoursText) } });
    setF({ ...r, hoursText: String(r.cancelAfterHours) });
  }, 'Payment settings saved');
  return (
    <section className="card stack g12" aria-label="Payments" data-testid="pay-settings">
      <strong>Payments</strong>
      <Loading st={st}>{() => f && (
        <>
          <div className="segmented" role="radiogroup" aria-label="Payment mode" style={{ alignSelf: 'flex-start' }}>
            {MODES.map(([v, l]) => (
              <button key={v} type="button" role="radio" aria-checked={f.mode === v} disabled={v === 'razorpay' && !f.razorpayReady}
                title={v === 'razorpay' && !f.razorpayReady ? 'Razorpay keys aren’t set on the server yet' : undefined} onClick={() => setF({ ...f, mode: v })}>{l}</button>
            ))}
          </div>
          <span className="xs muted">
            {f.mode === 'off' ? 'Nothing can be bought: paid buttons show “Coming soon” and downloads stay free.'
              : f.mode === 'whatsapp' ? 'Every paid button becomes “Buy on WhatsApp”. You confirm each payment below in WhatsApp payments.'
                : 'Razorpay’s checkout, as before.'}
            {' '}Now active: <strong data-testid="pay-active">{MODES.find(([v]) => v === f.active)?.[1]}</strong>
          </span>
          <div className="row g12" style={{ flexWrap: 'wrap' }}>
            <div className="field" style={{ flex: '1 1 220px' }}>
              <label className="label" htmlFor="pay-wa">WhatsApp number</label>
              <input id="pay-wa" className="input" inputMode="tel" autoComplete="off" placeholder="+91 98765 43210" value={f.whatsappNumber}
                aria-invalid={numberErr || needNumber ? 'true' : undefined} onChange={(e) => setF({ ...f, whatsappNumber: e.target.value })} />
              {(numberErr || needNumber) && <span className="error">{numberErr || 'Add the WhatsApp number to use WhatsApp.'}</span>}
              <span className="xs faint">Stored only in the database. Never put a UPI ID on the site: share it inside the chat.</span>
            </div>
            <div className="field" style={{ flex: '1 1 220px' }}>
              <label className="label" htmlFor="pay-hours">Reply hours</label>
              <input id="pay-hours" className="input" maxLength={80} placeholder="We reply 9 am - 9 pm" value={f.replyHours} onChange={(e) => setF({ ...f, replyHours: e.target.value })} />
            </div>
            <div className="field" style={{ flex: '0 1 200px' }}>
              <label className="label" htmlFor="pay-cancel">Cancel unpaid orders after</label>
              <span className="row g8 small" style={{ alignItems: 'center' }}><input id="pay-cancel" className="input" inputMode="numeric" style={{ width: 90 }} value={f.hoursText} aria-invalid={hoursErr ? 'true' : undefined} onChange={(e) => setF({ ...f, hoursText: e.target.value })} />hours</span>
              {hoursErr && <span className="error">{hoursErr}</span>}
            </div>
          </div>
          {!f.businessReady && <span className="xs" data-testid="pay-business">Business details (name, address, GSTIN) aren’t set: WhatsApp payments get a receipt from “Nm7” and no GST invoice. Add them in <Link to="/admin/billing-settings">Billing settings</Link> when ready.</span>}
          <button type="button" className="btn btn-ink" style={{ alignSelf: 'flex-start' }} disabled={busy || !!numberErr || !!hoursErr || needNumber} onClick={save}>Save payments</button>
        </>
      )}</Loading>
    </section>
  );
}

/* ---------- WhatsApp payments ---------- */
const VIEWS = [['awaiting', 'Waiting for payment'], ['paid', 'Paid'], ['cancelled', 'Cancelled'], ['all', 'All']];
const LABEL = { awaiting_payment: 'Waiting for payment', cancelled: 'Cancelled', refunded: 'Refunded' };

export function LiveWhatsAppPayments() {
  const toast = useToast();
  const [view, setView] = useState('awaiting');
  const st = useApi(`/api/admin/whatsapp/orders?status=${view}`);
  const [busy, run] = useAction(toast);
  const [dlg, setDlg] = useState(null); // { kind: 'paid' | 'refund' | 'cancel', row }
  return (
    <>
      <PageHead title="WhatsApp payments" sub="Orders paid in a WhatsApp chat. Mark one paid only after the money has arrived." right={<Link to="/admin/orders" className="btn btn-outline">All orders</Link>} />
      <Tabs label="Show" tabs={VIEWS} value={view} onChange={setView} />
      <Loading st={st} empty={emptyIf((d) => !d.length, view === 'awaiting' ? 'No orders waiting for payment.' : 'Nothing here.')}>{(rows) => (
        <div className="card table-wrap" tabIndex={0} role="region" aria-label="Table — scroll sideways to see all columns" style={{ padding: 0 }}>
          <table className="table" data-testid="wa-table"><thead><tr><th>Order</th><th>Customer</th><th>Item</th><th>Amount</th><th>Age</th><th>Status</th><th /></tr></thead>
            <tbody>{rows.map((r) => (
              <tr key={r.id} data-testid="wa-row">
                <td className="mono small">{r.id}</td>
                <td className="small">{r.customer.name}<div className="xs faint">{r.customer.email}</div></td>
                <td className="small">{r.item}</td>
                <td className="small">{rupees(r.amount)}</td>
                <td className="small">{r.ageHours < 48 ? `${r.ageHours} h` : `${Math.round(r.ageHours / 24)} d`}</td>
                <td className="small">{LABEL[r.status] || (r.payment ? `Paid · ${r.payment.method.toUpperCase()} ${r.payment.reference}` : r.status)}{r.receiptNo && <div className="xs faint">{r.receiptNo}</div>}{r.invoiceNo && <div className="xs faint">{r.invoiceNo}</div>}</td>
                <td>
                  <span className="row g4" style={{ flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                    {r.chatUrl && <a className="btn btn-outline" style={{ minHeight: 36 }} href={r.chatUrl} target="_blank" rel="noopener noreferrer">Open chat</a>}
                    {r.status === 'awaiting_payment' && <button type="button" className="btn btn-ink" style={{ minHeight: 36 }} onClick={() => setDlg({ kind: 'paid', row: r })}>Mark as paid</button>}
                    {r.status === 'awaiting_payment' && <button type="button" className="btn btn-ghost" style={{ minHeight: 36 }} onClick={() => setDlg({ kind: 'cancel', row: r })}>Cancel</button>}
                    {r.payment && r.status !== 'refunded' && <button type="button" className="btn btn-ghost" style={{ minHeight: 36 }} onClick={() => setDlg({ kind: 'refund', row: r })}>Refund</button>}
                  </span>
                </td>
              </tr>
            ))}</tbody></table>
        </div>
      )}</Loading>
      {dlg?.kind === 'paid' && <MarkPaid row={dlg.row} busy={busy} onClose={() => setDlg(null)} onSave={(body) => run(async () => { await http(`/api/admin/whatsapp/orders/${dlg.row.id}/paid`, { method: 'POST', body }); setDlg(null); st.reload(); }, `${dlg.row.id} marked paid — receipt emailed`)} />}
      {dlg?.kind === 'refund' && <RefundDlg row={dlg.row} busy={busy} onClose={() => setDlg(null)} onSave={(body) => run(async () => { await http(`/api/admin/whatsapp/orders/${dlg.row.id}/refund`, { method: 'POST', body }); setDlg(null); st.reload(); }, `${dlg.row.id} refunded`)} />}
      {dlg?.kind === 'cancel' && (
        <Dialog showTitle title={`Cancel ${dlg.row.id}?`} onClose={() => setDlg(null)}>
          <p className="small" style={{ margin: 0 }}>The customer sees it as cancelled and can place a new order.</p>
          <div className="row g8">
            <button type="button" className="btn btn-ink" disabled={busy} onClick={() => run(async () => { await http(`/api/admin/whatsapp/orders/${dlg.row.id}/cancel`, { method: 'POST', body: { reason: 'Cancelled by Nm7' } }); setDlg(null); st.reload(); }, `${dlg.row.id} cancelled`)}>Cancel order</button>
            <button type="button" className="btn btn-outline" onClick={() => setDlg(null)}>Keep it</button>
          </div>
        </Dialog>
      )}
    </>
  );
}

function MarkPaid({ row, busy, onClose, onSave }) {
  const [f, setF] = useState({ method: 'upi', reference: '', amountText: String(row.amount / 100), paidOn: today(), reason: '' });
  const amount = Math.round(Number(f.amountText) * 100);
  const differs = amount !== row.amount;
  const errs = {
    reference: f.reference.replace(/\s/g, '').length < 4 ? 'Enter the UTR or reference.' : '',
    amount: !(amount > 0) ? 'Enter the amount received.' : '',
    reason: differs && f.reason.trim().length < 3 ? 'The amount is different from the order total: say why.' : '',
    paidOn: !f.paidOn || f.paidOn > today() ? 'Pick the payment date (not in the future).' : '',
  };
  const ok = !Object.values(errs).some(Boolean);
  return (
    <Dialog showTitle title={`Mark ${row.id} as paid`} onClose={onClose}>
      <span className="small">{row.item} · {rupees(row.amount)} · {row.customer.name}</span>
      <div className="field"><label className="label" htmlFor="mp-method">Method</label>
        <select id="mp-method" className="input" value={f.method} onChange={(e) => setF({ ...f, method: e.target.value })}>{METHODS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></div>
      <div className="field"><label className="label" htmlFor="mp-ref">UTR or reference</label>
        <input id="mp-ref" className="input" autoComplete="off" value={f.reference} onChange={(e) => setF({ ...f, reference: e.target.value })} aria-invalid={errs.reference ? 'true' : undefined} />
        {f.reference && errs.reference && <span className="error">{errs.reference}</span>}</div>
      <div className="row g12" style={{ flexWrap: 'wrap' }}>
        <div className="field" style={{ flex: '1 1 140px' }}><label className="label" htmlFor="mp-amt">Amount received (₹)</label>
          <input id="mp-amt" className="input" inputMode="decimal" value={f.amountText} onChange={(e) => setF({ ...f, amountText: e.target.value })} aria-invalid={errs.amount ? 'true' : undefined} /></div>
        <div className="field" style={{ flex: '1 1 140px' }}><label className="label" htmlFor="mp-date">Date</label>
          <input id="mp-date" className="input" type="date" max={today()} value={f.paidOn} onChange={(e) => setF({ ...f, paidOn: e.target.value })} /></div>
      </div>
      {differs && (
        <div className="field"><label className="label" htmlFor="mp-reason">Why is the amount different?</label>
          <input id="mp-reason" className="input" value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} aria-invalid={errs.reason ? 'true' : undefined} />
          {errs.reason && <span className="error">{errs.reason}</span>}</div>
      )}
      <span className="xs muted">Saving unlocks the order at once and emails the customer a receipt.</span>
      <div className="row g8">
        <button type="button" className="btn btn-ink" disabled={busy || !ok} onClick={() => onSave({ method: f.method, reference: f.reference.trim(), amount, paidOn: f.paidOn, reason: f.reason.trim() })}>Save — mark paid</button>
        <button type="button" className="btn btn-outline" onClick={onClose}>Close</button>
      </div>
    </Dialog>
  );
}

function RefundDlg({ row, busy, onClose, onSave }) {
  const [f, setF] = useState({ method: row.payment?.method || 'upi', reference: '', amountText: '', note: '' });
  const amount = f.amountText.trim() ? Math.round(Number(f.amountText) * 100) : null;
  const ok = f.reference.replace(/\s/g, '').length >= 4 && (amount === null || amount > 0);
  return (
    <Dialog showTitle title={`Refund ${row.id}`} onClose={onClose}>
      <span className="small">Send the money back to the same UPI / bank account first, then record it here. A full refund removes access.</span>
      <div className="field"><label className="label" htmlFor="rf-method">Method</label>
        <select id="rf-method" className="input" value={f.method} onChange={(e) => setF({ ...f, method: e.target.value })}>{METHODS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></div>
      <div className="field"><label className="label" htmlFor="rf-ref">Refund UTR or reference</label>
        <input id="rf-ref" className="input" autoComplete="off" value={f.reference} onChange={(e) => setF({ ...f, reference: e.target.value })} /></div>
      <div className="field"><label className="label" htmlFor="rf-amt">Amount (₹) <span className="xs muted" style={{ fontWeight: 400 }}>· empty = the full amount</span></label>
        <input id="rf-amt" className="input" inputMode="decimal" placeholder={String(row.amount / 100)} value={f.amountText} onChange={(e) => setF({ ...f, amountText: e.target.value })} /></div>
      <div className="field"><label className="label" htmlFor="rf-note">Note</label>
        <input id="rf-note" className="input" maxLength={300} value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} /></div>
      <div className="row g8">
        <button type="button" className="btn btn-ink" disabled={busy || !ok} onClick={() => onSave({ method: f.method, reference: f.reference.trim(), ...(amount ? { amount } : {}), note: f.note.trim() })}>Save refund</button>
        <button type="button" className="btn btn-outline" onClick={onClose}>Close</button>
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
    <section className="card stack g12" aria-label="Payments by method" data-testid="wa-report">
      <div className="row between g8" style={{ flexWrap: 'wrap' }}><strong>Payments by method</strong><button type="button" className="btn btn-outline" disabled={busy} onClick={csv}>Download payments CSV</button></div>
      <Loading st={st}>{(r) => (
        <div className="kpis">
          <Kpi label="Money in · WhatsApp" value={rupees(r.moneyIn.whatsapp)} />
          <Kpi label="Money in · Razorpay" value={rupees(r.moneyIn.razorpay)} />
          <Kpi label="WhatsApp orders" value={r.counts.paid} sub={`${r.counts.pending} waiting · ${r.counts.cancelled} cancelled`} />
        </div>
      )}</Loading>
    </section>
  );
}

