// Org > Reviewers: invite faculty mentors as Reviewers (they sign in with their own Nm7 account) and assign students
// to each. A reviewer sees only the students assigned to them.
import { useState } from 'react';
import { Dialog, useToast } from '../../components/ui';
import { Loading, http, useAction, useApi } from '../admin/live/common';
import { Chip, Empty, MeCard, Skel } from '../me/kit';
import { SHAPE_COLORS, TINTS } from '../newhome/shapes';
import '../../styles/me-kit.css';
import '../../styles/org-team.css';

TINTS.college = SHAPE_COLORS.college;

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
        <div className="stack g12">
          <Chip tone="accent">{chosen.size} assigned</Chip>
          <div className="ot-pick-list">
            {x.people.map((p) => <label key={p.id} className={`ot-choice ot-pick-row ${chosen.has(p.id) ? 'on' : ''}`}><input type="checkbox" checked={chosen.has(p.id)} onChange={() => flip(p.id)} data-testid="rv-pick" /> <span className="ot-pick-name">{p.roll ? <span className="mono">{p.roll} · </span> : ''}{p.name}</span> <span className="xs faint">{p.branch}</span></label>)}
          </div>
          <button type="button" className="btn btn-signal" disabled={busy} style={{ alignSelf: 'flex-start' }} onClick={() => run(async () => { await http(`${base}/${r.id}/students`, { method: 'PUT', body: { membershipIds: [...chosen] } }); onSaved(); onClose(); }, 'Students assigned')} data-testid="rv-save">Save</button>
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
  // round P, Phase 4: an intro card with the invite form, then each reviewer as a card with their students
  return (
    <div className="ot-team">
      <MeCard title="Faculty reviewers" icon="✎" label="Faculty reviewers" sub="Faculty mentors review the resumes of the students you assign: comments on a section or line, then “needs changes” or “approved” (the same review status you see in Shared resumes). Reviewers see only their students.">
        {canManage && (
          <form className="ot-inline-form" onSubmit={invite} aria-label="Invite a reviewer">
            <label className="field" style={{ flex: '1 1 240px' }}><span className="label">Faculty email</span><input className="input" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} data-testid="rv-email" /></label>
            <button type="submit" className="btn btn-signal" disabled={busy} data-testid="rv-invite">Invite reviewer</button>
            {made?.inviteUrl && <span className="xs muted ot-full">Emailed. The link also works if you send it yourself: <span className="mono" data-testid="rv-link">{made.inviteUrl}</span></span>}
          </form>
        )}
      </MeCard>
      {!st.data && !st.error ? <Skel cards={2} lines={2} label="Loading reviewers" /> : (
        <Loading st={st}>{(rows) => (rows.length === 0 ? <Empty shape="resume" tint="college" title="No reviewers yet." compact>{canManage ? 'Invite a faculty member with their email above.' : 'Your coordinator can invite reviewers here.'}</Empty> : (
          <ul className="ot-cards">
            {rows.map((r) => (
              <li key={r.id} className="ot-card" data-testid="rv-row">
                <div className="ot-card-top">
                  <span className="mavatar ot-av" aria-hidden="true">{(r.name || r.email || '?').trim().charAt(0).toUpperCase()}</span>
                  <span className="ot-card-name"><strong className="small">{r.name || r.email}</strong><span className="xs muted ot-wrap">{r.email} · {r.status === 'active' ? `${r.students} student${r.students === 1 ? '' : 's'}` : 'invite sent'}</span></span>
                  <Chip tone={r.status === 'active' ? 'ok' : 'warn'}>{r.status === 'active' ? 'Active' : 'Invited'}</Chip>
                </div>
                {canManage && r.status === 'active' && <div className="ot-card-actions"><button type="button" className="btn btn-outline btn-sm-ot" onClick={() => setAssign(r)} data-testid="rv-assign">Assign students</button></div>}
              </li>
            ))}
          </ul>
        ))}</Loading>
      )}
      {assign && <Assign base={base} r={assign} onClose={() => setAssign(null)} onSaved={st.reload} />}
    </div>
  );
}
