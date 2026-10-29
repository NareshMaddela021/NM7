// Refunds & disputes, following the agreed rules: late = automatic; quality = free re-do first; review within 24h.
import { useState } from 'react';
import { useSearchParams, Link } from 'react-router-dom';
import { useToast } from '../../components/ui';
import { useAdmin } from './AdminContext';
import { PageHead, Panel, Tabs, Empty, inr, fmtDT, ago } from './AdminUI';
import { NOW_MS } from '../../data/adminData';

const ST = { review: ['To review', 'b-warning'], 'redo-offered': ['Re-do offered', 'b-neutral'], 'auto-approved': ['Auto-approved (late)', 'b-success'], refunded: ['Refunded', 'b-success'], rejected: ['Rejected', 'b-danger'] };
const TYPE = { late: 'Late delivery', quality: 'Quality complaint', other: 'Other' };

function Detail({ r, onClose }) {
  const { orders, actions, exName, settings } = useAdmin();
  const toast = useToast();
  const o = orders.find((x) => x.id === r.orderId) || {};
  const [note, setNote] = useState('');
  const [amt, setAmt] = useState(Math.round(r.amount / 2));
  const left = settings.rules.refundReviewHours - (NOW_MS - r.at) / 3600000;
  const decide = (d) => { actions.decideRefund(r.id, d, amt, note); toast(d === 'reject' ? 'Rejected — customer told why' : d === 'redo' ? 'Free re-do offered' : `Refund of ${inr(d === 'partial' ? amt : r.amount)} sent to Razorpay`); setNote(''); };
  return (
    <Panel title={`${r.id} · ${TYPE[r.type]}`} onClose={onClose}>
      <div className="row g8"><span className={`badge ${ST[r.status][1]}`}>{ST[r.status][0]}</span><span className="badge b-neutral">{inr(r.amount)}</span>{r.status === 'review' && <span className="badge" style={{ color: left < 4 ? 'var(--danger)' : 'var(--warning)' }}>{left > 0 ? `${Math.round(left)}h left to decide` : 'Past 24h — decide now'}</span>}</div>
      <span className="small"><Link to={`/admin/orders?id=${r.orderId}`}>{r.orderId}</Link> · {o.customer} · {o.role} · expert {exName(o.expert)}</span>
      <div className="well stack g4 small"><strong>Customer says</strong><span>{r.reason}</span><span className="xs faint">{fmtDT(r.at)}</span></div>
      <div className="well stack g4 small"><strong>Expert says</strong><span>{r.expertSide}</span></div>
      <div className="stack g4 small"><strong>Rule</strong><span className="muted">{r.type === 'late' ? 'Late delivery → full refund automatically. Nothing to decide.' : r.type === 'quality' ? 'Quality complaint → offer one free re-do first. If the customer still isn’t happy, decide within 24 hours.' : 'Review against the refund policy within 24 hours.'}</span></div>
      {r.rp && <div className="stack g4 small"><strong>Razorpay refund</strong><ol className="steps" aria-label="Refund progress"><li data-state="done"><span className="mono">✓</span>Started</li><li aria-current={r.rp === 'processing' ? 'step' : undefined} data-state={r.rp === 'done' ? 'done' : undefined}><span className="mono">{r.rp === 'done' ? '✓' : 2}</span>Processing</li><li data-state={r.rp === 'done' ? 'done' : undefined}><span className="mono">{r.rp === 'done' ? '✓' : 3}</span>In bank (3–5 days)</li></ol></div>}
      {r.note && <span className="small"><strong>Decision note:</strong> {r.note}</span>}
      {['review', 'redo-offered'].includes(r.status) && (
        <div className="stack g8">
          <label htmlFor="rf-note" className="label">Note to the customer</label>
          <textarea id="rf-note" className="input" rows={3} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Explain the decision in one or two lines." />
          <div className="row g8">
            {r.type === 'quality' && r.status === 'review' && <button type="button" className="btn btn-outline" onClick={() => decide('redo')}>Offer free re-do</button>}
            <button type="button" className="btn btn-ink" onClick={() => decide('approve')}>Approve full refund</button>
            <span className="row g4" style={{ flexWrap: 'nowrap' }}><label htmlFor="rf-amt" className="sr-only">Partial amount</label><input id="rf-amt" className="input" style={{ height: 40, width: 100 }} type="number" min={1} max={r.amount} value={amt} onChange={(e) => setAmt(Math.min(r.amount, Math.max(1, +e.target.value || 0)))} /><button type="button" className="btn btn-outline" onClick={() => decide('partial')}>Partial</button></span>
            <button type="button" className="btn btn-danger-soft" style={{ minHeight: 40 }} disabled={!note.trim()} onClick={() => decide('reject')}>Reject</button>
          </div>
          {!note.trim() && <span className="xs faint">A note is required to reject.</span>}
        </div>
      )}
    </Panel>
  );
}

export default function Refunds() {
  const { refunds } = useAdmin();
  const [params, setParams] = useSearchParams();
  const [f, setF] = useState('open');
  const sel = refunds.find((r) => r.id === params.get('id'));
  const list = refunds.filter((r) => (f === 'open' ? ['review', 'redo-offered'].includes(r.status) : f === 'all' ? true : !['review', 'redo-offered'].includes(r.status)));
  return (
    <>
      <PageHead title="Refunds & disputes" sub="Late = automatic refund · quality = free re-do first · decide within 24 hours." />
      <Tabs label="Filter" value={f} onChange={setF} tabs={[['open', `Open (${refunds.filter((r) => ['review', 'redo-offered'].includes(r.status)).length})`], ['closed', 'Closed'], ['all', 'All']]} />
      <div className="row g16" style={{ alignItems: 'flex-start' }}>
        <div className="card table-wrap" tabIndex={0} role="region" aria-label="Table — scroll sideways to see all columns" style={{ flex: '3 1 520px', padding: 0 }}>
          {list.length === 0 ? <Empty>Nothing here.</Empty> : (
            <table className="table"><thead><tr><th>Case</th><th>Type</th><th>Amount</th><th>Opened</th><th>Status</th></tr></thead>
              <tbody>{list.map((r) => (
                <tr key={r.id} className={`clickable${sel?.id === r.id ? ' sel' : ''}`} onClick={() => setParams({ id: r.id })}>
                  <td><button type="button" className="stack" style={{ border: 0, background: 'none', padding: 0, textAlign: 'left' }} onClick={() => setParams({ id: r.id })}><strong>{r.id}</strong><span className="mono xs faint">{r.orderId}</span></button></td>
                  <td className="small">{TYPE[r.type]}</td><td>{inr(r.amount)}</td><td className="small">{ago(r.at, NOW_MS)}</td>
                  <td><span className={`badge ${ST[r.status][1]}`}>{ST[r.status][0]}</span></td>
                </tr>))}</tbody></table>
          )}
        </div>
        {sel && <Detail key={sel.id + sel.status} r={sel} onClose={() => setParams({})} />}
      </div>
    </>
  );
}
