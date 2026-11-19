// Recruiter invites (colleges, Phase 3): the coordinator invites a recruiter by email to see the students of chosen
// groups (and branches) until an expiry date, with what they may do: download PDFs, see contact details (never,
// always, or only for students they shortlist). The recruiter needs no Nm7 account: the emailed link plus a one-time
// code sent to that address. Every view, search, download and shortlist is in the Activity log (and per invite here).
// Used in the coordinator portal (/org/:orgId/recruiters) and the admin console.
import { useState } from 'react';
import { Dialog, useToast } from '../../components/ui';
import { CONTACT_LABEL, INVITE_STATE, STAGE_LABEL } from '../../lib/recruiterPortal';
import { Loading, http, useAction, useApi, when } from '../admin/live/common';
import RecruiterFeedback from './RecruiterFeedback';
import { Chip, Empty, FieldGroup } from '../me/kit';
import { SHAPE_COLORS, TINTS } from '../newhome/shapes';
import '../../styles/me-kit.css';
import '../../styles/org-team.css';
import { IcMail } from '../../components/icons';

TINTS.college = SHAPE_COLORS.college;
const tone = { active: 'ok', expired: 'neutral', revoked: 'warn' };
const ACTION = {
  recruiter_invite: 'Invite sent', recruiter_invite_extend: 'Extended', recruiter_invite_revoke: 'Revoked',
  recruiter_login: 'Signed in with the email code', recruiter_search: 'Searched', recruiter_match: 'Job match',
  recruiter_view: 'Viewed a resume', recruiter_stage: 'Moved on the board', recruiter_download: 'Downloaded',
  recruiter_compare: 'Compared students', recruiter_interview: 'Scheduled an interview', recruiter_interview_change: 'Changed an interview time',
  recruiter_interview_cancel: 'Cancelled an interview',
};
const dayISO = (n) => { const d = new Date(Date.now() + n * 864e5); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const blank = () => ({ company: '', recruiterName: '', email: '', groupIds: [], branches: '', expiresOn: dayISO(30), allowPdf: true, contact: 'hidden' });

export default function RecruiterInvites({ orgId, groups = [], canManage }) {
  const base = `/api/org/${encodeURIComponent(orgId)}`;
  const st = useApi(`${base}/recruiter-invites`);
  const toast = useToast();
  const [busy, run] = useAction(toast);
  const [form, setForm] = useState(null);
  const [made, setMade] = useState(null);
  const [until, setUntil] = useState({});
  const [activity, setActivity] = useState(null);
  const shareable = groups.filter((g) => g.settings?.shareWithRecruiters);
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  const create = (e) => {
    e.preventDefault();
    run(async () => {
      const body = { ...form, branches: form.branches.split(',').map((s) => s.trim()).filter(Boolean) };
      const r = await http(`${base}/recruiter-invites`, { method: 'POST', body });
      setMade(r); setForm(null); st.reload();
    }, 'Invite sent');
  };
  const extend = (i) => run(async () => { await http(`${base}/recruiter-invites/${i.id}/extend`, { method: 'POST', body: { expiresOn: until[i.id] || dayISO(30) } }); st.reload(); }, 'Invite extended');
  const revoke = (i) => {
    if (!window.confirm(`Revoke ${i.company}'s invite? It stops working at once.`)) return;
    run(async () => { await http(`${base}/recruiter-invites/${i.id}/revoke`, { method: 'POST', body: {} }); st.reload(); }, 'Invite revoked');
  };
  const showShortlist = (on) => run(async () => { await http(`${base}/recruiter-settings`, { method: 'PUT', body: { showShortlist: on } }); st.reload(); }, on ? 'Students will see who shortlisted them' : 'Hidden from students');
  const namesAfter = (d, on) => run(async () => { await http(`${base}/recruiter-settings`, { method: 'PUT', body: { showShortlist: d.showShortlist, namesAfter: on } }); st.reload(); }, on ? 'Recruiters see names on past drives' : 'Names hidden on past drives');
  const openActivity = async (i) => { try { setActivity({ i, rows: await http(`${base}/recruiter-invites/${i.id}/activity`) }); } catch (e) { toast(e.message); } };

  // round P, Phase 4: invites as cards with a status chip and numbers; the new invite as a grouped card
  return (
    <section className="mcard" aria-label="Recruiter invites">
      <header className="mcard-h">
        <span className="mcard-ic" aria-hidden="true"><IcMail /></span>
        <span className="mcard-ht"><strong className="mcard-title">Recruiter invites</strong>
          <span className="mcard-sub">The recruiter gets a secure link by email and signs in with a one-time code sent to the same address (no Nm7 account). They see only students who ticked “Allow recruiter sharing”, in the groups you choose, until the expiry date. A student who stops sharing or leaves disappears at once. ID numbers are never shown.</span></span>
        <span className="mcard-actions">
          <button type="button" className="btn btn-outline btn-sm-ot" onClick={st.reload}>Refresh</button>
          {canManage && !form && <button type="button" className="btn btn-signal" onClick={() => { setForm(blank()); setMade(null); }}>New recruiter invite</button>}
        </span>
      </header>

      {made && (
        <div className="ot-made" role="status" data-testid="invite-made">
          <strong className="small">Invite sent to {made.email}{made.emailSent ? '' : ' (the email didn’t go out: send them this link yourself)'}</strong>
          <span className="xs muted">The link is shown once. It only works with the code we email to {made.email}.</span>
          <div className="ot-copy"><input className="input mono xs" readOnly value={made.url} aria-label="Invite link" onFocus={(e) => e.target.select()} />
            <button type="button" className="btn btn-outline" onClick={() => navigator.clipboard?.writeText(made.url).then(() => toast('Link copied'), () => {})}>Copy</button></div>
        </div>
      )}

      {form && (
        <form className="ot-form" aria-label="New recruiter invite" onSubmit={create}>
          <FieldGroup title="Who is the recruiter">
            <div className="field"><label className="label" htmlFor="ri-company">Company</label><input id="ri-company" className="input" required maxLength={80} value={form.company} onChange={(e) => set('company', e.target.value)} /></div>
            <div className="field"><label className="label" htmlFor="ri-name">Recruiter name</label><input id="ri-name" className="input" required maxLength={80} value={form.recruiterName} onChange={(e) => set('recruiterName', e.target.value)} /></div>
            <div className="field full"><label className="label" htmlFor="ri-email">Recruiter email</label><input id="ri-email" type="email" className="input" required value={form.email} onChange={(e) => set('email', e.target.value)} /></div>
          </FieldGroup>
          <fieldset className="ot-groups">
            <legend className="label">Groups they can see</legend>
            {shareable.length === 0 && <span className="xs ot-warn">No group shares with recruiters yet. Turn on “Share with recruiters” in a group first.</span>}
            <div className="ot-group-picks">
              {shareable.map((g) => (
                <label key={g.id} className="ot-choice ot-pick"><input type="checkbox" checked={form.groupIds.includes(g.id)} onChange={(e) => set('groupIds', e.target.checked ? [...form.groupIds, g.id] : form.groupIds.filter((x) => x !== g.id))} /> {g.name}</label>
              ))}
            </div>
          </fieldset>
          <FieldGroup title="What they can do">
            <div className="field"><label className="label" htmlFor="ri-branches">Branches (optional)</label><input id="ri-branches" className="input" placeholder="e.g. CSE, ECE (empty: all)" value={form.branches} onChange={(e) => set('branches', e.target.value)} /></div>
            <div className="field"><label className="label" htmlFor="ri-exp">Expires on</label><input id="ri-exp" type="date" className="input" required min={dayISO(0)} max={dayISO(120)} value={form.expiresOn} onChange={(e) => set('expiresOn', e.target.value)} /></div>
            <div className="field"><label className="label" htmlFor="ri-contact">Contact details</label>
              <select id="ri-contact" className="input" value={form.contact} onChange={(e) => set('contact', e.target.value)}>
                <option value="hidden">Hidden</option><option value="after_shortlist">Shown after they shortlist a student</option><option value="shown">Shown</option>
              </select></div>
            <label className="ot-choice full"><input type="checkbox" checked={form.allowPdf} onChange={(e) => set('allowPdf', e.target.checked)} /> Allow resume PDF downloads</label>
          </FieldGroup>
          <div className="ot-form-actions">
            <button type="submit" className="btn btn-signal" disabled={busy || form.groupIds.length === 0}>Send invite</button>
            <button type="button" className="btn btn-outline" onClick={() => setForm(null)}>Cancel</button>
          </div>
        </form>
      )}

      <Loading st={st}>{(d) => (
        <>
          {(canManage || d.accounts || !d.jobMatch) && (
            <div className="ot-settings">
              {canManage && (
                <label className="ot-toggle"><input type="checkbox" checked={d.showShortlist} disabled={busy} onChange={(e) => showShortlist(e.target.checked)} /> <span>Show students “Shortlisted by &lt;company&gt;” in My groups</span></label>
              )}
              {canManage && d.accounts && (
                <label className="ot-toggle"><input type="checkbox" checked={d.namesAfter} disabled={busy} onChange={(e) => namesAfter(d, e.target.checked)} /> <span>Show student names on a recruiter’s past drives (after an invite ends; otherwise only counts and their own notes)</span></label>
              )}
              {d.accounts && <span className="xs faint">Recruiters can also sign in at nm7.si/recruiter with the same email to see My drives: every college that invited them. Your students are visible only while your invite is active; revoking stops access at once.</span>}
              {!d.jobMatch && <span className="xs faint">Job match mode (recruiters paste a job description and get every student scored) is in the Campus plan.</span>}
            </div>
          )}
          {d.invites.length === 0 ? <Empty shape="handshake" tint="college" title="No recruiter invites yet." compact>{canManage ? 'Choose “New recruiter invite” to send the first one.' : 'Your coordinator can invite recruiters here.'}</Empty> : (
            <ul className="ot-cards">
              {d.invites.map((i) => (
                <li key={i.id} className={`ot-card ot-${i.state}`} data-testid="recruiter-invite">
                  <div className="ot-card-top">
                    <span className="mavatar ot-av" aria-hidden="true">{(i.company || '?').trim().charAt(0).toUpperCase()}</span>
                    <span className="ot-card-name"><strong>{i.company}</strong><span className="xs faint ot-wrap">{i.recruiterName} · {i.email}</span></span>
                    <Chip tone={tone[i.state]}>{INVITE_STATE[i.state]}</Chip>
                  </div>
                  <span className="ot-chips"><span className="ot-pill">{i.allowPdf ? 'PDF downloads' : 'view only'}</span><span className="ot-pill">{CONTACT_LABEL[i.contact]}</span></span>
                  <dl className="ot-facts">
                    <div><dt>Groups</dt><dd>{i.groups.filter(Boolean).join(', ') || '—'}{i.branches.length > 0 && <span className="xs faint"> · {i.branches.join(', ')}</span>}</dd></div>
                    <div><dt>Views · downloads</dt><dd data-testid="invite-stats">{i.views} view{i.views === 1 ? '' : 's'} · {i.downloads} download{i.downloads === 1 ? '' : 's'}</dd></div>
                    <div><dt>Shortlisted</dt><dd>{i.shortlisted || '—'}</dd></div>
                    <div><dt>Expires</dt><dd>{when(i.expiresAt)}</dd></div>
                  </dl>
                  <div className="ot-card-actions">
                    <button type="button" className="btn btn-outline btn-sm-ot" onClick={() => openActivity(i)}>Activity</button>
                    {canManage && i.state !== 'revoked' && (<>
                      <input type="date" className="input ot-select" aria-label={`New expiry for ${i.company}`} min={dayISO(0)} max={dayISO(120)} value={until[i.id] || dayISO(30)} onChange={(e) => setUntil({ ...until, [i.id]: e.target.value })} />
                      <button type="button" className="btn btn-outline btn-sm-ot" disabled={busy} onClick={() => extend(i)}>Extend</button>
                      <button type="button" className="btn btn-ghost btn-sm-ot ot-danger" disabled={busy} onClick={() => revoke(i)}>Revoke</button>
                    </>)}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </>
      )}</Loading>
      <CollegeInterviews base={base} />
      {st.data?.feedback && <RecruiterFeedback base={base} />}
      {activity && (
        <Dialog showTitle title={`${activity.i.company}: activity`} onClose={() => setActivity(null)}>
          {activity.rows.length === 0 ? <p className="small muted">Nothing yet.</p> : (
            <ul className="ot-timeline" data-testid="invite-activity">
              {activity.rows.map((a, n) => (
                <li key={n} className="small"><span className="faint xs">{when(a.at)}</span> · {ACTION[a.action] || a.action}{a.stage ? `: ${STAGE_LABEL[a.stage] || a.stage}` : ''}{a.count != null && a.action !== 'recruiter_view' ? ` (${a.count})` : ''}</li>
              ))}
            </ul>
          )}
        </Dialog>
      )}
    </section>
  );
}

const STATUS_TONE = { confirmed: 'ok', reschedule: 'warn', pending: 'neutral' };

/** Interviews recruiters scheduled (R3), with each student's answer (only this coordinator's groups). */
function CollegeInterviews({ base }) {
  const st = useApi(`${base}/interviews`);
  if (!st.data || st.data.rounds.length === 0) return null;
  return (
    <div className="ot-rounds" aria-label="Interviews" role="region" data-testid="college-interviews">
      <strong className="ot-sub-h">Interviews scheduled by recruiters</strong>
      {st.data.rounds.map((rd) => (
        <div key={rd.id} className={`ot-round ${rd.cancelled ? 'off' : ''}`} data-testid="college-round">
          <div className="ot-round-top">
            <span className="small"><strong>{rd.company}</strong> · {rd.round} · {rd.when}</span>
            <span className="xs ot-round-count">{rd.cancelled ? 'Cancelled' : `${rd.counts.confirmed} confirmed · ${rd.counts.pending} waiting · ${rd.counts.reschedule} asked for another time`}</span>
          </div>
          <ul className="ot-round-list">
            {rd.students.map((s) => (
              <li key={s.id} className="ot-round-row"><span className="small">{s.name}{s.reason ? <span className="xs muted"> · “{s.reason}”</span> : ''}</span><Chip tone={STATUS_TONE[s.status] || 'neutral'}>{s.statusName}</Chip></li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}
