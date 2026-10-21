// /org/:orgId/team — the Owner invites coordinators and viewers (within the plan's coordinator limit) and removes
// them. Owners themselves are added or removed by Nm7.
import { useState } from 'react';
import { useToast } from '../../components/ui';
import { http } from '../../services/http';
import { Loading, day, emptyIf, useAction, useApi } from '../admin/live/common';

const ROLE = { owner: 'Owner', coordinator: 'Coordinator', viewer: 'Viewer (view and print)' };

export default function Team({ orgId, groups }) {
  const toast = useToast();
  const st = useApi(`/api/org/${orgId}/team`);
  const [busy, run] = useAction(toast);
  const [f, setF] = useState({ email: '', role: 'coordinator', groupIds: null });
  const [link, setLink] = useState('');
  return (
    <div className="stack g16">
      <section className="card stack g12" aria-label="Team">
        <strong>Who helps run your organization</strong>
        <Loading st={st} empty={emptyIf((d) => !d.length, 'Nobody yet.')}>{(rows) => (
          <div className="table-wrap"><table className="table">
            <thead><tr><th>Email</th><th>Role</th><th>Status</th><th /></tr></thead>
            <tbody>{rows.map((s) => (
              <tr key={s.id}>
                <td>{s.name ? <>{s.name}<br /><span className="xs muted">{s.email}</span></> : s.email}</td>
                <td>{ROLE[s.role] || s.role}{s.groupIds ? <span className="xs muted"> · {s.groupIds.length} group{s.groupIds.length === 1 ? '' : 's'}</span> : null}</td>
                <td className="small">{s.status === 'invited' ? `Invited · expires ${day(s.expiresAt)}` : `Since ${day(s.acceptedAt)}`}</td>
                <td>{s.role !== 'owner' && <button type="button" className="link-btn small" disabled={busy} onClick={() => run(async () => { await http(`/api/org/${orgId}/team/${s.id}`, { method: 'DELETE' }); st.reload(); }, 'Removed')}>Remove</button>}</td>
              </tr>
            ))}</tbody>
          </table></div>
        )}</Loading>
      </section>
      <form className="card stack g12" aria-label="Invite someone" onSubmit={(e) => { e.preventDefault(); run(async () => { const r = await http(`/api/org/${orgId}/team`, { method: 'POST', body: f }); setLink(r.emailSent ? '' : r.inviteUrl); setF({ email: '', role: 'coordinator', groupIds: null }); st.reload(); }, 'Invite sent'); }}>
        <strong>Invite a coordinator or viewer</strong>
        <div className="row g12" style={{ flexWrap: 'wrap' }}>
          <div className="field" style={{ flex: '2 1 240px' }}><label className="label" htmlFor="tm-e">Email</label><input id="tm-e" type="email" className="input" required value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} /></div>
          <div className="field" style={{ flex: '1 1 180px' }}><label className="label" htmlFor="tm-r">Role</label><select id="tm-r" className="input" value={f.role} onChange={(e) => setF({ ...f, role: e.target.value })}><option value="coordinator">Coordinator</option><option value="viewer">Viewer (view and print)</option></select></div>
        </div>
        {groups.length > 1 && (
          <fieldset className="stack g4" style={{ border: 0, padding: 0 }}>
            <legend className="label">Groups</legend>
            <label className="row g8 small"><input type="radio" checked={f.groupIds === null} onChange={() => setF({ ...f, groupIds: null })} /> All groups</label>
            <label className="row g8 small"><input type="radio" checked={f.groupIds !== null} onChange={() => setF({ ...f, groupIds: [] })} /> Only some groups</label>
            {f.groupIds !== null && groups.map((g) => <label key={g.id} className="row g8 small" style={{ paddingLeft: 24 }}><input type="checkbox" checked={f.groupIds.includes(g.id)} onChange={(e) => setF({ ...f, groupIds: e.target.checked ? [...f.groupIds, g.id] : f.groupIds.filter((x) => x !== g.id) })} /> {g.name}</label>)}
          </fieldset>
        )}
        <button type="submit" className="btn btn-ink" style={{ alignSelf: 'flex-start' }} disabled={busy}>Send invite</button>
        <span className="xs muted">They get a one-time link by email (valid 7 days) and sign in with their own Nm7 account. Your plan sets how many coordinators you can have.</span>
        {link && <span className="small">The email couldn’t be sent — share this link with them: <span className="mono">{link}</span></span>}
      </form>
    </div>
  );
}
