// The organization plans table and FAQ, shared by /for-orgs and the home page. Prices, limits and features come from
// the server (Admin → Organization plans), so nothing here is hard-coded.
import { useEffect, useState } from 'react';
import { LIVE } from '../../lib/auth';
import { LIMITS, PLAN_FEATURES, limitText, periodText, rupees } from '../../lib/orgBilling';
import { http, onSlow } from '../../services/http';

export const ORG_FAQ = [
  ['What is Nm7 for Organizations?', 'Your students or candidates build ATS-safe resumes on Nm7 and share them with you, with their consent. You see every shared resume in one table, approve, remind, print and export them — and run kiosks at events.'],
  ['Can we try it first?', 'Yes. The Free plan needs no payment: one group of up to 50 members and one coordinator. Upgrade any time from Organization → Billing.'],
  ['What happens when a plan ends?', 'We email the Owner 14, 7 and 1 day before. After the end there is a grace period; then the Free limits apply. Nothing is ever deleted — your groups and shared resumes stay readable, and new joins over the Free limits wait until you renew.'],
  ['Do you give GST invoices?', 'Yes. Add your organization’s legal name, address and GSTIN (optional) in Billing; every payment gets an invoice you can download.'],
  ['How do we pay?', 'Online through Razorpay (UPI, cards, netbanking), or by bank transfer / purchase order — use “Talk to us” and we’ll send a proforma invoice.'],
  ['Is candidate data safe?', 'Members choose what to share and can leave any time. Aadhaar, PAN and similar numbers are removed from shared resumes, and every view, print and export is logged.'],
];

/** GET /api/public/org-plans once: { loading } → { data } or { error }. Without the API (preview builds): {}. */
export function useOrgPlans() {
  const [st, setSt] = useState(() => (LIVE ? { loading: true } : {}));
  useEffect(() => {
    if (!LIVE) return undefined;
    let alive = true;
    http('/api/public/org-plans').then((data) => alive && setSt({ data }), (error) => alive && setSt({ error }));
    return () => { alive = false; };
  }, []);
  return st;
}

/** While the plans load: the table's shape (so nothing jumps), and a word when the free server is waking up. */
export function PlansSkeleton({ rows = 6 }) {
  const [slow, setSlow] = useState(false);
  useEffect(() => onSlow(setSlow), []);
  return (
    <div className="stack g8" role="status" aria-live="polite">
      <span className="sr-only">Loading plans</span>
      <div className="plans-skel" aria-hidden="true">{Array.from({ length: rows * 5 }, (_, i) => <span key={i} />)}</div>
      {slow && <span className="xs muted">The server is waking up after a quiet spell — this can take up to a minute the first time.</span>}
    </div>
  );
}

/** Free / Drive / Campus / Custom side by side (prices before GST), from GET /api/public/org-plans. */
export function PlansTable({ data }) {
  const plans = data.plans;
  return (
    <div className="table-wrap" style={{ overflowX: 'auto' }}>
      <table className="table" style={{ minWidth: 640 }}>
        <caption className="sr-only">Plans for organizations</caption>
        <thead>
          <tr><th scope="col">Plan</th>{plans.map((p) => <th key={p.id} scope="col">{p.name}</th>)}</tr>
        </thead>
        <tbody>
          <tr>
            <th scope="row">Price</th>
            {plans.map((p) => (
              <td key={p.id}>
                {p.id === 'custom' ? <strong>Talk to us</strong> : p.price ? <><strong>{rupees(p.price)}</strong> <span className="small muted">{periodText(p)}{data.gstOn ? ' + GST' : ''}</span></> : <strong>₹0</strong>}
              </td>
            ))}
          </tr>
          {LIMITS.map(([k, label]) => (
            <tr key={k}><th scope="row">{label}</th>{plans.map((p) => <td key={p.id}>{p.id === 'custom' ? 'Your choice' : limitText(p.limits[k])}</td>)}</tr>
          ))}
          {PLAN_FEATURES.filter(([k]) => k !== 'kiosk').map(([k, label]) => (
            <tr key={k}><th scope="row">{label}</th>{plans.map((p) => <td key={p.id}>{p.features[k] ? 'Yes' : '—'}</td>)}</tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

