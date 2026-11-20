// Org > Offers (Drive and Campus plans): record offers (student, company, role, CTC in LPA, type, date, status),
// "Selected" on a recruiter's shortlist board pre-fills one, and the placement dashboard: placed vs not placed by
// branch and batch, highest / median / average package, offers per company, students with more than one offer; CSV
// and a printable placement report (PDF). Packages are for the college's coordinators and Owner only.
import { useState } from 'react';
import { Dialog, Spinner, useToast } from '../../components/ui';
import { API_BASE } from '../../services/http';
import { Loading, http, useAction, useApi } from '../admin/live/common';
import { Bar, Empty } from '../me/kit';
import '../../styles/me-kit.css';
import '../../styles/org-drives.css';
import { IcLock } from '../../components/icons';

const TYPES = { full_time: 'Full-time', internship: 'Internship', ppo: 'PPO' };
const STATUSES = { offered: 'Offered', accepted: 'Accepted', declined: 'Declined', joined: 'Joined' };
const enc = encodeURIComponent;
const lpa = (v) => (v == null ? '—' : `${v} LPA`);
const STATUS_TONE = { offered: 'info', accepted: 'ok', declined: 'bad', joined: 'accent' };

function OfferForm({ base, start, people, onDone, onClose }) {
  const toast = useToast();
  const [busy, run] = useAction(toast);
  const [f, setF] = useState({ membershipId: '', company: '', role: '', ctcLpa: '', type: 'full_time', offerDate: '', status: 'offered', ...start });
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const save = (e) => {
    e.preventDefault();
    const body = { ...f, ctcLpa: f.ctcLpa === '' || f.ctcLpa == null ? null : Number(f.ctcLpa), offerDate: f.offerDate || null };
    delete body.id;
    run(async () => { await (f.id ? http(`${base}/${f.id}`, { method: 'PUT', body }) : http(base, { method: 'POST', body })); onDone(); onClose(); }, f.id ? 'Offer saved' : 'Offer added');
  };
  return (
    <Dialog showTitle title={f.id ? 'Edit offer' : 'Add an offer'} onClose={onClose}>
      <form className="stack g12" onSubmit={save} data-testid="offer-form">
        <label className="small">Student <select className="input" required disabled={!!f.id} value={f.membershipId} onChange={set('membershipId')} data-testid="offer-student">
          <option value="">Choose…</option>
          {people.map((p) => <option key={p.id} value={p.id}>{p.roll ? `${p.roll} · ` : ''}{p.name} ({p.branch || p.group})</option>)}
        </select></label>
        <div className="of-fields">
          <label className="small" style={{ flex: '1 1 160px' }}>Company <input className="input" required maxLength={80} value={f.company} onChange={set('company')} data-testid="offer-company" /></label>
          <label className="small" style={{ flex: '1 1 160px' }}>Role <input className="input" maxLength={80} value={f.role} onChange={set('role')} data-testid="offer-role" /></label>
        </div>
        <div className="of-fields">
          <label className="small">CTC (LPA) <input className="input" type="number" step="0.01" min="0" value={f.ctcLpa ?? ''} onChange={set('ctcLpa')} data-testid="offer-ctc" /></label>
          <label className="small">Type <select className="input" value={f.type} onChange={set('type')} data-testid="offer-type">{Object.entries(TYPES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
          <label className="small">Offer date <input className="input" type="date" value={f.offerDate || ''} onChange={set('offerDate')} /></label>
          <label className="small">Status <select className="input" value={f.status} onChange={set('status')} data-testid="offer-status">{Object.entries(STATUSES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
        </div>
        <button type="submit" className="btn btn-signal" disabled={busy} style={{ alignSelf: 'flex-start' }} data-testid="offer-save">{busy && <Spinner />}Save</button>
      </form>
    </Dialog>
  );
}

function Table({ label, head, rows, testid }) {
  if (!rows.length) return null;
  return (
    <div className="mcard mcard-tight of-table"><span className="mkicker">{label}</span>
      <div className="table-wrap mtable-wrap" tabIndex={0} role="region" aria-label="Table — scroll sideways to see all columns"><table className="table mtable" aria-label={label} data-testid={testid}><thead><tr>{head.map((h) => <th key={h}>{h}</th>)}</tr></thead>
        <tbody>{rows.map((r) => <tr key={r[0]}>{r.map((v, i) => <td key={i} className="small" data-label={head[i]}>{v}</td>)}</tr>)}</tbody></table></div>
    </div>
  );
}

export default function Offers({ orgId, groups, canManage }) {
  const toast = useToast();
  const [busy, run] = useAction(toast);
  const [group, setGroup] = useState('');
  const base = `/api/org/${enc(orgId)}/offers`;
  const q = group ? `?group=${enc(group)}` : '';
  const stats = useApi(`${base}/stats${q}`);
  const list = useApi(`${base}${q}`);
  const sug = useApi(canManage ? `${base}/suggestions` : null);
  const [form, setForm] = useState(null);
  const [roster, setRoster] = useState(null);
  const reload = () => { stats.reload(); list.reload(); sug.reload(); };
  const openForm = async (start = {}) => {
    try {
      const r = roster || await http(`/api/org/${enc(orgId)}/offers/students`);
      setRoster(r); setForm(start);
    } catch (e) { toast(e.message); }
  };
  const download = (path, name) => run(async () => {
    const r = await fetch(`${API_BASE}${base}/${path}${q}`, { credentials: 'include' });
    if (!r.ok) throw new Error('Couldn’t download it.');
    const a = document.createElement('a'); a.href = URL.createObjectURL(await r.blob()); a.download = name; a.click();
  });
  const del = (o) => { if (window.confirm(`Delete ${o.company}'s offer to ${o.student?.name}?`)) run(async () => { await http(`${base}/${o.id}`, { method: 'DELETE' }); reload(); }, 'Deleted'); };
  return (
    <div className="stack g16 of-page">
      <div className="mcard mcard-accent of-bar">
        <span className="small of-note"><IcLock size={14} /> Offers and packages are for your placement team only — never shown to recruiters or other students. Each student sees their own offers.</span>
        <div className="of-tools">
          <label className="field"><span className="label">Batch</span><select className="input" value={group} onChange={(e) => setGroup(e.target.value)} data-testid="offers-group"><option value="">All batches</option>{groups.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}</select></label>
          {canManage && <button type="button" className="btn btn-signal" onClick={() => openForm()} data-testid="offer-add">Add an offer</button>}
          <button type="button" className="btn btn-outline" disabled={busy} onClick={() => download('offers.csv', 'offers.csv')} data-testid="offers-csv">CSV</button>
          <button type="button" className="btn btn-outline" disabled={busy} onClick={() => download('report.pdf', 'placement_report.pdf')} data-testid="offers-pdf">Offers report (PDF)</button>
        </div>
      </div>
      {canManage && sug.data?.length > 0 && (
        <div className="mcard mcard-warn of-sug" data-testid="offer-suggestions">
          <strong className="small">Selected on a recruiter’s shortlist board — add their offer</strong>
          {sug.data.map((s) => (
            <span key={`${s.membershipId}-${s.company}`} className="of-sug-row">
              <span className="mavatar of-av" aria-hidden="true">{(s.student.name || '?').trim().charAt(0).toUpperCase()}</span>
              <span className="small" style={{ flex: 1, minWidth: 0 }}>{s.student.roll ? `${s.student.roll} · ` : ''}{s.student.name} · {s.company}{s.note ? ` · “${s.note}”` : ''}</span>
              <button type="button" className="btn btn-outline btn-sm" onClick={() => openForm({ membershipId: s.membershipId, company: s.company })} data-testid="offer-prefill">Add offer</button>
            </span>
          ))}
        </div>
      )}
      <Loading st={stats}>{(s) => (
        <section className="stack g16" aria-label="Placement dashboard" data-testid="offer-stats">
          <div className="of-hero">
            <div className="mcard of-placed">
              <span className="mkicker">Placed</span>
              <span className="of-big"><strong data-testid="stat-placed">{s.placed}</strong><span className="of-of">of {s.placed + s.notPlaced} students</span></span>
              <Bar label="Share of students placed" value={s.placed} max={Math.max(1, s.placed + s.notPlaced)} tone="ok" showValue={false} />
              <span className="xs muted">Not placed: <b data-testid="stat-not-placed">{s.notPlaced}</b> · Offers: <b data-testid="stat-offers">{s.offers}</b></span>
            </div>
            <div className="of-pkgs">
              {[['Highest', lpa(s.packages.highest), 'highest'], ['Median', lpa(s.packages.median), 'median'], ['Average', lpa(s.packages.average), 'average']].map(([l, v, k]) => (
                <div key={l} className="mstat of-pkg"><span className="mstat-l">{l} package</span><strong className="mstat-v" data-testid={`stat-${k}`}>{v}</strong></div>
              ))}
            </div>
          </div>
          <span className="xs muted">Placed: at least one full-time or PPO offer that wasn’t declined. Packages count those offers.</span>
          <div className="of-tables">
            <Table label="By branch" head={['Branch', 'Students', 'Placed', 'Not placed', '%']} rows={s.byBranch.map((r) => [r.name, r.students, r.placed, r.notPlaced, `${r.percent}%`])} testid="by-branch" />
            <Table label="By batch" head={['Batch', 'Students', 'Placed', 'Not placed', '%']} rows={s.byBatch.map((r) => [r.name, r.students, r.placed, r.notPlaced, `${r.percent}%`])} />
            <Table label="Offers per company" head={['Company', 'Offers', 'Full-time', 'Internships', 'PPO']} rows={s.byCompany.map((c) => [c.company, c.offers, c.fullTime, c.internships, c.ppo])} testid="by-company" />
            <Table label="Students with more than one offer" head={['Student', 'Offers', 'Companies']} rows={s.multiple.map((m) => [`${m.student.roll ? `${m.student.roll} · ` : ''}${m.student.name}`, m.offers, m.companies.join(', ')])} testid="multiple" />
          </div>
        </section>
      )}</Loading>
      <Loading st={list}>{(rows) => (rows.length === 0 ? <Empty shape="college" tint="college" compact title="No offers recorded yet.">{canManage ? 'Add an offer when a student gets one, or from a recruiter’s “Selected” list above.' : 'Offers your placement team records show up here.'}</Empty> : (
        <div className="mcard of-list">
          <span className="mkicker">All offers</span>
          <div className="table-wrap mtable-wrap" tabIndex={0} role="region" aria-label="Table — scroll sideways to see all columns"><table className="table mtable" aria-label="Offers"><thead><tr><th>Student</th><th>Company</th><th>Role</th><th>CTC</th><th>Type</th><th>Status</th><th /></tr></thead>
            <tbody>{rows.map((o) => (
              <tr key={o.id} data-testid="offer-row">
                <td className="small" data-label="Student"><strong>{o.student?.roll ? <span className="mono">{o.student.roll} · </span> : null}{o.student?.name}</strong></td>
                <td className="small" data-label="Company">{o.company}</td><td className="small" data-label="Role">{o.role}</td><td className="small" data-label="CTC"><span className="of-ctc">{lpa(o.ctcLpa)}</span></td><td className="small" data-label="Type">{o.typeName}</td><td className="small" data-label="Status"><span className={`mchip mchip-${STATUS_TONE[o.status] || 'neutral'}`}>{o.statusName}</span></td>
                <td data-label="">{canManage && <span className="row g8"><button type="button" className="link-btn xs" onClick={() => openForm({ ...o, offerDate: o.offerDate || '' })}>Edit</button><button type="button" className="link-btn xs" onClick={() => del(o)}>Delete</button></span>}</td>
              </tr>
            ))}</tbody></table></div>
        </div>
      ))}</Loading>
      {form && roster && <OfferForm base={base} start={form} people={roster} onDone={reload} onClose={() => setForm(null)} />}
    </div>
  );
}
