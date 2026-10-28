// Org > Drives (Drive and Campus plans): drive days with companies, time slots, rooms and rounds; students placed
// in slots (auto, or by hand); a check-in QR per room (shown full screen on a laptop or a kiosk tablet); live
// attendance with late and absent lists; CSV. The server checks the plan, the scope and the role; viewers only look.
import { useEffect, useState } from 'react';
import QRCode from 'qrcode';
import { Link, useParams } from 'react-router-dom';
import { Dialog, Spinner, useToast } from '../../components/ui';
import { API_BASE } from '../../services/http';
import { Loading, emptyIf, http, useAction, useApi } from '../admin/live/common';

export const ROUND_NAMES = { test: 'Test', gd: 'Group discussion', interview: 'Interview' };
const STATUS = { present: ['Present', 'b-success'], late: ['Late', 'b-warning'], absent: ['Absent', 'b-danger'], waiting: ['Not yet', 'b-neutral'] };
const enc = encodeURIComponent;
const today = () => new Date(Date.now() + 5.5 * 3600e3).toISOString().slice(0, 10);

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
    <form className="card stack g12" onSubmit={save} aria-label="New drive day" data-testid="drive-new">
      <strong>New drive day</strong>
      <div className="row g12" style={{ flexWrap: 'wrap', alignItems: 'flex-end' }}>
        <label className="small" style={{ flex: '1 1 220px' }}>Name <input className="input" required minLength={2} maxLength={80} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="Campus drive · March" data-testid="drive-name" /></label>
        <label className="small">Date <input className="input" type="date" required value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} data-testid="drive-date" /></label>
      </div>
      <label className="small">Companies (one per line or comma-separated) <textarea className="input" rows={2} required value={f.companies} onChange={(e) => setF({ ...f, companies: e.target.value })} placeholder="Infosys, TCS" data-testid="drive-companies" /></label>
      <fieldset className="stack g4" style={{ border: 0, padding: 0, margin: 0 }}>
        <legend className="small">Groups (students in these groups can be placed in slots)</legend>
        {groups.map((g) => (
          <label key={g.id} className="row g8 small"><input type="checkbox" checked={f.groupIds.includes(g.id)} onChange={(e) => setF({ ...f, groupIds: e.target.checked ? [...f.groupIds, g.id] : f.groupIds.filter((x) => x !== g.id) })} /> {g.name}</label>
        ))}
      </fieldset>
      <button type="submit" className="btn btn-ink" disabled={busy || !f.groupIds.length} style={{ alignSelf: 'flex-start' }} data-testid="drive-create">{busy && <Spinner />}Create drive day</button>
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
    <form className="row g8" style={{ flexWrap: 'wrap', alignItems: 'flex-end' }} onSubmit={save} aria-label="Add a slot" data-testid="slot-new">
      <label className="small">Company <select className="input" value={f.companyId} onChange={set('companyId')} data-testid="slot-company">{d.companies.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
      <label className="small">Round <select className="input" value={f.round} onChange={set('round')} data-testid="slot-round">{Object.entries(ROUND_NAMES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
      <label className="small">Room <input className="input" required maxLength={40} value={f.room} onChange={set('room')} placeholder="Lab 1" style={{ width: 120 }} data-testid="slot-room" /></label>
      <label className="small">From <input className="input" type="time" required value={f.start} onChange={set('start')} data-testid="slot-start" /></label>
      <label className="small">To <input className="input" type="time" required value={f.end} onChange={set('end')} data-testid="slot-end" /></label>
      <button type="submit" className="btn btn-outline" disabled={busy} data-testid="slot-add">Add slot</button>
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
          <span className="xs muted">{sel.size} chosen · only students who joined with consent are listed</span>
          <div className="stack g4" style={{ maxHeight: '50vh', overflow: 'auto' }}>
            {x.people.map((p) => <label key={p.id} className="row g8 small"><input type="checkbox" checked={sel.has(p.id)} onChange={() => flip(p.id)} /> {p.roll ? `${p.roll} · ` : ''}{p.name}<span className="xs faint">{p.branch}</span></label>)}
          </div>
          <button type="button" className="btn btn-ink" disabled={busy} onClick={save} style={{ alignSelf: 'flex-start' }}>Save</button>
        </div>
      )}</Loading>
    </Dialog>
  );
}

function Attendance({ base, s, canManage, onClose }) {
  const toast = useToast();
  const [busy, run] = useAction(toast);
  const [data, setData] = useState(null);
  const [show, setShow] = useState('all');
  const load = () => http(`${base}/slots/${s.id}/attendance`).then(setData, (e) => toast(e.message));
  useEffect(() => { load(); const t = setInterval(load, 15000); return () => clearInterval(t); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const mark = (r, present) => run(async () => setData(await http(`${base}/slots/${s.id}/mark`, { method: 'POST', body: { membershipId: r.id, present } })));
  const rows = (data?.rows || []).filter((r) => show === 'all' || r.status === show);
  return (
    <Dialog showTitle wide title={`Attendance · ${s.company} · ${s.roundName} · ${s.room} · ${s.start}–${s.end}`} onClose={onClose}>
      {!data ? <div className="row g8"><Spinner /> Loading…</div> : (
        <div className="stack g12" data-testid="attendance">
          <div className="row g8" style={{ flexWrap: 'wrap' }} role="group" aria-label="Show">
            {[['all', `All ${data.rows.length}`], ['present', `Present ${data.counts.present}`], ['late', `Late ${data.counts.late}`], ['absent', `Absent ${data.counts.absent}`], ['waiting', `Not yet ${data.counts.waiting}`]].map(([k, l]) => (
              <button key={k} type="button" className={`btn ${show === k ? 'btn-ink' : 'btn-outline'}`} style={{ minHeight: 32 }} aria-pressed={show === k} onClick={() => setShow(k)} data-testid={`att-${k}`}>{l}</button>
            ))}
          </div>
          {rows.length === 0 ? <p className="small muted">No one here.</p> : (
            <ul className="stack g4" style={{ listStyle: 'none', margin: 0, padding: 0 }}>
              {rows.map((r) => (
                <li key={r.id} className="row between g8" style={{ flexWrap: 'wrap', borderBottom: '1px solid var(--border)', padding: '6px 0' }} data-testid="att-row">
                  <span className="small" style={{ minWidth: 0 }}>{r.roll ? <span className="mono">{r.roll} · </span> : null}{r.name} <span className="xs faint">{r.branch}</span></span>
                  <span className="row g8" style={{ alignItems: 'center' }}>
                    <StatusBadge s={r.status} />
                    {r.at && <span className="xs muted">{new Date(r.at).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Kolkata' })}{r.by === 'staff' ? ' · by hand' : ''}</span>}
                    {canManage && (r.at
                      ? <button type="button" className="link-btn xs" disabled={busy} onClick={() => mark(r, false)}>Undo</button>
                      : <button type="button" className="btn btn-outline" style={{ minHeight: 30 }} disabled={busy} onClick={() => mark(r, true)} data-testid="att-mark">Mark present</button>)}
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

function DriveDetail({ base, orgId, id, canManage, onBack, onGone }) {
  const toast = useToast();
  const [busy, run] = useAction(toast);
  const dbase = `${base}/${id}`;
  const st = useApi(dbase);
  const [students, setStudents] = useState(null);
  const [att, setAtt] = useState(null);
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
        <div className="row between g8" style={{ flexWrap: 'wrap', alignItems: 'baseline' }}>
          <div className="stack g4"><button type="button" className="link-btn xs" onClick={onBack} style={{ alignSelf: 'flex-start' }}>← All drive days</button><strong style={{ fontSize: 20 }}>{d.name}</strong><span className="xs muted">{d.date} · {d.companies.map((c) => c.name).join(', ')} · {d.groups.join(', ')}</span></div>
          <span className="row g8" style={{ flexWrap: 'wrap' }}>
            {canManage && <button type="button" className="btn btn-outline" style={{ minHeight: 36 }} disabled={busy || !d.slots.length} onClick={() => run(async () => set(await http(`${dbase}/auto-assign`, { method: 'POST', body: {} })), 'Students placed in slots')} data-testid="drive-auto">Auto-assign students</button>}
            <button type="button" className="btn btn-outline" style={{ minHeight: 36 }} disabled={busy} onClick={csv} data-testid="drive-csv">Attendance CSV</button>
            {canManage && <button type="button" className="link-btn xs" onClick={del}>Delete</button>}
          </span>
        </div>
        {canManage && <AddSlot base={dbase} d={d} onDone={set} />}
        {d.slots.length === 0 ? <p className="small muted">No slots yet. Add a time slot, room and round for each company.</p> : (
          <div className="table-wrap"><table className="table" aria-label="Slots"><thead><tr><th>Time</th><th>Company</th><th>Round</th><th>Room</th><th>Students</th><th>Present</th><th /></tr></thead>
            <tbody>{d.slots.map((s) => (
              <tr key={s.id} data-testid="slot-row">
                <td className="small mono">{s.start}–{s.end}</td><td className="small">{s.company}</td><td className="small">{s.roundName}</td><td className="small">{s.room}</td>
                <td className="small">{s.students}</td><td className="small" data-testid="slot-present">{s.present}</td>
                <td><span className="row g8" style={{ flexWrap: 'wrap' }}>
                  <Link className="btn btn-outline" style={{ minHeight: 30 }} to={`/org/${orgId}/checkin-screen/${d.id}/${s.id}`} target="_blank" data-testid="slot-qr">Check-in QR</Link>
                  <button type="button" className="btn btn-outline" style={{ minHeight: 30 }} onClick={() => setAtt(s)} data-testid="slot-att">Attendance</button>
                  {canManage && <button type="button" className="link-btn xs" onClick={() => setStudents(s)}>Students</button>}
                  {canManage && <button type="button" className="link-btn xs" onClick={() => { if (window.confirm('Delete this slot?')) run(async () => set(await http(`${dbase}/slots/${s.id}`, { method: 'DELETE' }))); }}>Delete</button>}
                </span></td>
              </tr>
            ))}</tbody></table></div>
        )}
        {students && <Students base={dbase} s={students} onClose={() => setStudents(null)} onSaved={set} />}
        {att && <Attendance base={dbase} s={att} canManage={canManage} onClose={() => { setAtt(null); st.reload(); }} />}
      </section>
    )}</Loading>
  );
}

export default function Drives({ orgId, groups, canManage }) {
  const base = `/api/org/${enc(orgId)}/drives`;
  const st = useApi(base);
  const [open, setOpen] = useState(null);
  if (open) return <DriveDetail base={base} orgId={orgId} id={open} canManage={canManage} onBack={() => { setOpen(null); st.reload(); }} onGone={() => { setOpen(null); st.reload(); }} />;
  return (
    <div className="stack g16">
      <span className="small muted">Plan a drive day: companies, time slots, rooms and rounds. Students see “My drive day” in their Nm7 account and check in by scanning the QR in their room (or typing its code). No location tracking.</span>
      {canManage && <NewDrive base={base} groups={groups} onMade={(d) => { st.reload(); setOpen(d.id); }} />}
      <Loading st={st} empty={emptyIf((x) => !x.length, 'No drive days yet.')}>{(rows) => (
        <ul className="stack g8" style={{ listStyle: 'none', margin: 0, padding: 0 }} aria-label="Drive days">
          {rows.map((d) => (
            <li key={d.id}><button type="button" className="card row between g8" style={{ width: '100%', textAlign: 'left', flexWrap: 'wrap' }} onClick={() => setOpen(d.id)} data-testid="drive-item">
              <span className="stack g4"><strong>{d.name}</strong><span className="xs muted">{d.companies.map((c) => c.name).join(', ')}</span></span>
              <span className="small mono">{d.date} · {d.slots.length} slot{d.slots.length === 1 ? '' : 's'}</span>
            </button></li>
          ))}
        </ul>
      )}</Loading>
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
    <main id="main" className="stack g16" style={{ minHeight: '100vh', padding: 24, alignItems: 'center', justifyContent: 'center', textAlign: 'center', background: '#fff', color: '#111', colorScheme: 'light' }} data-testid="checkin-screen">
      {err && <p role="alert">{err}</p>}
      {!x ? <div className="row g8"><Spinner /> Loading…</div> : (
        <>
          <span className="small" style={{ color: '#555' }}>{x.drive} · {x.date}</span>
          <h1 className="display" style={{ fontSize: 32, margin: 0 }}>{x.slot.company} · {x.slot.roundName}</h1>
          <span style={{ fontSize: 20 }}>{x.slot.room} · {x.slot.start}–{x.slot.end}</span>
          {qr && <img src={qr} width={320} height={320} alt="Check-in QR code" style={{ maxWidth: '80vw', height: 'auto' }} />}
          <span className="small" style={{ color: '#555' }}>Scan with your phone camera, or open My drive day in Nm7 and type:</span>
          <strong className="mono" style={{ fontSize: 48, letterSpacing: 8 }} data-testid="checkin-code">{x.code}</strong>
          <span className="small" style={{ color: '#555' }}>Changes every minute · {x.slot.present} of {x.slot.students} checked in</span>
        </>
      )}
    </main>
  );
}
