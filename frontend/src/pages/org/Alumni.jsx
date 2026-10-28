// Org > Alumni (Campus plan): invite past students by email and see counts. Coordinators never see the messages
// between students and alumni.
import { useState } from 'react';
import { useToast } from '../../components/ui';
import { Loading, http, useAction, useApi } from '../admin/live/common';

export default function Alumni({ orgId, canManage }) {
  const toast = useToast();
  const [busy, run] = useAction(toast);
  const base = `/api/org/${encodeURIComponent(orgId)}/alumni`;
  const st = useApi(`${base}/summary`);
  const [emails, setEmails] = useState('');
  const invite = (e) => {
    e.preventDefault();
    run(async () => { const r = await http(`${base}/invites`, { method: 'POST', body: { emails: emails.split(/[\s,;]+/).filter(Boolean) } }); toast(`${r.emailed} invite${r.emailed === 1 ? '' : 's'} emailed`); setEmails(''); st.reload(); });
  };
  return (
    <div className="stack g16">
      <span className="small muted">Past students opt in with their company, role and city. Current students ask them for referrals or mentoring (5 a week) and they reply inside Nm7. Contact details are never shown. You see counts, not messages.</span>
      <Loading st={st}>{(s) => (
        <div className="row g8" style={{ flexWrap: 'wrap' }} data-testid="alumni-counts">
          {[['Alumni', s.alumni], ['Open to referrals', s.referrals], ['Open to mentoring', s.mentoring], ['Paused', s.paused], ['Requests (30 days)', s.requests30d], ['Replied (30 days)', s.replied30d], ['Invited', s.invited], ['Joined from invites', s.joinedFromInvite]].map(([l, v]) => (
            <div key={l} className="card stack g4" style={{ padding: 12, flex: '1 1 130px' }}><span className="xs muted">{l}</span><strong className="display" style={{ fontSize: 22 }}>{v}</strong></div>
          ))}
        </div>
      )}</Loading>
      {canManage && (
        <form className="card stack g8" onSubmit={invite} aria-label="Invite alumni" data-testid="alumni-invite">
          <strong className="small">Invite alumni by email</strong>
          <textarea className="input" rows={3} required placeholder="one@example.com, two@example.com" value={emails} onChange={(e) => setEmails(e.target.value)} data-testid="alumni-emails" />
          <button type="submit" className="btn btn-ink" disabled={busy} style={{ alignSelf: 'flex-start' }} data-testid="alumni-send">Send invites</button>
        </form>
      )}
    </div>
  );
}
