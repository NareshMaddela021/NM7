// Quality: random audits with a checklist, ATS before/after, low ratings.
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useToast } from '../../components/ui';
import { useAdmin } from './AdminContext';
import { PageHead, Kpi, HBars, Empty } from './AdminUI';
import { QA_CHECKS } from '../../data/adminData';

function AuditCard({ a }) {
  const { orders, actions, exName } = useAdmin();
  const toast = useToast();
  const o = orders.find((x) => x.id === a.orderId) || {};
  const [s, setS] = useState(a.scores || QA_CHECKS.map(() => null));
  const done = a.scores;
  return (
    <div className="card stack g8" style={{ padding: 16 }}>
      <div className="row between g8"><span className="small"><Link to={`/admin/orders?id=${a.orderId}`}><strong>{a.orderId}</strong></Link> · {o.role} · {exName(a.expert)}</span>{done ? <span className={`badge ${done.filter(Boolean).length >= 4 ? 'b-success' : 'b-warning'}`}>{done.filter(Boolean).length}/{done.length}</span> : <span className="badge b-neutral">To check</span>}</div>
      <span className="xs muted">ATS {o.atsBefore} → {o.atsAfter ?? '—'}{o.rating ? ` · customer ★ ${o.rating}` : ''}</span>
      {QA_CHECKS.map((c, i) => (
        <div key={c} className="row between g8 small" style={{ flexWrap: 'nowrap' }}>
          <span>{c}</span>
          <span className="segmented" role="radiogroup" aria-label={c} style={{ flex: 'none' }}>
            {[[1, 'Pass'], [0, 'Fail']].map(([v, l]) => <button key={l} type="button" role="radio" aria-checked={s[i] === v} aria-pressed={s[i] === v} disabled={!!done} style={{ minHeight: 30, fontSize: 12 }} onClick={() => setS((p) => p.map((x, j) => (j === i ? v : x)))}>{l}</button>)}
          </span>
        </div>
      ))}
      {!done && <button type="button" className="btn btn-ink" disabled={s.some((x) => x === null)} onClick={() => { actions.audit(a.orderId, s); toast('Audit saved'); }}>Save audit</button>}
    </div>
  );
}

export default function Quality() {
  const { audits, orders, experts, settings, actions } = useAdmin();
  const toast = useToast();
  const delivered = orders.filter((o) => o.atsAfter && o.planId !== 'diy');
  const avg = (k) => Math.round(delivered.reduce((s, o) => s + o[k], 0) / Math.max(1, delivered.length));
  const low = orders.filter((o) => o.rating && o.rating <= 3);
  const scored = audits.filter((a) => a.scores);
  const passRate = scored.length ? Math.round((scored.reduce((s, a) => s + a.scores.filter(Boolean).length, 0) / (scored.length * QA_CHECKS.length)) * 100) : 0;
  const pickMore = () => {
    const pool = delivered.filter((o) => !audits.some((a) => a.orderId === o.id));
    const n = Math.max(1, Math.round(delivered.length * settings.auditPct / 100) - audits.length);
    pool.sort(() => Math.random() - 0.5).slice(0, n).forEach((o) => actions.addAudit(o.id, o.expert));
    toast(`Picked ${Math.min(n, pool.length)} delivery(ies) at random`);
  };
  return (
    <>
      <PageHead title="Quality" sub={`${settings.auditPct}% of delivered resumes are picked at random for a checklist review.`} right={<button type="button" className="btn btn-outline" onClick={pickMore}>Pick random deliveries</button>} />
      <div className="kpis">
        <Kpi label="ATS score before → after" value={`${avg('atsBefore')} → ${avg('atsAfter')}`} sub={`+${avg('atsAfter') - avg('atsBefore')} points on average`} tone="var(--success)" />
        <Kpi label="Audit pass rate" value={`${passRate}%`} sub={`${scored.length} audits done`} />
        <Kpi label="Low ratings (≤ 3★)" value={low.length} sub="Check these first" tone={low.length ? 'var(--warning)' : undefined} />
      </div>
      <div className="row g16" style={{ alignItems: 'flex-start' }}>
        <div className="stack g12" style={{ flex: '2 1 460px' }}>
          <strong>Audit queue</strong>
          {audits.length === 0 ? <Empty>No deliveries picked yet.</Empty> : audits.map((a) => <AuditCard key={a.orderId} a={a} />)}
        </div>
        <div className="stack g16" style={{ flex: '1 1 300px' }}>
          <div className="card"><HBars title="ATS points gained by expert" color="var(--viz-3)" rows={experts.map((x) => { const os = delivered.filter((o) => o.expert === x.id); return { label: x.name, value: os.length ? Math.round(os.reduce((s, o) => s + (o.atsAfter - o.atsBefore), 0) / os.length) : 0 }; }).sort((a, b) => b.value - a.value)} fmt={(v) => `+${v}`} /></div>
          <div className="card stack g8"><strong className="small">Low ratings</strong>{low.length ? low.map((o) => <Link key={o.id} to={`/admin/orders?id=${o.id}`} className="small">{o.id} · ★ {o.rating} · {o.role}</Link>) : <span className="small muted">None.</span>}</div>
        </div>
      </div>
    </>
  );
}
