// Org > Reviewers: invite faculty mentors as Reviewers (they sign in with their own Nm7 account) and assign students
// to each. A reviewer sees only the students assigned to them.
import { useState } from 'react';
import { Dialog, useToast } from '../../components/ui';
import { Loading, emptyIf, http, useAction, useApi } from '../admin/live/common';

function Assign({ base, r, onClose, onSaved }) {
  const toast = useToast();
  const [busy, run] = useAction(toast);
  const st = useApi(`${base}/${r.id}/students`);
  const [sel, setSel] = useState(null);
  const chosen = sel || new Set(st.data?.chosen || []);
  const flip = (id) => { const n = new Set(chosen); if (n.has(id)) n.delete(id); else n.add(id); setSel(n); };
  return (
    <Dialog showTitle title={`Students for ${r.name || r.email}`} onClose={onClose}>
      <Loading st={st}>{(x) => (
        <div className="stack g8">
          <span className="xs muted">{chosen.size} assigned</span>
          <div className="stack g4" style={{ maxHeight: '50vh', overflow: 'auto' }}>
            {x.people.map((p) => <label key={p.id} className="row g8 small"><input type="checkbox" checked={chosen.has(p.id)} onChange={() => flip(p.id)} data-testid="rv-pick" /> {p.roll ? `${p.roll} · ` : ''}{p.name} <span className="xs faint">{p.branch}</span></label>)}
          </div>
          <button type="button" className="btn btn-ink" disabled={busy} style={{ alignSelf: 'flex-start' }} onClick={() => run(async () => { await http(`${base}/${r.id}/students`, { method: 'PUT', body: { membershipIds: [...chosen] } }); onSaved(); onClose(); }, 'Students assigned')} data-testid="rv-save">Save</button>
        </div>
      )}</Loading>
    </Dialog>
  );
}

export default function Reviewers({ orgId, canManage }) {
  const toast = useToast();
  const [busy, run] = useAction(toast);
  const base = `/api/org/${encodeURIComponent(orgId)}/reviewers`;
  const st = useApi(base);
  const [email, setEmail] = useState('');
  const [made, setMade] = useState(null);
  const [assign, setAssign] = useState(null);
  const invite = (e) => { e.preventDefault(); run(async () => { setMade(await http(base, { method: 'POST', body: { email } })); setEmail(''); st.reload(); }, 'Invite sent'); };
  return (
    <div className="stack g16">
      <span className="small muted">Faculty mentors review the resumes of the students you assign: comments on a section or line, then “needs changes” or “approved” (the same review status you see in Shared resumes). Reviewers see only their students.</span>
      {canManage && (
        <form className="card row g8" style={{ flexWrap: 'wrap', alignItems: 'flex-end' }} onSubmit={invite} aria-label="Invite a reviewer">
          <label className="small" style={{ flex: '1 1 240px' }}>Faculty email <input className="input" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} data-testid="rv-email" /></label>
          <button type="submit" className="btn btn-ink" disabled={busy} data-testid="rv-invite">Invite reviewer</button>
          {made?.inviteUrl && <span className="xs muted" style={{ flexBasis: '100%' }}>Emailed. The link also works if you send it yourself: <span className="mono" data-testid="rv-link">{made.inviteUrl}</span></span>}
        </form>
      )}
      <Loading st={st} empty={emptyIf((x) => !x.length, 'No reviewers yet.')}>{(rows) => (
        <ul className="stack g8" style={{ listStyle: 'none', margin: 0, padding: 0 }}>
          {rows.map((r) => (
            <li key={r.id} className="card row between g8" style={{ flexWrap: 'wrap' }} data-testid="rv-row">
              <span className="stack g4"><strong className="small">{r.name || r.email}</strong><span className="xs muted">{r.email} · {r.status === 'active' ? `${r.students} student${r.students === 1 ? '' : 's'}` : 'invite sent'}</span></span>
              {canManage && r.status === 'active' && <button type="button" className="btn btn-outline" style={{ minHeight: 32 }} onClick={() => setAssign(r)} data-testid="rv-assign">Assign students</button>}
            </li>
          ))}
        </ul>
      )}</Loading>
      {assign && <Assign base={base} r={assign} onClose={() => setAssign(null)} onSaved={st.reload} />}
    </div>
  );
}
