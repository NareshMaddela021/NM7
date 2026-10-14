// Customers: activity, 60-day file deletion countdown, data deletion requests, block.
import { useMemo, useState } from 'react';
import { useSearchParams, Link } from 'react-router-dom';
import { useToast } from '../../components/ui';
import { useAdmin } from './AdminContext';
import { PageHead, Panel, Empty, inr, fmtDate } from './AdminUI';
import { NOW_MS } from '../../data/adminData';
import { PLANS } from '../../lib/pricing';
import { useMe, allCustomerStores, patchCustomer, decideRefund } from '../../lib/customerStore';

/** Issues and refund requests customers raise from their dashboard (Help → Raise an issue, Order → Refund). */
function SupportInbox() {
  useMe(); // re-render on changes
  const toast = useToast();
  const [reply, setReply] = useState({});
  const items = allCustomerStores().flatMap(({ key, s }) => (s.issues || []).map((i) => ({ key, name: s.account?.name || 'Customer', i }))).sort((a, b) => b.i.at - a.i.at);
  const open = items.filter(({ i }) => i.status !== 'resolved');
  const resolve = (key, id, text) => patchCustomer(key, (s) => ({ issues: s.issues.map((x) => (x.id === id ? { ...x, status: 'resolved', reply: text } : x)) }));
  return (
    <section className="card stack g12" aria-label="Support inbox">
      <div className="row between"><strong>Support inbox · from customer dashboards</strong><span className={`badge ${open.length ? 'b-warning' : 'b-success'}`}>{open.length} open</span></div>
      {items.length === 0 && <Empty>No issues raised.</Empty>}
      {items.map(({ key, name, i }) => {
        const r = (reply[i.id] || '').trim();
        return (
          <div key={key + i.id} className="well stack g8">
            <span className="row between g8"><strong className="small">{i.id} · {name} · {i.topic}{i.order ? ` · ${i.order}` : ''}</strong><span className="xs faint">{fmtDate(i.at)}</span></span>
            <span className="small">{i.text}</span>
            {i.status === 'resolved' ? <span className="small muted"><strong>Replied:</strong> {i.reply}</span> : (
              <div className="row g8">
                <label htmlFor={`rp-${i.id}`} className="sr-only">Reply</label>
                <input id={`rp-${i.id}`} className="input" style={{ height: 40, flex: '1 1 220px' }} placeholder={i.topic === 'Refund' ? 'Reason for your decision…' : 'Reply and resolve…'} value={reply[i.id] || ''} onChange={(e) => setReply({ ...reply, [i.id]: e.target.value })} />
                {i.topic === 'Refund' && i.order ? (
                  <>
                    <button type="button" className="btn btn-ink" style={{ minHeight: 40 }} disabled={!r} onClick={() => { decideRefund(key, i.order, true, r); toast('Refund approved — money back in 3–5 business days'); }}>Approve refund</button>
                    <button type="button" className="btn btn-outline" style={{ minHeight: 40 }} disabled={!r} onClick={() => { decideRefund(key, i.order, false, r); toast('Declined — the customer sees your reason and can ask for a re-do'); }}>Decline</button>
                  </>
                ) : <button type="button" className="btn btn-ink" style={{ minHeight: 40 }} disabled={!r} onClick={() => { resolve(key, i.id, r); toast('Reply sent — the customer sees it on their Help page'); }}>Reply & resolve</button>}
              </div>
            )}
          </div>
        );
      })}
    </section>
  );
}

function Detail({ c, onClose }) {
  const { orders, actions, settings } = useAdmin();
  const toast = useToast();
  const [confirm, setConfirm] = useState('');
  const [note, setNote] = useState(c.notes || '');
  const mine = orders.filter((o) => o.custId === c.id);
  const lastDelivered = Math.max(0, ...mine.map((o) => o.deliveredAt || o.createdAt));
  const daysLeft = lastDelivered ? Math.max(0, Math.ceil(settings.rules.retentionDays - (NOW_MS - lastDelivered) / 86400000)) : null;
  return (
    <Panel title={c.name} onClose={onClose}>
      <div className="row g8">{c.blocked && <span className="badge b-danger">Blocked</span>}{c.deleted && <span className="badge b-neutral">Data deleted</span>}<span className="badge b-neutral">{c.city}</span></div>
      <span className="small muted">{c.email} · joined {fmtDate(c.joined)} · {c.id}</span>
      <div className="grid-auto g8 small" style={{ '--min': '120px' }}>
        <span className="well"><strong>{c.scans}</strong><br /><span className="xs muted">free scans</span></span>
        <span className="well"><strong>{mine.length}</strong><br /><span className="xs muted">orders</span></span>
        <span className="well"><strong>{inr(mine.reduce((s, o) => s + o.price, 0))}</strong><br /><span className="xs muted">spent</span></span>
        <span className="well"><strong>{c.builder ? 'Yes' : 'No'}</strong><br /><span className="xs muted">builder profile</span></span>
      </div>
      <div className="stack g4 small"><strong>Orders</strong>{mine.length ? mine.map((o) => <Link key={o.id} to={`/admin/orders?id=${o.id}`}>{o.id} · {PLANS[o.planId].name} · {o.stage}</Link>) : <span className="muted">No orders yet.</span>}</div>
      {daysLeft !== null && !c.deleted && <span className="small"><strong>Resume files:</strong> deleted automatically in <strong>{daysLeft} days</strong> ({settings.rules.retentionDays}-day rule).</span>}
      <div className="field"><label htmlFor="cn" className="label">Support notes (internal)</label><textarea id="cn" className="input" rows={3} value={note} onChange={(e) => setNote(e.target.value)} onBlur={() => note !== (c.notes || '') && actions.customer(c.id, { notes: note }, 'note updated')} /></div>
      <div className="row g8">
        <button type="button" className="btn btn-outline" onClick={() => { actions.customer(c.id, { blocked: !c.blocked }, c.blocked ? 'unblocked' : 'blocked'); toast(c.blocked ? 'Unblocked' : 'Blocked — they can’t order or scan'); }}>{c.blocked ? 'Unblock' : 'Block'}</button>
      </div>
      {!c.deleted && (
        <div className="stack g8 well">
          <strong className="small" style={{ color: 'var(--danger)' }}>Delete this customer’s data</strong>
          <span className="xs muted">For “delete my data” requests. Removes name, email, resumes and builder profile. Payment records stay for tax law (amount and date only). This can’t be undone.</span>
          <label htmlFor="cdel" className="xs">Type <strong>DELETE</strong> to confirm</label>
          <div className="row g8" style={{ flexWrap: 'nowrap' }}><input id="cdel" className="input" style={{ height: 40 }} value={confirm} onChange={(e) => setConfirm(e.target.value)} /><button type="button" className="btn btn-danger-soft" style={{ minHeight: 40 }} disabled={confirm !== 'DELETE'} onClick={() => { actions.deleteCustomerData(c.id); setConfirm(''); toast('Customer data deleted'); }}>Delete</button></div>
        </div>
      )}
    </Panel>
  );
}

export default function Customers() {
  const { customers, orders } = useAdmin();
  const [params, setParams] = useSearchParams();
  const [q, setQ] = useState('');
  const [f, setF] = useState('all');
  const spend = useMemo(() => { const m = {}; orders.forEach((o) => { m[o.custId] = (m[o.custId] || 0) + o.price; }); return m; }, [orders]);
  const list = customers.filter((c) => (f === 'all' || (f === 'paid' ? spend[c.id] : f === 'free' ? !spend[c.id] : c.blocked)) && (!q || `${c.name} ${c.email} ${c.id}`.toLowerCase().includes(q.toLowerCase())));
  const sel = customers.find((c) => c.id === params.get('id'));
  return (
    <>
      <PageHead title="Customers" sub={`${customers.length} people · ${customers.filter((c) => spend[c.id]).length} have paid`} />
      <div className="row g8">
        <label htmlFor="cq" className="sr-only">Search customers</label><input id="cq" className="input" style={{ height: 40, flex: '1 1 220px' }} placeholder="Search name, email, ID" value={q} onChange={(e) => setQ(e.target.value)} />
        {[['all', 'All'], ['paid', 'Paid'], ['free', 'Free only'], ['blocked', 'Blocked']].map(([v, l]) => <button key={v} type="button" className="chip" aria-pressed={f === v} style={{ minHeight: 36, fontSize: 13 }} onClick={() => setF(v)}>{l}</button>)}
      </div>
      <div className="row g16" style={{ alignItems: 'flex-start' }}>
        <div className="card table-wrap" style={{ flex: '3 1 520px', padding: 0 }}>
          {list.length === 0 ? <Empty>No customers match.</Empty> : (
            <table className="table"><thead><tr><th>Customer</th><th>City</th><th>Scans</th><th>Spent</th><th>Joined</th></tr></thead>
              <tbody>{list.slice(0, 60).map((c) => (
                <tr key={c.id} className={`clickable${sel?.id === c.id ? ' sel' : ''}`} onClick={() => setParams({ id: c.id })}>
                  <td><button type="button" className="stack" style={{ border: 0, background: 'none', padding: 0, textAlign: 'left' }} onClick={() => setParams({ id: c.id })}><strong>{c.name}{c.blocked ? ' · blocked' : ''}</strong><span className="xs faint">{c.email}</span></button></td>
                  <td className="small">{c.city}</td><td>{c.scans}</td><td>{spend[c.id] ? inr(spend[c.id]) : '—'}</td><td className="small">{fmtDate(c.joined)}</td>
                </tr>))}</tbody></table>
          )}
        </div>
        {sel && <Detail key={sel.id} c={sel} onClose={() => setParams({})} />}
      </div>
      <SupportInbox />
    </>
  );
}
