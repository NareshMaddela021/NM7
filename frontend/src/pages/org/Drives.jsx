// Org > Drives (Drive and Campus plans): drive days with companies, time slots, rooms and rounds; students placed
// in slots (auto, or by hand); a check-in QR per room (shown full screen on a laptop or a kiosk tablet); live
// attendance with late and absent lists; CSV. The server checks the plan, the scope and the role; viewers only look.
import { useEffect, useState } from 'react';
import QRCode from 'qrcode';
import { Link, useParams } from 'react-router-dom';
import { Dialog, Spinner, useToast } from '../../components/ui';
import { API_BASE } from '../../services/http';
import { Loading, http, useAction, useApi } from '../admin/live/common';
import Eligibility from './Eligibility';
import WaReminders from './WaReminders';
import { Bar, Chip, Empty } from '../me/kit';
import { Still } from '../newhome/ParticleStage';
import '../../styles/me-kit.css';
import '../../styles/org-drives.css';

export const ROUND_NAMES = { test: 'Test', gd: 'Group discussion', interview: 'Interview' };
const STATUS = { present: ['Present', 'b-success'], late: ['Late', 'b-warning'], absent: ['Absent', 'b-danger'], waiting: ['Not yet', 'b-neutral'] };
const enc = encodeURIComponent;
const today = () => new Date(Date.now() + 5.5 * 3600e3).toISOString().slice(0, 10);
/** The academic year (June to May) a date falls in, by its starting year. */
export const academicYear = (iso = today()) => { const [y, m] = iso.split('-').map(Number); return m >= 6 ? y : y - 1; };
export const yearLabel = (y) => `${y}–${String(y + 1).slice(-2)}`;
async function saveFile(path, name) {
  const r = await fetch(`${API_BASE}${path}`, { credentials: 'include' });
  if (!r.ok) throw new Error('Couldn’t download it. Please try again.');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(await r.blob()); a.download = name; a.click();
}
/** "2026-03-14" -> { d: '14', m: 'Mar', w: 'Sat' } for the little calendar block on drive cards. */
const dateParts = (iso) => { const t = new Date(`${iso}T00:00:00`); if (Number.isNaN(t.getTime())) return { d: iso, m: '', w: '' }; return { d: String(t.getDate()), m: t.toLocaleDateString('en-IN', { month: 'short' }), w: t.toLocaleDateString('en-IN', { weekday: 'short' }) }; };
const NAAC = 'Numbers only, by branch and company, on your college format — helps with NAAC / NIRF and management reports (not an official NAAC or NIRF format). No student names or contact details.';

export function StatusBadge({ s }) {
  const [text, tone] = STATUS[s] || STATUS.waiting;
  return <span className={`badge ${tone}`} data-status={s}>{text}</span>;
}

function NewDrive({ base, groups, onMade }) {
  const toast = useToast();
  const [busy, run] = useAction(toast);
  const [f, setF] = useState({ name: '', date: today(), groupIds: groups.map((g) => g.id), companies: '' });
  const save = (e) => {
    e.preventDefault();
    run(async () => {
      const d = await http(base, { method: 'POST', body: { ...f, companies: f.companies.split(/[\n,]/).map((x) => x.trim()).filter(Boolean) } });
      setF({ ...f, name: '', companies: '' }); onMade(d);
    }, 'Drive day created');
  };
  return (
    <form className="mcard dv-new" onSubmit={save} aria-label="New drive day" data-testid="drive-new">
      <header className="mcard-h">
        <span className="mcard-ic" aria-hidden="true">＋</span>
        <span className="mcard-ht"><strong className="mcard-title">New drive day</strong><span className="mcard-sub">Name the day, pick the date, list the companies and choose which groups can be placed in slots.</span></span>
      </header>
      <div className="dv-fields">
        <label className="field dv-wide"><span className="label">Name</span><input className="input" required minLength={2} maxLength={80} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="Campus drive · March" data-testid="drive-name" /></label>
        <label className="field"><span className="label">Date</span><input className="input" type="date" required value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} data-testid="drive-date" /></label>
        <label className="field dv-full"><span className="label">Companies (one per line or comma-separated)</span><textarea className="input" rows={2} required value={f.companies} onChange={(e) => setF({ ...f, companies: e.target.value })} placeholder="Infosys, TCS" data-testid="drive-companies" /></label>
      </div>
      <fieldset className="dv-groups">
        <legend className="label">Groups (students in these groups can be placed in slots)</legend>
        <div className="dv-group-list">
          {groups.map((g) => (
            <label key={g.id} className={`dv-pick ${f.groupIds.includes(g.id) ? 'on' : ''}`}><input type="checkbox" checked={f.groupIds.includes(g.id)} onChange={(e) => setF({ ...f, groupIds: e.target.checked ? [...f.groupIds, g.id] : f.groupIds.filter((x) => x !== g.id) })} /> {g.name}</label>
          ))}
        </div>
      </fieldset>
      <button type="submit" className="btn btn-signal" disabled={busy || !f.groupIds.length} style={{ alignSelf: 'flex-start' }} data-testid="drive-create">{busy && <Spinner />}Create drive day</button>
    </form>
  );
}

function AddSlot({ base, d, onDone }) {
  const toast = useToast();
  const [busy, run] = useAction(toast);
  const [f, setF] = useState({ companyId: d.companies[0]?.id || '', round: 'test', room: '', start: '09:30', end: '10:30' });
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const save = (e) => { e.preventDefault(); run(async () => { onDone(await http(`${base}/slots`, { method: 'POST', body: f })); setF({ ...f, room: '' }); }, 'Slot added'); };
  return (
    <form className="mcard mcard-tight dv-slot-new" onSubmit={save} aria-label="Add a slot" data-testid="slot-new">
      <span className="mkicker">Add a time slot</span>
      <div className="dv-slot-fields">
        <label className="field"><span className="label">Company</span><select className="input" value={f.companyId} onChange={set('companyId')} data-testid="slot-company">{d.companies.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
        <label className="field"><span className="label">Round</span><select className="input" value={f.round} onChange={set('round')} data-testid="slot-round">{Object.entries(ROUND_NAMES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
        <label className="field"><span className="label">Room</span><input className="input" required maxLength={40} value={f.room} onChange={set('room')} placeholder="Lab 1" data-testid="slot-room" /></label>
        <label className="field"><span className="label">From</span><input className="input" type="time" required value={f.start} onChange={set('start')} data-testid="slot-start" /></label>
        <label className="field"><span className="label">To</span><input className="input" type="time" required value={f.end} onChange={set('end')} data-testid="slot-end" /></label>
        <button type="submit" className="btn btn-outline dv-slot-add" disabled={busy} data-testid="slot-add">Add slot</button>
      </div>
    </form>
  );
}

function Students({ base, s, onClose, onSaved }) {
  const toast = useToast();
  const [busy, run] = useAction(toast);
  const st = useApi(`${base}/slots/${s.id}/students`);
  const [chosen, setChosen] = useState(null);
  const sel = chosen || new Set(st.data?.chosen || []);
  const flip = (id) => { const n = new Set(sel); if (n.has(id)) n.delete(id); else n.add(id); setChosen(n); };
  const save = () => run(async () => { onSaved(await http(`${base}/slots/${s.id}/students`, { method: 'PUT', body: { membershipIds: [...sel] } })); onClose(); }, 'Students saved');
  return (
    <Dialog showTitle title={`Students · ${s.company} · ${s.roundName} · ${s.room}`} onClose={onClose}>
      <Loading st={st}>{(x) => (
        <div className="stack g8">
          <span className="row g8"><Chip tone="info">{sel.size} chosen</Chip><span className="xs muted">only students who joined with consent are listed</span></span>
          <div className="dv-people">
            {x.people.map((p) => <label key={p.id} className={`dv-person ${sel.has(p.id) ? 'on' : ''}`}><input type="checkbox" checked={sel.has(p.id)} onChange={() => flip(p.id)} /> <span className="dv-person-name">{p.roll ? `${p.roll} · ` : ''}{p.name}</span><span className="xs faint">{p.branch}</span></label>)}
          </div>
          <button type="button" className="btn btn-signal" disabled={busy} onClick={save} style={{ alignSelf: 'flex-start' }}>Save</button>
        </div>
      )}</Loading>
    </Dialog>
  );
}

function Attendance({ base, s, canManage, onClose, wa, orgBase }) {
  const toast = useToast();
  const [busy, run] = useAction(toast);
  const [data, setData] = useState(null);
  const [show, setShow] = useState('all');
  const [msg, setMsg] = useState(null);
  const load = () => http(`${base}/slots/${s.id}/attendance`).then(setData, (e) => toast(e.message));
  useEffect(() => { load(); const t = setInterval(load, 15000); return () => clearInterval(t); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const mark = (r, present) => run(async () => setData(await http(`${base}/slots/${s.id}/mark`, { method: 'POST', body: { membershipId: r.id, present } })));
  const rows = (data?.rows || []).filter((r) => show === 'all' || r.status === show);
  return (
    <Dialog showTitle wide title={`Attendance · ${s.company} · ${s.roundName} · ${s.room} · ${s.start}–${s.end}`} onClose={onClose}>
      {!data ? <div className="row g8"><Spinner /> Loading…</div> : (
        <div className="stack g12" data-testid="attendance">
          {data.rows.length > 0 && <Bar label="Checked in" value={data.counts.present + data.counts.late} max={data.rows.length} tone="ok" />}
          <div className="dv-filter" role="group" aria-label="Show">
            {[['all', `All ${data.rows.length}`], ['present', `Present ${data.counts.present}`], ['late', `Late ${data.counts.late}`], ['absent', `Absent ${data.counts.absent}`], ['waiting', `Not yet ${data.counts.waiting}`]].map(([k, l]) => (
              <button key={k} type="button" className={`dv-filter-btn dv-f-${k} ${show === k ? 'on' : ''}`} aria-pressed={show === k} onClick={() => setShow(k)} data-testid={`att-${k}`}>{l}</button>
            ))}
          </div>
          {wa && canManage && ['absent', 'waiting'].includes(show) && rows.length > 0 && <button type="button" className="btn btn-outline btn-sm" style={{ alignSelf: 'flex-start' }} onClick={() => setMsg(rows.map((r) => r.id))} data-testid="att-wa">WhatsApp these {rows.length}</button>}
          {msg && <WaReminders base={orgBase} ids={msg} list={`drive-${show}`} defaultMessage={`Hi {name}, you're in ${s.company} ${s.roundName} today, ${s.room} at ${s.start}. Please come and check in.`} onClose={() => setMsg(null)} />}
          {rows.length === 0 ? <p className="small muted dv-none">No one here.</p> : (
            <ul className="dv-att-list">
              {rows.map((r) => (
                <li key={r.id} className="dv-att-row" data-testid="att-row">
                  <span className="mavatar dv-av" aria-hidden="true">{(r.name || '?').trim().charAt(0).toUpperCase()}</span>
                  <span className="small dv-att-who">{r.roll ? <span className="mono">{r.roll} · </span> : null}{r.name} <span className="xs faint">{r.branch}</span></span>
                  <span className="row g8 dv-att-side" style={{ alignItems: 'center' }}>
                    <StatusBadge s={r.status} />
                    {r.at && <span className="xs muted">{new Date(r.at).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Kolkata' })}{r.by === 'staff' ? ' · by hand' : ''}</span>}
                    {canManage && (r.at
                      ? <button type="button" className="link-btn xs" disabled={busy} onClick={() => mark(r, false)}>Undo</button>
                      : <button type="button" className="btn btn-outline btn-sm" disabled={busy} onClick={() => mark(r, true)} data-testid="att-mark">Mark present</button>)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </Dialog>
  );
}

function DriveDetail({ base, orgId, id, canManage, features, onBack, onGone }) {
  const toast = useToast();
  const [busy, run] = useAction(toast);
  const dbase = `${base}/${id}`;
  const st = useApi(dbase);
  const [students, setStudents] = useState(null);
  const [att, setAtt] = useState(null);
  const [elig, setElig] = useState(null);
  const set = () => st.reload(); // the server answers with the drive; a reload keeps one source of truth
  const csv = () => run(async () => {
    const r = await fetch(`${API_BASE}${dbase}/attendance.csv`, { credentials: 'include' });
    if (!r.ok) throw new Error('Couldn’t download the CSV.');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(await r.blob()); a.download = 'attendance.csv'; a.click();
  });
  const del = () => { if (window.confirm('Delete this drive day and its attendance?')) run(async () => { await http(dbase, { method: 'DELETE' }); onGone(); }, 'Deleted'); };
  return (
    <Loading st={st}>{(d) => (
      <section className="stack g16" aria-label={d.name} data-testid="drive-detail">
        <div className="mcard dv-hero">
          <button type="button" className="link-btn xs" onClick={onBack} style={{ alignSelf: 'flex-start' }}>Back to all drive days</button>
          <div className="dv-hero-top">
            <span className="dv-cal" aria-hidden="true"><b>{dateParts(d.date).d}</b><span>{dateParts(d.date).m}</span></span>
            <span className="stack g4" style={{ minWidth: 0 }}>
              <strong className="dv-title">{d.name}</strong>
              <span className="xs muted">{d.date} · {d.companies.map((c) => c.name).join(', ')} · {d.groups.join(', ')}</span>
            </span>
          </div>
          <div className="dv-facts" aria-hidden="true">
            <span className="dv-fact"><b>{d.companies.length}</b> compan{d.companies.length === 1 ? 'y' : 'ies'}</span>
            <span className="dv-fact"><b>{d.slots.length}</b> slot{d.slots.length === 1 ? '' : 's'}</span>
            <span className="dv-fact"><b>{d.slots.reduce((n, x) => n + (x.students || 0), 0)}</b> placed in slots</span>
            <span className="dv-fact"><b>{d.slots.reduce((n, x) => n + (x.present || 0), 0)}</b> checked in</span>
          </div>
          <span className="dv-actions">
            {canManage && <button type="button" className="btn btn-signal btn-sm" disabled={busy || !d.slots.length} onClick={() => run(async () => set(await http(`${dbase}/auto-assign`, { method: 'POST', body: {} })), 'Students placed in slots')} data-testid="drive-auto">Auto-assign students</button>}
            <button type="button" className="btn btn-outline btn-sm" disabled={busy} onClick={csv} data-testid="drive-csv">Attendance CSV</button>
            <button type="button" className="btn btn-outline btn-sm" disabled={busy} title={NAAC} onClick={() => run(() => saveFile(`${dbase}/report.pdf`, 'drive_report.pdf'), 'Drive report ready')} data-testid="drive-report">Drive report (PDF)</button>
            {canManage && <button type="button" className="link-btn xs dv-del" onClick={del}>Delete</button>}
          </span>
        </div>
        {features?.eligibility && (
          <div className="dv-elig" aria-label="Company eligibility">
            <span className="mkicker">Eligibility</span>
            {d.companies.map((c) => <button key={c.id} type="button" className="dv-elig-btn" onClick={() => setElig(c)} data-testid="drive-elig">{c.name}</button>)}
          </div>
        )}
        {canManage && <AddSlot base={dbase} d={d} onDone={set} />}
        {d.slots.length === 0 ? <Empty shape="college" tint="college" compact title="No slots yet">Add a time slot, room and round for each company.</Empty> : (
          <div className="mcard dv-slots">
            <span className="mkicker">Time slots</span>
            <div className="table-wrap mtable-wrap" tabIndex={0} role="region" aria-label="Table — scroll sideways to see all columns"><table className="table mtable" aria-label="Slots"><thead><tr><th>Time</th><th>Company</th><th>Round</th><th>Room</th><th>Students</th><th>Present</th><th /></tr></thead>
              <tbody>{d.slots.map((s) => (
                <tr key={s.id} data-testid="slot-row">
                  <td className="small mono" data-label="Time"><span className="dv-time">{s.start}–{s.end}</span></td><td className="small" data-label="Company"><strong>{s.company}</strong></td><td className="small" data-label="Round"><span className={`dv-round dv-r-${s.round || 'x'}`}>{s.roundName}</span></td><td className="small" data-label="Room">{s.room}</td>
                  <td className="small" data-label="Students">{s.students}</td><td className="small" data-label="Present"><span data-testid="slot-present">{s.present}</span>{s.students > 0 && <span className="dv-mini" aria-hidden="true"><span style={{ width: `${Math.min(100, Math.round((s.present / s.students) * 100))}%` }} /></span>}</td>
                  <td data-label=""><span className="dv-row-actions">
                    <Link className="btn btn-outline btn-sm" to={`/org/${orgId}/checkin-screen/${d.id}/${s.id}`} target="_blank" data-testid="slot-qr">Check-in QR</Link>
                    <button type="button" className="btn btn-outline btn-sm" onClick={() => setAtt(s)} data-testid="slot-att">Attendance</button>
                    {canManage && <button type="button" className="link-btn xs" onClick={() => setStudents(s)}>Students</button>}
                    {canManage && <button type="button" className="link-btn xs" onClick={() => { if (window.confirm('Delete this slot?')) run(async () => set(await http(`${dbase}/slots/${s.id}`, { method: 'DELETE' }))); }}>Delete</button>}
                  </span></td>
                </tr>
              ))}</tbody></table></div>
          </div>
        )}
        {students && <Students base={dbase} s={students} onClose={() => setStudents(null)} onSaved={set} />}
        {elig && <Eligibility dbase={dbase} company={elig} canManage={canManage} onClose={() => { setElig(null); st.reload(); }} />}
        {att && <Attendance base={dbase} s={att} canManage={canManage} wa={!!features?.waReminders} orgBase={base.replace(/\/drives$/, '')} onClose={() => { setAtt(null); st.reload(); }} />}
      </section>
    )}</Loading>
  );
}

export default function Drives({ orgId, groups, canManage, features }) {
  const base = `/api/org/${enc(orgId)}/drives`;
  const st = useApi(base);
  const [open, setOpen] = useState(null);
  if (open) return <DriveDetail base={base} orgId={orgId} id={open} canManage={canManage} features={features} onBack={() => { setOpen(null); st.reload(); }} onGone={() => { setOpen(null); st.reload(); }} />;
  return (
    <div className="stack g16 dv-page">
      <div className="mcard mcard-accent dv-intro">
        <span className="dv-intro-art" aria-hidden="true"><Still shape="college" className="dv-intro-still" /></span>
        <span className="small dv-intro-text">Plan a drive day: companies, time slots, rooms and rounds. Students see “My drive day” in their Nm7 account and check in by scanning the QR in their room (or typing its code). No location tracking.</span>
      </div>
      <div className="dv-top">
        {canManage && <NewDrive base={base} groups={groups} onMade={(d) => { st.reload(); setOpen(d.id); }} />}
        <YearReport orgId={orgId} />
      </div>
      <Loading st={st}>{(rows) => (rows.length === 0 ? <Empty shape="college" tint="college" title="No drive days yet.">{canManage ? 'Make your first drive day with the form above.' : 'Your placement team hasn’t planned one yet.'}</Empty> : (
        <ul className="dv-list" aria-label="Drive days">
          {rows.map((d) => {
            const dp = dateParts(d.date);
            return (
              <li key={d.id}><button type="button" className="dv-item" onClick={() => setOpen(d.id)} data-testid="drive-item">
                <span className="dv-cal" aria-hidden="true"><b>{dp.d}</b><span>{dp.m}</span></span>
                <span className="dv-item-main"><strong>{d.name}</strong><span className="dv-item-cos">{d.companies.map((c) => <span key={c.id} className="dv-co">{c.name}</span>)}</span></span>
                <span className="small mono dv-item-meta">{d.date} · {d.slots.length} slot{d.slots.length === 1 ? '' : 's'}</span>
              </button></li>
            );
          })}
        </ul>
      ))}</Loading>
    </div>
  );
}

/** The placement report for a whole academic year (PDF): joined, ready, shortlisted, selected, offers, packages. */
function YearReport({ orgId }) {
  const toast = useToast();
  const [busy, run] = useAction(toast);
  const now = academicYear();
  const [y, setY] = useState(now);
  return (
    <div className="mcard dv-year" data-testid="year-report">
      <header className="mcard-h">
        <span className="mcard-ht"><strong className="mcard-title">Placement report for the year</strong><span className="mcard-sub">{NAAC}</span></span>
      </header>
      <div className="dv-year-row">
        <label className="field"><span className="label">Academic year</span><select className="input" value={y} onChange={(e) => setY(Number(e.target.value))} data-testid="year-report-year">{[0, 1, 2, 3].map((i) => <option key={i} value={now - i}>{yearLabel(now - i)}</option>)}</select></label>
        <button type="button" className="btn btn-outline" disabled={busy} onClick={() => run(() => saveFile(`/api/org/${enc(orgId)}/report/year.pdf?year=${y}`, `placement_report_${y}-${String(y + 1).slice(-2)}.pdf`), 'Report ready')} data-testid="year-report-pdf">Download PDF</button>
      </div>
    </div>
  );
}

/** /org/:orgId/checkin-screen/:driveId/:slotId — the room's screen (a laptop, projector or kiosk tablet): a QR and
 * a 6-digit code that change every minute, and a live count. Students scan it with their own Nm7 account. */
export function CheckinScreen() {
  const { orgId, driveId, slotId } = useParams();
  const [x, setX] = useState(null);
  const [err, setErr] = useState('');
  const [qr, setQr] = useState('');
  useEffect(() => {
    let off = false;
    let t;
    const load = async () => {
      try {
        const r = await http(`/api/org/${enc(orgId)}/drives/${enc(driveId)}/slots/${enc(slotId)}/code`);
        if (off) return;
        setX(r); setErr('');
        setQr(await QRCode.toDataURL(r.url, { width: 360, margin: 1 }));
        t = setTimeout(load, Math.min(15, r.refreshIn + 1) * 1000);
      } catch (e) { if (!off) { setErr(e.status === 404 ? 'This slot isn’t available.' : e.message); t = setTimeout(load, 15000); } }
    };
    load();
    return () => { off = true; clearTimeout(t); };
  }, [orgId, driveId, slotId]);
  return (
    <main id="main" className="dv-screen" data-testid="checkin-screen">
      {err && <p role="alert" className="dv-screen-err">{err}</p>}
      {!x ? <div className="row g8"><Spinner /> Loading…</div> : (
        <div className="dv-screen-card">
          <span className="dv-screen-kicker">{x.drive} · {x.date}</span>
          <h1 className="dv-screen-title">{x.slot.company} · {x.slot.roundName}</h1>
          <span className="dv-screen-room">{x.slot.room} · {x.slot.start}–{x.slot.end}</span>
          <div className="dv-screen-body">
            <span className="dv-screen-qr">{qr && <img src={qr} width={320} height={320} alt="Check-in QR code" />}</span>
            <span className="dv-screen-side">
              <span className="dv-screen-help">Scan with your phone camera, or open My drive day in Nm7 and type:</span>
              <strong className="mono dv-screen-code" data-testid="checkin-code">{x.code}</strong>
              <span className="dv-screen-count"><span className="dv-screen-bar" aria-hidden="true"><span style={{ width: `${x.slot.students ? Math.min(100, Math.round((x.slot.present / x.slot.students) * 100)) : 0}%` }} /></span>Changes every minute · {x.slot.present} of {x.slot.students} checked in</span>
            </span>
          </div>
        </div>
      )}
    </main>
  );
}
