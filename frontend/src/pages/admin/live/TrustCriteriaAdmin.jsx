// Admin -> Skill checks -> Vetting Trust -> Evidence to check (T7; owner only, the "settings" permission). Certificates a
// candidate added as evidence for a job requirement: open the file, then Accept (it becomes evidence, quoted as
// "Certificate checked by Nm7") or Not accepted (the person is told). Also how many requirement checks wait for the AI.
// /api/admin/trust/criteria (every decision audited).
import { useState } from 'react';
import { useToast } from '../../../components/ui';
import { API_BASE } from '../../../services/http';
import { Loading, http, useAction, useApi, when } from './common';

function Claim({ r, reload }) {
  const toast = useToast();
  const [busy, run] = useAction(toast);
  const [note, setNote] = useState('');
  const decide = (decision) => run(async () => { await http(`/api/admin/trust/criteria/claims/${r.id}/review`, { method: 'POST', body: { decision, note } }); reload(); },
    decision === 'verify' ? 'Accepted: it counts as evidence' : 'Not accepted: the person is told');
  return (
    <li className="card stack g8" data-testid="tcr-item">
      <strong style={{ overflowWrap: 'anywhere' }}>{r.userName} · {r.title}</strong>
      <span className="small" style={{ overflowWrap: 'anywhere' }}>For the requirement “{r.criterion}” · sent {when(r.at)}{r.note ? ` · their note: ${r.note}` : ''}</span>
      <a className="small" href={`${API_BASE}/api/admin/trust/criteria/claims/${r.id}/file`} target="_blank" rel="noreferrer">Open the certificate</a>
      <div className="row g8" style={{ flexWrap: 'wrap', alignItems: 'flex-end' }}>
        <div className="field" style={{ flex: '1 1 220px' }}><label className="label" htmlFor={`tcr-n-${r.id}`}>Note to the person (optional)</label><input id={`tcr-n-${r.id}`} className="input" value={note} onChange={(e) => setNote(e.target.value)} /></div>
        <button type="button" className="btn btn-signal" style={{ minHeight: 44 }} disabled={busy} onClick={() => decide('verify')} data-testid="tcr-verify">Accept</button>
        <button type="button" className="btn btn-outline" style={{ minHeight: 44 }} disabled={busy} onClick={() => decide('reject')} data-testid="tcr-reject">Not accepted</button>
      </div>
    </li>
  );
}

export default function TrustCriteriaAdmin() {
  const st = useApi('/api/admin/trust/criteria');
  return (
    <section className="card stack g12" aria-labelledby="tcr-h" data-testid="tcr-card">
      <h2 id="tcr-h" className="h3" style={{ margin: 0 }}>Job requirements: evidence to check</h2>
      <Loading st={st}>{(d) => (
        <>
          <p className="small" style={{ margin: 0 }}>Certificates candidates added for a job requirement. Accepted ones count as evidence (“Certificate checked by Nm7”). Requirement checks waiting for the AI: {d.queue}.</p>
          <p className="small muted" style={{ margin: 0 }} data-testid="tcr-counts">Waiting {d.counts.pending} · accepted {d.counts.verified} · not accepted {d.counts.rejected}</p>
          {d.pending.length ? <ul className="stack g8" style={{ listStyle: 'none', padding: 0, margin: 0 }}>{d.pending.map((r) => <Claim key={r.id} r={r} reload={st.reload} />)}</ul>
            : <p className="small muted" style={{ margin: 0 }}>Nothing to check.</p>}
        </>
      )}</Loading>
    </section>
  );
}
