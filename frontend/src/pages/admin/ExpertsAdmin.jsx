// Experts: directory with performance, tiers and controls; applications tab (approve / needs changes).
import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useToast } from '../../components/ui';
import { useAdmin } from './AdminContext';
import { PageHead, Panel, Tabs, inr } from './AdminUI';
import { ApplicationsPanel } from './Applications';
import { expertPayout } from '../../lib/pricing';

const TIERS = ['New', 'Trusted', 'Top expert'];
const STATUS_BADGE = { active: 'b-success', paused: 'b-warning', suspended: 'b-danger' };

function Detail({ x, onClose }) {
  const { orders, loads, actions, payouts } = useAdmin();
  const toast = useToast();
  const [reason, setReason] = useState('');
  const mine = orders.filter((o) => o.expert === x.id);
  const done = mine.filter((o) => o.deliveredAt);
  const earned = done.reduce((s, o) => s + expertPayout(o.price).net, 0);
  return (
    <Panel title={x.name} onClose={onClose}>
      <div className="row g8"><span className={`badge ${STATUS_BADGE[x.status]}`}>{x.status}</span><span className="badge b-neutral">{x.tier}</span>{x.ai && <span className="badge b-signal">Linked to asuraa.ai</span>}</div>
      <span className="small muted">{x.domains.join(', ')}</span>
      <div className="grid-auto g8 small" style={{ '--min': '140px' }}>
        <span className="well"><strong>{x.onTime}%</strong><br /><span className="xs muted">on time</span></span>
        <span className="well"><strong>★ {x.rating}</strong><br /><span className="xs muted">rating</span></span>
        <span className="well"><strong>{x.revisions}</strong><br /><span className="xs muted">revisions / order</span></span>
        <span className="well"><strong>{x.refunds}</strong><br /><span className="xs muted">refunds caused (30d)</span></span>
        <span className="well"><strong>{done.length}</strong><br /><span className="xs muted">delivered</span></span>
        <span className="well"><strong>{inr(earned)}</strong><br /><span className="xs muted">earned (net)</span></span>
      </div>
      <div className="stack g8">
        <span className="label">Capacity · {loads[x.id] || 0} active of {x.cap}</span>
        <div className="row g8"><button type="button" className="btn btn-outline" aria-label="Lower capacity" disabled={x.cap <= 1} onClick={() => actions.expert(x.id, { cap: x.cap - 1 }, 'capacity changed')}>−</button><strong className="mono">{x.cap}/week</strong><button type="button" className="btn btn-outline" aria-label="Raise capacity" onClick={() => actions.expert(x.id, { cap: x.cap + 1 }, 'capacity changed')}>+</button></div>
      </div>
      <div className="stack g8">
        <span className="label">Tier (Top experts get ₹2,999 orders first)</span>
        <div className="segmented" role="radiogroup" aria-label="Tier" style={{ alignSelf: 'flex-start' }}>{TIERS.map((t) => <button key={t} type="button" role="radio" aria-checked={x.tier === t} aria-pressed={x.tier === t} onClick={() => { actions.expert(x.id, { tier: t }, 'tier changed'); toast(`${x.name} is now ${t}`); }}>{t}</button>)}</div>
      </div>
      <div className="stack g8">
        <label htmlFor="ex-why" className="label">Reason (needed to pause or suspend — the expert sees it)</label>
        <input id="ex-why" className="input" style={{ height: 42 }} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. 2 late deliveries this week" />
        <div className="row g8">
          {x.status !== 'active' && <button type="button" className="btn btn-ink" onClick={() => { actions.expert(x.id, { status: 'active' }, 'reactivated'); toast(`${x.name} is active again`); }}>Make active</button>}
          {x.status === 'active' && <button type="button" className="btn btn-outline" disabled={!reason.trim()} onClick={() => { actions.expert(x.id, { status: 'paused' }, `paused — ${reason}`); setReason(''); toast('Paused — no new orders'); }}>Pause</button>}
          {x.status !== 'suspended' && <button type="button" className="btn btn-danger-soft" style={{ minHeight: 40 }} disabled={!reason.trim()} onClick={() => { actions.expert(x.id, { status: 'suspended' }, `suspended — ${reason}`); setReason(''); toast('Suspended'); }}>Suspend</button>}
        </div>
      </div>
      <div className="stack g4 small"><strong>Recent orders</strong>{mine.slice(0, 5).map((o) => <span key={o.id} className="muted">{o.id} · {o.role} · {o.stage}{o.rating ? ` · ★ ${o.rating}` : ''}</span>)}</div>
      <div className="stack g4 small"><strong>Payouts</strong>{payouts.filter((p) => p.expert === x.id).map((p) => <span key={p.id} className="muted">{p.id} · {inr(p.amount)} · {p.status}</span>)}<span className="xs faint">PAN ••••••{['1234F', '6789K', '4455Q'][x.id.charCodeAt(0) % 3]} · documents on file</span></div>
    </Panel>
  );
}

export default function ExpertsAdmin() {
  const { experts, loads } = useAdmin();
  const [params, setParams] = useSearchParams();
  const tab = params.get('tab') || 'directory';
  const sel = experts.find((x) => x.id === params.get('id'));
  const set = (k, v) => { const p = new URLSearchParams(params); if (v) p.set(k, v); else p.delete(k); setParams(p); };
  return (
    <>
      <PageHead title="Experts" sub="Performance, capacity, tiers and applications." />
      <Tabs label="Experts" value={tab} onChange={(v) => set('tab', v === 'directory' ? '' : v)} tabs={[['directory', 'Directory'], ['applications', 'Applications']]} />
      {tab === 'applications' ? <ApplicationsPanel /> : (
        <div className="row g16" style={{ alignItems: 'flex-start' }}>
          <div className="card table-wrap" tabIndex={0} role="region" aria-label="Table — scroll sideways to see all columns" style={{ flex: '3 1 560px', padding: 0 }}>
            <table className="table">
              <thead><tr><th>Expert</th><th>On time</th><th>Rating</th><th>Revisions</th><th>Refunds</th><th>Load</th><th>Tier</th><th>Status</th></tr></thead>
              <tbody>
                {experts.map((x) => (
                  <tr key={x.id} className={`clickable${sel?.id === x.id ? ' sel' : ''}`} onClick={() => set('id', x.id)}>
                    <td><button type="button" className="stack" style={{ border: 0, background: 'none', padding: 0, textAlign: 'left' }} onClick={() => set('id', x.id)}><strong>{x.name}{x.ai ? ' ✦' : ''}</strong><span className="xs faint">{x.domains.join(', ')}</span></button></td>
                    <td style={{ color: x.onTime < 85 ? 'var(--danger)' : undefined }}>{x.onTime}%</td>
                    <td>★ {x.rating}</td><td>{x.revisions}</td>
                    <td style={{ color: x.refunds >= 2 ? 'var(--danger)' : undefined }}>{x.refunds}</td>
                    <td className="mono">{loads[x.id] || 0}/{x.cap}</td>
                    <td className="small">{x.tier}</td>
                    <td><span className={`badge ${STATUS_BADGE[x.status]}`}>{x.status}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
            <span className="xs faint" style={{ display: 'block', padding: 12 }}>✦ linked to asuraa.ai · red = needs attention (under 85% on time or 2+ refunds)</span>
          </div>
          {sel && <Detail key={sel.id} x={sel} onClose={() => set('id', '')} />}
        </div>
      )}
    </>
  );
}
