// Org > Alumni (Campus plan): invite past students by email and see counts. Coordinators never see the messages
// between students and alumni.
import { useState } from 'react';
import { useToast } from '../../components/ui';
import { Loading, http, useAction, useApi } from '../admin/live/common';
import { MeCard, Skel, Stat } from '../me/kit';
import '../../styles/me-kit.css';
import '../../styles/org-team.css';

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
  // round P, Phase 4: an intro card, the numbers as tiles (people, then the last 30 days), and an invite card
  return (
    <div className="ot-team">
      <MeCard title="Alumni network" icon="☆" label="Alumni network" sub="Past students opt in with their company, role and city. Current students ask them for referrals or mentoring (5 a week) and they reply inside Nm7. Contact details are never shown. You see counts, not messages." />
      {!st.data && !st.error ? <Skel cards={2} lines={1} label="Loading alumni numbers" /> : (
        <Loading st={st}>{(s) => (
          <div className="ot-stats" data-testid="alumni-counts">
            {[['Alumni', s.alumni], ['Open to referrals', s.referrals, 'ok'], ['Open to mentoring', s.mentoring, 'ok'], ['Paused', s.paused], ['Requests (30 days)', s.requests30d], ['Replied (30 days)', s.replied30d], ['Invited', s.invited], ['Joined from invites', s.joinedFromInvite]].map(([l, v, tone]) => (
              <Stat key={l} label={l} value={v} tone={tone} />
            ))}
          </div>
        )}</Loading>
      )}
      {canManage && (
        <form className="mcard" onSubmit={invite} aria-label="Invite alumni" data-testid="alumni-invite">
          <header className="mcard-h"><span className="mcard-ic" aria-hidden="true">✉</span><span className="mcard-ht"><strong className="mcard-title">Invite alumni by email</strong><span className="mcard-sub">Paste the emails, separated by commas or new lines. Each gets an invite to join.</span></span></header>
          <label className="field"><span className="label">Emails</span><textarea className="input" rows={3} required placeholder="one@example.com, two@example.com" value={emails} onChange={(e) => setEmails(e.target.value)} data-testid="alumni-emails" /></label>
          <button type="submit" className="btn btn-signal" disabled={busy} style={{ alignSelf: 'flex-start' }} data-testid="alumni-send">Send invites</button>
        </form>
      )}
    </div>
  );
}
