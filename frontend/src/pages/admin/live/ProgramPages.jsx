// Admin → Programs (Phase 6, S8): internships and live projects held because they may be free labour (unpaid for
// many students, very long and unpaid, or sounding like the company's paid work). Approve to show it, or remove it.
import { useState } from 'react';
import { useToast } from '../../../components/ui';
import { PageHead } from '../AdminUI';
import { Loading, http, useAction, useApi } from './common';

export function LivePrograms() {
  const [all, setAll] = useState(false);
  const st = useApi(`/api/admin/programs${all ? '' : '?flagged=true'}`);
  const toast = useToast();
  const [busy, run] = useAction(toast);
  const act = (id, approve) => run(async () => { await http(`/api/admin/programs/${id}/review`, { method: 'POST', body: { approve } }); st.reload(); }, approve ? 'Approved' : 'Removed');
  return (
    <>
      <PageHead title="Internships & projects" sub="Held for a check when they may be free labour. Approve to show them to students, or remove them." right={<button type="button" className="btn btn-outline btn-sm" onClick={() => setAll(!all)}>{all ? 'Show held only' : 'Show all'}</button>} />
      <Loading st={st}>{(rows) => (
        <ul className="stack g8" style={{ listStyle: 'none', padding: 0, margin: 0 }}>
          {!rows.length && <li className="small muted">Nothing waiting.</li>}
          {rows.map((p) => (
            <li key={p.id} className="card-sm stack g4" data-testid="ad-pg-row">
              <strong className="small">{p.title} · {p.company.name} · {p.status}</strong>
              <span className="xs muted">{p.kind} · {p.stipend ? `₹${p.stipend}` : 'Unpaid'} · {p.weeks} weeks · {p.seats} places</span>
              {p.flags.length > 0 && <span className="small">Why held: {p.flags.join('; ')}</span>}
              <span className="xs">{p.brief}</span>
              {p.status === 'review' && <div className="row g8"><button type="button" className="btn btn-ink btn-sm" disabled={busy} onClick={() => act(p.id, true)}>Approve</button><button type="button" className="btn btn-outline btn-sm" disabled={busy} onClick={() => act(p.id, false)} data-testid="ad-pg-remove">Remove</button></div>}
            </li>
          ))}
        </ul>
      )}</Loading>
    </>
  );
}
