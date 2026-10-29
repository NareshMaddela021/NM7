// Recruiter invites (colleges, Phase 3): the coordinator invites a recruiter by email to see the students of chosen
// groups (and branches) until an expiry date, with what they may do: download PDFs, see contact details (never,
// always, or only for students they shortlist). The recruiter needs no Nm7 account: the emailed link plus a one-time
// code sent to that address. Every view, search, download and shortlist is in the Activity log (and per invite here).
// Used in the coordinator portal (/org/:orgId/recruiters) and the admin console.
import { useState } from 'react';
import { Dialog, useToast } from '../../components/ui';
import { CONTACT_LABEL, INVITE_STATE, STAGE_LABEL } from '../../lib/recruiterPortal';
import { Loading, http, useAction, useApi, when } from '../admin/live/common';

const tone = { active: 'b-success', expired: 'b-neutral', revoked: 'b-warning' };
const ACTION = {
  recruiter_invite: 'Invite sent', recruiter_invite_extend: 'Extended', recruiter_invite_revoke: 'Revoked',
  recruiter_login: 'Signed in with the email code', recruiter_search: 'Searched', recruiter_match: 'Job match',
  recruiter_view: 'Viewed a resume', recruiter_stage: 'Moved on the board', recruiter_download: 'Downloaded',
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

  return (
    <section className="card stack g12" aria-label="Recruiter invites">
      <div className="row between g8" style={{ flexWrap: 'wrap' }}>
        <strong>Recruiter invites</strong>
        <div className="row g12">
          <button type="button" className="link-btn small" onClick={st.reload}>Refresh</button>
          {canManage && !form && <button type="button" className="btn btn-ink" onClick={() => { setForm(blank()); setMade(null); }}>New recruiter invite</button>}
        </div>
      </div>
      <span className="xs faint">The recruiter gets a secure link by email and signs in with a one-time code sent to the same address (no Nm7 account). They see only students who ticked “Allow recruiter sharing”, in the groups you choose, until the expiry date. A student who stops sharing or leaves disappears at once. ID numbers are never shown.</span>

      {made && (
        <div className="well stack g8" role="status" data-testid="invite-made">
          <strong className="small">Invite sent to {made.email}{made.emailSent ? '' : ' (the email didn’t go out: send them this link yourself)'}</strong>
          <span className="xs muted">The link is shown once. It only works with the code we email to {made.email}.</span>
          <div className="row g8"><input className="input mono xs" readOnly value={made.url} aria-label="Invite link" style={{ flex: 1, minWidth: 0 }} onFocus={(e) => e.target.select()} />
            <button type="button" className="btn btn-outline" onClick={() => navigator.clipboard?.writeText(made.url).then(() => toast('Link copied'), () => {})}>Copy</button></div>
        </div>
      )}

      {form && (
        <form className="stack g12" aria-label="New recruiter invite" onSubmit={create}>
          <div className="row g12" style={{ flexWrap: 'wrap' }}>
            <div className="field" style={{ flex: '1 1 200px' }}><label className="label" htmlFor="ri-company">Company</label><input id="ri-company" className="input" required maxLength={80} value={form.company} onChange={(e) => set('company', e.target.value)} /></div>
            <div className="field" style={{ flex: '1 1 200px' }}><label className="label" htmlFor="ri-name">Recruiter name</label><input id="ri-name" className="input" required maxLength={80} value={form.recruiterName} onChange={(e) => set('recruiterName', e.target.value)} /></div>
            <div className="field" style={{ flex: '1 1 240px' }}><label className="label" htmlFor="ri-email">Recruiter email</label><input id="ri-email" type="email" className="input" required value={form.email} onChange={(e) => set('email', e.target.value)} /></div>
          </div>
          <fieldset className="stack g6" style={{ border: 0, padding: 0, margin: 0 }}>
            <legend className="label">Groups they can see</legend>
            {shareable.length === 0 && <span className="xs" style={{ color: 'var(--warning)' }}>No group shares with recruiters yet. Turn on “Share with recruiters” in a group first.</span>}
            {shareable.map((g) => (
              <label key={g.id} className="row g8 small"><input type="checkbox" checked={form.groupIds.includes(g.id)} onChange={(e) => set('groupIds', e.target.checked ? [...form.groupIds, g.id] : form.groupIds.filter((x) => x !== g.id))} /> {g.name}</label>
            ))}
          </fieldset>
          <div className="row g12" style={{ flexWrap: 'wrap' }}>
            <div className="field" style={{ flex: '1 1 220px' }}><label className="label" htmlFor="ri-branches">Branches (optional)</label><input id="ri-branches" className="input" placeholder="e.g. CSE, ECE (empty: all)" value={form.branches} onChange={(e) => set('branches', e.target.value)} /></div>
            <div className="field" style={{ flex: '0 1 180px' }}><label className="label" htmlFor="ri-exp">Expires on</label><input id="ri-exp" type="date" className="input" required min={dayISO(0)} max={dayISO(120)} value={form.expiresOn} onChange={(e) => set('expiresOn', e.target.value)} /></div>
            <div className="field" style={{ flex: '1 1 220px' }}><label className="label" htmlFor="ri-contact">Contact details</label>
              <select id="ri-contact" className="input" value={form.contact} onChange={(e) => set('contact', e.target.value)}>
                <option value="hidden">Hidden</option><option value="after_shortlist">Shown after they shortlist a student</option><option value="shown">Shown</option>
              </select></div>
          </div>
          <label className="row g8 small"><input type="checkbox" checked={form.allowPdf} onChange={(e) => set('allowPdf', e.target.checked)} /> Allow resume PDF downloads</label>
          <div className="row g8">
            <button type="submit" className="btn btn-ink" disabled={busy || form.groupIds.length === 0}>Send invite</button>
            <button type="button" className="btn btn-outline" onClick={() => setForm(null)}>Cancel</button>
          </div>
        </form>
      )}

      <Loading st={st}>{(d) => (
        <>
          {canManage && (
            <label className="row g8 small"><input type="checkbox" checked={d.showShortlist} disabled={busy} onChange={(e) => showShortlist(e.target.checked)} /> Show students “Shortlisted by &lt;company&gt;” in My groups</label>
          )}
          {canManage && d.accounts && (
            <label className="row g8 small"><input type="checkbox" checked={d.namesAfter} disabled={busy} onChange={(e) => namesAfter(d, e.target.checked)} /> Show student names on a recruiter’s past drives (after an invite ends; otherwise only counts and their own notes)</label>
          )}
          {d.accounts && <span className="xs faint">Recruiters can also sign in at nm7.si/recruiter with the same email to see My drives: every college that invited them. Your students are visible only while your invite is active; revoking stops access at once.</span>}
          {!d.jobMatch && <span className="xs faint">Job match mode (recruiters paste a job description and get every student scored) is in the Campus plan.</span>}
          {d.invites.length === 0 ? <div className="well small muted" style={{ textAlign: 'center', padding: 16 }}>No recruiter invites yet.</div> : (
            <div className="table-wrap" tabIndex={0} role="region" aria-label="Table — scroll sideways to see all columns"><table className="table"><thead><tr><th>Company</th><th>Status</th><th>Groups</th><th>Views · downloads</th><th>Shortlisted</th><th>Expires</th><th /></tr></thead>
              <tbody>{d.invites.map((i) => (
                <tr key={i.id} data-testid="recruiter-invite">
                  <td className="small"><strong>{i.company}</strong><div className="xs faint">{i.recruiterName} · {i.email}</div><div className="xs faint">{i.allowPdf ? 'PDF downloads' : 'view only'} · {CONTACT_LABEL[i.contact]}</div></td>
                  <td className="small"><span className={`badge ${tone[i.state]}`}>{INVITE_STATE[i.state]}</span></td>
                  <td className="small">{i.groups.filter(Boolean).join(', ') || '—'}{i.branches.length > 0 && <div className="xs faint">{i.branches.join(', ')}</div>}</td>
                  <td className="small" data-testid="invite-stats">{i.views} view{i.views === 1 ? '' : 's'} · {i.downloads} download{i.downloads === 1 ? '' : 's'}</td>
                  <td className="small">{i.shortlisted || '—'}</td>
                  <td className="small">{when(i.expiresAt)}</td>
                  <td><div className="row g8" style={{ flexWrap: 'wrap', alignItems: 'center' }}>
                    <button type="button" className="link-btn small" onClick={() => openActivity(i)}>Activity</button>
                    {canManage && i.state !== 'revoked' && (<>
                      <input type="date" className="input" aria-label={`New expiry for ${i.company}`} style={{ height: 32, width: 150 }} min={dayISO(0)} max={dayISO(120)} value={until[i.id] || dayISO(30)} onChange={(e) => setUntil({ ...until, [i.id]: e.target.value })} />
                      <button type="button" className="link-btn small" disabled={busy} onClick={() => extend(i)}>Extend</button>
                      <button type="button" className="link-btn small" disabled={busy} onClick={() => revoke(i)}>Revoke</button>
                    </>)}
                  </div></td>
                </tr>
              ))}</tbody></table></div>
          )}
        </>
      )}</Loading>
      {activity && (
        <Dialog showTitle title={`${activity.i.company}: activity`} onClose={() => setActivity(null)}>
          {activity.rows.length === 0 ? <p className="small muted">Nothing yet.</p> : (
            <ul className="stack g6" style={{ listStyle: 'none', padding: 0, margin: 0 }} data-testid="invite-activity">
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
