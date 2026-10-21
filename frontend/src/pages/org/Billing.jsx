// /org/:orgId/billing — the Owner's page: plan and usage, upgrade / renew (Razorpay), billing details for the
// invoice, and every payment. The browser never decides an amount: it asks the server for a quote and a Razorpay
// order, and the plan turns on only when Razorpay's verified webhook reaches the server — this page then waits for it.
import { useEffect, useRef, useState } from 'react';
import { Spinner, useToast } from '../../components/ui';
import { LIMITS, PLAN_FEATURES, gstinProblem, limitText, periodText, rupees, usagePct } from '../../lib/orgBilling';
import { pay } from '../../services/api';
import { http } from '../../services/http';
import { Loading, day, useApi } from '../admin/live/common';

const STATE = { free: ['Free', 'b-neutral'], active: ['Active', 'b-success'], grace: ['Ended — grace period', 'b-warning'], expired: ['Ended', 'b-neutral'] };
const ORDER_STATUS = { done: 'Paid', pending_payment: 'Waiting for payment', expired: 'Not paid', refunded: 'Refunded', cancelled: 'Cancelled' };

function Usage({ s }) {
  return (
    <div className="stack g8">
      {LIMITS.map(([k, label]) => {
        const pct = usagePct(s.usage[k], s.limits[k]);
        return (
          <div key={k} className="stack g4">
            <span className="row between small"><span>{label}</span><span className="muted">{s.usage[k].toLocaleString('en-IN')} / {limitText(s.limits[k])}</span></span>
            {pct !== null && <div role="meter" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} style={{ height: 6, background: 'var(--sunken)', borderRadius: 4 }}><div style={{ width: `${pct}%`, height: 6, borderRadius: 4, background: pct >= 100 ? 'var(--danger)' : pct >= 80 ? 'var(--warning)' : 'var(--text)' }} /></div>}
          </div>
        );
      })}
    </div>
  );
}

function Details({ data, onSaved }) {
  const toast = useToast();
  const d = data.details || {};
  const [f, setF] = useState({ legalName: d.legalName || data.orgName, address: d.address || '', stateCode: d.stateCode || '', gstin: d.gstin || '', email: d.email || '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const gstErr = gstinProblem(f.gstin, f.stateCode);
  const save = async (e) => {
    e.preventDefault();
    if (gstErr) { setError(gstErr); return; }
    setBusy(true); setError('');
    try { await http(`/api/org/${data.orgId}/billing/details`, { method: 'PUT', body: { ...f, gstin: f.gstin.trim().toUpperCase() } }); toast('Billing details saved'); onSaved(); } catch (err) { setError(err.message); } finally { setBusy(false); }
  };
  return (
    <form className="card stack g12" onSubmit={save} aria-label="Billing details">
      <strong>Billing details</strong>
      <span className="xs muted">Printed on your invoices. The state decides how GST is charged.</span>
      <div className="field"><label className="label" htmlFor="bd-n">Legal name</label><input id="bd-n" className="input" required minLength={2} maxLength={150} value={f.legalName} onChange={(e) => setF({ ...f, legalName: e.target.value })} /></div>
      <div className="field"><label className="label" htmlFor="bd-a">Address (with PIN code)</label><textarea id="bd-a" className="input" rows={2} required minLength={5} maxLength={400} value={f.address} onChange={(e) => setF({ ...f, address: e.target.value })} /></div>
      <div className="row g12" style={{ flexWrap: 'wrap' }}>
        <div className="field" style={{ flex: '1 1 200px' }}><label className="label" htmlFor="bd-s">State</label><select id="bd-s" className="input" required value={f.stateCode} onChange={(e) => setF({ ...f, stateCode: e.target.value })}><option value="">Choose…</option>{data.states.map((s) => <option key={s.code} value={s.code}>{s.name}</option>)}</select></div>
        <div className="field" style={{ flex: '1 1 200px' }}><label className="label" htmlFor="bd-g">GSTIN (optional)</label><input id="bd-g" className="input mono" maxLength={15} value={f.gstin} aria-invalid={!!gstErr} onChange={(e) => setF({ ...f, gstin: e.target.value.toUpperCase() })} />{gstErr && <span className="xs" style={{ color: 'var(--danger)' }}>{gstErr}</span>}</div>
      </div>
      <div className="field"><label className="label" htmlFor="bd-e">Send invoices to (optional)</label><input id="bd-e" type="email" className="input" maxLength={200} value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} /></div>
      <button type="submit" className="btn btn-outline" style={{ alignSelf: 'flex-start' }} disabled={busy}>{busy ? 'Saving…' : 'Save details'}</button>
      {error && <p className="small" role="alert" style={{ color: 'var(--danger)' }}>{error}</p>}
    </form>
  );
}

function Buy({ data, plan, onPaid }) {
  const [q, setQ] = useState(null);
  const [st, setSt] = useState({});
  const s = data.summary;
  const renew = s.planId === plan.id && (s.state === 'active' || s.state === 'grace');
  const open = async () => {
    setSt({ busy: true });
    try { setQ(await http(`/api/org/${data.orgId}/billing/quote?plan=${plan.id}`)); setSt({}); } catch (err) { setSt({ error: err.message }); }
  };
  const go = async () => {
    setSt({ busy: true });
    try {
      const order = await http(`/api/org/${data.orgId}/billing/checkout`, { method: 'POST', body: { planId: plan.id } });
      await pay(order);
      setSt({ waiting: true });
      onPaid(order.orderId);
    } catch (err) { setSt(err.code === 'dismissed' ? {} : { error: err.message }); }
  };
  return (
    <section className="card stack g8" style={{ flex: '1 1 260px' }} aria-label={`Buy ${plan.name}`}>
      <span className="row between"><strong>{plan.name}</strong><span className="small"><strong>{rupees(plan.price)}</strong> <span className="muted">{periodText(plan)}{data.gstOn ? ' + GST' : ''}</span></span></span>
      <span className="xs muted">{LIMITS.map(([k, , words]) => `${limitText(plan.limits[k])} ${words}`).join(' · ')}</span>
      <span className="xs muted">{PLAN_FEATURES.filter(([k]) => plan.features[k]).map(([, l]) => l).join(' · ')}</span>
      {!q ? (
        <button type="button" className="btn btn-ink" style={{ alignSelf: 'flex-start' }} disabled={st.busy || !data.details} onClick={open}>{renew ? 'Renew' : s.planId === 'free' ? 'Upgrade' : 'Switch to this plan'}</button>
      ) : (
        <div className="stack g4 well small">
          <span className="row between"><span>{q.planName} plan</span><span>{rupees(q.listPrice)}</span></span>
          {q.discount > 0 && <span className="row between"><span>{q.discountLabel || 'Discount'}</span><span>−{rupees(q.discount)}</span></span>}
          {q.taxLines.map((t) => <span key={t.label} className="row between"><span>{t.label} {t.ratePct}%</span><span>{rupees(t.amount)}</span></span>)}
          <span className="row between" style={{ fontWeight: 700 }}><span>Total</span><span>{rupees(q.total)}</span></span>
          <div className="row g8" style={{ marginTop: 6 }}>
            <button type="button" className="btn btn-ink" disabled={st.busy || st.waiting} onClick={go}>{st.busy ? 'Opening…' : `Pay ${rupees(q.total)}`}</button>
            <button type="button" className="btn btn-outline" onClick={() => setQ(null)}>Cancel</button>
          </div>
          {renew && <span className="xs muted">Renewing continues from the day after your current plan ends.</span>}
          {!renew && s.state === 'active' && <span className="xs muted">A new plan starts today and replaces the current one.</span>}
        </div>
      )}
      {!data.details && <span className="xs muted">Add your billing details below first.</span>}
      {st.error && <p className="small" role="alert" style={{ color: 'var(--danger)' }}>{st.error}</p>}
    </section>
  );
}

/** After paying: wait for Razorpay's webhook to reach the server (usually a few seconds). */
function useWaitForPayment(reload) {
  const [waiting, setWaiting] = useState(null);
  const timer = useRef(null);
  useEffect(() => () => clearInterval(timer.current), []);
  const start = (orderId) => {
    const since = Date.now();
    setWaiting({ orderId });
    clearInterval(timer.current);
    timer.current = setInterval(async () => {
      const d = await reload().catch(() => null);
      const paid = d?.orders?.find((o) => o.id === orderId && o.status === 'done');
      if (paid) { clearInterval(timer.current); setWaiting(null); } else if (Date.now() - since > 3 * 60_000) { clearInterval(timer.current); setWaiting({ orderId, slow: true }); }
    }, 3000);
  };
  return [waiting, start];
}

export default function Billing({ orgId }) {
  const st = useApi(`/api/org/${orgId}/billing`);
  const reload = async () => { const d = await http(`/api/org/${orgId}/billing`); st.reload(); return d; };
  const [waiting, startWaiting] = useWaitForPayment(reload);
  return (
    <Loading st={st}>{(data) => {
      const s = data.summary;
      const [label, cls] = STATE[s.state] || STATE.free;
      return (
        <div className="stack g16">
          {data.testMode && <div className="well small" role="note">Payments are in <strong>test mode</strong>: no real money is taken yet.</div>}
          {waiting && <div className="well small row g8" role="status">{waiting.slow ? 'Payment received by Razorpay — confirmation is taking longer than usual. This page updates on its own; you’ll also get an email.' : <><Spinner /> Payment done — waiting for Razorpay to confirm it…</>}</div>}
          <section className="card stack g12" aria-label="Your plan">
            <span className="row between g8" style={{ flexWrap: 'wrap' }}>
              <strong style={{ fontSize: 20 }}>{s.planName} plan</strong>
              <span className={`badge ${cls}`}>{label}</span>
            </span>
            {s.state !== 'free' && <span className="small muted">{day(s.startsOn)} – {day(s.endsOn)}{s.state === 'grace' ? ` · works until ${day(s.graceUntil)}` : ''}{s.daysLeft !== null && s.state === 'active' ? ` · ${s.daysLeft} day${s.daysLeft === 1 ? '' : 's'} left` : ''}</span>}
            <Usage s={s} />
            {data.discountPct > 0 && <span className="xs muted">Your organization has a {data.discountPct}% discount on plans.</span>}
          </section>
          <section className="stack g8" aria-label="Plans">
            <strong>{s.state === 'free' ? 'Upgrade' : 'Renew or change plan'}</strong>
            <div className="row g12" style={{ flexWrap: 'wrap', alignItems: 'stretch' }}>
              {data.plans.map((p) => <Buy key={p.id} data={data} plan={p} onPaid={startWaiting} />)}
            </div>
            <span className="xs muted">{data.gstOn ? `GST (${data.gstRatePct}%) is added at checkout. ` : ''}Paying by bank transfer or purchase order? Use “Talk to us” on nm7.si/for-orgs and we’ll send a proforma invoice.</span>
          </section>
          <Details data={data} onSaved={st.reload} />
          <section className="card stack g8" aria-label="Payments">
            <strong>Payments</strong>
            {data.orders.length === 0 ? <span className="small muted">No payments yet.</span> : (
              <div className="table-wrap"><table className="table">
                <thead><tr><th>Date</th><th>Plan</th><th>Amount</th><th>Status</th><th>Invoice</th></tr></thead>
                <tbody>{data.orders.map((o) => (
                  <tr key={o.id}><td>{day(o.paidAt || o.createdAt)}</td><td>{o.planName}</td><td>{rupees(o.amount)}</td><td>{ORDER_STATUS[o.status] || o.status}</td><td className="mono small">{o.invoiceNo || '—'}</td></tr>
                ))}</tbody>
              </table></div>
            )}
          </section>
        </div>
      );
    }}</Loading>
  );
}
