// /org/:orgId/billing — the Owner's page: plan and usage, upgrade / renew (Razorpay), billing details for the
// invoice, and every payment. The browser never decides an amount: it asks the server for a quote and a Razorpay
// order, and the plan turns on only when Razorpay's verified webhook reaches the server — this page then waits for it.
import { useEffect, useRef, useState } from 'react';
import { Spinner, useToast } from '../../components/ui';
import { LIMITS, PLAN_FEATURES, gstinProblem, limitText, periodText, rupees, usagePct } from '../../lib/orgBilling';
import { downloadFrom } from '../../lib/fileDownload';
import { pay } from '../../services/api';
import { http } from '../../services/http';
import { BUY_WA, WA_PAY_TEXT, WA_SAFETY, WA_WAITING, buyOnWhatsApp } from '../../lib/waPay';
import { Loading, day, useAction, useApi } from '../admin/live/common';
import CodeBox from '../../components/CodeBox';
import { Chip, FieldGroup } from '../me/kit';
import '../../styles/me-kit.css';
import '../../styles/org-signup.css';

const STATE = { free: ['Free', 'neutral'], active: ['Active', 'ok'], grace: ['Ended — grace period', 'warn'], expired: ['Ended', 'neutral'] };
const ORDER_TONE = { done: 'ok', pending_payment: 'warn', awaiting_payment: 'warn', expired: 'neutral', refunded: 'info', cancelled: 'neutral' };
const ORDER_STATUS = { done: 'Paid', pending_payment: 'Waiting for payment', awaiting_payment: WA_WAITING, expired: 'Not paid', refunded: 'Refunded', cancelled: 'Cancelled' };

function Usage({ s }) {
  return (
    <div className="ob-usage">
      {LIMITS.map(([k, label]) => {
        const pct = usagePct(s.usage[k], s.limits[k]);
        const tone = pct === null ? '' : pct >= 100 ? 'bad' : pct >= 80 ? 'warn' : 'ok';
        return (
          <div key={k} className={`ob-use ${tone ? `ob-use-${tone}` : ''}`}>
            <span className="ob-use-l">{label}</span>
            <span className="ob-use-n"><strong>{s.usage[k].toLocaleString('en-IN')}</strong> <span className="muted">/ {limitText(s.limits[k])}</span></span>
            {pct !== null && <div role="meter" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} className="ob-meter"><div style={{ width: `${pct}%` }} /></div>}
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
    <form className="mcard ob-details" onSubmit={save} aria-label="Billing details">
      <header className="mcard-h"><span className="mcard-ic" aria-hidden="true">✎</span><span className="mcard-ht"><strong className="mcard-title">Billing details</strong><span className="mcard-sub">Printed on your invoices. The state decides how GST is charged.</span></span></header>
      <FieldGroup>
        <div className="field full"><label className="label" htmlFor="bd-n">Legal name</label><input id="bd-n" className="input" required minLength={2} maxLength={150} value={f.legalName} onChange={(e) => setF({ ...f, legalName: e.target.value })} /></div>
        <div className="field full"><label className="label" htmlFor="bd-a">Address (with PIN code)</label><textarea id="bd-a" className="input" rows={2} required minLength={5} maxLength={400} value={f.address} onChange={(e) => setF({ ...f, address: e.target.value })} /></div>
        <div className="field"><label className="label" htmlFor="bd-s">State</label><select id="bd-s" className="input" required value={f.stateCode} onChange={(e) => setF({ ...f, stateCode: e.target.value })}><option value="">Choose…</option>{data.states.map((s) => <option key={s.code} value={s.code}>{s.name}</option>)}</select></div>
        <div className="field"><label className="label" htmlFor="bd-g">GSTIN (optional)</label><input id="bd-g" className="input mono" maxLength={15} value={f.gstin} aria-invalid={!!gstErr} onChange={(e) => setF({ ...f, gstin: e.target.value.toUpperCase() })} />{gstErr && <span className="xs" style={{ color: 'var(--danger)' }}>{gstErr}</span>}</div>
        <div className="field full"><label className="label" htmlFor="bd-e">Send invoices to (optional)</label><input id="bd-e" type="email" className="input" maxLength={200} value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} /></div>
      </FieldGroup>
      <button type="submit" className="btn btn-signal" style={{ alignSelf: 'flex-start' }} disabled={busy}>{busy ? 'Saving…' : 'Save details'}</button>
      {error && <p className="small" role="alert" style={{ color: 'var(--danger)' }}>{error}</p>}
    </form>
  );
}

function Buy({ data, plan, onPaid, onOrdered, refCode }) {
  const [q, setQ] = useState(null);
  const [st, setSt] = useState({});
  const [code, setCode] = useState(null); // typed partner code; null = the remembered one (partner link)
  const [coupon, setCoupon] = useState(''); // a code from Admin → Codes, applied (instead of a partner discount)
  const s = data.summary;
  const renew = s.planId === plan.id && (s.state === 'active' || s.state === 'grace');
  const firstPayment = !data.orders.some((o) => o.paidAt);
  const typed = (code ?? '').trim();
  const quoteUrl = (ref, c) => `/api/org/${data.orgId}/billing/quote?plan=${plan.id}${ref ? `&ref=${encodeURIComponent(ref)}` : ''}${c ? `&code=${encodeURIComponent(c)}` : ''}`;
  const quote = async (ref) => {
    setSt({ busy: true });
    try { setQ(await http(quoteUrl(ref, coupon))); setSt({}); } catch (err) { setSt({ error: err.message }); }
  };
  const canCode = plan.id === 'drive' || plan.id === 'campus';
  // the code field: a free code turns the plan on now; a discount re-prices the quote and goes with the order
  const applyCode = async (c) => {
    const nq = await http(quoteUrl(null, c));
    if (nq.free) {
      const r = await http(`/api/org/${data.orgId}/billing/code`, { method: 'POST', body: { planId: plan.id, code: c } });
      return r;
    }
    setQ(nq); setCoupon(c);
    return { unlocked: false, code: nq.code, text: nq.codeText };
  };
  const dropCode = async (applied) => {
    if (applied) return;
    setCoupon('');
    try { setQ(await http(quoteUrl(typed, ''))); } catch { /* keep the old quote */ }
  };
  const open = () => quote(typed);
  const mode = data.paymentMode || 'razorpay';
  const go = async () => {
    setSt({ busy: true });
    if (mode === 'whatsapp') {
      try { await buyOnWhatsApp({ planId: plan.id, refCode: coupon ? null : typed || null, code: coupon || null }, `/api/org/${data.orgId}/billing/whatsapp`, { orderLink: false }); setSt({}); setQ(null); onOrdered(); } catch (err) { setSt({ error: err.message }); }
      return;
    }
    try {
      const order = await http(`/api/org/${data.orgId}/billing/checkout`, { method: 'POST', body: { planId: plan.id, refCode: coupon ? null : typed || null, code: coupon || null } });
      await pay(order);
      setSt({ waiting: true });
      onPaid(order.orderId);
    } catch (err) { setSt(err.code === 'dismissed' ? {} : { error: err.message }); }
  };
  return (
    <section className={`ob-buy ${s.planId === plan.id ? 'ob-buy-current' : ''}`} aria-label={`Buy ${plan.name}`}>
      <span className="ob-buy-top">
        <strong className="ob-buy-name">{plan.name}</strong>
        {s.planId === plan.id && <Chip tone="accent">Your plan</Chip>}
      </span>
      <span className="ob-buy-price"><strong>{rupees(plan.price)}</strong> <span className="muted small">{periodText(plan)}{data.gstOn ? ' + GST' : ''}</span></span>
      <ul className="ob-buy-limits">{LIMITS.map(([k, , words]) => <li key={k}><strong>{limitText(plan.limits[k])}</strong> {words}</li>)}</ul>
      <ul className="mplan-feat ob-buy-feats">{PLAN_FEATURES.filter(([k]) => plan.features[k]).map(([k, l]) => <li key={k}>{l}</li>)}</ul>
      {!q ? (
        <button type="button" className="btn btn-signal ob-buy-go" disabled={st.busy || !data.details} onClick={open}>{renew ? 'Renew' : s.planId === 'free' ? 'Upgrade' : 'Switch to this plan'}</button>
      ) : (
        <div className="stack g4 small ob-quote">
          <span className="row between"><span>{q.planName} plan</span><span>{rupees(q.listPrice)}</span></span>
          {q.discount > 0 && <span className="row between"><span>{q.discountLabel || 'Discount'}</span><span>−{rupees(q.discount)}</span></span>}
          {q.codeDiscount > 0 && <span className="row between"><span>Code {q.code}</span><span>−{rupees(q.codeDiscount)}</span></span>}
          {q.taxLines.map((t) => <span key={t.label} className="row between"><span>{t.label} {t.ratePct}%</span><span>{rupees(t.amount)}</span></span>)}
          <span className="row between" style={{ fontWeight: 700 }}><span>Total</span><span>{rupees(q.total)}</span></span>
          {canCode && <CodeBox apply={applyCode} onApplied={dropCode} disabled={st.busy || st.waiting} onUnlocked={() => { setQ(null); onOrdered(); }} />}
          {firstPayment && !coupon && (
            <form className="row g8" style={{ alignItems: 'flex-end', flexWrap: 'wrap' }} onSubmit={(e) => { e.preventDefault(); quote(typed); }}>
              <label className="xs muted" style={{ flex: '1 1 140px' }}>Partner code (optional)
                <input className="input mono" style={{ height: 34 }} maxLength={16} value={code ?? q.partnerCode ?? refCode ?? ''} placeholder="ASX-…" onChange={(e) => setCode(e.target.value.toUpperCase())} />
              </label>
              <button type="submit" className="btn btn-outline btn-sm" disabled={st.busy}>Apply</button>
            </form>
          )}
          {q.partnerCode && <span className="xs muted">Referred by partner <span className="mono">{q.partnerCode}</span>.</span>}
          <div className="row g8" style={{ marginTop: 6 }}>
            {mode === 'off' ? <button type="button" className="btn btn-outline" disabled data-testid="org-pay-soon">Coming soon</button>
              : <button type="button" className="btn btn-signal" disabled={st.busy || st.waiting} onClick={go}>{st.busy ? 'Opening…' : mode === 'whatsapp' ? `${BUY_WA} · ${rupees(q.total)}` : `Pay ${rupees(q.total)}`}</button>}
            <button type="button" className="btn btn-outline" onClick={() => setQ(null)}>Cancel</button>
          </div>
          {mode === 'whatsapp' && <span className="xs muted">{WA_PAY_TEXT} {WA_SAFETY}</span>}
          {mode === 'off' && <span className="xs muted">Online payment opens soon. To buy now, use “Talk to us” on nm7.si/for-orgs.</span>}
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

const DOC_KIND = { invoice: 'Tax invoice', credit_note: 'Credit note', proforma: 'Proforma' };

/** Billing → Invoices: every invoice, credit note and proforma of this organization, to download as PDF. */
function Invoices({ orgId }) {
  const toast = useToast();
  const st = useApi(`/api/org/${orgId}/billing/invoices`);
  const [busy, run] = useAction(toast);
  return (
    <section className="mcard" aria-label="Invoices">
      <header className="mcard-h"><span className="mcard-ic" aria-hidden="true">⎙</span><span className="mcard-ht"><strong className="mcard-title">Invoices</strong><span className="mcard-sub">Every invoice, credit note and proforma, as a PDF.</span></span></header>
      <Loading st={st}>{(rows) => rows.length === 0 ? <span className="ob-empty small muted">Your invoices appear here after a payment.</span> : (
        <div className="table-wrap mtable-wrap" tabIndex={0} role="region" aria-label="Table — scroll sideways to see all columns"><table className="table mtable ob-table">
          <thead><tr><th>Number</th><th>Date</th><th>Type</th><th>Amount</th><th /></tr></thead>
          <tbody>{rows.map((d) => (
            <tr key={d.id}>
              <td className="mono small" data-label="Number"><span>{d.number}{d.against ? <span className="xs faint ob-against">against {d.against}</span> : null}</span></td>
              <td className="small" data-label="Date">{day(d.date)}</td>
              <td className="small" data-label="Type">{d.kind === 'invoice' && !d.gstOn ? 'Invoice' : DOC_KIND[d.kind]}</td>
              <td className="small ob-amt" data-label="Amount">{d.kind === 'credit_note' ? '−' : ''}{rupees(d.total)}</td>
              <td><button type="button" className="btn btn-outline btn-sm ob-dl" disabled={busy} aria-label={`Download ${d.number}`} onClick={() => run(() => downloadFrom(`/api/org/${orgId}/billing/invoices/${d.id}/pdf`, d.fileName))}><span aria-hidden="true">⤓ </span>Download PDF</button></td>
            </tr>
          ))}</tbody>
        </table></div>
      )}</Loading>
    </section>
  );
}

export default function Billing({ orgId }) {
  const st = useApi(`/api/org/${orgId}/billing`);
  const reload = async () => { const d = await http(`/api/org/${orgId}/billing`); st.reload(); return d; };
  const [waiting, startWaiting] = useWaitForPayment(reload);
  const [refCode, setRefCode] = useState(null);
  useEffect(() => { http('/api/public/referral').then((r) => setRefCode(r.code), () => {}); }, []);
  return (
    <Loading st={st}>{(data) => {
      const s = data.summary;
      const [label, tone] = STATE[s.state] || STATE.free;
      return (
        <div className="stack g16 ob-page">
          {data.testMode && <div className="ob-note ob-note-warn small" role="note"><span aria-hidden="true">⚠ </span>Payments are in <strong>test mode</strong>: no real money is taken yet.</div>}
          {waiting && <div className="ob-note small row g8" role="status">{waiting.slow ? 'Payment received by Razorpay — confirmation is taking longer than usual. This page updates on its own; you’ll also get an email.' : <><Spinner /> Payment done — waiting for Razorpay to confirm it…</>}</div>}
          <section className={`mcard ob-plan ob-plan-${s.state}`} aria-label="Your plan">
            <div className="ob-plan-top">
              <span className="ob-plan-ic" aria-hidden="true">₹</span>
              <span className="stack g4" style={{ minWidth: 0 }}>
                <span className="mkicker">Your plan</span>
                <strong className="ob-plan-name">{s.planName} plan</strong>
                {s.state !== 'free' && <span className="small muted">{day(s.startsOn)} – {day(s.endsOn)}{s.state === 'grace' ? ` · works until ${day(s.graceUntil)}` : ''}{s.daysLeft !== null && s.state === 'active' ? ` · ${s.daysLeft} day${s.daysLeft === 1 ? '' : 's'} left` : ''}</span>}
              </span>
              <Chip tone={tone}>{label}</Chip>
            </div>
            <Usage s={s} />
            {data.discountPct > 0 && <span className="xs ob-discount">Your organization has a {data.discountPct}% discount on plans.</span>}
          </section>
          <section className="stack g12" aria-label="Plans">
            <strong className="ob-h">{s.state === 'free' ? 'Upgrade' : 'Renew or change plan'}</strong>
            <div className="ob-plans">
              {data.plans.map((p) => <Buy key={p.id} data={data} plan={p} onPaid={startWaiting} onOrdered={st.reload} refCode={refCode} />)}
            </div>
            <span className="xs muted">{data.gstOn ? `GST (${data.gstRatePct}%) is added at checkout. ` : ''}Paying by bank transfer or purchase order? Use “Talk to us” on nm7.si/for-orgs and we’ll send a proforma invoice.</span>
          </section>
          <div className="ob-two">
            <Details data={data} onSaved={st.reload} />
            <section className="mcard" aria-label="Payments">
              <header className="mcard-h"><span className="mcard-ic" aria-hidden="true">✓</span><span className="mcard-ht"><strong className="mcard-title">Payments</strong></span></header>
              {data.orders.length === 0 ? <span className="ob-empty small muted">No payments yet.</span> : (
                <div className="table-wrap mtable-wrap" tabIndex={0} role="region" aria-label="Table — scroll sideways to see all columns"><table className="table mtable ob-table">
                  <thead><tr><th>Date</th><th>Plan</th><th>Amount</th><th>Status</th><th>Invoice</th></tr></thead>
                  <tbody>{data.orders.map((o) => (
                    <tr key={o.id}><td data-label="Date">{day(o.paidAt || o.createdAt)}</td><td data-label="Plan">{o.planName}</td><td data-label="Amount" className="ob-amt">{rupees(o.amount)}</td><td data-label="Status"><Chip tone={ORDER_TONE[o.status] || 'neutral'}>{ORDER_STATUS[o.status] || o.status}</Chip></td><td data-label="Invoice" className="mono small">{o.invoiceNo || '—'}</td></tr>
                  ))}</tbody>
                </table></div>
              )}
            </section>
          </div>
          <Invoices key={data.orders.filter((o) => o.invoiceNo).length} orgId={orgId} />
        </div>
      );
    }}</Loading>
  );
}
