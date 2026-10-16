// Nm7 for Organizations (Phase 1), super-admin only: organizations → groups (join code, link, QR code) and every
// shared resume across them (filters, view, print, combined PDF / ZIP / CSV). The server checks the role and
// two-step login on every request and writes the audit log.
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import QRCode from 'qrcode';
import { Dialog, useToast } from '../../../components/ui';
import { savePdf } from '../../builder/resumePdf';
import ResumePreview from '../../builder/ResumePreview';
import { designOf, runExport } from '../../../lib/orgExport';
import { TEMPLATE_PRESETS } from '../../builder/design';
import { API_BASE } from '../../../services/http';
import { PageHead } from '../AdminUI';
import { Loading, day, emptyIf, http, useAction, useApi, when } from './common';
import { auditText } from './auditText';

export const ORG_TYPES = [
  ['college', 'College'], ['institute', 'Coaching / training institute'], ['job_fair', 'Job fair'], ['skill_centre', 'Skill centre'],
  ['ngo', 'NGO'], ['agency', 'Placement agency'], ['company', 'Company hiring drive'], ['other', 'Other'],
];
export const joinLink = (code) => `${window.location.origin}/join/${code}`;
const inputStyle = { height: 40 };

/** The QR code for a join link as a PNG file (made in the browser — no outside QR service). */
export async function qrPng(code) {
  const url = await QRCode.toDataURL(joinLink(code), { width: 768, margin: 2, errorCorrectionLevel: 'M' });
  return (await fetch(url)).blob();
}

function QrImage({ code }) {
  const [src, setSrc] = useState('');
  useEffect(() => { let off = false; QRCode.toDataURL(joinLink(code), { width: 240, margin: 1 }).then((u) => !off && setSrc(u)); return () => { off = true; }; }, [code]);
  return src ? <img src={src} width={120} height={120} alt={`QR code for ${joinLink(code)}`} style={{ borderRadius: 8, border: '1px solid var(--border)' }} /> : null;
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
const emptyGroup = { name: '', code: '', startsOn: '', endsOn: '', memberLimit: '', customFields: [], settings: { membersDownloadFree: false, active: true } };
function GroupForm({ initial = emptyGroup, onSave, onCancel, busy, label }) {
  const [g, setG] = useState(() => ({ ...emptyGroup, ...initial, startsOn: initial.startsOn || '', endsOn: initial.endsOn || '', memberLimit: initial.memberLimit ?? '', customFields: (initial.customFields || []).map((f) => ({ ...f, fixedKey: true })) }));
  const body = () => ({
    name: g.name.trim(), ...(g.code.trim() ? { code: g.code.trim() } : {}), startsOn: g.startsOn || null, endsOn: g.endsOn || null,
    memberLimit: g.memberLimit ? Number(g.memberLimit) : null, customFields: fieldsBody(g.customFields), settings: g.settings,
  });
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
        <label className="row g8 small"><input type="checkbox" checked={g.settings.active} onChange={(e) => setG({ ...g, settings: { ...g.settings, active: e.target.checked } })} /> Open for joining</label>
        <label className="row g8 small"><input type="checkbox" checked={g.settings.membersDownloadFree} onChange={(e) => setG({ ...g, settings: { ...g.settings, membersDownloadFree: e.target.checked } })} /> Members download free (no ₹99 unlock)</label>
      </div>
      <div className="row g8">
        <button type="submit" className="btn btn-ink" disabled={busy || g.name.trim().length < 2}>Save group</button>
        {onCancel && <button type="button" className="btn btn-outline" onClick={onCancel}>Cancel</button>}
      </div>
    </form>
  );
}

function GroupCard({ g, busy, run, reload, toast }) {
  const [editing, setEditing] = useState(false);
  const link = joinLink(g.code);
  const state = !g.settings.active ? 'Closed' : g.endsOn && g.endsOn < new Date().toISOString().slice(0, 10) ? 'Ended' : 'Open';
  return (
    <section className="card stack g12" aria-label={`Group ${g.name}`}>
      <div className="row between g12" style={{ alignItems: 'flex-start' }}>
        <div className="stack g4">
          <strong>{g.name}</strong>
          <span className="small muted">Code <strong className="mono" data-testid="join-code">{g.code}</strong> · {g.members}{g.memberLimit ? ` / ${g.memberLimit}` : ''} members · <span className={`badge ${state === 'Open' ? 'b-success' : 'b-neutral'}`}>{state}</span>{g.settings.membersDownloadFree ? ' · free downloads' : ''}</span>
          {(g.startsOn || g.endsOn) && <span className="xs faint">{g.startsOn ? `From ${day(Date.parse(g.startsOn))}` : ''}{g.endsOn ? ` until ${day(Date.parse(g.endsOn))}` : ''}</span>}
          <span className="small">Join link: <a href={link} className="mono" data-testid="join-link">{link}</a></span>
          <div className="row g8">
            <button type="button" className="btn btn-outline" style={{ minHeight: 34 }} onClick={async () => { try { await navigator.clipboard.writeText(link); toast('Join link copied'); } catch { toast(link); } }}>Copy link</button>
            <button type="button" className="btn btn-outline" style={{ minHeight: 34 }} onClick={async () => savePdf(await qrPng(g.code), `Nm7_join_${g.code}_QR.png`)}>Download QR code (PNG)</button>
            <Link className="btn btn-outline" style={{ minHeight: 34 }} to={`/admin/shared-resumes?org=${g.orgId}&group=${g.id}`}>Shared resumes</Link>
            <button type="button" className="link-btn small" onClick={() => setEditing(!editing)}>{editing ? 'Close' : 'Edit'}</button>
          </div>
        </div>
        <QrImage code={g.code} />
      </div>
      {editing && <GroupForm label={`Edit ${g.name}`} initial={g} busy={busy} onCancel={() => setEditing(false)} onSave={(body) => run(async () => { await http(`/api/admin/groups/${g.id}`, { method: 'PATCH', body }); setEditing(false); reload(); }, 'Group saved')} />}
    </section>
  );
}

function OrgDetail({ id, onBack }) {
  const toast = useToast();
  const st = useApi(`/api/admin/orgs/${id}`);
  const [busy, run] = useAction(toast);
  const [adding, setAdding] = useState(false);
  const [edit, setEdit] = useState(null);
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
        {o.groupList.map((g) => <GroupCard key={g.id} g={g} busy={busy} run={run} reload={st.reload} toast={toast} />)}
        {o.groupList.length === 0 && !adding && <div className="well small muted" style={{ textAlign: 'center', padding: 24 }}>No groups yet. A group is one batch, event or drive with its own join code.</div>}
        {adding ? (
          <section className="card stack g12"><strong>New group</strong>
            <GroupForm label="New group" busy={busy} onCancel={() => setAdding(false)} onSave={(body) => run(async () => { await http(`/api/admin/orgs/${id}/groups`, { method: 'POST', body }); setAdding(false); st.reload(); }, 'Group created')} />
          </section>
        ) : <button type="button" className="btn btn-ink" style={{ alignSelf: 'flex-start' }} onClick={() => setAdding(true)}>New group</button>}
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

function OrgAudit() {
  const log = useApi('/api/admin/org-audit?limit=100');
  return (
    <section className="card stack g12" aria-label="Audit log">
      <div className="row between g8"><strong>Audit log</strong><button type="button" className="link-btn small" onClick={log.reload}>Refresh</button></div>
      <span className="xs faint">Every view, download, print and export of a shared resume, and every organization / group change.</span>
      <Loading st={log} empty={emptyIf((d) => !d.length, 'Nothing logged yet.')}>{(rows) => (
        <div className="table-wrap"><table className="table"><thead><tr><th>When</th><th>Who</th><th>Action</th><th>Count</th><th>Details</th></tr></thead>
          <tbody>{rows.map((a) => <tr key={a.id}><td className="small">{when(a.at)}</td><td className="small">{a.actorName || '—'}</td><td className="small mono">{a.action}</td><td className="small">{a.count ?? '—'}</td><td className="xs" style={{ maxWidth: 320, overflowWrap: 'anywhere' }}>{auditText(a.details)}</td></tr>)}</tbody></table></div>
      )}</Loading>
    </section>
  );
}

/** /admin/orgs */
export function LiveOrgs() {
  const toast = useToast();
  const [params, setParams] = useSearchParams();
  const open = params.get('org');
  const st = useApi(open ? null : '/api/admin/orgs');
  const [busy, run] = useAction(toast);
  const [f, setF] = useState({ name: '', type: 'college', city: '', logoUrl: '' });
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
      <OrgAudit />
    </>
  );
}

/* ---------- shared resumes ---------- */
const FILTER_KEYS = ['org', 'group', 'q', 'joinedFrom', 'joinedTo', 'updatedFrom', 'updatedTo', 'fieldKey', 'fieldValue', 'incomplete', 'notPrinted'];
const PER_PAGE = 25;
const COLS = [['name', 'Name'], ['org', 'Organization / group'], ['roll', 'Fields'], [null, 'Resume'], ['completeness', 'Complete'], ['updated', 'Last updated'], ['printed', 'Printed']];

function filtersFrom(params) {
  const f = {};
  FILTER_KEYS.forEach((k) => { const v = params.get(k); if (v) f[k] = k === 'incomplete' || k === 'notPrinted' ? v === 'true' : v; });
  return f;
}

function ViewResume({ row, onClose, onAction }) {
  const st = useApi(`/api/admin/shared-resumes/${row.membershipId}`);
  return (
    <Dialog showTitle wide title={`${row.name} · ${row.groupName}`} onClose={onClose}>
      <Loading st={st}>{(r) => (
        <div className="stack g12">
          <div className="row g8"><button type="button" className="btn btn-ink" onClick={() => onAction('download', row)}>Download PDF</button><button type="button" className="btn btn-outline" onClick={() => onAction('print', row)}>Print</button><span className="xs faint">Read-only · exactly as the member’s template prints it (hidden entries stay hidden)</span></div>
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

/** /admin/shared-resumes */
export function LiveShared() {
  const toast = useToast();
  const [params, setParams] = useSearchParams();
  const filters = useMemo(() => filtersFrom(params), [params]);
  const sort = params.get('sort') || 'joined';
  const dir = params.get('dir') || 'desc';
  const page = Number(params.get('page') || 1);
  const [q, setQ] = useState(filters.q || '');
  useEffect(() => { const t = setTimeout(() => { if ((q.trim() || undefined) !== filters.q) setFilter({ q: q.trim() }); }, 300); return () => clearTimeout(t); }, [q]); // eslint-disable-line react-hooks/exhaustive-deps
  const qs = new URLSearchParams({ ...Object.fromEntries(Object.entries(filters).map(([k, v]) => [k, String(v)])), sort, dir, page: String(page), perPage: String(PER_PAGE) });
  const st = useApi(`/api/admin/shared-resumes?${qs}`);
  const orgs = useApi('/api/admin/orgs');
  const org = useApi(filters.org ? `/api/admin/orgs/${filters.org}` : null);
  const [selected, setSelected] = useState(() => new Set());
  const [viewing, setViewing] = useState(null);
  const [job, setJob] = useState(null); // { label, done, total, stage }
  const [cover, setCover] = useState(true);
  const [printSort, setPrintSort] = useState('roll');
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

  const body = (Object.fromEntries(Object.entries(filters)));
  async function exportJob(kind, ids, label) {
    const ac = new AbortController(); stop.current = ac;
    setJob({ label, done: 0, total: ids ? ids.length : st.data?.total || 0, stage: 'Starting' });
    try {
      const r = await runExport({ kind, ids, filters: body, sort: kind === 'print_bulk' || kind === 'export_zip' ? printSort : 'name', direction: 'asc', cover, signal: ac.signal, onProgress: (p) => setJob({ label, ...p }) });
      if (kind === 'print') openForPrint(r.blob, r.fileName); else await savePdf(r.blob, r.fileName);
      toast(kind === 'print_bulk' ? `Combined PDF ready · ${r.total} resumes${r.pages ? ` · ${r.pages} pages` : ''}${r.skipped ? ` · ${r.skipped} skipped` : ''}` : kind === 'export_zip' ? `ZIP ready · ${r.total} PDFs` : 'PDF ready');
      st.reload();
    } catch (e) {
      toast(e.name === 'AbortError' ? 'Stopped' : e.message || 'That didn’t work. Please try again.');
    } finally { setJob(null); stop.current = null; }
  }
  const rowAction = (kind, row) => exportJob(kind, [row.membershipId], kind === 'print' ? `Print · ${row.name}` : `PDF · ${row.name}`);
  const csv = () => run(async () => {
    const res = await fetch(`${API_BASE}/api/admin/shared-resumes/export.csv?sort=${printSort}&dir=asc`, { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    if (!res.ok) throw new Error((await res.json().catch(() => null))?.error?.message || 'The CSV couldn’t be made.');
    await savePdf(await res.blob(), `Nm7_shared_resumes_${new Date().toISOString().slice(0, 10)}.csv`);
  }, 'CSV downloaded');

  const data = st.data;
  const ids = selected.size ? [...selected] : null;
  const scope = selected.size ? `${selected.size} selected` : `all ${data?.total ?? 0} matching`;
  const pageIds = data?.rows.map((r) => r.membershipId) || [];
  const allOnPage = pageIds.length > 0 && pageIds.every((i) => selected.has(i));
  const toggle = (i) => setSelected((s) => { const n = new Set(s); if (n.has(i)) n.delete(i); else n.add(i); return n; });
  const fieldDefs = data?.fields || [];
  const pages = data ? Math.max(1, Math.ceil(data.total / PER_PAGE)) : 1;

  return (
    <>
      <PageHead title="Shared resumes" sub="Resumes members shared with their organization (with consent). Downloads and prints here are free and logged." right={<Link className="btn btn-outline" to="/admin/orgs">Organizations</Link>} />
      <section className="card stack g12" aria-label="Filters">
        <div className="row g12">
          <div className="field" style={{ flex: '1 1 200px' }}><label className="label" htmlFor="sf-org">Organization</label>
            <select id="sf-org" className="input" style={inputStyle} value={filters.org || ''} onChange={(e) => setFilter({ org: e.target.value, group: '' })}><option value="">All</option>{orgs.data?.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}</select></div>
          <div className="field" style={{ flex: '1 1 200px' }}><label className="label" htmlFor="sf-group">Group</label>
            <select id="sf-group" className="input" style={inputStyle} value={filters.group || ''} disabled={!filters.org} onChange={(e) => setFilter({ group: e.target.value })}><option value="">All</option>{org.data?.groupList.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}</select></div>
          <div className="field" style={{ flex: '2 1 220px' }}><label className="label" htmlFor="sf-q">Search</label><input id="sf-q" className="input" style={inputStyle} placeholder="Name, email or roll number" value={q} onChange={(e) => setQ(e.target.value)} /></div>
        </div>
        <div className="row g12" style={{ alignItems: 'flex-end' }}>
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
          <button type="button" className="btn btn-ink" disabled={!!job || !data?.total} onClick={() => exportJob('print_bulk', ids, 'Combined PDF')}>Combined PDF</button>
          <button type="button" className="btn btn-outline" disabled={!!job || !data?.total} onClick={() => exportJob('export_zip', ids, 'ZIP of PDFs')}>ZIP (one PDF each)</button>
          <button type="button" className="btn btn-outline" disabled={busy || !data?.total} onClick={csv}>CSV</button>
        </div>
        {job && (
          <div className="stack g4" role="status" aria-live="polite">
            <div className="row between g8 small"><span>{job.label} · {job.stage} · {job.done} of {job.total}</span><button type="button" className="link-btn small" onClick={() => stop.current?.abort()}>Stop</button></div>
            <progress max={job.total || 1} value={job.done} style={{ width: '100%' }} aria-label="Export progress" />
            <span className="xs faint">Keep this tab open. The PDFs are drawn in this browser, so nothing times out.</span>
          </div>
        )}
        <span className="xs faint">Combined PDF and ZIP mark those resumes as printed. Exports never include ID numbers.</span>
      </section>

      <Loading st={st} empty={emptyIf((d) => d.total === 0, Object.keys(filters).length ? 'No shared resumes match these filters.' : 'No shared resumes yet. Create a group in Organizations and share its join link or QR code.')}>{(d) => (
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
                  <td className="small">{day(r.updatedAt)}</td>
                  <td className="small">{r.printedAt ? <>{day(r.printedAt)}{r.printedCount > 1 ? <div className="xs faint">{r.printedCount}×</div> : null}</> : <span className="muted">Not yet</span>}</td>
                  <td><div className="row g8" style={{ flexWrap: 'nowrap' }}>
                    <button type="button" className="link-btn small" onClick={() => setViewing(r)}>View</button>
                    <button type="button" className="link-btn small" disabled={!!job} onClick={() => rowAction('download', r)}>PDF</button>
                    <button type="button" className="link-btn small" disabled={!!job} onClick={() => rowAction('print', r)}>Print</button>
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
      {viewing && <ViewResume row={viewing} onClose={() => setViewing(null)} onAction={(k, r) => rowAction(k, r)} />}
    </>
  );
}
