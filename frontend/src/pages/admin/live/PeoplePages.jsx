// Live admin: experts + applications, customers + support tickets, quality audits, reports.
import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useToast } from '../../../components/ui';
import { PLANS } from '../../../lib/pricing';
import { savePdf } from '../../builder/resumePdf';
import { BarChart, Kpi, PageHead, Panel, Tabs } from '../AdminUI';
import { API_BASE } from '../../../services/http';
import { Loading, STATUS_LABEL, day, emptyIf, http, rupees, useAction, useApi, when } from './common';

/* ---------- experts and applications ---------- */
const EXPERT_STATUS = { draft: 'Filling in profile', review: 'To review', changes: 'Asked for changes', test: 'Doing test task', testReview: 'Test to score', approved: 'Approved', rejected: 'Not approved' };
const RUBRIC = [['ats', 'ATS-safe & readable'], ['impact', 'Results & numbers'], ['fit', 'Fit to the job'], ['language', 'Language'], ['judgement', 'Judgement & honesty']];

export function LiveExperts() {
  const [params, setParams] = useSearchParams();
  const tab = params.get('tab') || 'applications';
  const [open, setOpen] = useState(params.get('id'));
  const st = useApi('/api/admin/experts');
  const show = (x) => (tab === 'experts' ? x.status === 'approved' : tab === 'applications' ? ['review', 'testReview', 'test', 'changes'].includes(x.status) : true);
  return (
    <>
      <PageHead title="Experts" sub="Approve applications, score test tasks and pause experts." />
      <Tabs label="View" tabs={[['applications', 'Applications'], ['experts', 'Approved experts'], ['all', 'Everyone']]} value={tab} onChange={(v) => setParams({ tab: v })} />
      <div className="row g16" style={{ alignItems: 'flex-start' }}>
        <div style={{ flex: '3 1 420px', minWidth: 0 }}>
          <Loading st={st} empty={emptyIf((d) => !d.filter(show).length, tab === 'applications' ? 'No applications waiting.' : tab === 'experts' ? 'No approved experts yet.' : 'No expert accounts yet.')}>{(d) => (
            <div className="card table-wrap" style={{ padding: 0 }}>
              <table className="table"><thead><tr><th>Name</th><th>Domains</th><th>Status</th><th>Active orders</th><th>Joined</th></tr></thead>
                <tbody>{d.filter(show).map((x) => (
                  <tr key={x.id} onClick={() => setOpen(x.id)} style={{ cursor: 'pointer', background: open === x.id ? 'var(--sunken)' : undefined }}>
                    <td className="small"><button type="button" className="link-btn small" onClick={() => setOpen(x.id)}>{x.name}</button><div className="xs faint">{x.email}</div></td>
                    <td className="small">{x.domains.join(', ') || '—'}</td>
                    <td><span className={`badge b-${x.status === 'approved' ? 'success' : ['review', 'testReview'].includes(x.status) ? 'warning' : 'neutral'}`}>{EXPERT_STATUS[x.status] || x.status}</span>{x.paused && <span className="badge b-neutral" style={{ marginLeft: 4 }}>Paused</span>}</td>
                    <td className="small">{x.orders}</td><td className="small">{day(x.joined)}</td>
                  </tr>
                ))}</tbody></table>
            </div>
          )}</Loading>
        </div>
        {open && <ExpertPanel id={open} onClose={() => setOpen(null)} onChanged={st.reload} />}
      </div>
    </>
  );
}

function ExpertPanel({ id, onClose, onChanged }) {
  const toast = useToast();
  const st = useApi(`/api/admin/experts/${id}`);
  const [busy, run] = useAction(toast);
  const [note, setNote] = useState('');
  const [scores, setScores] = useState({});
  const decide = (action, ok) => run(async () => { await http(`/api/admin/experts/${id}/decision`, { method: 'POST', body: { action, note, scores: action === 'pass' || action === 'fail' ? scores : null } }); setNote(''); st.reload(); onChanged(); }, ok);
  return (
    <Panel title="Expert" onClose={onClose}>
      <Loading st={st}>{(x) => {
        const p = x.profile || {};
        const a = p.about || {};
        return (
          <div className="stack g12">
            <span className="small"><strong>{x.name}</strong> · {x.email}</span>
            <span><span className="badge b-neutral">{EXPERT_STATUS[x.status] || x.status}</span>{x.paused && <span className="badge b-neutral" style={{ marginLeft: 4 }}>Paused</span>}</span>
            {!x.profile && <span className="small muted">No profile submitted yet.</span>}
            {x.profile && (
              <div className="well stack g4 small">
                {a.headline && <strong>{a.headline}</strong>}
                {a.bio && <span>{a.bio}</span>}
                <span className="xs muted">{[a.city, (a.languages || []).join(', ')].filter(Boolean).join(' · ')}</span>
                <span className="xs">Domains: {(p.expertise?.domains || []).join(', ') || '—'} · levels: {(p.expertise?.levels || []).join(', ') || '—'}</span>
                {(p.proof?.experience || []).map((e, i) => <span key={i} className="xs">• {e.role} {e.company ? `at ${e.company}` : ''} {e.period || ''}</span>)}
                {p.proof?.linkedin && <span className="xs">LinkedIn: {p.proof.linkedin}</span>}
                <span className="xs muted">Payout: {p.payout?.method || '—'} {p.payout?.upi || p.payout?.account || ''} · PAN {p.payout?.pan || '—'}</span>
                {p.note && <span className="xs">Last note: {p.note}</span>}
              </div>
            )}
            {p.test && (
              <div className="well stack g4 small">
                <strong>Test task</strong>
                <span className="xs">Sent {when(p.test.sentAt)} · due {when(p.test.due)} · {p.test.submitted ? `submitted ${when(p.test.submitted)}` : 'not submitted yet'}</span>
                {p.test.data?.summary && <span className="xs">Summary written: “{String(p.test.data.summary).slice(0, 300)}”</span>}
                {p.test.result && <span className="xs">Result: {p.test.result}</span>}
              </div>
            )}
            <div className="field"><label className="label" htmlFor="ex-note">Note to the expert (sent by email)</label><textarea id="ex-note" className="input" rows={3} value={note} onChange={(e) => setNote(e.target.value)} /></div>
            {x.status === 'review' && (
              <div className="row g8">
                <button type="button" className="btn btn-ink" disabled={busy} onClick={() => decide('test', 'Test task sent')}>Send test task</button>
                <button type="button" className="btn btn-outline" disabled={busy} onClick={() => decide('approve', 'Approved')}>Approve without test</button>
                <button type="button" className="btn btn-outline" disabled={busy || !note.trim()} onClick={() => decide('changes', 'Asked for changes')}>Ask for changes</button>
                <button type="button" className="btn btn-ghost" disabled={busy} onClick={() => decide('reject', 'Rejected')}>Reject</button>
              </div>
            )}
            {x.status === 'testReview' && (
              <div className="stack g8">
                {RUBRIC.map(([k, l]) => (
                  <label key={k} className="row between g8 small">{l}
                    <select className="input" style={{ height: 36, width: 80 }} value={scores[k] || ''} onChange={(e) => setScores({ ...scores, [k]: +e.target.value })}><option value="">–</option>{[1, 2, 3, 4, 5].map((n) => <option key={n}>{n}</option>)}</select>
                  </label>
                ))}
                <div className="row g8">
                  <button type="button" className="btn btn-ink" disabled={busy || RUBRIC.some(([k]) => !scores[k])} onClick={() => decide('pass', 'Passed — expert approved')}>Pass & approve</button>
                  <button type="button" className="btn btn-outline" disabled={busy || RUBRIC.some(([k]) => !scores[k])} onClick={() => decide('fail', 'Marked as not passed')}>Not passed</button>
                </div>
              </div>
            )}
            {x.status === 'test' && <button type="button" className="btn btn-ghost" style={{ alignSelf: 'flex-start' }} disabled={busy} onClick={() => decide('reject', 'Rejected')}>Reject</button>}
            {x.status === 'approved' && (
              <button type="button" className="btn btn-outline" style={{ alignSelf: 'flex-start' }} disabled={busy} onClick={() => run(async () => { await http(`/api/admin/experts/${id}/pause`, { method: 'POST', body: { paused: !x.paused } }); st.reload(); onChanged(); }, x.paused ? 'Expert can take orders again' : 'Expert paused')}>{x.paused ? 'Resume expert' : 'Pause expert'}</button>
            )}
          </div>
        );
      }}</Loading>
    </Panel>
  );
}

/* ---------- customers and support tickets ---------- */
export function LiveCustomers() {
  const [params, setParams] = useSearchParams();
  const tab = params.get('tab') || 'customers';
  return (
    <>
      <PageHead title="Customers & support" sub="Accounts, their orders, and support tickets from “Raise an issue”." />
      <Tabs label="View" tabs={[['customers', 'Customers'], ['tickets', 'Support tickets']]} value={tab} onChange={(v) => setParams({ tab: v })} />
      {tab === 'customers' ? <CustomerList initial={params.get('id')} /> : <Tickets />}
    </>
  );
}

function CustomerList({ initial }) {
  const [q, setQ] = useState('');
  const [search, setSearch] = useState('');
  const [open, setOpen] = useState(initial);
  const st = useApi(`/api/admin/customers?limit=100${search ? `&q=${encodeURIComponent(search)}` : ''}`);
  return (
    <>
      <form className="row g8" onSubmit={(e) => { e.preventDefault(); setSearch(q.trim()); }}>
        <label htmlFor="c-q" className="sr-only">Search customers</label>
        <input id="c-q" className="input" style={{ height: 40, width: 260 }} placeholder="Name, email or phone" value={q} onChange={(e) => setQ(e.target.value)} />
        <button type="submit" className="btn btn-outline" style={{ minHeight: 40 }}>Search</button>
      </form>
      <div className="row g16" style={{ alignItems: 'flex-start' }}>
        <div style={{ flex: '3 1 420px', minWidth: 0 }}>
          <Loading st={st} failText={search ? 'Search couldn’t run — try different words.' : undefined} empty={emptyIf((d) => !d.items.length, search ? 'No customers match.' : 'No customers yet.')}>{(d) => (
            <div className="card table-wrap" style={{ padding: 0 }}>
              <table className="table"><thead><tr><th>Name</th><th>Joined</th><th>Orders</th><th>Spent</th><th /></tr></thead>
                <tbody>{d.items.map((c) => (
                  <tr key={c.id} onClick={() => setOpen(c.id)} style={{ cursor: 'pointer', background: open === c.id ? 'var(--sunken)' : undefined }}>
                    <td className="small"><button type="button" className="link-btn small" onClick={() => setOpen(c.id)}>{c.name}</button><div className="xs faint">{c.email}</div></td>
                    <td className="small">{day(c.joined)}</td><td className="small">{c.orders}</td><td className="small">{rupees(c.spent)}</td>
                    <td>{c.blocked ? <span className="badge b-danger">Blocked</span> : !c.verified ? <span className="badge b-neutral">Email not confirmed</span> : null}</td>
                  </tr>
                ))}</tbody></table>
              <div className="xs faint" style={{ padding: 12 }}>{d.total} customer(s)</div>
            </div>
          )}</Loading>
        </div>
        {open && <CustomerPanel id={open} onClose={() => setOpen(null)} onChanged={st.reload} />}
      </div>
    </>
  );
}

function CustomerPanel({ id, onClose, onChanged }) {
  const toast = useToast();
  const st = useApi(`/api/admin/customers/${id}`);
  const [busy, run] = useAction(toast);
  const [notes, setNotes] = useState(null);
  return (
    <Panel title="Customer" onClose={onClose}>
      <Loading st={st}>{(c) => (
        <div className="stack g12">
          <span className="small"><strong>{c.name}</strong> · {c.email}{c.phone ? ` · ${c.phone}` : ''}</span>
          <span className="xs muted">Joined {day(c.joined)}{c.targetRole ? ` · target role ${c.targetRole}` : ''}{c.blocked ? ' · BLOCKED' : ''}</span>
          <strong className="small">Orders</strong>
          {c.orders.length ? c.orders.map((o) => <span key={o.id} className="small">{o.id} · {o.planName} · {rupees(o.amount)} · {STATUS_LABEL[o.status] || o.status}</span>) : <span className="xs muted">No orders.</span>}
          <strong className="small">LinkedIn pack</strong>
          <div className="row between g8 small" data-testid="admin-li-pack" style={{ alignItems: 'center', flexWrap: 'wrap' }}>
            <span>{!c.linkedinPack ? 'Not unlocked' : c.linkedinPack.source === 'grant' ? `Granted by an admin · ${day(c.linkedinPack.purchasedAt)}` : `Paid · ${c.linkedinPack.orderId}${c.linkedinPack.source === 'launch' ? ' (Career Launch)' : ''}`}</span>
            {!c.linkedinPack ? (
              <button type="button" className="btn btn-outline" disabled={busy} onClick={() => run(async () => { await http(`/api/admin/customers/${id}/linkedin-pack`, { method: 'POST', body: { granted: true, note: notes || '' } }); st.reload(); }, 'LinkedIn pack granted')}>Grant LinkedIn pack</button>
            ) : c.linkedinPack.source === 'grant' ? (
              <button type="button" className="btn btn-ghost" disabled={busy} onClick={() => run(async () => { await http(`/api/admin/customers/${id}/linkedin-pack`, { method: 'POST', body: { granted: false } }); st.reload(); }, 'LinkedIn pack taken back')}>Take back</button>
            ) : <span className="xs muted">Paid: refund the order to take it back</span>}
          </div>
          <strong className="small">Support tickets</strong>
          {c.tickets.length ? c.tickets.map((t) => <span key={t.id} className="small">{t.id} · {t.topic} · {t.status} — {t.text.slice(0, 80)}</span>) : <span className="xs muted">No tickets.</span>}
          <div className="field"><label className="label" htmlFor="c-notes">Private notes (team only)</label><textarea id="c-notes" className="input" rows={3} value={notes ?? c.notes} onChange={(e) => setNotes(e.target.value)} /></div>
          <div className="row g8">
            <button type="button" className="btn btn-outline" disabled={busy || notes == null} onClick={() => run(async () => { await http(`/api/admin/customers/${id}/notes`, { method: 'PUT', body: { notes } }); }, 'Notes saved')}>Save notes</button>
            <button type="button" className="btn btn-ghost" style={{ color: c.blocked ? undefined : 'var(--danger)' }} disabled={busy} onClick={() => run(async () => { await http(`/api/admin/customers/${id}/block`, { method: 'POST', body: { blocked: !c.blocked, reason: notes || '' } }); st.reload(); onChanged(); }, c.blocked ? 'Customer unblocked' : 'Customer blocked and signed out')}>{c.blocked ? 'Unblock' : 'Block account'}</button>
          </div>
        </div>
      )}</Loading>
    </Panel>
  );
}

function Tickets() {
  const toast = useToast();
  const [status, setStatus] = useState('open');
  const st = useApi(`/api/admin/tickets${status ? `?status=${status}` : ''}`);
  const [busy, run] = useAction(toast);
  const [reply, setReply] = useState({});
  return (
    <>
      <Tabs label="Ticket status" tabs={[['open', 'Open'], ['resolved', 'Resolved'], ['', 'All']]} value={status} onChange={setStatus} />
      <Loading st={st} empty={emptyIf((d) => !d.length, status === 'open' ? 'No open tickets.' : 'No tickets.')}>{(d) => (
        <div className="stack g12">{d.map((t) => (
          <section key={t.id} className="card stack g8" aria-label={t.id}>
            <span className="row between g8"><strong className="small">{t.id} · {t.topic}{t.orderId ? ` · ${t.orderId}` : ''}</strong><span className={`badge ${t.status === 'resolved' ? 'b-success' : 'b-warning'}`}>{t.status}</span></span>
            <span className="xs muted">{t.customer.name} · {t.customer.email} · {when(t.at)}</span>
            <span className="small" style={{ whiteSpace: 'pre-wrap' }}>{t.text}</span>
            {t.reply && <span className="small muted"><strong>Reply:</strong> {t.reply}</span>}
            {t.status === 'open' && (
              <form className="stack g8" onSubmit={(e) => { e.preventDefault(); run(async () => { await http(`/api/admin/tickets/${t.id}/reply`, { method: 'POST', body: { reply: reply[t.id], resolve: true } }); st.reload(); }, 'Reply emailed — ticket resolved'); }}>
                <label className="label" htmlFor={`r-${t.id}`}>Reply (emailed to the customer)</label>
                <textarea id={`r-${t.id}`} className="input" rows={3} value={reply[t.id] || ''} onChange={(e) => setReply({ ...reply, [t.id]: e.target.value })} />
                <button type="submit" className="btn btn-ink" style={{ alignSelf: 'flex-start' }} disabled={busy || (reply[t.id] || '').trim().length < 2}>Send reply & resolve</button>
              </form>
            )}
          </section>
        ))}</div>
      )}</Loading>
    </>
  );
}

/* ---------- quality ---------- */
export function LiveQuality() {
  const toast = useToast();
  const st = useApi('/api/admin/quality');
  const [busy, run] = useAction(toast);
  const [edit, setEdit] = useState({});
  return (
    <>
      <PageHead title="Quality" sub="Score delivered resumes against the five checks. Scores are saved with who scored them." />
      <Loading st={st} empty={emptyIf((d) => !d.orders.length, 'No delivered orders to audit yet.')}>{(d) => (
        <div className="card table-wrap" style={{ padding: 0 }}>
          <table className="table"><thead><tr><th>Order</th><th>Delivered</th><th>Rating</th>{d.checks.map((c) => <th key={c} className="xs">{c}</th>)}<th /></tr></thead>
            <tbody>{d.orders.map((o) => {
              const cur = edit[o.orderId] || o.scores || d.checks.map(() => 0);
              return (
                <tr key={o.orderId}>
                  <td className="mono small">{o.orderId}</td><td className="small">{day(o.deliveredAt)}</td><td className="small">{o.rating ? `${o.rating}★` : '—'}</td>
                  {d.checks.map((c, i) => <td key={c}><input type="checkbox" aria-label={`${o.orderId}: ${c}`} checked={!!cur[i]} onChange={(e) => setEdit({ ...edit, [o.orderId]: cur.map((v, j) => (j === i ? (e.target.checked ? 1 : 0) : v)) })} /></td>)}
                  <td><button type="button" className="btn btn-outline" style={{ minHeight: 34 }} disabled={busy || !edit[o.orderId]} onClick={() => run(async () => { await http(`/api/admin/quality/${o.orderId}`, { method: 'PUT', body: { scores: cur } }); setEdit({ ...edit, [o.orderId]: undefined }); st.reload(); }, 'Audit saved')}>{o.scores ? 'Update' : 'Save'}</button></td>
                </tr>
              );
            })}</tbody></table>
        </div>
      )}</Loading>
    </>
  );
}

/* ---------- reports ---------- */
export function LiveReports() {
  const toast = useToast();
  const [days, setDays] = useState(30);
  const st = useApi(`/api/admin/reports?days=${days}`);
  const [busy, run] = useAction(toast);
  const csv = () => run(async () => {
    const r = await fetch(`${API_BASE}/api/admin/reports/orders.csv?days=${days}`, { credentials: 'include' });
    if (!r.ok) throw new Error('Could not make the file. Please try again.');
    await savePdf(await r.blob(), `nm7-orders-${days}d.csv`);
  }, 'CSV downloaded');
  return (
    <>
      <PageHead title="Reports" sub="Paid orders and money in, by day (India time)." right={
        <span className="row g8">
          <select aria-label="Period" className="input" style={{ height: 40, width: 'auto' }} value={days} onChange={(e) => setDays(+e.target.value)}><option value={7}>Last 7 days</option><option value={30}>Last 30 days</option><option value={90}>Last 90 days</option><option value={365}>Last 12 months</option></select>
          <button type="button" className="btn btn-outline" disabled={busy} onClick={csv}>Download orders CSV</button>
        </span>} />
      <Loading st={st}>{(r) => (
        <>
          <div className="kpis">
            <Kpi label="Money in" value={rupees(r.moneyIn)} />
            <Kpi label="Refunded" value={rupees(r.refunded)} />
            <Kpi label="Paid orders" value={r.daily.reduce((t, x) => t + x.orders, 0)} sub={Object.entries(r.byPlan).map(([k, n]) => `${PLANS[k]?.name || k}: ${n}`).join(' · ') || 'none'} />
            <Kpi label="Sign-ups" value={r.newCustomers} sub="new customer accounts in this period, incl. email not confirmed yet" />
          </div>
          {r.daily.length ? (
            <section className="card"><BarChart title="Revenue per day" data={r.daily.map((x) => ({ label: x.date.slice(5), revenue: x.revenue / 100 }))} series={[{ key: 'revenue', label: 'Revenue (₹)', color: 'var(--viz-1)' }]} fmt={(v) => `₹${Math.round(v).toLocaleString('en-IN')}`} height={180} /></section>
          ) : <div className="well small muted" style={{ textAlign: 'center', padding: 24 }}>No paid orders in this period.</div>}
        </>
      )}</Loading>
    </>
  );
}
