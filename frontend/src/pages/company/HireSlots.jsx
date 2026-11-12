// Interview times for one job (Phase 5, H5), under the Hire now tab. The company adds times (India time, with a place
// or an online link, the interviewer and the round). Candidates who accepted an invite pick one with one tap; both
// sides get a calendar file and reminders 1 day and 1 hour before. A booked time can be cancelled with a reason (the
// candidate is told). After it starts, mark Attended or No-show (feeds reliability; the candidate never sees who
// marked it). No pop-up dialogs. English, Telugu and Hindi (co.slots.*).
import { useCallback, useEffect, useState } from 'react';
import { readAccount } from '../../lib/recruiterPortal';
import { API_BASE } from '../../services/http';
import { rq } from '../../lib/company';

const when = (ms) => new Date(ms).toLocaleString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Kolkata' });
const ROW = { date: '', time: '10:00', minutes: '30', place: '', link: '', interviewer: '', round: '' };

export default function HireSlots({ t, c, job, canEdit }) {
  const [list, setList] = useState(null);
  const [rows, setRows] = useState([{ ...ROW }]);
  const [adding, setAdding] = useState(false);
  const [why, setWhy] = useState({});
  const [err, setErr] = useState('');
  const [msg, setMsg] = useState('');
  const load = useCallback(() => rq(`/api/company/${c.id}/hire/slots?job=${encodeURIComponent(job)}`).then(setList, (x) => setErr(x.message)), [c.id, job]);
  useEffect(() => { load(); }, [load]);
  const act = async (fn, said) => { setErr(''); setMsg(''); try { await fn(); if (said) setMsg(said); await load(); } catch (x) { setErr(x.message); } };
  const save = (e) => {
    e.preventDefault();
    act(async () => {
      await rq(`/api/company/${c.id}/hire/slots`, { method: 'POST', body: { job, slots: rows.map((r) => ({ ...r, minutes: Number(r.minutes) })) } });
      setRows([{ ...ROW }]); setAdding(false);
    }, t('co.slots.added'));
  };
  const set = (i, k) => (e) => setRows(rows.map((r, j) => (j === i ? { ...r, [k]: e.target.value } : r)));
  const ics = async (id) => {
    const r = await fetch(`${API_BASE}/api/company/${c.id}/hire/slots/${id}/ics`, { headers: { 'X-Recruiter-Account': readAccount() } });
    const url = URL.createObjectURL(await r.blob());
    const a = Object.assign(document.createElement('a'), { href: url, download: 'interview.ics' });
    a.click(); URL.revokeObjectURL(url);
  };
  const live = (list || []).filter((s) => s.status !== 'cancelled');
  return (
    <section className="card stack g8" aria-labelledby="co-slots-h" data-testid="co-slots">
      <strong id="co-slots-h">{t('co.slots.title')}</strong>
      <span className="small muted">{t('co.slots.intro')}</span>
      {err && <p className="error" role="alert" style={{ margin: 0 }}>{err}</p>}
      {msg && <p className="small" role="status" style={{ margin: 0 }} data-testid="co-slots-msg">{msg}</p>}
      {live.length > 0 && (
        <ul className="stack g8" style={{ listStyle: 'none', padding: 0, margin: 0 }}>
          {live.map((s) => (
            <li key={s.id} className="card-sm stack g4" data-testid="co-slot">
              <div className="row between g8" style={{ flexWrap: 'wrap' }}>
                <strong className="small">{when(s.at)} · {s.minutes} min{s.round ? ` · ${s.round}` : ''}</strong>
                <span className={`badge ${s.booked ? 'b-success' : 'b-neutral'}`} data-testid="co-slot-state">{s.booked ? t('co.slots.bookedBy', { name: s.who?.name || '' }) : t('co.slots.open')}</span>
              </div>
              <span className="xs muted">{[s.place, s.link, s.interviewer].filter(Boolean).join(' · ')}</span>
              {canEdit && (
                <div className="row g8" style={{ flexWrap: 'wrap' }}>
                  <button type="button" className="btn btn-ghost btn-sm" onClick={() => ics(s.id)}>{t('co.slots.ics')}</button>
                  {s.booked && s.at <= Date.now() && ['attended', 'no_show'].map((k) => (
                    <button key={k} type="button" className={`btn btn-sm ${s.mark === k ? 'btn-ink' : 'btn-outline'}`} onClick={() => act(() => rq(`/api/company/${c.id}/hire/slots/${s.id}/mark`, { method: 'POST', body: { result: s.mark === k ? 'clear' : k } }))} data-testid={`co-slot-${k}`}>{t(`co.slots.${k}`)}</button>
                  ))}
                  {why[s.id] !== undefined ? (
                    <span className="row g8" style={{ flexWrap: 'wrap' }}>
                      <input className="input" style={{ height: 34, minWidth: 180 }} maxLength={300} placeholder={t('co.slots.reason')} aria-label={t('co.slots.reason')} value={why[s.id]} onChange={(e) => setWhy({ ...why, [s.id]: e.target.value })} data-testid="co-slot-reason" />
                      <button type="button" className="btn btn-outline btn-sm" onClick={() => act(() => rq(`/api/company/${c.id}/hire/slots/${s.id}/cancel`, { method: 'POST', body: { reason: why[s.id] } }), t('co.slots.cancelled'))} data-testid="co-slot-cancel-ok">{t('co.slots.cancelIt')}</button>
                    </span>
                  ) : <button type="button" className="btn btn-ghost btn-sm" onClick={() => setWhy({ ...why, [s.id]: '' })} data-testid="co-slot-cancel">{t('co.slots.cancel')}</button>}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
      {canEdit && (adding ? (
        <form className="stack g8" onSubmit={save} aria-label={t('co.slots.add')} data-testid="co-slots-form">
          {rows.map((r, i) => (
            <fieldset key={i} className="card-sm co-grid" style={{ margin: 0 }}>
              <label className="field"><span className="label">{t('co.slots.date')}</span><input type="date" className="input" required value={r.date} onChange={set(i, 'date')} data-testid="co-slot-date" /></label>
              <label className="field"><span className="label">{t('co.slots.time')}</span><input type="time" className="input" required value={r.time} onChange={set(i, 'time')} data-testid="co-slot-time" /></label>
              <label className="field"><span className="label">{t('co.slots.minutes')}</span><input className="input" inputMode="numeric" value={r.minutes} onChange={set(i, 'minutes')} /></label>
              <label className="field"><span className="label">{t('co.slots.place')}</span><input className="input" maxLength={200} value={r.place} onChange={set(i, 'place')} data-testid="co-slot-place" /></label>
              <label className="field"><span className="label">{t('co.slots.link')}</span><input className="input" maxLength={300} placeholder="https://" value={r.link} onChange={set(i, 'link')} /></label>
              <label className="field"><span className="label">{t('co.slots.interviewer')}</span><input className="input" maxLength={80} value={r.interviewer} onChange={set(i, 'interviewer')} /></label>
              <label className="field"><span className="label">{t('co.slots.round')}</span><input className="input" maxLength={60} value={r.round} onChange={set(i, 'round')} /></label>
            </fieldset>
          ))}
          <div className="row g8" style={{ flexWrap: 'wrap' }}>
            <button type="button" className="btn btn-outline btn-sm" onClick={() => setRows([...rows, { ...rows[rows.length - 1] }])} data-testid="co-slot-more">{t('co.slots.another')}</button>
            <button type="submit" className="btn btn-ink btn-sm" data-testid="co-slots-save">{t('co.slots.save')}</button>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setAdding(false)}>{t('co.slots.close')}</button>
          </div>
        </form>
      ) : <button type="button" className="btn btn-outline" style={{ alignSelf: 'flex-start' }} onClick={() => setAdding(true)} data-testid="co-slots-add">{t('co.slots.add')}</button>)}
    </section>
  );
}
