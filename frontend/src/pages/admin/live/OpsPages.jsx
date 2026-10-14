// Live admin: dashboard, orders (with expert assignment), refunds, payments & invoices.
import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useToast } from '../../../components/ui';
import { PLANS } from '../../../lib/pricing';
import { Kpi, PageHead, Panel, Tabs } from '../AdminUI';
import { Loading, STATUS_LABEL, day, emptyIf, http, rupees, tone, useAction, useApi, when } from './common';

/* ---------- dashboard ---------- */
export function LiveDashboard() {
  const [days, setDays] = useState(30);
  const st = useApi(`/api/admin/stats?days=${days}`);
  return (
    <>
      <PageHead title="Dashboard" sub="Live numbers from the database." right={
        <select aria-label="Period" className="input" style={{ height: 40, width: 'auto' }} value={days} onChange={(e) => setDays(+e.target.value)}>
          <option value={1}>Today</option><option value={7}>Last 7 days</option><option value={30}>Last 30 days</option><option value={365}>Last 12 months</option>
        </select>} />
      <Loading st={st}>{(s) => (
        <>
          <div className="kpis">
            <Kpi label="Revenue (after refunds)" value={rupees(s.revenue)} sub={`${rupees(s.moneyIn)} in · ${rupees(s.refunded)} refunded`} />
            <Kpi label="Paid orders" value={s.ordersPaid} sub={Object.entries(s.ordersByPlan).map(([k, n]) => `${PLANS[k]?.name || k}: ${n}`).join(' · ') || 'none yet'} />
            <Kpi label="Verified customers" value={s.customers} sub={`all time, email confirmed · ${s.newCustomers} sign-up(s) in this period`} />
            <Kpi label="Experts approved" value={s.experts} sub={`${s.applicationsWaiting} application(s) waiting`} />
          </div>
          <section className="card stack g8" aria-label="Needs attention">
            <strong>Needs attention</strong>
            {[
              [s.lateOrders, 'order(s) past the deadline', '/admin/orders?late=1', 'var(--danger)'],
              [s.unassigned, 'paid order(s) without an expert', '/admin/orders?status=offer', 'var(--warning)'],
              [s.openOrders, 'open order(s) in progress', '/admin/orders'],
              [s.refundsInReview, 'refund request(s) to review', '/admin/refunds'],
              [s.ticketsOpen, 'open support ticket(s)', '/admin/customers?tab=tickets'],
              [s.applicationsWaiting, 'expert application(s) to review', '/admin/experts?tab=applications'],
            ].map(([n, text, to, color]) => (
              <Link key={text} to={to} className="row g8 small" style={{ color: n ? color || 'var(--text)' : 'var(--text3)' }}><strong>{n}</strong> {text}</Link>
            ))}
            {!s.ordersPaid && !s.openOrders && <span className="xs faint">No paid orders yet. They show here as soon as customers pay.</span>}
          </section>
        </>
      )}</Loading>
    </>
  );
}

/* ---------- orders ---------- */
const ORDER_FILTERS = [['', 'All'], ['offer', 'Finding expert'], ['in_progress', 'Writing'], ['waiting', 'With customer'], ['revision', 'Changes'], ['delivered', 'Delivered'], ['refunded', 'Refunded']];

export function LiveOrders() {
  const [params, setParams] = useSearchParams();
  const status = params.get('status') || '';
  const late = params.get('late') === '1';
  const [q, setQ] = useState(params.get('q') || '');
  const [open, setOpen] = useState(params.get('id') || null);
  const qs = new URLSearchParams({ ...(status ? { status } : {}), ...(late ? { late: 'true' } : {}), ...(params.get('q') ? { q: params.get('q') } : {}), limit: '100' });
  const st = useApi(`/api/admin/orders?${qs}`);
  const setFilter = (k, v) => { const p = new URLSearchParams(params); if (v) p.set(k, v); else p.delete(k); setParams(p); };
  return (
    <>
      <PageHead title="Orders" sub="Open orders first, closest deadline first." />
      <div className="row g8">
        <Tabs label="Status" tabs={ORDER_FILTERS} value={status} onChange={(v) => setFilter('status', v)} />
        <label className="row g4 small"><input type="checkbox" checked={late} onChange={(e) => setFilter('late', e.target.checked ? '1' : '')} />Late only</label>
        <form className="row g8" onSubmit={(e) => { e.preventDefault(); setFilter('q', q.trim()); }}>
          <label htmlFor="o-q" className="sr-only">Search orders</label>
          <input id="o-q" className="input" style={{ height: 40, width: 220 }} placeholder="Order no., name or email" value={q} onChange={(e) => setQ(e.target.value)} />
          <button type="submit" className="btn btn-outline" style={{ minHeight: 40 }}>Search</button>
        </form>
      </div>
      <div className="row g16" style={{ alignItems: 'flex-start' }}>
        <div style={{ flex: '3 1 480px', minWidth: 0 }}>
          <Loading st={st} empty={emptyIf((d) => !d.items.length, status || late || params.get('q') ? 'No orders match.' : 'No orders yet. Paid orders appear here.')}>{(d) => (
            <div className="card table-wrap" style={{ padding: 0 }}>
              <table className="table"><thead><tr><th>Order</th><th>Customer</th><th>Plan</th><th>Status</th><th>Deadline</th><th>Amount</th></tr></thead>
                <tbody>{d.items.map((o) => (
                  <tr key={o.id} onClick={() => setOpen(o.id)} style={{ cursor: 'pointer', background: open === o.id ? 'var(--sunken)' : undefined }}>
                    <td className="mono small"><button type="button" className="link-btn small" onClick={() => setOpen(o.id)}>{o.id}</button></td>
                    <td className="small">{o.customer.name}<div className="xs faint">{o.customer.email}</div></td>
                    <td className="small">{o.planName}</td>
                    <td><span className={`badge b-${o.late ? 'danger' : tone(o.status)}`}>{o.late ? 'Late' : STATUS_LABEL[o.status] || o.status}</span></td>
                    <td className="small">{o.hoursLeft == null ? '—' : o.hoursLeft < 0 ? `${Math.round(-o.hoursLeft)} h late` : `${Math.round(o.hoursLeft)} h left`}</td>
                    <td className="small">{rupees(o.amount)}</td>
                  </tr>
                ))}</tbody></table>
              <div className="xs faint" style={{ padding: 12 }}>{d.total} order(s)</div>
            </div>
          )}</Loading>
        </div>
        {open && <OrderPanel id={open} onClose={() => setOpen(null)} onChanged={st.reload} />}
      </div>
    </>
  );
}

function OrderPanel({ id, onClose, onChanged }) {
  const toast = useToast();
  const st = useApi(`/api/admin/orders/${encodeURIComponent(id)}`);
  const experts = useApi('/api/admin/experts?status=approved');
  const [busy, run] = useAction(toast);
  const [pick, setPick] = useState('');
  return (
    <Panel title={`Order ${id}`} onClose={onClose}>
      <Loading st={st}>{(o) => {
        const w = o.work;
        const canAssign = ['offer', 'in_progress'].includes(o.status) && o.plan !== 'diy';
        return (
          <div className="stack g12">
            <span className="small">{o.customer.name} · {o.customer.email}{o.customer.phone ? ` · ${o.customer.phone}` : ''}</span>
            <span className="small">{o.planName} · {rupees(o.amount)} · <span className={`badge b-${tone(o.status)}`}>{STATUS_LABEL[o.status] || o.status}</span></span>
            <span className="xs muted">Paid {when(o.paidAt)} · invoice {o.invoiceNo || '—'} · deadline {when(o.deadlineAt)}{o.deliveredAt ? ` · delivered ${when(o.deliveredAt)}` : ''}</span>
            {o.items.length > 1 && <span className="xs muted">Add-ons: {o.items.filter((i) => i.kind === 'addon').map((i) => i.name).join(', ')}</span>}
            {o.refunds.length > 0 && <span className="xs">Refunds: {o.refunds.map((r) => `${r.id} ${r.status} ${rupees(r.amount)}`).join(' · ')}</span>}
            {w && (
              <div className="well stack g4 small">
                <strong>Expert work</strong>
                <span>Expert: {w.expertName || 'not assigned'}{w.expertId && !w.accepted ? ` · offer until ${when(w.offerExpires)}` : w.accepted ? ` · accepted ${when(w.accepted)}` : ''}</span>
                <span>Intake: {w.intake?.target ? `done — ${w.intake.target}` : 'not filled in yet'}</span>
                <span>Drafts sent: {w.versions.filter((v) => v.sent).length} · messages: {w.messages.length}{w.rating ? ` · rated ${w.rating}★` : ''}</span>
              </div>
            )}
            {canAssign && (
              <form className="stack g8" onSubmit={(e) => { e.preventDefault(); run(async () => { await http(`/api/admin/orders/${encodeURIComponent(id)}/assign`, { method: 'POST', body: { expertId: pick || null } }); st.reload(); onChanged(); }, pick ? 'Offered to the expert' : 'Taken back from the expert'); }}>
                <label htmlFor="as-x" className="label">{w?.expertId ? 'Reassign to' : 'Offer to an expert'}</label>
                {experts.error ? <span className="xs muted">Your role can’t list experts.</span> : (
                  <select id="as-x" className="input" style={{ height: 42 }} value={pick} onChange={(e) => setPick(e.target.value)}>
                    <option value="">{w?.expertId ? 'Nobody (take it back)' : 'Choose…'}</option>
                    {(experts.data || []).filter((x) => !x.paused).map((x) => <option key={x.id} value={x.id}>{x.name} · {x.domains.join(', ') || 'no domains'} · {x.orders} active</option>)}
                  </select>
                )}
                {!experts.loading && !experts.error && !(experts.data || []).length && <span className="xs muted">No approved experts yet — approve one under Experts.</span>}
                <button type="submit" className="btn btn-ink" style={{ alignSelf: 'flex-start' }} disabled={busy || (!pick && !w?.expertId)}>{pick ? 'Offer order' : 'Take back'}</button>
              </form>
            )}
          </div>
        );
      }}</Loading>
    </Panel>
  );
}

/* ---------- refunds ---------- */
export function LiveRefunds() {
  const toast = useToast();
  const [status, setStatus] = useState('review');
  const st = useApi(`/api/admin/refunds?limit=200${status ? `&status=${status}` : ''}`);
  const [busy, run] = useAction(toast);
  const [note, setNote] = useState({});
  const [amount, setAmount] = useState({});
  return (
    <>
      <PageHead title="Refunds & disputes" sub="Late deliveries and cancellations refund automatically. Quality and other requests wait for a decision here (24-hour rule)." />
      <Tabs label="Refund status" tabs={[['review', 'To review'], ['approved', 'Approved'], ['processed', 'Paid back'], ['rejected', 'Rejected'], ['', 'All']]} value={status} onChange={setStatus} />
      <Loading st={st} empty={emptyIf((d) => !d.items.length, status === 'review' ? 'No refund requests waiting.' : 'No refunds here.')}>{(d) => (
        <div className="stack g12">{d.items.map((r) => (
          <section key={r.id} className="card stack g8" aria-label={r.id}>
            <span className="row between g8"><strong>{r.id} · order {r.orderId}</strong><span className={`badge b-${r.status === 'review' ? 'warning' : r.status === 'rejected' ? 'neutral' : 'success'}`}>{r.status}</span></span>
            <span className="small">{r.customer.name} · {r.customer.email} · asked {when(r.createdAt)} · {rupees(r.amount)} of {rupees(r.orderAmount)}</span>
            <span className="small"><strong>Reason:</strong> {r.reason}{r.details ? ` — ${r.details}` : ''}</span>
            {r.decisionNote && <span className="small muted">Note: {r.decisionNote}</span>}
            {r.error && <span className="small" style={{ color: 'var(--danger)' }}>Payment provider: {r.error}</span>}
            {r.status === 'review' && (
              <div className="row g8" style={{ alignItems: 'flex-end' }}>
                <div className="field"><label className="label" htmlFor={`am-${r.id}`}>Amount (₹, empty = full)</label><input id={`am-${r.id}`} className="input" inputMode="numeric" style={{ height: 40, width: 140 }} value={amount[r.id] || ''} onChange={(e) => setAmount({ ...amount, [r.id]: e.target.value.replace(/\D/g, '') })} /></div>
                <div className="field" style={{ flex: '1 1 200px' }}><label className="label" htmlFor={`nt-${r.id}`}>Note to the customer</label><input id={`nt-${r.id}`} className="input" style={{ height: 40 }} value={note[r.id] || ''} onChange={(e) => setNote({ ...note, [r.id]: e.target.value })} /></div>
                <button type="button" className="btn btn-ink" disabled={busy} onClick={() => run(async () => { await http(`/api/admin/refunds/${r.id}/approve`, { method: 'POST', body: { amount: amount[r.id] ? Number(amount[r.id]) * 100 : null, note: note[r.id] || null } }); st.reload(); }, 'Refund approved')}>Approve</button>
                <button type="button" className="btn btn-outline" disabled={busy || (note[r.id] || '').trim().length < 5} title="Write a note (5+ characters) first" onClick={() => run(async () => { await http(`/api/admin/refunds/${r.id}/reject`, { method: 'POST', body: { note: note[r.id] } }); st.reload(); }, 'Refund rejected')}>Reject</button>
              </div>
            )}
          </section>
        ))}</div>
      )}</Loading>
    </>
  );
}

/* ---------- payments & invoices ---------- */
export function LivePayments() {
  const [params, setParams] = useSearchParams();
  const tab = params.get('tab') || 'payments';
  const pays = useApi(tab === 'payments' ? '/api/admin/payments?limit=200' : null);
  const invoices = useApi(tab === 'invoices' ? '/api/admin/invoices?limit=500' : null);
  return (
    <>
      <PageHead title="Payments & invoices" sub="Every Razorpay payment and every GST invoice number." />
      <Tabs label="View" tabs={[['payments', 'Payments'], ['invoices', 'Invoices'], ['payouts', 'Expert payouts']]} value={tab} onChange={(v) => setParams({ tab: v })} />
      {tab === 'payments' && (
        <Loading st={pays} empty={emptyIf((d) => !d.items.length, 'No payments yet. Online payments are switched off until the Razorpay keys are added.')}>{(d) => (
          <div className="card table-wrap" style={{ padding: 0 }}>
            <table className="table"><thead><tr><th>When</th><th>Order</th><th>Customer</th><th>Amount</th><th>Method</th><th>Status</th></tr></thead>
              <tbody>{d.items.map((p) => (
                <tr key={p.id}><td className="small">{when(p.createdAt)}</td><td className="mono small">{p.orderId || <span style={{ color: 'var(--danger)' }}>no order</span>}</td><td className="small">{p.customerName || '—'}</td><td className="small">{rupees(p.amount)}</td><td className="small">{p.method || '—'}</td><td><span className={`badge b-${p.status === 'captured' ? 'success' : p.status === 'failed' ? 'danger' : 'neutral'}`}>{p.status}</span><div className="xs faint mono">{p.razorpayPaymentId || ''}</div></td></tr>
              ))}</tbody></table>
          </div>
        )}</Loading>
      )}
      {tab === 'invoices' && (
        <Loading st={invoices} empty={emptyIf((d) => !d.items.length, 'No invoices yet. An invoice number is given when a payment succeeds.')}>{(d) => (
          <div className="card table-wrap" style={{ padding: 0 }}>
            <table className="table"><thead><tr><th>Invoice</th><th>Date</th><th>Order</th><th>Customer</th><th>Amount</th><th>Status</th></tr></thead>
              <tbody>{d.items.map((v) => <tr key={v.invoiceNo}><td className="mono small">{v.invoiceNo}</td><td className="small">{day(v.paidAt)}</td><td className="mono small">{v.orderId}</td><td className="small">{v.customer}<div className="xs faint">{v.email}</div></td><td className="small">{rupees(v.amount)}</td><td className="small">{STATUS_LABEL[v.status] || v.status}</td></tr>)}</tbody></table>
            <div className="xs faint" style={{ padding: 12 }}>{d.total} invoice(s). Prices include GST.</div>
          </div>
        )}</Loading>
      )}
      {tab === 'payouts' && <div className="well small muted" style={{ padding: 24 }}>No expert payouts yet. Payouts are paid by bank/UPI transfer after delivered orders are approved; they will be listed here once experts start completing orders.</div>}
    </>
  );
}
