// Live admin: dashboard, orders (with expert assignment), refunds, payments & invoices.
import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useToast } from '../../../components/ui';
import { PLANS } from '../../../lib/pricing';
import { PageHead, Panel, Tabs } from '../AdminUI';
import { Chip } from '../../me/kit';
import '../../../styles/me-kit.css';
import '../../../styles/admin-ops.css';
import { Loading, STATUS_LABEL, day, emptyIf, http, rupees, tone, useAction, useApi, when } from './common';
import { aiDetail } from './aiUsageText';
import { HomeClicks, OrgRevenue } from './BillingPages';
import { liveParams } from '../../../lib/liveParams';

/** badge tone → chip tone */
const CHIP = { success: 'ok', danger: 'bad', warning: 'warn', neutral: 'neutral' };
/** A number tile on the dashboard (same label, value and line as before). */
function Tile({ label, value, sub }) {
  return <div className="ops-kpi"><span className="ops-kpi-l">{label}</span><strong className="ops-kpi-v">{value}</strong>{sub && <span className="ops-kpi-s">{sub}</span>}</div>;
}

/* ---------- dashboard ---------- */
/** "Today so far" with a Share to WhatsApp button (wa.me with the text, sent from the admin's own phone). The same
 * numbers for yesterday are emailed to the Owner admins at 8:00 IST (Admin › Settings turns that off). */
export function TodayCard() {
  const st = useApi('/api/admin/today');
  return (
    <section className="ops-today" aria-label="Today" data-testid="today-card">
      <Loading st={st}>{(t) => (
        <>
          <div className="ops-today-h">
            <strong>Today so far</strong>
            <a className="btn btn-outline" style={{ minHeight: 40 }} href={`https://wa.me/?text=${encodeURIComponent(t.text)}`} target="_blank" rel="noopener noreferrer" data-testid="today-wa">Share to WhatsApp</a>
          </div>
          <div className="ops-today-grid">
            {[['New users today', t.newUsers], ['Resumes started', t.resumes], ['Orders paid today', t.ordersPaid], ['Annual passes sold', t.passesSold ?? 0], ['Revenue', rupees(t.revenue)], ['Codes used', t.codesUsed], ['New organizations', t.orgSignups], ['Jobs posted', t.jobsPosted ?? 0], ['Live jobs', t.jobsLive ?? 0], ['Job applications', t.applications ?? 0], ['By Auto Apply', t.autoApplications ?? 0], ['New companies', t.companySignups ?? 0], ['Companies waiting', t.companiesWaiting ?? 0], ['Server errors', t.errors]].map(([k, v]) => (
              <span key={k} className={`ops-today-cell ${k === 'Server errors' && v ? 'bad' : ''}`}><span className="xs muted">{k}</span><strong>{v}</strong></span>
            ))}
          </div>
        </>
      )}</Loading>
    </section>
  );
}

export function LiveDashboard() {
  const [days, setDays] = useState(30);
  const st = useApi(`/api/admin/stats?days=${days}`);
  return (
    <>
      <PageHead title="Dashboard" sub="Live numbers from the database." right={
        <select aria-label="Period" className="input" style={{ height: 40, width: 'auto' }} value={days} onChange={(e) => setDays(+e.target.value)}>
          <option value={1}>Today</option><option value={7}>Last 7 days</option><option value={30}>Last 30 days</option><option value={365}>Last 12 months</option>
        </select>} />
      <TodayCard />
      <Loading st={st}>{(s) => (
        <>
          <div className="ops-kpis">
            <Tile label="Revenue (after refunds)" value={rupees(s.revenue)} sub={`${rupees(s.moneyIn)} in · ${rupees(s.refunded)} refunded`} />
            <Tile label="Paid orders" value={s.ordersPaid} sub={Object.entries(s.ordersByPlan).map(([k, n]) => `${PLANS[k]?.name || k}: ${n}`).join(' · ') || 'none yet'} />
            <Tile label="Verified customers" value={s.customers} sub={`all time, email confirmed · ${s.newCustomers} sign-up(s) in this period`} />
            <Tile label="Experts approved" value={s.experts} sub={`${s.applicationsWaiting} application(s) waiting`} />
          </div>
          <section className="ops-attn" aria-label="Needs attention">
            <strong className="ops-attn-h">Needs attention</strong>
            <ul className="ops-attn-list">{[
              [s.lateOrders, 'order(s) past the deadline', '/admin/orders?late=1', 'var(--danger)'],
              [s.unassigned, 'paid order(s) without an expert', '/admin/orders?status=offer', 'var(--warning)'],
              [s.openOrders, 'open order(s) in progress', '/admin/orders'],
              [s.refundsInReview, 'refund request(s) to review', '/admin/refunds'],
              [s.ticketsOpen, 'open support ticket(s)', '/admin/customers?tab=tickets'],
              [s.applicationsWaiting, 'expert application(s) to review', '/admin/experts?tab=applications'],
            ].map(([n, text, to, color]) => (
              <li key={text}><Link to={to} className={`ops-attn-item ${!n ? 'quiet' : color === 'var(--danger)' ? 'hot' : color ? 'warm' : ''}`}><strong>{n}</strong> {text}</Link></li>
            ))}</ul>
            {!s.ordersPaid && !s.openOrders && <span className="xs faint">No paid orders yet. They show here as soon as customers pay.</span>}
          </section>
        </>
      )}</Loading>
      <OrgRevenue days={days} />
      <HomeClicks />
      <AiUsage />
    </>
  );
}

const AI_FEATURES = [['photos', 'Snap photos'], ['summary', 'Summary writer'], ['linkedin', 'LinkedIn headlines']];

/** AI calls per day (Claude API): counted before each call, failed ones included; the site-wide cap is in code.
 *  Under each day's counts: why the first model's answer was unusable (the fallback did the work) and, for the
 *  summary writer, how many options the server's checks dropped. */
function AiUsage() {
  const st = useApi('/api/admin/ai-usage?days=7');
  return (
    <Loading st={st}>{(u) => (
      <section className="ops-card" aria-label="AI usage">
        <div className="ops-card-h">
          <strong>AI usage</strong>
          <span className="xs muted">Today {u.days[0].total} of {u.cap} AI calls · per person a day: Snap photos {u.perPerson.photos}, summary writer {u.perPerson.summary}, LinkedIn headlines {u.perPerson.linkedin ?? 10}</span>
        </div>
        {u.capReachedToday && <div className="ops-cap" role="status"><strong>AI daily cap reached.</strong> AI features are using their free fallback until midnight (India time).</div>}
        <div className="table-wrap" tabIndex={0} role="region" aria-label="Table — scroll sideways to see all columns">
          <table className="table">
            <thead><tr><th>Day</th>{AI_FEATURES.map(([k, l]) => <th key={k}>{l}: calls · fallbacks · failed · refused</th>)}<th>All AI calls</th></tr></thead>
            <tbody>{u.days.map((d) => (
              <tr key={d.date} data-testid="ai-day">
                <td className="small">{d.date}</td>
                {AI_FEATURES.map(([k]) => (
                  <td key={k} className="small mono">
                    {d[k].calls} · {d[k].fallback} · {d[k].failed} · {d[k].limited + d[k].capped}
                    {aiDetail(d[k]) && <div className="xs faint" data-testid={`ai-${k}-detail`}>{aiDetail(d[k])}</div>}
                  </td>
                ))}
                <td className="small mono">{d.total}{d.capReached ? ' (cap reached)' : ''}</td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      </section>
    )}</Loading>
  );
}

/* ---------- orders ---------- */
const ORDER_FILTERS = [['', 'All'], ['offer', 'Finding expert'], ['in_progress', 'Writing'], ['waiting', 'With customer'], ['revision', 'Changes'], ['delivered', 'Delivered'], ['refunded', 'Refunded']];

// a search the hosting edge refuses (e.g. text that looks like SQL) never reaches the API: say so plainly
const SEARCH_FAIL = 'Search couldn’t run — try different words.';

export function LiveOrders() {
  const [params, setParams] = useSearchParams();
  const status = params.get('status') || '';
  const late = params.get('late') === '1';
  const [q, setQ] = useState(params.get('q') || '');
  const [open, setOpen] = useState(params.get('id') || null);
  const qs = new URLSearchParams({ ...(status ? { status } : {}), ...(late ? { late: 'true' } : {}), ...(params.get('q') ? { q: params.get('q') } : {}), limit: '100' });
  const st = useApi(`/api/admin/orders?${qs}`);
  const setFilter = (k, v) => { const p = liveParams(); if (v) p.set(k, v); else p.delete(k); setParams(p); };
  return (
    <>
      <PageHead title="Orders" sub="Open orders first, closest deadline first." />
      <div className="ad-toolbar ops-toolbar">
        <Tabs label="Status" tabs={ORDER_FILTERS} value={status} onChange={(v) => setFilter('status', v)} />
        <div className="ops-toolbar-r">
          <label className="ops-toggle"><input type="checkbox" checked={late} onChange={(e) => setFilter('late', e.target.checked ? '1' : '')} />Late only</label>
          <form className="ops-search" onSubmit={(e) => { e.preventDefault(); setFilter('q', q.trim()); }}>
            <label htmlFor="o-q" className="sr-only">Search orders</label>
            <input id="o-q" className="input" placeholder="Order no., name or email" value={q} onChange={(e) => setQ(e.target.value)} />
            <button type="submit" className="btn btn-outline" style={{ minHeight: 40 }}>Search</button>
          </form>
        </div>
      </div>
      <div className="ops-split">
        <div className="ops-split-main">
          <Loading st={st} failText={params.get('q') ? SEARCH_FAIL : undefined} empty={emptyIf((d) => !d.items.length, status || late || params.get('q') ? 'No orders match.' : 'No orders yet. Paid orders appear here.')}>{(d) => (
            <div className="card table-wrap ops-table" tabIndex={0} role="region" aria-label="Table — scroll sideways to see all columns">
              <table className="table mtable"><thead><tr><th>Order</th><th>Customer</th><th>Plan</th><th>Status</th><th>Deadline</th><th>Amount</th></tr></thead>
                <tbody>{d.items.map((o) => (
                  <tr key={o.id} onClick={() => setOpen(o.id)} className={`clickable ${open === o.id ? 'on' : ''}`}>
                    <td className="ops-mono" data-label="Order"><button type="button" className="link-btn small" onClick={() => setOpen(o.id)}>{o.id}</button></td>
                    <td className="small" data-label="Customer"><span>{o.customer.name}<span className="ops-sub">{o.customer.email}</span></span></td>
                    <td className="small" data-label="Plan">{o.planName}</td>
                    <td data-label="Status"><Chip tone={o.late ? 'bad' : CHIP[tone(o.status)]}>{o.late ? 'Late' : STATUS_LABEL[o.status] || o.status}</Chip></td>
                    <td className="small" data-label="Deadline">{o.hoursLeft == null ? '—' : o.hoursLeft < 0 ? `${Math.round(-o.hoursLeft)} h late` : `${Math.round(o.hoursLeft)} h left`}</td>
                    <td className="small" data-label="Amount"><strong>{rupees(o.amount)}</strong></td>
                  </tr>
                ))}</tbody></table>
              <div className="ops-foot">{d.total} order(s)</div>
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
            <div className="ops-panel-sum">
              <span className="ops-panel-cell"><span>Plan</span><strong>{o.planName}</strong></span>
              <span className="ops-panel-cell"><span>Amount</span><strong>{rupees(o.amount)}</strong></span>
              <span className="ops-panel-cell"><span>Status</span><Chip tone={CHIP[tone(o.status)]}>{STATUS_LABEL[o.status] || o.status}</Chip></span>
            </div>
            <span className="xs muted">Paid {when(o.paidAt)} · invoice {o.invoiceNo || '—'} · deadline {when(o.deadlineAt)}{o.deliveredAt ? ` · delivered ${when(o.deliveredAt)}` : ''}</span>
            {o.items.length > 1 && <span className="xs muted">Add-ons: {o.items.filter((i) => i.kind === 'addon').map((i) => i.name).join(', ')}</span>}
            {o.refunds.length > 0 && <span className="xs">Refunds: {o.refunds.map((r) => `${r.id} ${r.status} ${rupees(r.amount)}`).join(' · ')}</span>}
            {w && (
              <div className="ops-work">
                <strong>Expert work</strong>
                <span>Expert: {w.expertName || 'not assigned'}{w.expertId && !w.accepted ? ` · offer until ${when(w.offerExpires)}` : w.accepted ? ` · accepted ${when(w.accepted)}` : ''}</span>
                <span>Intake: {w.intake?.target ? `done — ${w.intake.target}` : 'not filled in yet'}</span>
                <span>Drafts sent: {w.versions.filter((v) => v.sent).length} · messages: {w.messages.length}{w.rating ? ` · rated ${w.rating}★` : ''}</span>
              </div>
            )}
            {canAssign && (
              <form className="ops-assign" onSubmit={(e) => { e.preventDefault(); run(async () => { await http(`/api/admin/orders/${encodeURIComponent(id)}/assign`, { method: 'POST', body: { expertId: pick || null } }); st.reload(); onChanged(); }, pick ? 'Offered to the expert' : 'Taken back from the expert'); }}>
                <label htmlFor="as-x" className="label">{w?.expertId ? 'Reassign to' : 'Offer to an expert'}</label>
                {experts.error ? <span className="xs muted">Your role can’t list experts.</span> : (
                  <select id="as-x" className="input" style={{ height: 42 }} value={pick} onChange={(e) => setPick(e.target.value)}>
                    <option value="">{w?.expertId ? 'Nobody (take it back)' : 'Choose…'}</option>
                    {(experts.data || []).filter((x) => !x.paused).map((x) => <option key={x.id} value={x.id}>{x.name} · {x.domains.join(', ') || 'no domains'} · {x.orders} active</option>)}
                  </select>
                )}
                {!experts.loading && !experts.error && !(experts.data || []).length && <span className="xs muted">No approved experts yet — approve one under Experts.</span>}
                <button type="submit" className="btn btn-signal" style={{ alignSelf: 'flex-start' }} disabled={busy || (!pick && !w?.expertId)}>{pick ? 'Offer order' : 'Take back'}</button>
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
      <div className="ad-toolbar ops-toolbar"><Tabs label="Refund status" tabs={[['review', 'To review'], ['approved', 'Approved'], ['processed', 'Paid back'], ['rejected', 'Rejected'], ['', 'All']]} value={status} onChange={setStatus} /></div>
      <Loading st={st} empty={emptyIf((d) => !d.items.length, status === 'review' ? 'No refund requests waiting.' : 'No refunds here.')}>{(d) => (
        <div className="ops-refunds">{d.items.map((r) => (
          <section key={r.id} className={`ops-refund ${r.status === 'review' ? 'review' : ''}`} aria-label={r.id}>
            <span className="ops-refund-h"><strong>{r.id} · order {r.orderId}</strong><Chip tone={r.status === 'review' ? 'warn' : r.status === 'rejected' ? 'neutral' : 'ok'}>{r.status}</Chip></span>
            <span className="ops-refund-money">{rupees(r.amount)} <span className="ops-sub">of {rupees(r.orderAmount)}</span></span>
            <span className="small">{r.customer.name} · {r.customer.email} · asked {when(r.createdAt)}</span>
            <span className="ops-refund-reason"><strong>Reason:</strong> {r.reason}{r.details ? ` — ${r.details}` : ''}</span>
            {r.decisionNote && <span className="small muted">Note: {r.decisionNote}</span>}
            {r.error && <span className="small" style={{ color: 'var(--danger)' }}>Payment provider: {r.error}</span>}
            {r.status === 'review' && (
              <div className="ops-decide">
                <div className="field"><label className="label" htmlFor={`am-${r.id}`}>Amount (₹, empty = full)</label><input id={`am-${r.id}`} className="input" inputMode="numeric" style={{ height: 40, width: 140 }} value={amount[r.id] || ''} onChange={(e) => setAmount({ ...amount, [r.id]: e.target.value.replace(/\D/g, '') })} /></div>
                <div className="field" style={{ flex: '1 1 200px' }}><label className="label" htmlFor={`nt-${r.id}`}>Note to the customer</label><input id={`nt-${r.id}`} className="input" style={{ height: 40 }} value={note[r.id] || ''} onChange={(e) => setNote({ ...note, [r.id]: e.target.value })} /></div>
                <button type="button" className="btn btn-signal" disabled={busy} onClick={() => run(async () => { await http(`/api/admin/refunds/${r.id}/approve`, { method: 'POST', body: { amount: amount[r.id] ? Number(amount[r.id]) * 100 : null, note: note[r.id] || null } }); st.reload(); }, 'Refund approved')}>Approve</button>
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
      <div className="ad-toolbar ops-toolbar"><Tabs label="View" tabs={[['payments', 'Payments'], ['invoices', 'Invoices'], ['payouts', 'Expert payouts']]} value={tab} onChange={(v) => setParams({ tab: v })} /></div>
      {tab === 'payments' && (
        <Loading st={pays} empty={emptyIf((d) => !d.items.length, 'No payments yet. Online payments are switched off until the Razorpay keys are added.')}>{(d) => (
          <div className="card table-wrap ops-table" tabIndex={0} role="region" aria-label="Table — scroll sideways to see all columns">
            <table className="table mtable"><thead><tr><th>When</th><th>Order</th><th>Customer</th><th>Amount</th><th>Method</th><th>Status</th></tr></thead>
              <tbody>{d.items.map((p) => (
                <tr key={p.id}><td className="small" data-label="When">{when(p.createdAt)}</td><td className="ops-mono" data-label="Order">{p.orderId || <span style={{ color: 'var(--danger)' }}>no order</span>}</td><td className="small" data-label="Customer">{p.customerName || '—'}</td><td className="small" data-label="Amount"><strong>{rupees(p.amount)}</strong></td><td className="small" data-label="Method">{p.method || '—'}</td><td data-label="Status"><span><Chip tone={p.status === 'captured' ? 'ok' : p.status === 'failed' ? 'bad' : 'neutral'}>{p.status}</Chip><span className="ops-sub ops-mono">{p.razorpayPaymentId || ''}</span></span></td></tr>
              ))}</tbody></table>
          </div>
        )}</Loading>
      )}
      {tab === 'invoices' && (
        <Loading st={invoices} empty={emptyIf((d) => !d.items.length, 'No invoices yet. An invoice number is given when a payment succeeds.')}>{(d) => (
          <div className="card table-wrap ops-table" tabIndex={0} role="region" aria-label="Table — scroll sideways to see all columns">
            <table className="table mtable"><thead><tr><th>Invoice</th><th>Date</th><th>Order</th><th>Customer</th><th>Amount</th><th>Status</th></tr></thead>
              <tbody>{d.items.map((v) => <tr key={v.invoiceNo}><td className="ops-mono" data-label="Invoice">{v.invoiceNo}</td><td className="small" data-label="Date">{day(v.paidAt)}</td><td className="ops-mono" data-label="Order">{v.orderId}</td><td className="small" data-label="Customer"><span>{v.customer}<span className="ops-sub">{v.email}</span></span></td><td className="small" data-label="Amount"><strong>{rupees(v.amount)}</strong></td><td className="small" data-label="Status">{STATUS_LABEL[v.status] || v.status}</td></tr>)}</tbody></table>
            <div className="ops-foot">{d.total} invoice(s). Prices include GST.</div>
          </div>
        )}</Loading>
      )}
      {tab === 'payouts' && <div className="well small muted" style={{ padding: 24 }}>No expert payouts yet. Payouts are paid by bank/UPI transfer after delivered orders are approved; they will be listed here once experts start completing orders.</div>}
    </>
  );
}
