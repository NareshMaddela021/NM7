// Admin → Joining reports (Phase 6, S10): "the job is not what was promised" from the day 7 / day 30 check-ins.
// Close one when handled, or dismiss it when it isn't about the company (then it no longer lowers the trust score).
import { useState } from 'react';
import { useToast } from '../../../components/ui';
import { PageHead } from '../AdminUI';
import { Loading, http, useAction, useApi } from './common';

export function LiveJoiningReports() {
  const [status, setStatus] = useState('open');
  const st = useApi(`/api/admin/joining-reports?status=${status}`);
  const toast = useToast();
  const [busy, run] = useAction(toast);
  const close = (id, dismiss) => run(async () => { await http(`/api/admin/joining-reports/${id}/close`, { method: 'POST', body: { dismiss } }); st.reload(); }, dismiss ? 'Dismissed' : 'Closed');
  return (
    <>
      <PageHead title="Joining reports" sub="From people who joined a job and say it isn't what was promised. Reports from two or more people lower the company's trust score." right={<select className="input" style={{ height: 36, width: 'auto' }} value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Show"><option value="open">Open</option><option value="closed">Closed</option><option value="dismissed">Dismissed</option></select>} />
      <Loading st={st}>{(rows) => (
        <ul className="stack g8" style={{ listStyle: 'none', padding: 0, margin: 0 }}>
          {!rows.length && <li className="small muted">Nothing here.</li>}
          {rows.map((r) => (
            <li key={r.id} className="card-sm stack g4" data-testid="ad-jr-row">
              <strong className="small">{r.company} · {r.role} · day {r.day}</strong>
              <span className="small">{r.problems.join(', ')}</span>
              {r.note && <span className="xs">{r.note}</span>}
              {r.status === 'open' && <div className="row g8"><button type="button" className="btn btn-ink btn-sm" disabled={busy} onClick={() => close(r.id, false)}>Close</button><button type="button" className="btn btn-outline btn-sm" disabled={busy} onClick={() => close(r.id, true)}>Dismiss (not about the company)</button></div>}
            </li>
          ))}
        </ul>
      )}</Loading>
    </>
  );
}
