// Orders: saved views, filters, live deadline timers, bulk + auto assign, and a detail panel with every action.
import { useMemo, useState } from 'react';
import { useSearchParams, Link } from 'react-router-dom';
import { useToast } from '../../components/ui';
import { useAdmin, hoursLeft, atRisk, isLate, bestExpert } from './AdminContext';
import { PageHead, Panel, Tabs, Empty, inr, fmtDT, downloadCsv } from './AdminUI';
import { DOMAINS, orderTimeline } from '../../data/adminData';
import { PLANS } from '../../lib/pricing';

const VIEWS = [
  ['all', 'All', () => true],
  ['unassigned', 'Unassigned', (o) => !o.expert && o.stage === 'Placed'],
  ['risk', 'Due in 6h', (o) => atRisk(o) && !isLate(o)],
  ['late', 'Late', isLate],
  ['progress', 'In progress', (o) => hoursLeft(o) !== null],
  ['delivered', 'Delivered', (o) => ['Delivered', 'Approved'].includes(o.stage)],
  ['refunded', 'Refunded', (o) => o.stage === 'Refunded'],
];
const STAGE_BADGE = { Placed: 'b-warning', 'Expert assigned': 'b-neutral', 'Draft 1': 'b-neutral', Revisions: 'b-neutral', Delivered: 'b-success', Approved: 'b-success', Refunded: 'b-danger', Cancelled: 'b-danger', 'Self-serve': 'b-neutral' };

function Timer({ o }) {
  const h = hoursLeft(o);
  if (h === null) return <span className="xs muted">{o.deliveredAt ? `Delivered in ${Math.round((o.deliveredAt - o.createdAt) / 3600000)}h` : '—'}</span>;
  const color = h < 0 ? 'var(--danger)' : h < 6 ? 'var(--danger)' : h < 24 ? 'var(--warning)' : 'var(--text2)';
  const pct = Math.max(4, Math.min(100, 100 - (h / 48) * 100));
  return (
    <div className="stack g4" style={{ minWidth: 96 }}>
      <span className="xs strong" style={{ color }}>{h < 0 ? `${Math.round(-h)}h late` : `${Math.floor(h)}h ${Math.round((h % 1) * 60)}m left`}</span>
      <div style={{ height: 4, borderRadius: 2, background: 'var(--sunken)' }}><div style={{ height: 4, borderRadius: 2, width: `${pct}%`, background: color }} /></div>
    </div>
  );
}

function Detail({ o, onClose }) {
  const { experts, loads, actions, exName, notes, refunds } = useAdmin();
  const toast = useToast();
  const [tab, setTab] = useState('timeline');
  const [ext, setExt] = useState({ hours: 12, reason: '' });
  const [note, setNote] = useState('');
  const [refundWhy, setRefundWhy] = useState('');
  const suggestion = !o.expert && o.planId !== 'diy' ? bestExpert(o, experts, loads) : null;
  const live = hoursLeft(o) !== null;
  const rf = refunds.find((r) => r.orderId === o.id);

  return (
    <Panel title={`${o.id} · ${o.customer}`} onClose={onClose}>
      <div className="row g8"><span className={`badge ${STAGE_BADGE[o.stage]}`}>{o.stage}</span><span className="badge b-neutral">{PLANS[o.planId].name} · {inr(o.price)}</span>{rf && <Link to={`/admin/refunds?id=${rf.id}`} className="badge b-danger">Refund {rf.id} · {rf.status}</Link>}</div>
      <span className="small muted">{o.role} · {o.domain} · {o.city} · placed {fmtDT(o.createdAt)}</span>
      {live && <Timer o={o} />}

      {o.planId !== 'diy' && (
        <div className="stack g8 well">
          <label htmlFor="as-ex" className="label" style={{ margin: 0 }}>Expert</label>
          <div className="row g8" style={{ flexWrap: 'nowrap' }}>
            <select id="as-ex" className="input" style={{ height: 42 }} value={o.expert || ''} onChange={(e) => { actions.assign(o.id, e.target.value); toast(`${o.id} → ${exName(e.target.value)}`); }}>
              <option value="" disabled>Choose an expert…</option>
              {experts.filter((x) => x.status === 'active').map((x) => <option key={x.id} value={x.id}>{x.name} · {x.domains[0]} · {loads[x.id] || 0}/{x.cap}{x.domains.includes(o.domain) ? ' ✓ domain' : ''}</option>)}
            </select>
          </div>
          {suggestion && <button type="button" className="btn btn-signal" onClick={() => { actions.assign(o.id, suggestion.id); toast(`Assigned to ${suggestion.name}`); }}>✦ Best match: {suggestion.name} (★ {suggestion.rating}, {suggestion.onTime}% on time) — assign</button>}
        </div>
      )}

      <Tabs label="Order details" value={tab} onChange={setTab} tabs={[['timeline', 'Timeline'], ['intake', 'Intake'], ['files', 'Files'], ['messages', 'Messages'], ['notes', `Notes${notes[o.id]?.length ? ` (${notes[o.id].length})` : ''}`]]} />
      {tab === 'timeline' && <ol className="stack g8" style={{ margin: 0, paddingLeft: 18 }}>{orderTimeline(o).map(([l, t]) => <li key={l} className="small"><strong>{l}</strong> <span className="muted">· {fmtDT(t)}</span></li>)}{o.deadline && <li className="small muted">Deadline · {fmtDT(o.deadline)}</li>}</ol>}
      {tab === 'intake' && <div className="stack g4 small"><span><strong>Target role:</strong> {o.role}</span><span><strong>Experience:</strong> Fresher (0–1 yr)</span><span><strong>Top wins to highlight:</strong> “Built a Power BI dashboard for my college fest; internship at a local firm.”</span><span><strong>Anything to avoid:</strong> “Don’t mention my gap year in detail.”</span><span className="xs faint">Sample answers in this preview.</span></div>}
      {tab === 'files' && <div className="stack g4 small">{['Original upload · v0', ...(o.stage !== 'Placed' && o.stage !== 'Expert assigned' ? ['Draft 1 · v1'] : []), ...(['Revisions', 'Delivered', 'Approved'].includes(o.stage) ? ['Draft 2 · v2'] : []), ...(o.deliveredAt ? ['Final PDF + DOCX · v3'] : [])].map((f) => <span key={f} className="row between well"><span>{f}</span><span className="xs faint">ATS {f.includes('v0') ? o.atsBefore : o.atsAfter || '—'}</span></span>)}<span className="xs faint">Files are deleted 60 days after delivery.</span></div>}
      {tab === 'messages' && <div className="stack g8 small"><span className="well"><strong>{o.customer}:</strong> Can you make it one page?</span>{o.expert && <span className="well"><strong>{exName(o.expert)}:</strong> Yes — draft 2 trims projects to the best two.</span>}<span className="xs faint">Customer ↔ expert chat (sample).</span></div>}
      {tab === 'notes' && (
        <div className="stack g8">
          {(notes[o.id] || []).map((n, i) => <span key={i} className="well small"><strong>{n.who}</strong> <span className="faint xs">{fmtDT(n.at)}</span><br />{n.text}</span>)}
          <form className="row g8" style={{ flexWrap: 'nowrap' }} onSubmit={(e) => { e.preventDefault(); if (note.trim()) { actions.addNote(o.id, note.trim()); setNote(''); } }}>
            <label htmlFor="nt" className="sr-only">Internal note</label>
            <input id="nt" className="input" style={{ height: 42 }} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Internal note (customer never sees it)" />
            <button type="submit" className="btn btn-ink" disabled={!note.trim()}>Add</button>
          </form>
        </div>
      )}

      {live && (
        <div className="stack g8">
          <strong className="small">Actions</strong>
          <div className="row g8" style={{ alignItems: 'flex-end' }}>
            <div className="field" style={{ flex: '0 0 90px' }}><label htmlFor="ext-h" className="label">Extend</label><select id="ext-h" className="input" style={{ height: 40 }} value={ext.hours} onChange={(e) => setExt({ ...ext, hours: +e.target.value })}>{[6, 12, 24].map((h) => <option key={h} value={h}>+{h}h</option>)}</select></div>
            <div className="field" style={{ flex: 1 }}><label htmlFor="ext-r" className="label">Reason (customer is told)</label><input id="ext-r" className="input" style={{ height: 40 }} value={ext.reason} onChange={(e) => setExt({ ...ext, reason: e.target.value })} placeholder="e.g. Customer sent intake late" /></div>
            <button type="button" className="btn btn-outline" disabled={!ext.reason.trim()} onClick={() => { actions.extend(o.id, ext.hours, ext.reason); setExt({ hours: 12, reason: '' }); toast('Deadline extended'); }}>Extend</button>
          </div>
          <div className="row g8">
            <button type="button" className="btn btn-outline" onClick={() => { actions.setStage(o.id, 'Revisions', 'free re-do added'); toast('Free re-do added'); }}>Add free re-do</button>
            <button type="button" className="btn btn-danger-soft" style={{ minHeight: 40 }} onClick={() => { actions.setStage(o.id, 'Cancelled', 'cancelled by admin'); toast('Order cancelled — open a refund if needed'); }}>Cancel order</button>
          </div>
        </div>
      )}
      {!rf && o.stage !== 'Refunded' && (
        <form className="stack g8" onSubmit={(e) => { e.preventDefault(); const id = actions.openRefund(o.id, refundWhy); setRefundWhy(''); toast(`Refund case ${id} opened`); }}>
          <label htmlFor="rf-why" className="label">Open a refund case</label>
          <div className="row g8" style={{ flexWrap: 'nowrap' }}><input id="rf-why" className="input" style={{ height: 40 }} value={refundWhy} onChange={(e) => setRefundWhy(e.target.value)} placeholder="Reason" /><button type="submit" className="btn btn-outline" disabled={!refundWhy.trim()}>Open</button></div>
        </form>
      )}
    </Panel>
  );
}

export default function Orders() {
  const { orders, experts, actions, exName } = useAdmin();
  const toast = useToast();
  const [params, setParams] = useSearchParams();
  const view = params.get('view') || 'all';
  const selId = params.get('id');
  const [q, setQ] = useState('');
  const [plan, setPlan] = useState('');
  const [domain, setDomain] = useState('');
  const [expert, setExpert] = useState('');
  const [checked, setChecked] = useState([]);
  const [bulkTo, setBulkTo] = useState('');

  const list = useMemo(() => {
    const f = VIEWS.find(([v]) => v === view)?.[2] || (() => true);
    return orders.filter(f).filter((o) => (!plan || o.planId === plan) && (!domain || o.domain === domain) && (!expert || o.expert === expert) && (!q || `${o.id} ${o.customer} ${o.role}`.toLowerCase().includes(q.toLowerCase())))
      .sort((a, b) => (hoursLeft(a) ?? 1e9) - (hoursLeft(b) ?? 1e9) || b.createdAt - a.createdAt);
  }, [orders, view, plan, domain, expert, q]);
  const sel = orders.find((o) => o.id === selId);
  const set = (k, v) => { const p = new URLSearchParams(params); if (v) p.set(k, v); else p.delete(k); setParams(p); };
  const counts = Object.fromEntries(VIEWS.map(([v, , f]) => [v, orders.filter(f).length]));
  const unassignedIds = orders.filter((o) => !o.expert && o.stage === 'Placed').map((o) => o.id);

  return (
    <>
      <PageHead title="Orders" sub="Late and due-soon orders are always on top."
        right={<>
          <button type="button" className="btn btn-signal" disabled={!unassignedIds.length} onClick={() => toast(`Auto-assigned ${actions.autoAssign(unassignedIds)} order(s) by domain, rating, on-time and free capacity`)}>✦ Auto-assign {unassignedIds.length || ''}</button>
          <button type="button" className="btn btn-outline" onClick={() => downloadCsv('orders.csv', [['Order', 'Customer', 'Plan', 'Price', 'Domain', 'Role', 'Expert', 'Stage', 'Placed', 'Deadline'], ...list.map((o) => [o.id, o.customer, PLANS[o.planId].name, o.price, o.domain, o.role, exName(o.expert), o.stage, fmtDT(o.createdAt), o.deadline ? fmtDT(o.deadline) : ''])])}>Export CSV</button>
        </>} />
      <div className="row g8" role="tablist" aria-label="Saved views">
        {VIEWS.map(([v, l]) => <button key={v} type="button" role="tab" aria-selected={view === v} className="chip" aria-pressed={view === v} style={{ minHeight: 36, fontSize: 13 }} onClick={() => set('view', v === 'all' ? '' : v)}>{l} <span className="mono xs" style={{ opacity: 0.7 }}>{counts[v]}</span></button>)}
      </div>
      <div className="row g8">
        <label htmlFor="oq" className="sr-only">Search</label><input id="oq" className="input" style={{ height: 40, flex: '1 1 200px' }} placeholder="Search order, customer, role" value={q} onChange={(e) => setQ(e.target.value)} />
        <select aria-label="Plan" className="input" style={{ height: 40, width: 'auto' }} value={plan} onChange={(e) => setPlan(e.target.value)}><option value="">All plans</option>{Object.values(PLANS).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select>
        <select aria-label="Domain" className="input" style={{ height: 40, width: 'auto' }} value={domain} onChange={(e) => setDomain(e.target.value)}><option value="">All domains</option>{DOMAINS.map((d) => <option key={d}>{d}</option>)}</select>
        <select aria-label="Expert" className="input" style={{ height: 40, width: 'auto' }} value={expert} onChange={(e) => setExpert(e.target.value)}><option value="">All experts</option>{experts.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select>
      </div>
      {checked.length > 0 && (
        <div className="card row g8" style={{ padding: 12, borderColor: 'var(--ink)' }}>
          <strong className="small">{checked.length} selected</strong>
          <select aria-label="Assign selected to" className="input" style={{ height: 40, width: 'auto' }} value={bulkTo} onChange={(e) => setBulkTo(e.target.value)}><option value="">Assign to…</option>{experts.filter((x) => x.status === 'active').map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select>
          <button type="button" className="btn btn-ink" disabled={!bulkTo} onClick={() => { checked.forEach((id) => actions.assign(id, bulkTo)); toast(`${checked.length} orders → ${exName(bulkTo)}`); setChecked([]); }}>Assign</button>
          <button type="button" className="btn btn-signal" onClick={() => { toast(`Auto-assigned ${actions.autoAssign(checked)} order(s)`); setChecked([]); }}>Auto-assign selected</button>
          <button type="button" className="btn btn-ghost" onClick={() => setChecked([])}>Clear</button>
        </div>
      )}
      <div className="row g16" style={{ alignItems: 'flex-start' }}>
        <div className="card table-wrap" style={{ flex: '3 1 560px', padding: 0 }}>
          {list.length === 0 ? <Empty>No orders in this view.</Empty> : (
            <table className="table">
              <thead><tr><th><span className="sr-only">Select</span></th><th>Order</th><th>Plan</th><th>Expert</th><th>Stage</th><th>Deadline</th></tr></thead>
              <tbody>
                {list.map((o) => (
                  <tr key={o.id} className={`clickable${selId === o.id ? ' sel' : ''}`} onClick={() => set('id', o.id)}>
                    <td onClick={(e) => e.stopPropagation()}>{o.planId !== 'diy' && hoursLeft(o) !== null && <input type="checkbox" aria-label={`Select ${o.id}`} checked={checked.includes(o.id)} onChange={(e) => setChecked((c) => (e.target.checked ? [...c, o.id] : c.filter((x) => x !== o.id)))} />}</td>
                    <td><button type="button" className="stack" style={{ border: 0, background: 'none', padding: 0, textAlign: 'left' }} onClick={() => set('id', o.id)}><strong>{o.customer}</strong><span className="mono xs faint">{o.id} · {o.role}</span></button></td>
                    <td className="small">{PLANS[o.planId].name}</td>
                    <td className="small" style={{ color: o.expert || o.planId === 'diy' ? undefined : 'var(--warning)', fontWeight: o.expert ? 400 : 600 }}>{o.planId === 'diy' ? '—' : exName(o.expert)}</td>
                    <td><span className={`badge ${STAGE_BADGE[o.stage]}`}>{o.stage}</span></td>
                    <td><Timer o={o} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
        {sel && <Detail key={sel.id} o={sel} onClose={() => set('id', '')} />}
      </div>
    </>
  );
}
