// A student's interviews (R3): rounds a recruiter scheduled, with Confirm, "Ask for another time" (with a reason),
// the calendar file again, and the day-before reminder switch. On My drive day and My groups.
import { useCallback, useEffect, useState } from 'react';
import { useToast } from './ui';
import { API_BASE, http } from '../services/http';

const TONE = { confirmed: 'badge-success', reschedule: 'badge-warning', pending: '' };

async function saveIcs(id) {
  const res = await fetch(`${API_BASE}/api/me/interviews/${id}/ics`, { credentials: 'include', cache: 'no-store' });
  if (!res.ok) throw new Error('Couldn’t get the calendar file. Please try again.');
  const url = URL.createObjectURL(await res.blob());
  const a = document.createElement('a');
  a.href = url; a.download = 'interview.ics';
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

export default function MyInterviews() {
  const toast = useToast();
  const [st, setSt] = useState(null);
  const load = useCallback(() => http('/api/me/interviews').then(setSt, () => setSt({ interviews: [], reminders: true })), []);
  useEffect(() => { load(); }, [load]);
  if (!st || st.interviews.length === 0) return null;
  const setReminders = async (on) => {
    try { setSt({ ...st, ...(await http('/api/me/interviews/reminders', { method: 'PUT', body: { on } })) }); toast(on ? 'Reminders on' : 'Reminders off'); } catch (e) { toast(e.message); }
  };
  const put = (iv) => setSt((s) => ({ ...s, interviews: s.interviews.map((x) => (x.id === iv.id ? iv : x)) }));
  return (
    <section className="card stack g12" aria-label="My interviews" data-testid="my-interviews">
      <div className="row between g8" style={{ flexWrap: 'wrap' }}>
        <strong>My interviews</strong>
        <label className="row g8 xs"><input type="checkbox" checked={st.reminders} onChange={(e) => setReminders(e.target.checked)} /> Email me a reminder the day before</label>
      </div>
      {st.interviews.map((iv) => <Interview key={iv.id} iv={iv} onChange={put} />)}
    </section>
  );
}

function Interview({ iv, onChange }) {
  const toast = useToast();
  const [asking, setAsking] = useState(false);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const past = iv.startsAt < Date.now();
  const act = async (path, body) => {
    setBusy(true);
    try { onChange(await http(`/api/me/interviews/${iv.id}/${path}`, { method: 'POST', body: body || {} })); setAsking(false); toast(path === 'confirm' ? 'Confirmed' : 'Asked for another time'); } catch (e) { toast(e.message); } finally { setBusy(false); }
  };
  return (
    <article className="well stack g8" data-testid="my-interview" aria-label={`${iv.company} ${iv.round}`}>
      <div className="row between g8" style={{ flexWrap: 'wrap', alignItems: 'flex-start' }}>
        <div className="stack g2" style={{ minWidth: 0 }}>
          <strong className="small" style={{ overflowWrap: 'anywhere' }}>{iv.company} · {iv.round}</strong>
          <span className="xs muted">{iv.when} · {iv.minutes} min{iv.orgName ? ` · via ${iv.orgName}` : ''}</span>
        </div>
        <span className={`badge ${iv.cancelled ? 'badge-warning' : TONE[iv.status]}`}>{iv.cancelled ? 'Cancelled' : iv.statusName}</span>
      </div>
      <dl className="stack g4 xs" style={{ margin: 0 }}>
        {iv.place && <div><dt className="muted" style={{ display: 'inline' }}>Where: </dt><dd style={{ display: 'inline', margin: 0 }}>{iv.place}</dd></div>}
        {iv.link && <div><dt className="muted" style={{ display: 'inline' }}>Online: </dt><dd style={{ display: 'inline', margin: 0, overflowWrap: 'anywhere' }}><a href={iv.link} target="_blank" rel="noopener noreferrer">{iv.link}</a></dd></div>}
        <div><dt className="muted" style={{ display: 'inline' }}>Interviewer: </dt><dd style={{ display: 'inline', margin: 0 }}>{iv.interviewer}</dd></div>
        {iv.notes && <div><dt className="muted" style={{ display: 'inline' }}>Notes: </dt><dd style={{ display: 'inline', margin: 0 }}>{iv.notes}</dd></div>}
        {iv.status === 'reschedule' && iv.reason && <div><dt className="muted" style={{ display: 'inline' }}>You asked: </dt><dd style={{ display: 'inline', margin: 0 }}>{iv.reason}</dd></div>}
      </dl>
      {!iv.cancelled && !past && (
        <div className="row g8" style={{ flexWrap: 'wrap' }}>
          {iv.status !== 'confirmed' && <button type="button" className="btn btn-ink" disabled={busy} onClick={() => act('confirm')}>Confirm</button>}
          {!asking && <button type="button" className="btn btn-outline" disabled={busy} onClick={() => setAsking(true)}>Ask for another time</button>}
          <button type="button" className="link-btn small" onClick={() => saveIcs(iv.id).catch((e) => toast(e.message))}>Add to calendar (.ics)</button>
        </div>
      )}
      {asking && (
        <form className="stack g8" onSubmit={(e) => { e.preventDefault(); act('reschedule', { reason }); }}>
          <div className="field"><label className="label" htmlFor={`why-${iv.id}`}>Why do you need another time?</label>
            <textarea id={`why-${iv.id}`} className="input" rows={2} maxLength={300} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. I have an exam that morning" /></div>
          <div className="row g8">
            <button type="submit" className="btn btn-ink" disabled={busy || reason.trim().length < 5}>Send to the recruiter</button>
            <button type="button" className="btn btn-outline" onClick={() => setAsking(false)}>Back</button>
          </div>
        </form>
      )}
    </article>
  );
}
