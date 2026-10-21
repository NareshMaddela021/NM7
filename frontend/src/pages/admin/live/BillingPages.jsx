// Admin console, Nm7 for Organizations Phase 4: Organization plans (every price, period, limit and feature is
// editable; each save is a new version and never changes what someone already bought), Billing settings (supplier
// details, GST, grace, reminders, commission, test / live payments), each organization's billing panel (assign a
// plan, extend, discount, custom plan, limits) and the dashboard numbers.
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useToast } from '../../../components/ui';
import { LIMITS, PLAN_FEATURES, limitText, periodText, rupees } from '../../../lib/orgBilling';
import { downloadFrom } from '../../../lib/fileDownload';
import { Kpi, PageHead } from '../AdminUI';
import { OrgPartner } from './PartnerPages';
import { Loading, day, emptyIf, http, useAction, useApi } from './common';

const inputStyle = { height: 40 };
const FEATURE_EDIT = PLAN_FEATURES.filter(([k]) => k !== 'kiosk'); // kiosks come from the kiosk-stall limit
const toPaise = (rupeesText) => (rupeesText === '' || rupeesText === null ? null : Math.round(Number(rupeesText) * 100));
const toRupees = (paise) => (paise === null || paise === undefined ? '' : String(paise / 100));
const numOrNull = (v) => (v === '' || v === null ? null : Number(v));

function LimitInputs({ value, onChange, idp }) {
  return (
    <div className="row g12" style={{ flexWrap: 'wrap' }}>
      {LIMITS.map(([k, label]) => (
        <div key={k} className="field" style={{ flex: '1 1 130px' }}>
          <label className="label" htmlFor={`${idp}-${k}`}>{label}</label>
          <input id={`${idp}-${k}`} className="input" style={inputStyle} type="number" min={0} placeholder="Unlimited" value={value[k] ?? ''} onChange={(e) => onChange({ ...value, [k]: numOrNull(e.target.value) })} />
        </div>
      ))}
    </div>
  );
}

function FeatureInputs({ value, onChange }) {
  return (
    <div className="row g16" style={{ flexWrap: 'wrap' }}>
      {FEATURE_EDIT.map(([k, label]) => <label key={k} className="row g8 small"><input type="checkbox" checked={!!value[k]} onChange={(e) => onChange({ ...value, [k]: e.target.checked })} /> {label}</label>)}
    </div>
  );
}

function PlanForm({ p, reload }) {
  const toast = useToast();
  const [busy, run] = useAction(toast);
  const [f, setF] = useState({ name: p.name, blurb: p.blurb, price: toRupees(p.price), unit: p.periodMonths ? 'months' : 'days', n: p.periodMonths || p.periodDays || '', limits: p.limits, features: p.features, onSale: p.onSale, public: p.public });
  const [hist, setHist] = useState(false);
  const save = (e) => {
    e.preventDefault();
    run(async () => {
      const body = {
        name: f.name, blurb: f.blurb, price: p.id === 'free' ? 0 : toPaise(f.price),
        periodDays: f.unit === 'days' && f.n ? Number(f.n) : null, periodMonths: f.unit === 'months' && f.n ? Number(f.n) : null,
        limits: f.limits, features: { branding: f.features.branding, recruiterLinks: f.features.recruiterLinks, membersDownloadFree: f.features.membersDownloadFree },
        onSale: f.onSale, public: f.public,
      };
      await http(`/api/admin/billing/plans/${p.id}`, { method: 'PUT', body });
      reload();
    }, 'Saved as a new version');
  };
  return (
    <form className="card stack g12" onSubmit={save} aria-label={`${p.name} plan`}>
      <span className="row between g8" style={{ flexWrap: 'wrap' }}><strong>{p.name}</strong><span className="xs muted">version {p.version}{p.id === 'custom' ? ' · price and limits are set per organization' : ''}</span></span>
      <div className="row g12" style={{ flexWrap: 'wrap' }}>
        <div className="field" style={{ flex: '1 1 160px' }}><label className="label" htmlFor={`pn-${p.id}`}>Name</label><input id={`pn-${p.id}`} className="input" style={inputStyle} required value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></div>
        <div className="field" style={{ flex: '2 1 260px' }}><label className="label" htmlFor={`pb-${p.id}`}>One line on /for-orgs</label><input id={`pb-${p.id}`} className="input" style={inputStyle} maxLength={160} value={f.blurb} onChange={(e) => setF({ ...f, blurb: e.target.value })} /></div>
      </div>
      {p.id !== 'free' && p.id !== 'custom' && (
        <div className="row g12" style={{ flexWrap: 'wrap' }}>
          <div className="field" style={{ flex: '1 1 160px' }}><label className="label" htmlFor={`pp-${p.id}`}>Price (₹, before GST)</label><input id={`pp-${p.id}`} className="input" style={inputStyle} type="number" min={1} step="0.01" required value={f.price} onChange={(e) => setF({ ...f, price: e.target.value })} /></div>
          <div className="field" style={{ flex: '1 1 120px' }}><label className="label" htmlFor={`pd-${p.id}`}>Period</label><input id={`pd-${p.id}`} className="input" style={inputStyle} type="number" min={1} required value={f.n} onChange={(e) => setF({ ...f, n: e.target.value })} /></div>
          <div className="field" style={{ flex: '1 1 120px' }}><label className="label" htmlFor={`pu-${p.id}`}>Unit</label><select id={`pu-${p.id}`} className="input" style={inputStyle} value={f.unit} onChange={(e) => setF({ ...f, unit: e.target.value })}><option value="days">days</option><option value="months">months</option></select></div>
        </div>
      )}
      {p.id !== 'custom' && <LimitInputs value={f.limits} onChange={(limits) => setF({ ...f, limits })} idp={`pl-${p.id}`} />}
      {p.id !== 'custom' && <FeatureInputs value={f.features} onChange={(features) => setF({ ...f, features })} />}
      <div className="row g16" style={{ flexWrap: 'wrap' }}>
        {p.id !== 'free' && p.id !== 'custom' && <label className="row g8 small"><input type="checkbox" checked={f.onSale} onChange={(e) => setF({ ...f, onSale: e.target.checked })} /> On sale (Owners can buy it)</label>}
        <label className="row g8 small"><input type="checkbox" checked={f.public} onChange={(e) => setF({ ...f, public: e.target.checked })} /> Shown on /for-orgs</label>
      </div>
      <div className="row g8"><button type="submit" className="btn btn-ink" disabled={busy}>Save</button>{p.history?.length > 0 && <button type="button" className="btn btn-outline" onClick={() => setHist(!hist)}>{hist ? 'Hide' : 'Earlier versions'}</button>}</div>
      <span className="xs muted">Saving creates version {p.version + 1}. Plans already bought and invoices already issued keep the terms they were sold on.</span>
      {hist && (
        <div className="table-wrap"><table className="table">
          <thead><tr><th>Version</th><th>Price</th><th>Period</th><th>Members</th><th>Until</th></tr></thead>
          <tbody>{p.history.map((h) => <tr key={h.version}><td>{h.version}</td><td>{h.price === null ? '—' : rupees(h.price)}</td><td>{periodText(h) || '—'}</td><td>{limitText(h.limits?.members)}</td><td>{day(h.until)}</td></tr>)}</tbody>
        </table></div>
      )}
    </form>
  );
}

/** Admin → Organization plans */
export function LivePlans() {
  const st = useApi('/api/admin/billing/plans');
  return (
    <>
      <PageHead title="Organization plans" sub="Prices exclude GST. Limits left empty are unlimited. Kiosks are on when a plan allows at least one kiosk stall." right={<Link className="btn btn-outline" to="/admin/billing-settings">Billing settings</Link>} />
      <Loading st={st}>{(plans) => plans.map((p) => <PlanForm key={`${p.id}-${p.version}`} p={p} reload={st.reload} />)}</Loading>
    </>
  );
}

const SETTINGS_FIELDS = [
  ['gstRateBp', 'GST rate (basis points, 1800 = 18%)', 0, 2800],
  ['graceDays', 'Grace period after a plan ends (days)', 0, 60],
  ['usageWarnPct', 'Usage banner from (% of a limit)', 50, 100],
  ['endsSoonDays', '“Plan ends soon” banner (days before)', 1, 60],
  ['commissionPct', 'Partner commission (%)', 0, 100],
  ['commissionMonths', 'Commission on payments in the first (months)', 1, 60],
  ['commissionPayableDays', 'Commission payable after (days)', 0, 365],
  ['referralDays', 'Referral link remembered for (days)', 1, 365],
  ['partnerDiscountPct', 'Partner-code discount for organizations (%)', 0, 50],
  ['paymentLinkDays', 'Proforma payment link valid for (days)', 1, 90],
];

function SettingsForm({ s, states, reload }) {
  const toast = useToast();
  const [busy, run] = useAction(toast);
  const [f, setF] = useState({ ...s, reminderText: s.reminderDays.join(', ') });
  const sup = (k) => (e) => setF({ ...f, supplier: { ...f.supplier, [k]: k === 'gstin' ? e.target.value.toUpperCase() : e.target.value } });
  const save = (e) => {
    e.preventDefault();
    run(async () => {
      const { gstOn, missing, reminderText, ...rest } = f; // eslint-disable-line no-unused-vars
      await http('/api/admin/billing/settings', { method: 'PUT', body: { ...rest, reminderDays: reminderText.split(/[,\s]+/).filter(Boolean).map(Number) } });
      reload();
    }, 'Billing settings saved');
  };
  return (
    <form className="stack g16" onSubmit={save} aria-label="Billing settings">
      {s.missing.length > 0 && <div className="well small" role="note">Before going live, fill in: <strong>{s.missing.join(', ')}</strong>. GST stays off (plain invoices, no tax lines) until a GSTIN is entered.</div>}
      <section className="card stack g12" aria-label="Supplier">
        <strong>Supplier (printed on every invoice)</strong>
        <div className="row g12" style={{ flexWrap: 'wrap' }}>
          <div className="field" style={{ flex: '2 1 260px' }}><label className="label" htmlFor="bs-ln">Legal name</label><input id="bs-ln" className="input" style={inputStyle} required value={f.supplier.legalName} onChange={sup('legalName')} /></div>
          <div className="field" style={{ flex: '1 1 160px' }}><label className="label" htmlFor="bs-tn">Trade name</label><input id="bs-tn" className="input" style={inputStyle} value={f.supplier.tradeName} onChange={sup('tradeName')} /></div>
        </div>
        <div className="field"><label className="label" htmlFor="bs-ad">Address</label><textarea id="bs-ad" className="input" rows={2} value={f.supplier.address} onChange={sup('address')} /></div>
        <div className="row g12" style={{ flexWrap: 'wrap' }}>
          <div className="field" style={{ flex: '1 1 200px' }}><label className="label" htmlFor="bs-st">State</label><select id="bs-st" className="input" style={inputStyle} value={f.supplier.stateCode} onChange={sup('stateCode')}><option value="">Choose…</option>{states.map((x) => <option key={x.code} value={x.code}>{x.name}</option>)}</select></div>
          <div className="field" style={{ flex: '1 1 200px' }}><label className="label" htmlFor="bs-g">GSTIN (empty = GST off)</label><input id="bs-g" className="input mono" style={inputStyle} maxLength={15} value={f.supplier.gstin} onChange={sup('gstin')} /></div>
          <div className="field" style={{ flex: '1 1 120px' }}><label className="label" htmlFor="bs-sac">SAC code</label><input id="bs-sac" className="input mono" style={inputStyle} maxLength={8} inputMode="numeric" value={f.supplier.sac} onChange={sup('sac')} /></div>
        </div>
        <div className="row g12" style={{ flexWrap: 'wrap' }}>
          <div className="field" style={{ flex: '1 1 220px' }}><label className="label" htmlFor="bs-sg">Authorised signatory</label><input id="bs-sg" className="input" style={inputStyle} value={f.supplier.signatory} onChange={sup('signatory')} /></div>
          <div className="field" style={{ flex: '1 1 220px' }}><label className="label" htmlFor="bs-em">Billing email</label><input id="bs-em" type="email" className="input" style={inputStyle} value={f.supplier.email} onChange={sup('email')} /></div>
        </div>
      </section>
      <section className="card stack g12" aria-label="Rules">
        <strong>Rules</strong>
        <div className="row g12" style={{ flexWrap: 'wrap' }}>
          {SETTINGS_FIELDS.map(([k, label, min, max]) => (
            <div key={k} className="field" style={{ flex: '1 1 220px' }}><label className="label" htmlFor={`bs-${k}`}>{label}</label><input id={`bs-${k}`} className="input" style={inputStyle} type="number" min={min} max={max} required value={f[k]} onChange={(e) => setF({ ...f, [k]: Number(e.target.value) })} /></div>
          ))}
          <div className="field" style={{ flex: '1 1 220px' }}><label className="label" htmlFor="bs-rd">Reminder emails (days before the end)</label><input id="bs-rd" className="input" style={inputStyle} value={f.reminderText} onChange={(e) => setF({ ...f, reminderText: e.target.value })} /></div>
        </div>
        <label className="row g8 small"><input type="checkbox" checked={f.partnerDiscountOn} onChange={(e) => setF({ ...f, partnerDiscountOn: e.target.checked })} /> A partner code also gives the organization the discount above</label>
        <label className="row g8 small"><input type="checkbox" checked={f.orgSignupOpen} onChange={(e) => setF({ ...f, orgSignupOpen: e.target.checked })} /> “Start free” on /for-orgs creates organizations</label>
        <label className="row g8 small"><input type="checkbox" checked={f.razorpayLive} onChange={(e) => setF({ ...f, razorpayLive: e.target.checked })} /> <span><strong>Live payments.</strong> Off = test mode: checkout only works with Razorpay test keys. Switch on after putting the live keys in Render.</span></label>
      </section>
      <button type="submit" className="btn btn-ink" style={{ alignSelf: 'flex-start' }} disabled={busy}>Save billing settings</button>
    </form>
  );
}

/** Admin → Billing settings */
export function LiveBillingSettings() {
  const st = useApi('/api/admin/billing/settings');
  const pub = useApi('/api/public/org-plans');
  return (
    <>
      <PageHead title="Billing settings" sub={st.data ? (st.data.gstOn ? 'GST is on: invoices carry CGST + SGST (same state) or IGST.' : 'GST is off: invoices print without tax lines.') : ''} right={<Link className="btn btn-outline" to="/admin/plans">Organization plans</Link>} />
      <Loading st={st}>{(s) => (pub.data ? <SettingsForm s={s} states={pub.data.states} reload={st.reload} /> : null)}</Loading>
    </>
  );
}

const STATE_TEXT = { free: 'Free', active: 'Active', grace: 'Grace period', expired: 'Ended (Free limits)' };

/** Admin → Organizations → (organization) → Billing: assign / extend a plan, discount, custom plan, limits. */
export function OrgBilling({ orgId }) {
  const toast = useToast();
  const st = useApi(`/api/admin/orgs/${orgId}/billing`);
  const [busy, run] = useAction(toast);
  const [assign, setAssign] = useState(null);
  const [ext, setExt] = useState('');
  const [pricing, setPricing] = useState(null);
  return (
    <Loading st={st}>{(b) => {
      const s = b.summary;
      return (
        <section className="card stack g12" aria-label="Plan and billing">
          <span className="row between g8" style={{ flexWrap: 'wrap' }}><strong>Plan and billing</strong><span className="badge b-neutral">{s.planName} · {STATE_TEXT[s.state]}</span></span>
          {b.legacyUnlimited && <span className="xs" role="note">Created before plans existed: no plan limits until you assign a plan.</span>}
          {s.state !== 'free' && <span className="small muted">{day(s.startsOn)} – {day(s.endsOn)} · grace until {day(s.graceUntil)}{b.subscription?.source ? ` · ${b.subscription.source}` : ''}</span>}
          <span className="small">{LIMITS.map(([k, , words]) => `${s.usage[k]}/${limitText(s.limits[k])} ${words}`).join(' · ')}</span>
          {b.details ? <span className="xs muted">Bills to {b.details.legalName}, {b.details.stateName}{b.details.gstin ? ` · GSTIN ${b.details.gstin}` : ''}</span> : <span className="xs muted">No billing details yet.</span>}
          <div className="row g8" style={{ flexWrap: 'wrap' }}>
            <button type="button" className="btn btn-outline" onClick={() => setAssign(assign ? null : { planId: 'drive', startsOn: '', endsOn: '', price: '', discount: '0', note: '' })}>Assign a plan</button>
            {s.state !== 'free' && <button type="button" className="btn btn-outline" onClick={() => setExt(ext ? '' : s.endsOn)}>Extend</button>}
            <button type="button" className="btn btn-outline" onClick={() => setPricing(pricing ? null : { discountPct: b.discountPct, custom: b.customPlan ? { ...b.customPlan, price: toRupees(b.customPlan.price), unit: b.customPlan.periodMonths ? 'months' : 'days', n: b.customPlan.periodMonths || b.customPlan.periodDays } : null, limits: b.limitOverrides })}>Discount and custom plan</button>
          </div>
          {assign && (
            <form className="well stack g8" onSubmit={(e) => { e.preventDefault(); run(async () => { await http(`/api/admin/orgs/${orgId}/billing/plan`, { method: 'PUT', body: { planId: assign.planId, startsOn: assign.startsOn || null, endsOn: assign.endsOn || null, price: toPaise(assign.price), discount: toPaise(assign.discount) || 0, note: assign.note } }); setAssign(null); st.reload(); }, 'Plan assigned'); }}>
              <div className="row g8" style={{ flexWrap: 'wrap' }}>
                <select aria-label="Plan" className="input" style={inputStyle} value={assign.planId} onChange={(e) => setAssign({ ...assign, planId: e.target.value })}><option value="free">Free (remove the paid plan)</option><option value="drive">Drive</option><option value="campus">Campus</option><option value="custom">Custom</option></select>
                <label className="small">Starts <input type="date" className="input" style={inputStyle} value={assign.startsOn} onChange={(e) => setAssign({ ...assign, startsOn: e.target.value })} /></label>
                <label className="small">Ends <input type="date" className="input" style={inputStyle} value={assign.endsOn} onChange={(e) => setAssign({ ...assign, endsOn: e.target.value })} /></label>
                <label className="small">Price ₹ <input type="number" className="input" style={{ ...inputStyle, width: 120 }} min={0} value={assign.price} placeholder="plan price" onChange={(e) => setAssign({ ...assign, price: e.target.value })} /></label>
                <label className="small">Discount ₹ <input type="number" className="input" style={{ ...inputStyle, width: 110 }} min={0} value={assign.discount} onChange={(e) => setAssign({ ...assign, discount: e.target.value })} /></label>
              </div>
              <input className="input" style={inputStyle} placeholder="Note for the audit log (optional)" maxLength={300} value={assign.note} onChange={(e) => setAssign({ ...assign, note: e.target.value })} />
              <span className="xs muted">No payment is taken. Empty dates: starts today, for the plan’s period. Logged.</span>
              <button type="submit" className="btn btn-ink" style={{ alignSelf: 'flex-start' }} disabled={busy}>Assign</button>
            </form>
          )}
          {ext && (
            <form className="well row g8" onSubmit={(e) => { e.preventDefault(); run(async () => { await http(`/api/admin/orgs/${orgId}/billing/extend`, { method: 'POST', body: { endsOn: ext } }); setExt(''); st.reload(); }, 'Extended'); }}>
              <label className="small">New end date <input type="date" className="input" style={inputStyle} value={ext} onChange={(e) => setExt(e.target.value)} /></label>
              <button type="submit" className="btn btn-ink" disabled={busy}>Save</button>
            </form>
          )}
          {pricing && (
            <form className="well stack g8" onSubmit={(e) => { e.preventDefault(); run(async () => { const c = pricing.custom; await http(`/api/admin/orgs/${orgId}/billing/pricing`, { method: 'PUT', body: { discountPct: Number(pricing.discountPct) || 0, customPlan: c ? { price: toPaise(c.price), periodDays: c.unit === 'days' ? Number(c.n) : null, periodMonths: c.unit === 'months' ? Number(c.n) : null, limits: c.limits, features: c.features } : null, ...(pricing.limits ? { limitOverrides: pricing.limits } : { clearLimitOverrides: true }) } }); setPricing(null); st.reload(); }, 'Saved'); }}>
              <label className="small">Discount on Drive / Campus checkouts (%) <input type="number" min={0} max={100} className="input" style={{ ...inputStyle, width: 90 }} value={pricing.discountPct} onChange={(e) => setPricing({ ...pricing, discountPct: e.target.value })} /></label>
              <label className="row g8 small"><input type="checkbox" checked={!!pricing.custom} onChange={(e) => setPricing({ ...pricing, custom: e.target.checked ? { price: '', unit: 'months', n: 12, limits: { members: null, groups: null, coordinators: null, kiosks: null }, features: { branding: true, recruiterLinks: true, membersDownloadFree: true } } : null })} /> A custom plan this organization can buy</label>
              {pricing.custom && (
                <div className="stack g8" style={{ paddingLeft: 24 }}>
                  <div className="row g8" style={{ flexWrap: 'wrap' }}>
                    <label className="small">Price ₹ <input type="number" min={1} required className="input" style={{ ...inputStyle, width: 130 }} value={pricing.custom.price} onChange={(e) => setPricing({ ...pricing, custom: { ...pricing.custom, price: e.target.value } })} /></label>
                    <label className="small">Period <input type="number" min={1} required className="input" style={{ ...inputStyle, width: 80 }} value={pricing.custom.n} onChange={(e) => setPricing({ ...pricing, custom: { ...pricing.custom, n: e.target.value } })} /></label>
                    <select aria-label="Period unit" className="input" style={inputStyle} value={pricing.custom.unit} onChange={(e) => setPricing({ ...pricing, custom: { ...pricing.custom, unit: e.target.value } })}><option value="days">days</option><option value="months">months</option></select>
                  </div>
                  <LimitInputs value={pricing.custom.limits} onChange={(limits) => setPricing({ ...pricing, custom: { ...pricing.custom, limits } })} idp="cp" />
                  <FeatureInputs value={pricing.custom.features} onChange={(features) => setPricing({ ...pricing, custom: { ...pricing.custom, features } })} />
                </div>
              )}
              <label className="row g8 small"><input type="checkbox" checked={!!pricing.limits} onChange={(e) => setPricing({ ...pricing, limits: e.target.checked ? { members: null, groups: null, coordinators: null, kiosks: null } : null })} /> Different limits for this organization (empty = no limit)</label>
              {pricing.limits && <LimitInputs value={pricing.limits} onChange={(limits) => setPricing({ ...pricing, limits })} idp="lo" />}
              <button type="submit" className="btn btn-ink" style={{ alignSelf: 'flex-start' }} disabled={busy}>Save</button>
            </form>
          )}
          <OrgPartner orgId={orgId} partner={b.partner} reload={st.reload} />
          <OrgMoney orgId={orgId} b={b} reload={st.reload} />
          {b.history.length > 0 && <details><summary className="small">Earlier plans ({b.history.length})</summary><ul className="small">{b.history.map((h, i) => <li key={i}>{h.planName} · {h.startsOn ? `${day(h.startsOn)} – ${day(h.endsOn)}` : ''} · {h.source || ''} · replaced {day(h.replacedAt)}</li>)}</ul></details>}
        </section>
      );
    }}</Loading>
  );
}

const METHODS = [['bank_transfer', 'Bank transfer (NEFT/RTGS/IMPS)'], ['upi', 'UPI'], ['cheque', 'Cheque'], ['purchase_order', 'Purchase order'], ['cash', 'Cash'], ['other', 'Other']];
const DOC_KIND = { invoice: 'Invoice', credit_note: 'Credit note', proforma: 'Proforma' };
const today = () => new Date(Date.now() + 5.5 * 3600_000).toISOString().slice(0, 10); // IST

/** Admin → Organization → Billing: proforma (with an optional Razorpay payment link), offline payment, refunds,
 * and this organization's invoices and credit notes. The server does all the money arithmetic. */
function OrgMoney({ orgId, b, reload }) {
  const toast = useToast();
  const [busy, run] = useAction(toast);
  const docs = useApi(`/api/admin/org-invoices?orgId=${orgId}`);
  const [pf, setPf] = useState(null);
  const [made, setMade] = useState(null);
  const [off, setOff] = useState(null);
  const [rf, setRf] = useState(null);
  const again = () => { reload(); docs.reload(); };
  const paidOrders = new Set(b.orders.filter((o) => o.paidAt).map((o) => o.id));
  const openProformas = (docs.data?.rows || []).filter((d) => d.kind === 'proforma' && !paidOrders.has(d.orderId));
  return (
    <div className="stack g12">
      <div className="row g8" style={{ flexWrap: 'wrap' }}>
        <button type="button" className="btn btn-outline" onClick={() => { setMade(null); setPf(pf ? null : { planId: 'drive', extraDiscountPct: 0, paymentLink: true }); }}>Proforma invoice</button>
        <button type="button" className="btn btn-outline" onClick={() => setOff(off ? null : { orderId: openProformas[0]?.orderId || '', planId: 'drive', method: 'bank_transfer', reference: '', paidOn: today(), amount: openProformas[0] ? String(openProformas[0].total / 100) : '' })}>Record offline payment</button>
      </div>
      {!b.details && (pf || off) && <span className="xs" role="note">Add the organization’s billing details first (the Owner does it under Billing).</span>}
      {pf && (
        <form className="well stack g8" aria-label="Proforma invoice" onSubmit={(e) => { e.preventDefault(); run(async () => { const d = await http(`/api/admin/orgs/${orgId}/billing/proforma`, { method: 'POST', body: { ...pf, extraDiscountPct: Number(pf.extraDiscountPct) || 0 } }); setMade(d); setPf(null); again(); }, 'Proforma issued'); }}>
          <div className="row g8" style={{ flexWrap: 'wrap' }}>
            <select aria-label="Proforma plan" className="input" style={inputStyle} value={pf.planId} onChange={(e) => setPf({ ...pf, planId: e.target.value })}><option value="drive">Drive</option><option value="campus">Campus</option>{b.customPlan && <option value="custom">Custom</option>}</select>
            <label className="small">Extra discount % <input type="number" min={0} max={100} className="input" style={{ ...inputStyle, width: 80 }} value={pf.extraDiscountPct} onChange={(e) => setPf({ ...pf, extraDiscountPct: e.target.value })} /></label>
            <label className="row g8 small"><input type="checkbox" checked={pf.paymentLink} onChange={(e) => setPf({ ...pf, paymentLink: e.target.checked })} /> With a Razorpay payment link</label>
          </div>
          <span className="xs muted">A request for payment, not a tax invoice. Paid through the link, the plan turns on by itself; paid by bank, record it below.</span>
          <button type="submit" className="btn btn-ink" style={{ alignSelf: 'flex-start' }} disabled={busy}>Issue proforma</button>
        </form>
      )}
      {made && <div className="well small" role="status">Proforma <span className="mono">{made.number}</span> for {rupees(made.total)}.{made.paymentLink ? <> Payment link: <a href={made.paymentLink} target="_blank" rel="noreferrer" className="mono">{made.paymentLink}</a></> : ''} Download it below and send it to the organization.</div>}
      {off && (
        <form className="well stack g8" aria-label="Offline payment" onSubmit={(e) => { e.preventDefault(); run(async () => { await http(`/api/admin/orgs/${orgId}/billing/offline-payment`, { method: 'POST', body: { orderId: off.orderId || null, planId: off.orderId ? null : off.planId, method: off.method, reference: off.reference, paidOn: off.paidOn, amount: Math.round(Number(off.amount) * 100) } }); setOff(null); again(); }, 'Payment recorded · plan on · invoice issued'); }}>
          <div className="row g8" style={{ flexWrap: 'wrap' }}>
            <select aria-label="Paid for" className="input" style={inputStyle} value={off.orderId} onChange={(e) => { const d = openProformas.find((x) => x.orderId === e.target.value); setOff({ ...off, orderId: e.target.value, amount: d ? String(d.total / 100) : off.amount }); }}>
              {openProformas.map((d) => <option key={d.id} value={d.orderId}>Proforma {d.number} · {rupees(d.total)}</option>)}
              <option value="">A plan, without a proforma</option>
            </select>
            {!off.orderId && <select aria-label="Plan paid for" className="input" style={inputStyle} value={off.planId} onChange={(e) => setOff({ ...off, planId: e.target.value })}><option value="drive">Drive</option><option value="campus">Campus</option>{b.customPlan && <option value="custom">Custom</option>}</select>}
            <select aria-label="Method" className="input" style={inputStyle} value={off.method} onChange={(e) => setOff({ ...off, method: e.target.value })}>{METHODS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
          </div>
          <div className="row g8" style={{ flexWrap: 'wrap' }}>
            <label className="small">Reference (UTR / cheque / PO no.) <input required minLength={3} maxLength={80} className="input" style={inputStyle} value={off.reference} onChange={(e) => setOff({ ...off, reference: e.target.value })} /></label>
            <label className="small">Received on <input type="date" required className="input" style={inputStyle} max={today()} value={off.paidOn} onChange={(e) => setOff({ ...off, paidOn: e.target.value })} /></label>
            <label className="small">Amount received ₹ (GST included) <input type="number" required min={1} step="0.01" className="input" style={{ ...inputStyle, width: 140 }} value={off.amount} onChange={(e) => setOff({ ...off, amount: e.target.value })} /></label>
          </div>
          <span className="xs muted">Only once the money is in the bank. The plan turns on now and the tax invoice is emailed to the Owner. The amount must match the order total.</span>
          <button type="submit" className="btn btn-ink" style={{ alignSelf: 'flex-start' }} disabled={busy}>Record payment</button>
        </form>
      )}
      {b.orders.length > 0 && (
        <div className="table-wrap"><table className="table">
          <thead><tr><th>Order</th><th>Plan</th><th>Amount</th><th>Status</th><th>Paid</th><th>Invoice</th><th /></tr></thead>
          <tbody>{b.orders.map((o) => <tr key={o.id}><td className="mono small">{o.id}</td><td>{o.planName}</td><td>{rupees(o.amount)}</td><td>{o.status}</td><td>{day(o.paidAt)}</td><td className="mono small">{o.invoiceNo || '—'}</td><td>{o.paidAt && o.status !== 'refunded' && <button type="button" className="link-btn small" onClick={() => setRf(rf?.orderId === o.id ? null : { orderId: o.id, amount: '', note: '', offline: '' })}>Refund</button>}</td></tr>)}</tbody>
        </table></div>
      )}
      {rf && (
        <form className="well stack g8" aria-label="Refund" onSubmit={(e) => { e.preventDefault(); if (!window.confirm('Send this refund? A credit note is issued and cannot be undone.')) return; run(async () => { await http(`/api/admin/orgs/${orgId}/billing/orders/${rf.orderId}/refund`, { method: 'POST', body: { amount: rf.amount ? Math.round(Number(rf.amount) * 100) : null, note: rf.note, offlineReference: rf.offline || null } }); setRf(null); again(); }, 'Refunded · credit note issued'); }}>
          <strong className="small">Refund order <span className="mono">{rf.orderId}</span></strong>
          <div className="row g8" style={{ flexWrap: 'wrap' }}>
            <label className="small">Amount ₹ (empty = all that’s left) <input type="number" min={1} step="0.01" className="input" style={{ ...inputStyle, width: 130 }} value={rf.amount} onChange={(e) => setRf({ ...rf, amount: e.target.value })} /></label>
            <label className="small" style={{ flex: '1 1 220px' }}>Reason (printed on the credit note) <input required minLength={3} maxLength={300} className="input" style={inputStyle} value={rf.note} onChange={(e) => setRf({ ...rf, note: e.target.value })} /></label>
            <label className="small">Bank reference, if paid offline <input minLength={3} maxLength={80} className="input" style={inputStyle} value={rf.offline} onChange={(e) => setRf({ ...rf, offline: e.target.value })} /></label>
          </div>
          <span className="xs muted">Razorpay payments are refunded through Razorpay; offline payments need the reference of the money you sent back. A full refund takes the plan back (Free, or the plan it renewed). The partner commission on it is reversed.</span>
          <button type="submit" className="btn btn-danger" style={{ alignSelf: 'flex-start' }} disabled={busy}>Refund</button>
        </form>
      )}
      <Loading st={docs}>{(d) => d.rows.length > 0 && (
        <div className="table-wrap"><table className="table" aria-label="Invoices and credit notes">
          <thead><tr><th>Document</th><th>Date</th><th>Taxable</th><th>Total</th><th /></tr></thead>
          <tbody>{d.rows.map((x) => <tr key={x.id}><td className="small"><span className="mono">{x.number}</span><div className="xs faint">{DOC_KIND[x.kind]}{x.against ? ` · against ${x.against}` : ''}</div></td><td className="small">{day(x.date)}</td><td className="small">{rupees(x.taxable)}</td><td className="small">{rupees(x.total)}</td><td><button type="button" className="link-btn small" disabled={busy} onClick={() => run(() => downloadFrom(`/api/admin/org-invoices/${x.id}/pdf`, x.fileName))}>PDF</button></td></tr>)}</tbody>
        </table></div>
      )}</Loading>
    </div>
  );
}

/** /admin/org-invoices — invoices and credit notes by financial year, with the GSTR-1-style register as CSV. */
export function LiveOrgInvoices() {
  const toast = useToast();
  const [fy, setFy] = useState('');
  const st = useApi(`/api/admin/org-invoices${fy ? `?fy=${fy}` : ''}`);
  const [busy, run] = useAction(toast);
  return (
    <>
      <PageHead title="Organization invoices" sub="Tax invoices and credit notes for organization plans, by financial year (April–March)." right={st.data && (
        <span className="row g8">
          <select aria-label="Financial year" className="input" style={inputStyle} value={st.data.fy} onChange={(e) => setFy(e.target.value)}>{st.data.years.map((y) => <option key={y} value={y}>FY 20{y.slice(0, 2)}–{y.slice(3)}</option>)}</select>
          <button type="button" className="btn btn-outline" disabled={busy} onClick={() => run(() => downloadFrom(`/api/admin/org-invoices/gstr1.csv?fy=${st.data.fy}`, `nm7-gstr1-${st.data.fy}.csv`), 'CSV downloaded')}>GSTR-1 CSV</button>
        </span>
      )} />
      <Loading st={st} empty={emptyIf((d) => d.rows.length === 0, 'No invoices in this financial year yet.')}>{(d) => (
        <div className="stack g12">
          <div className="kpis">
            <Kpi label="Invoices" value={d.totals.invoice.count} sub={`${rupees(d.totals.invoice.taxable)} taxable · ${rupees(d.totals.invoice.total)} with GST`} />
            <Kpi label="Credit notes" value={d.totals.credit_note.count} sub={`${rupees(d.totals.credit_note.taxable)} taxable · ${rupees(d.totals.credit_note.total)} with GST`} />
          </div>
          <div className="card table-wrap" style={{ padding: 0 }}>
            <table className="table"><thead><tr><th>Number</th><th>Date</th><th>Organization</th><th>Taxable</th><th>GST</th><th>Total</th><th /></tr></thead>
              <tbody>{d.rows.map((x) => (
                <tr key={x.id}><td className="small"><span className="mono">{x.number}</span><div className="xs faint">{DOC_KIND[x.kind]}{x.against ? ` · against ${x.against}` : ''}</div></td><td className="small">{day(x.date)}</td><td className="small"><Link to={`/admin/orgs/${x.orgId}`}>{x.recipient}</Link>{x.gstin ? <div className="xs faint mono">{x.gstin}</div> : null}</td><td className="small">{rupees(x.taxable)}</td><td className="small">{x.gstOn ? rupees(x.tax) : '—'}</td><td className="small">{rupees(x.total)}</td><td><button type="button" className="link-btn small" disabled={busy} onClick={() => run(() => downloadFrom(`/api/admin/org-invoices/${x.id}/pdf`, x.fileName))}>PDF</button></td></tr>
              ))}</tbody></table>
          </div>
        </div>
      )}</Loading>
    </>
  );
}

/** Dashboard card: organization revenue after refunds, active paid organizations, renewals due in 30 days. */
export function OrgRevenue({ days }) {
  const st = useApi(`/api/admin/billing/summary?days=${days}`);
  if (!st.data) return null;
  const s = st.data;
  return (
    <section className="stack g12" aria-label="Organizations">
      <div className="kpis">
        <Kpi label="Organization revenue (after refunds)" value={rupees(s.revenue)} sub={`${s.paidOrders} payment(s) · ${rupees(s.refunded)} refunded · GST included`} />
        <Kpi label="Active paid organizations" value={s.activePaidOrgs} sub={`${s.pendingCheckouts} checkout(s) waiting for payment`} />
      </div>
      <div className="card stack g8">
        <strong>Renewals due in the next 30 days</strong>
        {s.renewalsDue.length === 0 ? <span className="small muted">None.</span> : s.renewalsDue.map((r) => <span key={r.orgId} className="small row between"><span>{r.name} · {r.plan}</span><span className="muted">{day(r.endsOn)}</span></span>)}
      </div>
    </section>
  );
}
