// /org/:orgId/team — the Owner invites coordinators and viewers (within the plan's coordinator limit) and removes
// them. Owners themselves are added or removed by Nm7; the Owner can transfer ownership (./Transfer).
// Round P, Phase 4: staff as cards with role and status chips, the invite form as a grouped card.
import { useState } from 'react';
import { useToast } from '../../components/ui';
import { http } from '../../services/http';
import { day, useAction, useApi } from '../admin/live/common';
import { Chip, Empty, MeCard, Skel } from '../me/kit';
import { SHAPE_COLORS, TINTS } from '../newhome/shapes';
import { TransferOwnership } from './Transfer';
import '../../styles/me-kit.css';
import '../../styles/org-team.css';

TINTS.college = SHAPE_COLORS.college;

const ROLE = { owner: 'Owner', coordinator: 'Coordinator', viewer: 'Viewer (view and print)' };
const ROLE_TONE = { owner: 'accent', coordinator: 'info', viewer: 'neutral' };
const initial = (s) => (s.name || s.email || '?').trim().charAt(0).toUpperCase();

export default function Team({ orgId, groups }) {
  const toast = useToast();
  const st = useApi(`/api/org/${orgId}/team`);
  const [busy, run] = useAction(toast);
  const [f, setF] = useState({ email: '', role: 'coordinator', groupIds: null });
  const [link, setLink] = useState('');
  const rows = st.data || [];
  return (
    <div className="ot-team">
      <MeCard label="Team" title="Who helps run your organization" icon="☺" sub={st.data ? `${rows.length} ${rows.length === 1 ? 'person' : 'people'}` : undefined} className="ot-team-list">
        {st.error ? (
          <div className="stack g8" role="alert"><strong>Couldn’t load this</strong><span className="small muted">{st.error.message}</span><button type="button" className="btn btn-outline" style={{ alignSelf: 'flex-start' }} onClick={st.reload}>Try again</button></div>
        ) : !st.data ? <Skel cards={2} lines={2} label="Loading the team" /> : rows.length === 0 ? (
          <Empty shape="handshake" tint="college" title="Nobody yet." compact>Invite a coordinator or a viewer with the form.</Empty>
        ) : (
          <ul className="ot-people">
            {rows.map((s) => (
              <li key={s.id} className="ot-person">
                <span className="mavatar ot-av" aria-hidden="true">{initial(s)}</span>
                <span className="ot-person-main">
                  <strong className="ot-person-name">{s.name || s.email}</strong>
                  {s.name && <span className="xs muted ot-wrap">{s.email}</span>}
                  <span className="ot-chips">
                    <Chip tone={ROLE_TONE[s.role] || 'neutral'}>{ROLE[s.role] || s.role}</Chip>
                    {s.groupIds ? <Chip tone="neutral">{s.groupIds.length} group{s.groupIds.length === 1 ? '' : 's'}</Chip> : null}
                    <Chip tone={s.status === 'invited' ? 'warn' : 'ok'}>{s.status === 'invited' ? `Invited · expires ${day(s.expiresAt)}` : `Since ${day(s.acceptedAt)}`}</Chip>
                  </span>
                </span>
                {s.role !== 'owner' && <button type="button" className="btn btn-outline ot-remove" disabled={busy} onClick={() => run(async () => { await http(`/api/org/${orgId}/team/${s.id}`, { method: 'DELETE' }); st.reload(); }, 'Removed')}>Remove</button>}
              </li>
            ))}
          </ul>
        )}
      </MeCard>
      <form className="mcard ot-invite" aria-label="Invite someone" onSubmit={(e) => { e.preventDefault(); run(async () => { const r = await http(`/api/org/${orgId}/team`, { method: 'POST', body: f }); setLink(r.emailSent ? '' : r.inviteUrl); setF({ email: '', role: 'coordinator', groupIds: null }); st.reload(); }, 'Invite sent'); }}>
        <header className="mcard-h">
          <span className="mcard-ic" aria-hidden="true">✉</span>
          <span className="mcard-ht"><strong className="mcard-title">Invite a coordinator or viewer</strong><span className="mcard-sub">They get a one-time link by email (valid 7 days) and sign in with their own Nm7 account. Your plan sets how many coordinators you can have.</span></span>
        </header>
        <div className="ot-fields">
          <div className="field"><label className="label" htmlFor="tm-e">Email</label><input id="tm-e" type="email" className="input" required value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} /></div>
          <div className="field"><label className="label" htmlFor="tm-r">Role</label><select id="tm-r" className="input" value={f.role} onChange={(e) => setF({ ...f, role: e.target.value })}><option value="coordinator">Coordinator</option><option value="viewer">Viewer (view and print)</option></select></div>
        </div>
        <p className="ot-help">{f.role === 'viewer' ? 'A viewer can see and print resumes, but can’t change groups or settings.' : 'A coordinator runs groups, drives and shared resumes.'}</p>
        {groups.length > 1 && (
          <fieldset className="ot-groups">
            <legend className="label">Groups</legend>
            <label className="ot-choice"><input type="radio" checked={f.groupIds === null} onChange={() => setF({ ...f, groupIds: null })} /> All groups</label>
            <label className="ot-choice"><input type="radio" checked={f.groupIds !== null} onChange={() => setF({ ...f, groupIds: [] })} /> Only some groups</label>
            {f.groupIds !== null && (
              <div className="ot-group-picks">
                {groups.map((g) => <label key={g.id} className="ot-choice ot-pick"><input type="checkbox" checked={f.groupIds.includes(g.id)} onChange={(e) => setF({ ...f, groupIds: e.target.checked ? [...f.groupIds, g.id] : f.groupIds.filter((x) => x !== g.id) })} /> {g.name}</label>)}
              </div>
            )}
          </fieldset>
        )}
        <button type="submit" className="btn btn-signal ot-send" disabled={busy}>Send invite</button>
        {link && <span className="small ot-link">The email couldn’t be sent — share this link with them: <span className="mono">{link}</span></span>}
      </form>
      <div className="ot-transfer"><TransferOwnership base={`/api/org/${orgId}/transfer`} team={st.data || []} /></div>
    </div>
  );
}
