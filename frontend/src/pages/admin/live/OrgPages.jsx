// Nm7 for Organizations: organizations → groups (join code, link, QR code), coordinators, group dashboards and the
// shared-resumes table (filters, approval, review, reminders, print, combined PDF / ZIP / CSV).
// Every part takes a `ctx` and works in both places:
//   the admin console — ctx.base '/api/admin', every organization;
//   the coordinator portal (/org/:orgId, pages/org/Portal.jsx) — ctx.base '/api/org/<id>', one organization.
// The server decides what each person may see and do (app/orgs/scope.py); the screens only hide what they can't use.
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import QRCode from 'qrcode';
import { Dialog, useToast } from '../../../components/ui';
import { savePdf } from '../../builder/resumePdf';
import ResumePreview from '../../builder/ResumePreview';
import { designOf, runExport } from '../../../lib/orgExport';
import { APPROVAL_LABEL, REVIEW_LABEL, bucketRows, countTiles, exportFilters, joinBars, remindSummary } from '../../../lib/orgDashboard';
import { TEMPLATE_PRESETS } from '../../builder/design';
import { API_BASE } from '../../../services/http';
import { BarChart, HBars, PageHead } from '../AdminUI';
import { Loading, day, emptyIf, http, useAction, useApi, when } from './common';
import { auditText } from './auditText';

export const ORG_TYPES = [
  ['college', 'College'], ['institute', 'Coaching / training institute'], ['job_fair', 'Job fair'], ['skill_centre', 'Skill centre'],
  ['ngo', 'NGO'], ['agency', 'Placement agency'], ['company', 'Company hiring drive'], ['other', 'Other'],
];
export const joinLink = (code) => `${window.location.origin}/join/${code}`;
const inputStyle = { height: 40 };

/** Where things live for the admin console. The portal passes its own ctx (see pages/org/Portal.jsx). */
export const ADMIN_CTX = {
  base: '/api/admin',
  orgId: null,
  role: 'admin',
  canManage: true,
  sharedUrl: (params = {}) => `/admin/shared-resumes?${new URLSearchParams(params)}`,
  dashboardUrl: (g) => `/admin/orgs?org=${g.orgId}&group=${g.id}`,
  groupPatchUrl: (g) => `/api/admin/groups/${g.id}`,
};
const can = (ctx, action) => ctx.role !== 'viewer' || ['view', 'print'].includes(action);

/** The QR code for a join link as a PNG file (made in the browser — no outside QR service). */
export async function qrPng(code) {
  const url = await QRCode.toDataURL(joinLink(code), { width: 768, margin: 2, errorCorrectionLevel: 'M' });
  return (await fetch(url)).blob();
}

function QrImage({ code, size = 120 }) {
  const [src, setSrc] = useState('');
  useEffect(() => { let off = false; QRCode.toDataURL(joinLink(code), { width: 240, margin: 1 }).then((u) => !off && setSrc(u)); return () => { off = true; }; }, [code]);
  return src ? <img src={src} width={size} height={size} alt={`QR code for ${joinLink(code)}`} style={{ borderRadius: 8, border: '1px solid var(--border)' }} /> : null;
}

/* ---------- questions (custom fields) editor ---------- */
const keyOf = (label) => label.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').replace(/^(\d)/, 'f_$1').slice(0, 30) || 'field';
export const FIELD_PRESETS = [
  ['Roll number', 'text'], ['Branch', 'select', 'CSE, ECE, EEE, MECH, CIVIL, IT'], ['Course', 'text'], ['Trade', 'text'], ['Preferred job', 'text'], ['Preferred location', 'text'],
];
function FieldsEditor({ fields, set }) {
  const upd = (i, patch) => set(fields.map((f, j) => (j === i ? { ...f, ...patch } : f)));
  return (
    <fieldset className="stack g8" style={{ border: 0, padding: 0, margin: 0 }}>
      <legend className="label">Questions for members</legend>
      {fields.map((f, i) => (
        <div key={i} className="row g8" style={{ alignItems: 'center' }}>
          <input aria-label="Question" className="input" style={{ ...inputStyle, flex: '2 1 160px' }} value={f.label} onChange={(e) => upd(i, { label: e.target.value, key: f.fixedKey ? f.key : keyOf(e.target.value) })} />
          <select aria-label="Answer type" className="input" style={{ ...inputStyle, flex: '0 0 120px' }} value={f.type} onChange={(e) => upd(i, { type: e.target.value })}><option value="text">Text</option><option value="select">Choose one</option></select>
          {f.type === 'select' && <input aria-label="Options (comma separated)" className="input" style={{ ...inputStyle, flex: '2 1 180px' }} placeholder="Options, comma separated" value={f.optionsText ?? f.options.join(', ')} onChange={(e) => upd(i, { optionsText: e.target.value, options: e.target.value.split(',').map((x) => x.trim()).filter(Boolean) })} />}
          <label className="row g4 small"><input type="checkbox" checked={f.required} onChange={(e) => upd(i, { required: e.target.checked })} /> Required</label>
          <button type="button" className="link-btn small" onClick={() => set(fields.filter((_, j) => j !== i))}>Remove</button>
        </div>
      ))}
      <div className="row g8">
        {FIELD_PRESETS.filter(([l]) => !fields.some((f) => f.label === l)).map(([l, type, opts]) => (
          <button key={l} type="button" className="btn btn-outline" style={{ minHeight: 32 }} onClick={() => set([...fields, { key: keyOf(l), label: l, type, options: opts ? opts.split(', ') : [], required: l === 'Roll number' }])}>+ {l}</button>
        ))}
        <button type="button" className="btn btn-outline" style={{ minHeight: 32 }} onClick={() => set([...fields, { key: `field_${fields.length + 1}`, label: '', type: 'text', options: [], required: false }])}>+ Other question</button>
      </div>
      <span className="xs faint">Never ask for Aadhaar, PAN or other ID / bank numbers — the server refuses them.</span>
    </fieldset>
  );
}
const fieldsBody = (fields) => fields.filter((f) => f.label.trim()).map(({ key, label, type, options, required }) => ({ key, label: label.trim(), type, options: type === 'select' ? options : [], required }));

/* ---------- group form (new and edit) ---------- */
const emptyGroup = { name: '', code: '', startsOn: '', endsOn: '', memberLimit: '', customFields: [], settings: { membersDownloadFree: false, active: true, requireApproval: false } };
function GroupForm({ initial = emptyGroup, onSave, onCancel, busy, label, ctx }) {
  const [g, setG] = useState(() => ({ ...emptyGroup, ...initial, settings: { ...emptyGroup.settings, ...initial.settings }, startsOn: initial.startsOn || '', endsOn: initial.endsOn || '', memberLimit: initial.memberLimit ?? '', customFields: (initial.customFields || []).map((f) => ({ ...f, fixedKey: true })) }));
  const nm7 = ctx.role === 'admin';
  const body = () => {
    const { membersDownloadFree, ...rest } = g.settings;
    return {
      name: g.name.trim(), ...(g.code.trim() ? { code: g.code.trim() } : {}), startsOn: g.startsOn || null, endsOn: g.endsOn || null,
      memberLimit: g.memberLimit ? Number(g.memberLimit) : null, customFields: fieldsBody(g.customFields),
      settings: nm7 ? g.settings : rest, // free downloads are Nm7's decision
    };
  };
  const set = (k) => (e) => setG({ ...g, settings: { ...g.settings, [k]: e.target.checked } });
  return (
    <form className="stack g12" aria-label={label} onSubmit={(e) => { e.preventDefault(); onSave(body()); }}>
      <div className="row g12">
        <div className="field" style={{ flex: '2 1 220px' }}><label className="label" htmlFor={`${label}-n`}>Group name</label><input id={`${label}-n`} className="input" style={inputStyle} placeholder="e.g. B.Tech 2026 placements" value={g.name} onChange={(e) => setG({ ...g, name: e.target.value })} /></div>
        <div className="field" style={{ flex: '1 1 140px' }}><label className="label" htmlFor={`${label}-c`}>Join code</label><input id={`${label}-c`} className="input mono" style={inputStyle} placeholder="Automatic" maxLength={12} value={g.code} onChange={(e) => setG({ ...g, code: e.target.value.toUpperCase() })} /></div>
      </div>
      <div className="row g12">
        <div className="field" style={{ flex: '1 1 150px' }}><label className="label" htmlFor={`${label}-s`}>Starts (optional)</label><input id={`${label}-s`} type="date" className="input" style={inputStyle} value={g.startsOn} onChange={(e) => setG({ ...g, startsOn: e.target.value })} /></div>
        <div className="field" style={{ flex: '1 1 150px' }}><label className="label" htmlFor={`${label}-e`}>Ends (optional)</label><input id={`${label}-e`} type="date" className="input" style={inputStyle} value={g.endsOn} onChange={(e) => setG({ ...g, endsOn: e.target.value })} /></div>
        <div className="field" style={{ flex: '1 1 150px' }}><label className="label" htmlFor={`${label}-l`}>Member limit (optional)</label><input id={`${label}-l`} type="number" min="1" className="input" style={inputStyle} value={g.memberLimit} onChange={(e) => setG({ ...g, memberLimit: e.target.value })} /></div>
      </div>
      <FieldsEditor fields={g.customFields} set={(customFields) => setG({ ...g, customFields })} />
      <div className="row g16">
        <label className="row g8 small"><input type="checkbox" checked={g.settings.active} onChange={set('active')} /> Open for joining</label>
        <label className="row g8 small"><input type="checkbox" checked={g.settings.requireApproval} onChange={set('requireApproval')} /> Approve members before they’re shared</label>
        {nm7 && <label className="row g8 small"><input type="checkbox" checked={g.settings.membersDownloadFree} onChange={set('membersDownloadFree')} /> Members download free (no ₹99 unlock)</label>}
      </div>
      <div className="row g8">
        <button type="submit" className="btn btn-ink" disabled={busy || g.name.trim().length < 2}>Save group</button>
        {onCancel && <button type="button" className="btn btn-outline" onClick={onCancel}>Cancel</button>}
      </div>
    </form>
  );
}

export function GroupCard({ g, ctx, busy, run, reload, toast }) {
  const [editing, setEditing] = useState(false);
  const link = joinLink(g.code);
  const state = !g.settings.active ? 'Closed' : g.endsOn && g.endsOn < new Date().toISOString().slice(0, 10) ? 'Ended' : 'Open';
  const patch = (body, ok) => run(async () => { await http(ctx.groupPatchUrl(g), { method: 'PATCH', body }); setEditing(false); reload(); }, ok);
  return (
    <section className="card stack g12" aria-label={`Group ${g.name}`}>
      <div className="row between g12" style={{ alignItems: 'flex-start' }}>
        <div className="stack g4" style={{ minWidth: 0, flex: '1 1 260px' }}>
          <strong>{g.name}</strong>
          <span className="small muted">Code <strong className="mono" data-testid="join-code">{g.code}</strong> · {g.members}{g.memberLimit ? ` / ${g.memberLimit}` : ''} members · <span className={`badge ${state === 'Open' ? 'b-success' : 'b-neutral'}`}>{state}</span>{g.settings.requireApproval ? ' · approval on' : ''}{g.settings.membersDownloadFree ? ' · free downloads' : ''}</span>
          {(g.startsOn || g.endsOn) && <span className="xs faint">{g.startsOn ? `From ${day(Date.parse(g.startsOn))}` : ''}{g.endsOn ? ` until ${day(Date.parse(g.endsOn))}` : ''}</span>}
          <span className="small" style={{ overflowWrap: 'anywhere' }}>Join link: <a href={link} className="mono" data-testid="join-link">{link}</a></span>
          <div className="row g8">
            <button type="button" className="btn btn-outline" style={{ minHeight: 34 }} onClick={async () => { try { await navigator.clipboard.writeText(link); toast('Join link copied'); } catch { toast(link); } }}>Copy link</button>
            <button type="button" className="btn btn-outline" style={{ minHeight: 34 }} onClick={async () => savePdf(await qrPng(g.code), `Nm7_join_${g.code}_QR.png`)}>Download QR code (PNG)</button>
            <Link className="btn btn-outline" style={{ minHeight: 34 }} to={ctx.dashboardUrl(g)}>Dashboard</Link>
            <Link className="btn btn-outline" style={{ minHeight: 34 }} to={ctx.sharedUrl(ctx.orgId ? { group: g.id } : { org: g.orgId, group: g.id })}>Shared resumes</Link>
            {ctx.canManage && <button type="button" className="btn btn-outline" style={{ minHeight: 34 }} disabled={busy} onClick={() => patch({ settings: { active: !g.settings.active } }, g.settings.active ? 'Joining closed' : 'Joining open')}>{g.settings.active ? 'Close joining' : 'Open joining'}</button>}
            {ctx.canManage && <button type="button" className="link-btn small" onClick={() => setEditing(!editing)}>{editing ? 'Close' : 'Edit'}</button>}
          </div>
        </div>
        <QrImage code={g.code} />
      </div>
      {editing && <GroupForm ctx={ctx} label={`Edit ${g.name}`} initial={g} busy={busy} onCancel={() => setEditing(false)} onSave={(body) => patch(body, 'Group saved')} />}
    </section>
  );
}

/** The new-group form behind a button. */
export function NewGroup({ ctx, url, busy, run, reload }) {
  const [adding, setAdding] = useState(false);
  return adding ? (
    <section className="card stack g12"><strong>New group</strong>
      <GroupForm ctx={ctx} label="New group" busy={busy} onCancel={() => setAdding(false)} onSave={(body) => run(async () => { await http(url, { method: 'POST', body }); setAdding(false); reload(); }, 'Group created')} />
    </section>
  ) : <button type="button" className="btn btn-ink" style={{ alignSelf: 'flex-start' }} onClick={() => setAdding(true)}>New group</button>;
}

/* ---------- coordinators (admin only) ---------- */
function GroupPicker({ groups, value, onChange, idp }) {
  return (
    <fieldset className="stack g4" style={{ border: 0, padding: 0, margin: 0 }}>
      <legend className="label">Groups</legend>
      <label className="row g8 small"><input type="radio" name={`${idp}-scope`} checked={value === null} onChange={() => onChange(null)} /> All groups (also new ones)</label>
      <label className="row g8 small"><input type="radio" name={`${idp}-scope`} checked={value !== null} onChange={() => onChange(groups.slice(0, 1).map((g) => g.id))} /> Only these:</label>
      {value !== null && (
        <div className="row g12" style={{ paddingLeft: 24 }}>
          {groups.map((g) => <label key={g.id} className="row g4 small"><input type="checkbox" checked={value.includes(g.id)} onChange={(e) => onChange(e.target.checked ? [...value, g.id] : value.filter((x) => x !== g.id))} /> {g.name}</label>)}
        </div>
      )}
    </fieldset>
  );
}

const ROLE_TEXT = { coordinator: 'Coordinator — groups, approvals, reminders, exports', viewer: 'Viewer — view and print only' };
function Coordinators({ orgId, groups }) {
  const toast = useToast();
  const st = useApi(`/api/admin/orgs/${orgId}/staff`);
  const [busy, run] = useAction(toast);
  const [f, setF] = useState({ email: '', role: 'coordinator', groupIds: null });
  const [link, setLink] = useState(null);
  const [editing, setEditing] = useState(null);
  const gname = (ids) => (ids === null ? 'All groups' : ids.map((i) => groups.find((g) => g.id === i)?.name || '—').join(', '));
  const sent = (r) => { setLink(r); st.reload(); };
  return (
    <section className="card stack g12" aria-label="Coordinators">
      <strong>Coordinators</strong>
      <span className="xs faint">People from the organization who run their own drives at nm7.si/org. They sign in with their own Nm7 account; removing someone ends their access at once.</span>
      <Loading st={st} empty={emptyIf((d) => !d.length, 'No coordinators yet.')}>{(rows) => (
        <div className="table-wrap"><table className="table"><thead><tr><th>Person</th><th>Role</th><th>Groups</th><th>Status</th><th /></tr></thead>
          <tbody>{rows.map((s) => (
            <tr key={s.id}>
              <td className="small">{s.name || s.email}{s.name && <div className="xs faint">{s.email}</div>}</td>
              <td className="small">{editing?.id === s.id
                ? <select aria-label={`Role for ${s.email}`} className="input" style={{ height: 34 }} value={editing.role} onChange={(e) => setEditing({ ...editing, role: e.target.value })}><option value="coordinator">Coordinator</option><option value="viewer">Viewer</option></select>
                : s.role === 'viewer' ? 'Viewer' : 'Coordinator'}</td>
              <td className="xs">{editing?.id === s.id ? <GroupPicker idp={`e-${s.id}`} groups={groups} value={editing.groupIds} onChange={(groupIds) => setEditing({ ...editing, groupIds })} /> : gname(s.groupIds)}</td>
              <td className="small">{s.status === 'active' ? <span className="badge b-success">Active</span> : <span className="badge b-warning">Invited{s.expiresAt && s.expiresAt < Date.now() ? ' · expired' : ''}</span>}</td>
              <td><div className="row g8">
                {editing?.id === s.id
                  ? <><button type="button" className="link-btn small" disabled={busy} onClick={() => run(async () => { await http(`/api/admin/staff/${s.id}`, { method: 'PATCH', body: { role: editing.role, groupIds: editing.groupIds } }); setEditing(null); st.reload(); }, 'Access changed')}>Save</button><button type="button" className="link-btn small" onClick={() => setEditing(null)}>Cancel</button></>
                  : <button type="button" className="link-btn small" onClick={() => setEditing({ id: s.id, role: s.role, groupIds: s.groupIds })}>Change</button>}
                {s.status === 'invited' && <button type="button" className="link-btn small" disabled={busy} onClick={() => run(async () => sent(await http(`/api/admin/staff/${s.id}/resend`, { method: 'POST', body: {} })), 'Invite sent again')}>Resend invite</button>}
                <button type="button" className="link-btn small" disabled={busy} onClick={() => { if (window.confirm(`Remove ${s.email}? Their access ends now.`)) run(async () => { await http(`/api/admin/staff/${s.id}`, { method: 'DELETE' }); st.reload(); }, 'Access removed'); }}>Remove</button>
              </div></td>
            </tr>
          ))}</tbody></table></div>
      )}</Loading>
      <form className="stack g12" aria-label="Invite a coordinator" onSubmit={(e) => { e.preventDefault(); run(async () => { sent(await http(`/api/admin/orgs/${orgId}/staff`, { method: 'POST', body: f })); setF({ email: '', role: 'coordinator', groupIds: null }); }, 'Invite sent'); }}>
        <div className="row g12" style={{ alignItems: 'flex-end' }}>
          <div className="field" style={{ flex: '2 1 220px' }}><label className="label" htmlFor="st-email">Invite by email</label><input id="st-email" type="email" className="input" style={inputStyle} placeholder="placement.cell@college.edu" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} /></div>
          <div className="field" style={{ flex: '1 1 260px' }}><label className="label" htmlFor="st-role">Role</label><select id="st-role" className="input" style={inputStyle} value={f.role} onChange={(e) => setF({ ...f, role: e.target.value })}>{Object.entries(ROLE_TEXT).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></div>
        </div>
        {groups.length > 0 && <GroupPicker idp="new" groups={groups} value={f.groupIds} onChange={(groupIds) => setF({ ...f, groupIds })} />}
        <button type="submit" className="btn btn-ink" style={{ alignSelf: 'flex-start' }} disabled={busy || !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(f.email.trim()) || (f.groupIds !== null && !f.groupIds.length)}>Send invite</button>
      </form>
      {link && (
        <div className="well stack g4 small" role="status">
          <strong>{link.emailSent ? `Invite emailed to ${link.email}` : `The email didn’t go out — send ${link.email} this link yourself`}</strong>
          <span className="xs">One-time link (expires in 7 days): <code style={{ userSelect: 'all', overflowWrap: 'anywhere' }} data-testid="invite-url">{link.inviteUrl}</code></span>
          <button type="button" className="link-btn xs" style={{ alignSelf: 'flex-start' }} onClick={() => setLink(null)}>Hide</button>
        </div>
      )}
    </section>
  );
}

function OrgDetail({ id, onBack }) {
  const toast = useToast();
  const st = useApi(`/api/admin/orgs/${id}`);
  const [busy, run] = useAction(toast);
  const [edit, setEdit] = useState(null);
  const ctx = { ...ADMIN_CTX, orgId: null };
  return (
    <Loading st={st}>{(o) => (
      <>
        <PageHead title={o.name} sub={`${o.typeName}${o.city ? ` · ${o.city}` : ''} · ${o.groups} group${o.groups === 1 ? '' : 's'} · ${o.members} member${o.members === 1 ? '' : 's'}${o.status === 'archived' ? ' · archived' : ''}`}
          right={<><button type="button" className="btn btn-outline" onClick={() => setEdit(edit ? null : { name: o.name, type: o.type, city: o.city, logoUrl: o.logoUrl, status: o.status })}>Edit organization</button><button type="button" className="btn btn-outline" onClick={onBack}>All organizations</button></>} />
        {edit && (
          <form className="card stack g12" aria-label="Edit organization" onSubmit={(e) => { e.preventDefault(); run(async () => { await http(`/api/admin/orgs/${id}`, { method: 'PATCH', body: edit }); setEdit(null); st.reload(); }, 'Saved'); }}>
            <OrgFields f={edit} set={setEdit} idp="eo" />
            <label className="row g8 small"><input type="checkbox" checked={edit.status === 'archived'} onChange={(e) => setEdit({ ...edit, status: e.target.checked ? 'archived' : 'active' })} /> Archived</label>
            <button type="submit" className="btn btn-ink" style={{ alignSelf: 'flex-start' }} disabled={busy}>Save</button>
          </form>
        )}
        {o.groupList.map((g) => <GroupCard key={g.id} g={g} ctx={ctx} busy={busy} run={run} reload={st.reload} toast={toast} />)}
        {o.groupList.length === 0 && <div className="well small muted" style={{ textAlign: 'center', padding: 24 }}>No groups yet. A group is one batch, event or drive with its own join code.</div>}
        <NewGroup ctx={ctx} url={`/api/admin/orgs/${id}/groups`} busy={busy} run={run} reload={st.reload} />
        <Coordinators orgId={id} groups={o.groupList} />
      </>
    )}</Loading>
  );
}

function OrgFields({ f, set, idp }) {
  return (
    <div className="row g12">
      <div className="field" style={{ flex: '2 1 220px' }}><label className="label" htmlFor={`${idp}-n`}>Organization name</label><input id={`${idp}-n`} className="input" style={inputStyle} value={f.name} onChange={(e) => set({ ...f, name: e.target.value })} /></div>
      <div className="field" style={{ flex: '1 1 200px' }}><label className="label" htmlFor={`${idp}-t`}>Type</label><select id={`${idp}-t`} className="input" style={inputStyle} value={f.type} onChange={(e) => set({ ...f, type: e.target.value })}>{ORG_TYPES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></div>
      <div className="field" style={{ flex: '1 1 140px' }}><label className="label" htmlFor={`${idp}-c`}>City</label><input id={`${idp}-c`} className="input" style={inputStyle} value={f.city} onChange={(e) => set({ ...f, city: e.target.value })} /></div>
      <div className="field" style={{ flex: '2 1 220px' }}><label className="label" htmlFor={`${idp}-l`}>Logo URL (optional, https)</label><input id={`${idp}-l`} className="input" style={inputStyle} value={f.logoUrl} onChange={(e) => set({ ...f, logoUrl: e.target.value.trim() })} /></div>
    </div>
  );
}

/** Audit log list: the admin's (every organization) or one organization's. */
export function AuditList({ url, sub }) {
  const log = useApi(url);
  return (
    <section className="card stack g12" aria-label="Audit log">
      <div className="row between g8"><strong>Audit log</strong><button type="button" className="link-btn small" onClick={log.reload}>Refresh</button></div>
      <span className="xs faint">{sub || 'Every view, download, print, export, reminder and approval of a shared resume, and every organization / group change.'}</span>
      <Loading st={log} empty={emptyIf((d) => !d.length, 'Nothing logged yet.')}>{(rows) => (
        <div className="table-wrap"><table className="table"><thead><tr><th>When</th><th>Who</th><th>Action</th><th>Count</th><th>Details</th></tr></thead>
          <tbody>{rows.map((a) => <tr key={a.id}><td className="small">{when(a.at)}</td><td className="small">{a.actorName || '—'}{a.byStaff && <div className="xs faint">coordinator</div>}</td><td className="small mono">{a.action}</td><td className="small">{a.count ?? '—'}</td><td className="xs" style={{ maxWidth: 320, overflowWrap: 'anywhere' }}>{auditText(a.details)}</td></tr>)}</tbody></table></div>
      )}</Loading>
    </section>
  );
}

/* ---------- group dashboard ---------- */
function Tile({ label, value, to }) {
  const inner = <><span className="xs muted">{label}</span><strong className="display" style={{ fontSize: 26 }}>{value}</strong></>;
  return to ? <Link to={to} className="card stack g4" style={{ padding: 14, textDecoration: 'none', color: 'inherit' }} aria-label={`${label}: ${value}`}>{inner}</Link> : <div className="card stack g4" style={{ padding: 14 }}>{inner}</div>;
}

/** Remind a segment of a group, or chosen members (one email per member per day, 3 sends per group per day). */
function RemindDialog({ ctx, groups, groupId, ids, onClose, onSent }) {
  const toast = useToast();
  const [busy, run] = useAction(toast);
  const [f, setF] = useState({ segment: ids?.length ? 'selected' : 'incomplete', group: groupId || groups?.[0]?.id || '', since: '', note: '' });
  const send = () => run(async () => {
    const body = { segment: f.segment, note: f.note.trim(), ...(f.segment === 'selected' ? { ids } : { group: f.group }), ...(f.segment === 'stale' ? { since: f.since } : {}) };
    const r = await http(`${ctx.base}/shared-resumes/remind`, { method: 'POST', body });
    toast(remindSummary(r));
    onSent?.(r);
    onClose();
  });
  return (
    <Dialog showTitle title="Send a reminder" onClose={onClose}>
      <div className="stack g12">
        <fieldset className="stack g4" style={{ border: 0, padding: 0, margin: 0 }}>
          <legend className="label">Who</legend>
          {ids?.length > 0 && <label className="row g8 small"><input type="radio" name="rm-seg" checked={f.segment === 'selected'} onChange={() => setF({ ...f, segment: 'selected' })} /> The {ids.length} selected member{ids.length === 1 ? '' : 's'}</label>}
          {[['incomplete', 'Everyone with an incomplete resume'], ['needs_changes', 'Everyone asked for changes'], ['stale', 'Everyone not updated since…']].map(([k, l]) => (
            <label key={k} className="row g8 small"><input type="radio" name="rm-seg" checked={f.segment === k} onChange={() => setF({ ...f, segment: k })} /> {l}</label>
          ))}
        </fieldset>
        {f.segment !== 'selected' && !groupId && (
          <div className="field"><label className="label" htmlFor="rm-group">Group</label><select id="rm-group" className="input" style={inputStyle} value={f.group} onChange={(e) => setF({ ...f, group: e.target.value })}>{(groups || []).map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}</select></div>
        )}
        {f.segment === 'stale' && <div className="field"><label className="label" htmlFor="rm-since">Not updated since</label><input id="rm-since" type="date" className="input" style={inputStyle} value={f.since} onChange={(e) => setF({ ...f, since: e.target.value })} /></div>}
        <div className="field"><label className="label" htmlFor="rm-note">Your note (optional)</label><textarea id="rm-note" className="input" rows={3} maxLength={300} value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} placeholder="e.g. Bring a printout to the placement drive on Friday." /><span className="xs faint">{300 - f.note.length} characters left · plain text</span></div>
        <span className="xs faint">The email lists what’s missing and links to their resume. Each member gets at most one reminder a day and can stop reminders with one click.</span>
        <div className="row g8"><button type="button" className="btn btn-ink" disabled={busy || (f.segment !== 'selected' && !f.group) || (f.segment === 'stale' && !f.since)} onClick={send}>Send reminder</button><button type="button" className="btn btn-outline" onClick={onClose}>Cancel</button></div>
      </div>
    </Dialog>
  );
}

/** One group's numbers, joins per day, completeness and who's incomplete — with the quick actions. */
export function GroupDashboard({ ctx, groupId, onBack }) {
  const toast = useToast();
  const st = useApi(`${ctx.base}/groups/${groupId}/dashboard`);
  const [reminding, setReminding] = useState(false);
  const [job, setJob] = useState(null);
  const [busy, run] = useAction(toast);
  const shared = (params) => ctx.sharedUrl({ ...(ctx.orgId ? {} : { org: st.data?.group.orgId }), group: groupId, ...params });
  const printReady = async () => {
    setJob('Starting');
    try {
      const r = await runExport({ base: ctx.base, kind: 'print_bulk', filters: { group: groupId, readyNotPrinted: true }, sort: 'roll', cover: true, onProgress: (p) => setJob(`${p.stage} · ${p.done} of ${p.total}`) });
      await savePdf(r.blob, r.fileName);
      toast(`Combined PDF ready · ${r.total} resumes`);
      st.reload();
    } catch (e) { toast(e.message); } finally { setJob(null); }
  };
  const csv = () => run(async () => savePdf(await csvBlob(ctx, { group: groupId }), `Nm7_${st.data.group.code}_${new Date().toISOString().slice(0, 10)}.csv`), 'CSV downloaded');
  return (
    <Loading st={st}>{(d) => (
      <>
        <PageHead title={d.group.name} sub={`Group dashboard · code ${d.group.code}`} right={onBack} />
        <div className="row g8">
          {can(ctx, 'remind') && <button type="button" className="btn btn-ink" onClick={() => setReminding(true)} disabled={!d.counts.incomplete && !d.counts.needsChanges}>Remind incomplete</button>}
          <button type="button" className="btn btn-outline" disabled={!!job || !d.counts.readyNotPrinted} onClick={printReady}>Print ready & not printed ({d.counts.readyNotPrinted})</button>
          {can(ctx, 'export') && <button type="button" className="btn btn-outline" disabled={busy} onClick={csv}>Download CSV</button>}
          <Link className="btn btn-outline" to={shared({})}>Open the table</Link>
        </div>
        {job && <span className="small" role="status">{job}</span>}
        <div className="grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: 12 }}>
          {countTiles(d.counts).map(([label, value, filters]) => <Tile key={label} label={label} value={value} to={filters ? shared(filters) : null} />)}
        </div>
        <div className="row g16" style={{ alignItems: 'stretch' }}>
          <div className="card" style={{ flex: '2 1 360px', padding: 16, minWidth: 0 }}><BarChart title="Joins per day (last 30 days)" data={joinBars(d.joinsPerDay)} series={[{ key: 'joins', label: 'Joined', color: 'var(--viz-1)' }]} height={150} /></div>
          <div className="card" style={{ flex: '1 1 240px', padding: 16 }}><HBars title="Resume completeness" rows={bucketRows(d.buckets)} /></div>
        </div>
        <section className="card stack g8" aria-label="Incomplete members">
          <strong>Incomplete resumes ({d.counts.incomplete})</strong>
          {d.incompleteMembers.length === 0 ? <span className="small muted">Everyone’s resume is at least 80% complete.</span> : (
            <div className="table-wrap"><table className="table"><thead><tr><th>Member</th><th>Complete</th><th>Missing</th></tr></thead>
              <tbody>{d.incompleteMembers.map((m) => <tr key={m.membershipId}><td className="small">{m.name}{m.roll && <div className="xs faint">{m.roll}</div>}{m.approval === 'pending' && <span className="badge b-warning">Pending</span>}</td><td className="small">{m.completeness}%</td><td className="small">{m.missing.join(', ')}</td></tr>)}</tbody></table></div>
          )}
        </section>
        {reminding && <RemindDialog ctx={ctx} groupId={groupId} onClose={() => setReminding(false)} onSent={() => st.reload()} />}
      </>
    )}</Loading>
  );
}

async function csvBlob(ctx, body, sort = 'name') {
  const res = await fetch(`${API_BASE}${ctx.base}/shared-resumes/export.csv?sort=${sort}&dir=asc`, { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  if (!res.ok) throw new Error((await res.json().catch(() => null))?.error?.message || 'The CSV couldn’t be made.');
  return res.blob();
}

/** /admin/orgs */
export function LiveOrgs() {
  const toast = useToast();
  const [params, setParams] = useSearchParams();
  const open = params.get('org');
  const group = params.get('group');
  const st = useApi(open ? null : '/api/admin/orgs');
  const [busy, run] = useAction(toast);
  const [f, setF] = useState({ name: '', type: 'college', city: '', logoUrl: '' });
  if (open && group) return <GroupDashboard ctx={ADMIN_CTX} groupId={group} onBack={<button type="button" className="btn btn-outline" onClick={() => setParams({ org: open })}>Back to the organization</button>} />;
  if (open) return <OrgDetail id={open} onBack={() => setParams({})} />;
  return (
    <>
      <PageHead title="Organizations" sub="Colleges, institutes, job fairs and other groups whose people share their resumes with Nm7." right={<Link className="btn btn-outline" to="/admin/shared-resumes">Shared resumes</Link>} />
      <Loading st={st} empty={emptyIf((d) => !d.length, 'No organizations yet. Add the first one below.')}>{(orgs) => (
        <div className="card table-wrap" style={{ padding: 0 }}>
          <table className="table"><thead><tr><th>Organization</th><th>Type</th><th>Groups</th><th>Members</th><th>Added</th></tr></thead>
            <tbody>{orgs.map((o) => (
              <tr key={o.id}>
                <td><button type="button" className="link-btn" onClick={() => setParams({ org: o.id })}>{o.name}</button>{o.city && <div className="xs faint">{o.city}</div>}{o.status === 'archived' && <span className="badge b-neutral">Archived</span>}</td>
                <td className="small">{o.typeName}</td><td className="small">{o.groups}</td><td className="small">{o.members}</td><td className="small">{day(o.createdAt)}</td>
              </tr>
            ))}</tbody></table>
        </div>
      )}</Loading>
      <form className="card stack g12" aria-label="New organization" onSubmit={(e) => { e.preventDefault(); run(async () => { const o = await http('/api/admin/orgs', { method: 'POST', body: f }); setF({ name: '', type: 'college', city: '', logoUrl: '' }); setParams({ org: o.id }); }, 'Organization added'); }}>
        <strong>New organization</strong>
        <OrgFields f={f} set={setF} idp="no" />
        <button type="submit" className="btn btn-ink" style={{ alignSelf: 'flex-start' }} disabled={busy || f.name.trim().length < 2}>Add organization</button>
      </form>
      <AuditList url="/api/admin/org-audit?limit=100" />
    </>
  );
}

/* ---------- shared resumes ---------- */
const FILTER_KEYS = ['org', 'group', 'q', 'joinedFrom', 'joinedTo', 'updatedFrom', 'updatedTo', 'fieldKey', 'fieldValue', 'incomplete', 'notPrinted', 'readyNotPrinted', 'approval', 'review'];
const BOOL_KEYS = ['incomplete', 'notPrinted', 'readyNotPrinted'];
const PER_PAGE = 25;
const COLS = [['name', 'Name'], ['org', 'Organization / group'], ['roll', 'Fields'], [null, 'Resume'], ['completeness', 'Complete'], [null, 'Status'], ['updated', 'Last updated'], ['printed', 'Printed']];

function filtersFrom(params) {
  const f = {};
  FILTER_KEYS.forEach((k) => { const v = params.get(k); if (v) f[k] = BOOL_KEYS.includes(k) ? v === 'true' : v; });
  return f;
}

function ViewResume({ ctx, row, onClose, onAction }) {
  const st = useApi(`${ctx.base}/shared-resumes/${row.membershipId}`);
  return (
    <Dialog showTitle wide title={`${row.name} · ${row.groupName}`} onClose={onClose}>
      <Loading st={st}>{(r) => (
        <div className="stack g12">
          <div className="row g8">{row.approval === 'approved' && <><button type="button" className="btn btn-ink" onClick={() => onAction('download', row)}>Download PDF</button><button type="button" className="btn btn-outline" onClick={() => onAction('print', row)}>Print</button></>}<span className="xs faint">Read-only · exactly as the member’s template prints it (hidden entries stay hidden)</span></div>
          {r.reviewNote && <div className="well small">Asked for changes: {r.reviewNote}</div>}
          <ResumePreview data={r.data} design={designOf(r.data)} />
        </div>
      )}</Loading>
    </Dialog>
  );
}

/** Opens a PDF for printing (the browser's PDF viewer has Print); downloads it when pop-ups are blocked. */
function openForPrint(blob, name) {
  const url = URL.createObjectURL(blob);
  const w = window.open(url, '_blank');
  if (!w) savePdf(blob, name);
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

function NoteDialog({ count, onSave, onClose }) {
  const [note, setNote] = useState('');
  return (
    <Dialog showTitle title={`Ask for changes (${count})`} onClose={onClose}>
      <div className="stack g12">
        <div className="field"><label className="label" htmlFor="rv-note">What should they change?</label><textarea id="rv-note" className="input" rows={4} maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Add your internship dates and one project." /><span className="xs faint">{500 - note.length} characters left · the member sees this note and gets an email</span></div>
        <div className="row g8"><button type="button" className="btn btn-ink" disabled={!note.trim()} onClick={() => onSave(note.trim())}>Send</button><button type="button" className="btn btn-outline" onClick={onClose}>Cancel</button></div>
      </div>
    </Dialog>
  );
}

const statusBadge = (r) => (r.approval !== 'approved'
  ? <span className={`badge ${r.approval === 'pending' ? 'b-warning' : 'b-neutral'}`}>{APPROVAL_LABEL[r.approval]}</span>
  : r.reviewStatus !== 'none' ? <span className={`badge ${r.reviewStatus === 'ready' ? 'b-success' : 'b-warning'}`} title={r.reviewNote || undefined}>{REVIEW_LABEL[r.reviewStatus]}</span> : <span className="xs faint">—</span>);

/** The shared-resumes table. `ctx` decides the API base and what the person may do; `groups` (portal) or the
 * organization picker (admin) feeds the group filter. */
export function SharedResumes({ ctx = ADMIN_CTX, groups: portalGroups = null, title = 'Shared resumes', sub, right }) {
  const toast = useToast();
  const [params, setParams] = useSearchParams();
  const filters = useMemo(() => filtersFrom(params), [params]);
  const sort = params.get('sort') || 'joined';
  const dir = params.get('dir') || 'desc';
  const page = Number(params.get('page') || 1);
  const [q, setQ] = useState(filters.q || '');
  useEffect(() => { const t = setTimeout(() => { if ((q.trim() || undefined) !== filters.q) setFilter({ q: q.trim() }); }, 300); return () => clearTimeout(t); }, [q]); // eslint-disable-line react-hooks/exhaustive-deps
  const qs = new URLSearchParams({ ...Object.fromEntries(Object.entries(filters).map(([k, v]) => [k, String(v)])), sort, dir, page: String(page), perPage: String(PER_PAGE) });
  const st = useApi(`${ctx.base}/shared-resumes?${qs}`);
  const admin = !ctx.orgId;
  const orgs = useApi(admin ? '/api/admin/orgs' : null);
  const org = useApi(admin && filters.org ? `/api/admin/orgs/${filters.org}` : null);
  const groups = admin ? org.data?.groupList || [] : portalGroups || [];
  const [selected, setSelected] = useState(() => new Set());
  const [viewing, setViewing] = useState(null);
  const [job, setJob] = useState(null); // { label, done, total, stage }
  const [cover, setCover] = useState(true);
  const [onlyReady, setOnlyReady] = useState(false);
  const [printSort, setPrintSort] = useState('roll');
  const [dialog, setDialog] = useState(null); // 'remind' | 'note'
  const stop = useRef(null);
  const [busy, run] = useAction(toast);

  function setFilter(patch) {
    const next = new URLSearchParams(params);
    Object.entries(patch).forEach(([k, v]) => { if (v === '' || v == null || v === false) next.delete(k); else next.set(k, String(v)); });
    next.delete('page');
    setParams(next, { replace: true });
    setSelected(new Set());
  }
  const setSort = (k) => { const next = new URLSearchParams(params); next.set('sort', k); next.set('dir', sort === k && dir === 'asc' ? 'desc' : 'asc'); setParams(next, { replace: true }); };
  const goPage = (p) => { const next = new URLSearchParams(params); next.set('page', String(p)); setParams(next, { replace: true }); };

  const body = exportFilters(filters, { onlyReady });
  async function exportJob(kind, ids, label) {
    const ac = new AbortController(); stop.current = ac;
    setJob({ label, done: 0, total: ids ? ids.length : st.data?.total || 0, stage: 'Starting' });
    try {
      const r = await runExport({ base: ctx.base, kind, ids, filters: body, sort: kind === 'print_bulk' || kind === 'export_zip' ? printSort : 'name', direction: 'asc', cover, signal: ac.signal, onProgress: (p) => setJob({ label, ...p }) });
      if (kind === 'print') openForPrint(r.blob, r.fileName); else await savePdf(r.blob, r.fileName);
      toast(kind === 'print_bulk' ? `Combined PDF ready · ${r.total} resumes${r.pages ? ` · ${r.pages} pages` : ''}${r.skipped ? ` · ${r.skipped} skipped` : ''}` : kind === 'export_zip' ? `ZIP ready · ${r.total} PDFs` : 'PDF ready');
      st.reload();
    } catch (e) {
      toast(e.name === 'AbortError' ? 'Stopped' : e.message || 'That didn’t work. Please try again.');
    } finally { setJob(null); stop.current = null; }
  }
  const rowAction = (kind, row) => exportJob(kind, [row.membershipId], kind === 'print' ? `Print · ${row.name}` : `PDF · ${row.name}`);
  const csv = () => run(async () => savePdf(await csvBlob(ctx, body, printSort), `Nm7_shared_resumes_${new Date().toISOString().slice(0, 10)}.csv`), 'CSV downloaded');
  const act = (path, extra, ok) => run(async () => {
    const r = await http(`${ctx.base}/shared-resumes/${path}`, { method: 'POST', body: { ids: [...selected], ...extra } });
    setSelected(new Set()); st.reload();
    toast(r.emailed != null ? `${ok} · ${remindSummary(r, 'emailed')}` : `${ok} · ${r.updated}`);
  });

  const data = st.data;
  const ids = selected.size ? [...selected] : null;
  const scope = selected.size ? `${selected.size} selected` : `all ${data?.total ?? 0} matching`;
  const pageIds = data?.rows.map((r) => r.membershipId) || [];
  const allOnPage = pageIds.length > 0 && pageIds.every((i) => selected.has(i));
  const toggle = (i) => setSelected((s) => { const n = new Set(s); if (n.has(i)) n.delete(i); else n.add(i); return n; });
  const fieldDefs = data?.fields || [];
  const pages = data ? Math.max(1, Math.ceil(data.total / PER_PAGE)) : 1;
  const showsUnapproved = filters.approval && filters.approval !== 'approved';

  return (
    <>
      <PageHead title={title} sub={sub || 'Resumes members shared with their organization (with consent). Downloads and prints here are free and logged.'} right={right} />
      <section className="card stack g12" aria-label="Filters">
        <div className="row g12">
          {admin && <div className="field" style={{ flex: '1 1 200px' }}><label className="label" htmlFor="sf-org">Organization</label>
            <select id="sf-org" className="input" style={inputStyle} value={filters.org || ''} onChange={(e) => setFilter({ org: e.target.value, group: '' })}><option value="">All</option>{orgs.data?.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}</select></div>}
          <div className="field" style={{ flex: '1 1 200px' }}><label className="label" htmlFor="sf-group">Group</label>
            <select id="sf-group" className="input" style={inputStyle} value={filters.group || ''} disabled={admin && !filters.org} onChange={(e) => setFilter({ group: e.target.value })}><option value="">All</option>{groups.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}</select></div>
          <div className="field" style={{ flex: '2 1 220px' }}><label className="label" htmlFor="sf-q">Search</label><input id="sf-q" className="input" style={inputStyle} placeholder="Name, email or roll number" value={q} onChange={(e) => setQ(e.target.value)} /></div>
        </div>
        <div className="row g12" style={{ alignItems: 'flex-end' }}>
          <div className="field" style={{ flex: '1 1 150px' }}><label className="label" htmlFor="sf-appr">Approval</label>
            <select id="sf-appr" className="input" style={inputStyle} value={filters.approval || 'approved'} onChange={(e) => setFilter({ approval: e.target.value === 'approved' ? '' : e.target.value })}><option value="approved">Approved</option><option value="pending">Pending</option><option value="rejected">Rejected</option><option value="all">All</option></select></div>
          <div className="field" style={{ flex: '1 1 150px' }}><label className="label" htmlFor="sf-rev">Review</label>
            <select id="sf-rev" className="input" style={inputStyle} value={filters.review || ''} onChange={(e) => setFilter({ review: e.target.value })}><option value="">Any</option><option value="none">Not reviewed</option><option value="needs_changes">Needs changes</option><option value="ready">Ready</option></select></div>
          {[['joinedFrom', 'Joined from'], ['joinedTo', 'Joined to'], ['updatedFrom', 'Updated from'], ['updatedTo', 'Updated to']].map(([k, l]) => (
            <div key={k} className="field" style={{ flex: '1 1 140px' }}><label className="label" htmlFor={`sf-${k}`}>{l}</label><input id={`sf-${k}`} type="date" className="input" style={inputStyle} value={filters[k] || ''} onChange={(e) => setFilter({ [k]: e.target.value })} /></div>
          ))}
        </div>
        <div className="row g12" style={{ alignItems: 'flex-end' }}>
          <div className="field" style={{ flex: '1 1 160px' }}><label className="label" htmlFor="sf-fk">Answer to</label>
            <select id="sf-fk" className="input" style={inputStyle} value={filters.fieldKey || ''} onChange={(e) => setFilter({ fieldKey: e.target.value, fieldValue: '' })}><option value="">Any question</option>{fieldDefs.map((f) => <option key={f.key} value={f.key}>{f.label}</option>)}</select></div>
          <div className="field" style={{ flex: '1 1 160px' }}><label className="label" htmlFor="sf-fv">is</label>
            {fieldDefs.find((f) => f.key === filters.fieldKey)?.type === 'select'
              ? <select id="sf-fv" className="input" style={inputStyle} value={filters.fieldValue || ''} onChange={(e) => setFilter({ fieldValue: e.target.value })}><option value="">Any</option>{fieldDefs.find((f) => f.key === filters.fieldKey).options.map((o) => <option key={o}>{o}</option>)}</select>
              : <input id="sf-fv" className="input" style={inputStyle} disabled={!filters.fieldKey} defaultValue={filters.fieldValue || ''} key={filters.fieldKey || '-'} onBlur={(e) => setFilter({ fieldValue: e.target.value.trim() })} onKeyDown={(e) => { if (e.key === 'Enter') setFilter({ fieldValue: e.currentTarget.value.trim() }); }} />}
          </div>
          <label className="row g8 small"><input type="checkbox" checked={!!filters.incomplete} onChange={(e) => setFilter({ incomplete: e.target.checked })} /> Incomplete only</label>
          <label className="row g8 small"><input type="checkbox" checked={!!filters.notPrinted} onChange={(e) => setFilter({ notPrinted: e.target.checked })} /> Not printed yet</label>
          <label className="row g8 small"><input type="checkbox" checked={!!filters.readyNotPrinted} onChange={(e) => setFilter({ readyNotPrinted: e.target.checked })} /> Ready & not printed</label>
          {Object.keys(filters).length > 0 && <button type="button" className="link-btn small" onClick={() => { setQ(''); setParams({}, { replace: true }); setSelected(new Set()); }}>Clear filters</button>}
        </div>
      </section>

      <section className="card stack g12" aria-label="Bulk actions">
        <div className="row between g12" style={{ alignItems: 'center' }}>
          <strong>Print or export {scope}</strong>
          {selected.size > 0 && <button type="button" className="link-btn small" onClick={() => setSelected(new Set())}>Clear selection</button>}
        </div>
        <div className="row g12" style={{ alignItems: 'center' }}>
          <label className="row g8 small">Order by <select className="input" style={{ height: 36, width: 'auto' }} value={printSort} onChange={(e) => setPrintSort(e.target.value)}><option value="roll">Roll number</option><option value="name">Name</option></select></label>
          <label className="row g8 small"><input type="checkbox" checked={cover} onChange={(e) => setCover(e.target.checked)} /> Cover page</label>
          <label className="row g8 small"><input type="checkbox" checked={onlyReady} onChange={(e) => setOnlyReady(e.target.checked)} /> Export only Ready</label>
          <button type="button" className="btn btn-ink" disabled={!!job || !data?.total} onClick={() => exportJob('print_bulk', ids, 'Combined PDF')}>Combined PDF</button>
          {can(ctx, 'export') && <button type="button" className="btn btn-outline" disabled={!!job || !data?.total} onClick={() => exportJob('export_zip', ids, 'ZIP of PDFs')}>ZIP (one PDF each)</button>}
          {can(ctx, 'export') && <button type="button" className="btn btn-outline" disabled={busy || !data?.total} onClick={csv}>CSV</button>}
        </div>
        {can(ctx, 'approve') && (
          <div className="row g8" style={{ alignItems: 'center' }} aria-label="Review actions">
            <span className="small muted">Selected ({selected.size}):</span>
            <button type="button" className="btn btn-outline" style={{ minHeight: 34 }} disabled={busy || !selected.size} onClick={() => act('approval', { action: 'approve' }, 'Approved')}>Approve</button>
            <button type="button" className="btn btn-outline" style={{ minHeight: 34 }} disabled={busy || !selected.size} onClick={() => act('approval', { action: 'reject' }, 'Rejected')}>Reject</button>
            <button type="button" className="btn btn-outline" style={{ minHeight: 34 }} disabled={busy || !selected.size} onClick={() => setDialog('note')}>Needs changes</button>
            <button type="button" className="btn btn-outline" style={{ minHeight: 34 }} disabled={busy || !selected.size} onClick={() => act('review', { status: 'ready' }, 'Marked ready')}>Mark ready</button>
            <button type="button" className="btn btn-outline" style={{ minHeight: 34 }} disabled={busy || !selected.size} onClick={() => act('unprint', {}, 'Marked not printed')}>Mark not printed</button>
            <button type="button" className="btn btn-outline" style={{ minHeight: 34 }} disabled={busy} onClick={() => setDialog('remind')}>Remind…</button>
          </div>
        )}
        {job && (
          <div className="stack g4" role="status" aria-live="polite">
            <div className="row between g8 small"><span>{job.label} · {job.stage} · {job.done} of {job.total}</span><button type="button" className="link-btn small" onClick={() => stop.current?.abort()}>Stop</button></div>
            <progress max={job.total || 1} value={job.done} style={{ width: '100%' }} aria-label="Export progress" />
            <span className="xs faint">Keep this tab open. The PDFs are drawn in this browser, so nothing times out.</span>
          </div>
        )}
        <span className="xs faint">Exports include approved members only{showsUnapproved ? ' — the pending / rejected rows shown here are left out' : ''}. Combined PDF and ZIP mark those resumes as printed. Exports never include ID numbers.</span>
      </section>

      <Loading st={st} empty={emptyIf((d) => d.total === 0, Object.keys(filters).length ? 'No shared resumes match these filters.' : 'No shared resumes yet. Share a group’s join link or QR code.')}>{(d) => (
        <>
          <div className="card table-wrap" style={{ padding: 0 }}>
            <table className="table" aria-label="Shared resumes">
              <thead><tr>
                <th><input type="checkbox" aria-label="Select all on this page" checked={allOnPage} onChange={() => setSelected((s) => { const n = new Set(s); pageIds.forEach((i) => (allOnPage ? n.delete(i) : n.add(i))); return n; })} /></th>
                {COLS.map(([k, l]) => <th key={l} aria-sort={k && sort === k ? (dir === 'asc' ? 'ascending' : 'descending') : undefined}>{k ? <button type="button" className="link-btn small" style={{ fontWeight: 600, textAlign: 'left' }} onClick={() => setSort(k)}>{l}{sort === k ? (dir === 'asc' ? ' ↑' : ' ↓') : ''}</button> : l}</th>)}
                <th />
              </tr></thead>
              <tbody>{d.rows.map((r) => (
                <tr key={r.membershipId}>
                  <td><input type="checkbox" aria-label={`Select ${r.name}`} checked={selected.has(r.membershipId)} onChange={() => toggle(r.membershipId)} /></td>
                  <td className="small"><strong>{r.name}</strong><div className="xs faint">{r.email}{r.phone ? ` · ${r.phone}` : ''}</div></td>
                  <td className="small">{r.orgName}<div className="xs faint">{r.groupName}</div></td>
                  <td className="xs">{(r.fieldDefs || []).filter((f) => r.fields[f.key]).map((f) => <div key={f.key}>{f.label}: {r.fields[f.key]}</div>)}</td>
                  <td className="small">{r.resumeTitle}<div className="xs faint">{TEMPLATE_PRESETS[r.template]?.name || 'Custom'}{r.pages ? ` · ${r.pages} page${r.pages > 1 ? 's' : ''}` : ''}</div></td>
                  <td className="small"><span className={`badge ${r.completeness === 100 ? 'b-success' : 'b-warning'}`} title={r.missing.length ? `Missing: ${r.missing.join(', ')}` : 'Complete'}>{r.completeness}%</span></td>
                  <td className="small" data-testid="status">{statusBadge(r)}</td>
                  <td className="small">{day(r.updatedAt)}</td>
                  <td className="small">{r.printedAt ? <>{day(r.printedAt)}{r.printedCount > 1 ? <div className="xs faint">{r.printedCount}×</div> : null}</> : <span className="muted">{r.printedCount ? `Reprint (${r.printedCount}×)` : 'Not yet'}</span>}</td>
                  <td><div className="row g8" style={{ flexWrap: 'nowrap' }}>
                    <button type="button" className="link-btn small" onClick={() => setViewing(r)}>View</button>
                    {r.approval === 'approved' && <button type="button" className="link-btn small" disabled={!!job} onClick={() => rowAction('download', r)}>PDF</button>}
                    {r.approval === 'approved' && <button type="button" className="link-btn small" disabled={!!job} onClick={() => rowAction('print', r)}>Print</button>}
                  </div></td>
                </tr>
              ))}</tbody>
            </table>
          </div>
          <div className="row between g8 small">
            <span>{d.total} shared resume{d.total === 1 ? '' : 's'} · page {page} of {pages}</span>
            <div className="row g8">
              <button type="button" className="btn btn-outline" style={{ minHeight: 34 }} disabled={page <= 1} onClick={() => goPage(page - 1)}>Previous</button>
              <button type="button" className="btn btn-outline" style={{ minHeight: 34 }} disabled={page >= pages} onClick={() => goPage(page + 1)}>Next</button>
            </div>
          </div>
        </>
      )}</Loading>
      {viewing && <ViewResume ctx={ctx} row={viewing} onClose={() => setViewing(null)} onAction={(k, r) => rowAction(k, r)} />}
      {dialog === 'remind' && <RemindDialog ctx={ctx} groups={groups} groupId={filters.group || null} ids={ids} onClose={() => setDialog(null)} onSent={() => st.reload()} />}
      {dialog === 'note' && <NoteDialog count={selected.size} onClose={() => setDialog(null)} onSave={(note) => { setDialog(null); act('review', { status: 'needs_changes', note }, 'Asked for changes'); }} />}
    </>
  );
}

/** /admin/shared-resumes */
export function LiveShared() {
  return <SharedResumes ctx={ADMIN_CTX} right={<Link className="btn btn-outline" to="/admin/orgs">Organizations</Link>} />;
}
