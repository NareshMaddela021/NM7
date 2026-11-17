// Payments, admin side (the server checks every rule again: app/wapay, app/payments):
//   PaymentSettings  Admin → Settings & prices → Payments: the payment method, Razorpay or Off (pause payments),
//                    and whether the Razorpay keys are set on the server.
//   WaReport         Admin → Reports: money in, Razorpay vs old (WhatsApp) orders, CSV.
// The old (WhatsApp) orders themselves are read-only in Admin → Payments & invoices → Old WhatsApp orders.
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useToast } from '../../../components/ui';
import { savePdf } from '../../builder/resumePdf';
import { API_BASE } from '../../../services/http';
import '../../../styles/me-kit.css';
import '../../../styles/admin-ops.css';
import { Loading, http, rupees, useAction, useApi } from './common';

export const MODES = [['razorpay', 'Razorpay'], ['off', 'Off (pause payments)']];
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
            {mode === 'off' ? 'Payments are paused: pay buttons show “Payments coming soon” and downloads stay free.'
              : 'Customers pay with Razorpay’s checkout (UPI, cards, netbanking, wallets). A GST invoice is emailed after each payment.'}
            {' '}Now active: <strong className="ops-pay-active" data-testid="pay-active">{f.active === 'razorpay' ? 'Razorpay' : 'Off'}</strong>
          </span>
          {!f.razorpayReady && <div className="well xs" role="note" data-testid="pay-keys" style={{ borderLeft: '3px solid var(--warning)' }}>Razorpay keys are missing, so payments stay off. {KEYS_HINT}</div>}
          {!f.businessReady && <span className="xs" data-testid="pay-business">Business details (name, address, GSTIN) aren’t set: invoices carry no GST lines yet. Add them in <Link to="/admin/billing-settings">Billing settings</Link>.</span>}
          {f.pendingWhatsapp > 0 && <span className="xs" data-testid="pay-old-wa">{f.pendingWhatsapp} {OLD_WA} order(s) still wait for money: <Link to="/admin/payments?tab=old">send them a Razorpay payment link</Link>.</span>}
          <button type="button" className="btn btn-signal" style={{ alignSelf: 'flex-start', minHeight: 44 }} disabled={busy || mode === f.mode || (mode === 'razorpay' && !f.razorpayReady)} onClick={save}>Save payment method</button>
        </>
      )}</Loading>
    </section>
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

