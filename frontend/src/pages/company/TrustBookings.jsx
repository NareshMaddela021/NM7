// Company dashboard -> Hire now -> "Bookings by one-tap link" (Vetting Trust T11). Only where the Trust switch lets this
// company in (GET /api/company/{id}/trust/booking answers 404 otherwise, and nothing shows). Live (every 30 s while the
// tab is visible): candidates who booked, moved or cancelled an interview time with the link Nm7 sent them, and "can't
// make it" notes; the joining days coming up with each new hire's answers (coming / reschedule / joined) and the
// company's reporting time, place and map link, which go into the joining-day messages. Never phone numbers or
// messages. English only while it is tested; no pop-ups; 390 px.
import { useCallback, useEffect, useState } from 'react';
import { rq } from '../../lib/company';
import { Chip } from '../me/kit';

const when = (v) => (v ? new Date(v).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }) : '');
const day = (iso) => new Date(`${iso}T12:00:00+05:30`).toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', weekday: 'short', day: 'numeric', month: 'short' });
const TONE = { t11_booked: 'ok', t11_moved: 'neutral', t11_cancelled: 'warn', t11_cant: 'warn', t11_invite: 'neutral' };

function Joining({ c, j, can, onSaved }) {
  const [f, setF] = useState(null);
  const [err, setErr] = useState('');
  const save = async (e) => {
    e.preventDefault(); setErr('');
    try { onSaved(await rq(`/api/company/${c.id}/trust/booking/joinings/${j.id}`, { method: 'PUT', body: f })); setF(null); } catch (x) { setErr(x.message); }
  };
  const joined = j.joined.company === true || j.joined.candidate === true;
  return (
    <li className="stack g4" style={{ borderTop: '1px solid var(--border)', paddingTop: 8, minWidth: 0 }} data-testid="tb-joining">
      <span className="small" style={{ overflowWrap: 'anywhere' }}><strong>{j.name || 'New hire'}</strong> · {j.role} · {day(j.joinDate)}{j.time ? `, ${j.time}` : ''}{j.place ? ` · ${j.place}` : ''}
        {joined && <> · <Chip tone="ok">Joined</Chip></>}{j.status === 'dropped' && <> · <Chip tone="warn">Didn’t join</Chip></>}</span>
      {j.answers.length > 0 && <ul className="xs" style={{ margin: 0, paddingLeft: 18 }} data-testid="tb-answers">{j.answers.map((a, i) => <li key={i}>{a.side === 'company' ? 'You: ' : ''}{a.text}{a.reason ? ` — “${a.reason}”` : ''} · {when(a.at)}</li>)}</ul>}
      {can && !f && j.status !== 'dropped' && <span><button type="button" className="link-btn small" style={{ minHeight: 44 }} onClick={() => setF({ time: j.time, place: j.place, map: j.map.includes('google.com/maps/search') ? '' : j.map })} data-testid="tb-edit">Reporting time and place</button></span>}
      {f && (
        <form className="row g8" style={{ flexWrap: 'wrap', alignItems: 'flex-end' }} onSubmit={save} aria-label={`Joining day for ${j.name}`}>
          <label className="field stack g4" style={{ flex: '0 0 120px' }}><span className="label">Time</span><input className="input" type="time" value={f.time} onChange={(e) => setF({ ...f, time: e.target.value })} data-testid="tb-time" /></label>
          <label className="field stack g4" style={{ flex: '1 1 200px', minWidth: 0 }}><span className="label">Place</span><input className="input" value={f.place} maxLength={200} onChange={(e) => setF({ ...f, place: e.target.value })} data-testid="tb-place" /></label>
          <label className="field stack g4" style={{ flex: '1 1 200px', minWidth: 0 }}><span className="label">Map link (optional)</span><input className="input" value={f.map} maxLength={300} placeholder="https://" onChange={(e) => setF({ ...f, map: e.target.value })} /></label>
          <button type="submit" className="btn btn-signal btn-sm" style={{ minHeight: 44 }} data-testid="tb-save">Save</button>
          <button type="button" className="link-btn small" style={{ minHeight: 44 }} onClick={() => setF(null)}>Cancel</button>
        </form>
      )}
      {err && <p className="error" role="alert" style={{ margin: 0 }}>{err}</p>}
    </li>
  );
}

export default function TrustBookings({ c, job, canEdit }) {
  const [d, setD] = useState(null);
  const load = useCallback(() => rq(`/api/company/${c.id}/trust/booking?job=${encodeURIComponent(job || '')}`).then(setD, () => setD(null)), [c.id, job]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    const id = setInterval(() => { if (document.visibilityState === 'visible') load(); }, 30000);
    return () => clearInterval(id);
  }, [load]);
  if (!d) return null;
  const saved = (x) => setD({ ...d, joinings: d.joinings.map((j) => (j.id === x.id ? { ...j, ...x } : j)) });
  return (
    <section className="mcard stack g12" aria-labelledby="tb-h" data-testid="tb">
      <header className="stack g4">
        <strong id="tb-h" className="mcard-title">Bookings by one-tap link</strong>
        <span className="xs muted">Nm7 sends each person you shortlist or invite a link (WhatsApp, if they said yes to it, and email) to pick one of your interview times, with no sign-in. They can move or cancel it until {d.changeHours} hours before. Reminders go the evening before and {d.soonHours} hours before. Updates here every 30 seconds.</span>
      </header>
      {d.events.length === 0 ? <p className="small muted" style={{ margin: 0 }} data-testid="tb-none">No bookings by link yet for this job.</p> : (
        <ul className="stack g8" style={{ listStyle: 'none', padding: 0, margin: 0 }} data-testid="tb-events" role="status">
          {d.events.map((e, i) => (
            <li key={i} className="small" style={{ overflowWrap: 'anywhere' }} data-testid="tb-event">
              <Chip tone={TONE[e.kind]}>{e.text}</Chip> <strong>{e.name || 'Candidate'}</strong>{e.slotAt ? ` · ${when(e.slotAt)}` : ''}{e.reason ? ` · “${e.reason}”` : ''} <span className="xs muted">({when(e.at)})</span>
            </li>
          ))}
        </ul>
      )}
      {d.joinings.length > 0 && (
        <details open data-testid="tb-joinings">
          <summary className="small">Joining days coming up ({d.joinings.length})</summary>
          <ul className="stack g8" style={{ listStyle: 'none', padding: 0, margin: '8px 0 0' }}>
            {d.joinings.map((j) => <Joining key={j.id} c={c} j={j} can={canEdit} onSaved={saved} />)}
          </ul>
          <span className="xs muted">New hires get “See you tomorrow” the evening before, “Good luck” with directions that morning and a one-tap “I’ve joined”. You get a one-tap “Did they join?” email that afternoon.</span>
        </details>
      )}
    </section>
  );
}
