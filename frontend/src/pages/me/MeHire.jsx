// "Ready to join" (Phase 5, H1): the candidate says they can start a job now — when, where, the salary they expect,
// their notice period and the kinds of job — and agrees that companies hiring now may see their profile and invite
// them. It lasts 7 days (Admin can change it); one tap on "Still ready" starts the days again. Pause keeps
// everything. Phone and email are never shown to a company until the candidate accepts an invite. Invites from
// companies (H2) show at the top: Accept, or Not interested with a reason.
import { useEffect, useState } from 'react';
import { useToast } from '../../components/ui';
import { API_BASE, http } from '../../services/http';
import { MeHead } from './MeLayout';

const TYPES = [['full_time', 'Full-time'], ['internship', 'Internship'], ['part_time', 'Part-time'], ['contract', 'Contract']];
const day = (ms) => new Date(ms).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
const toForm = (s) => ({
  joinDate: s.joinDate || '', cities: (s.cities || []).join(', '), remote: !!s.remote,
  amount: s.salary ? String(s.salary.amount) : '', unit: s.salary?.unit || 'month', noticeDays: String(s.noticeDays || 0),
  jobTypes: s.jobTypes || [], consent: !!s.consent,
});

/** One line for the card and the page: visible until …, paused, needs a tap, or off. */
export function hireLine(s) {
  if (!s?.on) return 'Off: companies hiring now don’t see you.';
  if (s.paused) return 'Paused: companies hiring now don’t see you until you resume.';
  if (s.stale) return 'Not visible any more: tap Still ready to show companies you can join.';
  if (s.due) return `Visible to companies hiring now until ${day(s.expiresAt)}. Tap Still ready to keep it.`;
  return `Visible to companies hiring now until ${day(s.expiresAt)}.`;
}

/** Phase 6 S4: what fresher jobs in the person's role pay, from Nm7's own jobs (only with enough of them). */
function PayHint({ cities }) {
  const city = (cities || '').split(',')[0].trim();
  const [h, setH] = useState(null);
  useEffect(() => {
    const id = setTimeout(() => { http(`/api/me/salary-hint${city ? `?city=${encodeURIComponent(city)}` : ''}`).then(setH, () => setH(null)); }, 400);
    return () => clearTimeout(id);
  }, [city]);
  if (!h?.role) return null;
  const r = h.range;
  return (
    <span className="xs muted" data-testid="hj-pay">
      {r ? `Most fresher jobs for ${h.role.title} ${r.city ? `in ${r.city}` : 'across India'} on Nm7 pay ₹${r.min.toLocaleString('en-IN')}–₹${r.max.toLocaleString('en-IN')} a month (based on ${r.jobs} jobs in the last ${r.days} days).` : `Salary guide for ${h.role.title}: not enough data yet.`}
    </span>
  );
}

export default function MeHire() {
  const toast = useToast();
  const [s, setS] = useState(null);
  const [f, setF] = useState(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const load = (x) => { setS(x); setF(toForm(x)); };
  useEffect(() => { http('/api/me/hire').then(load, (e) => setErr(e.message)); }, []);
  const run = async (fn, said) => { setBusy(true); setErr(''); try { const x = await fn(); setS(x); if (said) toast(said); return x; } catch (e) { setErr(e.message); } finally { setBusy(false); } };
  const set = (k) => (e) => setF({ ...f, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value });
  const save = (on) => run(async () => {
    const body = {
      on, consent: f.consent, joinDate: f.joinDate, cities: f.cities.split(',').map((x) => x.trim()).filter(Boolean), remote: f.remote,
      salary: f.amount ? { amount: Number(f.amount), unit: f.unit } : null, noticeDays: Number(f.noticeDays || 0), jobTypes: f.jobTypes,
    };
    const x = await http('/api/me/hire', { method: 'PUT', body });
    setF(toForm(x));
    return x;
  }, on ? 'Saved: you are ready to join' : 'Turned off');
  if (!s) return err ? <p className="error" role="alert">{err}</p> : <p className="muted">Loading…</p>;
  if (!s.siteOn && !s.on) return <><MeHead title="Ready to join" /><p className="card small">Hiring now is switched off for the moment.</p></>;
  const tone = s.available ? 'b-success' : s.on ? 'b-warning' : 'b-neutral';
  return (
    <>
      <MeHead title="Ready to join" sub="Tell companies hiring now that you can start, and they can invite you to an interview." />
      <Offers />
      <Invites />
      <Slots />
      <section className="card stack g12" aria-labelledby="hire-status-h" data-testid="hire-status">
        <div className="row between g8"><strong id="hire-status-h">Status</strong><span className={`badge ${tone}`} data-testid="hire-badge">{s.available ? 'Visible' : s.on ? (s.paused ? 'Paused' : 'Not visible') : 'Off'}</span></div>
        <p className="small" style={{ margin: 0 }} data-testid="hire-line">{hireLine(s)}</p>
        {s.on && (
          <div className="row g8" style={{ flexWrap: 'wrap' }}>
            {!s.paused && <button type="button" className="btn btn-ink" disabled={busy} onClick={() => run(() => http('/api/me/hire/confirm', { method: 'POST' }), 'Thanks: visible for another week')} data-testid="hire-still">Still ready</button>}
            <button type="button" className="btn btn-outline" disabled={busy} onClick={() => run(() => http('/api/me/hire/pause', { method: 'POST', body: { paused: !s.paused } }), s.paused ? 'Resumed' : 'Paused')} data-testid="hire-pause">{s.paused ? 'Resume' : 'Pause'}</button>
          </div>
        )}
        <p className="xs muted" style={{ margin: 0 }}>Your phone number and email are never shown to a company until you accept its invite.</p>
        <p className="small" style={{ margin: 0 }}>Stand out: take a 10-minute <a href="/me/skill-checks" data-testid="hire-skill-link">skill check</a> and choose to show the score.</p>
      </section>
      <form className="card stack g12" onSubmit={(e) => { e.preventDefault(); save(true); }} aria-label="Ready to join details" data-testid="hire-form">
        <div className="co-grid">
          <div className="field"><label className="label" htmlFor="hj-date">Earliest join date</label><input id="hj-date" type="date" className="input" value={f.joinDate} onChange={set('joinDate')} /></div>
          <div className="field"><label className="label" htmlFor="hj-notice">Notice period (days)</label><input id="hj-notice" className="input" inputMode="numeric" value={f.noticeDays} onChange={(e) => setF({ ...f, noticeDays: e.target.value.replace(/\D/g, '').slice(0, 3) })} /></div>
        </div>
        <div className="field"><label className="label" htmlFor="hj-cities">Cities you can work in (comma between)</label><input id="hj-cities" className="input" placeholder="Hyderabad, Pune" value={f.cities} onChange={set('cities')} /></div>
        <label className="row g8 small"><input type="checkbox" value="remote" checked={f.remote} onChange={set('remote')} /> Remote is fine</label>
        <div className="co-grid">
          <div className="field"><label className="label" htmlFor="hj-sal">Expected salary</label><input id="hj-sal" className="input" inputMode="decimal" placeholder={f.unit === 'lpa' ? '3.5' : '25000'} value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value.replace(/[^\d.]/g, '').slice(0, 9) })} /></div>
          <div className="field"><label className="label" htmlFor="hj-unit">Per</label><select id="hj-unit" className="input" value={f.unit} onChange={set('unit')}><option value="month">₹ a month</option><option value="lpa">Lakhs a year (LPA)</option></select></div>
        </div>
        <PayHint cities={f.cities} />
        <fieldset className="stack g4" style={{ border: 0, padding: 0, margin: 0 }}>
          <legend className="label">Kinds of job</legend>
          <div className="row g12" style={{ flexWrap: 'wrap' }}>
            {TYPES.map(([k, l]) => <label key={k} className="row g4 small"><input type="checkbox" value={k} checked={f.jobTypes.includes(k)} onChange={(e) => setF({ ...f, jobTypes: e.target.checked ? [...f.jobTypes, k] : f.jobTypes.filter((x) => x !== k) })} /> {l}</label>)}
          </div>
        </fieldset>
        <label className="row g8 small" style={{ alignItems: 'flex-start', flexWrap: 'nowrap' }}><input type="checkbox" value="consent" checked={f.consent} onChange={set('consent')} style={{ marginTop: 3 }} data-testid="hire-consent" /> <span>Companies hiring now can see my profile and invite me. (Not my phone or email: those only after I accept an invite.)</span></label>
        {err && <p className="error" role="alert" style={{ margin: 0 }}>{err}</p>}
        <div className="row g8" style={{ flexWrap: 'wrap' }}>
          <button type="submit" className="btn btn-ink" disabled={busy} data-testid="hire-save">{s.on ? 'Save' : 'Turn on Ready to join'}</button>
          {s.on && <button type="button" className="btn btn-outline" disabled={busy} onClick={() => save(false)} data-testid="hire-off">Turn off</button>}
        </div>
      </form>
      <Reliability />
      {s.on && (
        <label className="row g8 small card-sm" style={{ flexWrap: 'nowrap' }}>
          <input type="checkbox" value="emails" checked={s.emails} onChange={(e) => run(() => http('/api/me/hire/emails', { method: 'PUT', body: { on: e.target.checked } }))} data-testid="hire-emails" />
          Email me a day before it ends, with a one-tap Still ready
        </label>
      )}
    </>
  );
}

const REASONS = [['salary', 'The salary is too low'], ['place', 'The place doesn’t suit me'], ['role', 'The role doesn’t suit me'], ['timing', 'I can’t join that soon'], ['joined', 'I already got a job'], ['other', 'Another reason']];
const STATE = { sent: 'Waiting for your answer', accepted: 'Accepted: the company can see your email and phone', declined: 'Not interested', expired: 'Expired' };

/** Invites from companies hiring now (H2): Accept shares the email and phone with that company; Not interested asks
 * for a reason (no pop-up: the reasons open under the invite). */
export function Invites() {
  const toast = useToast();
  const [list, setList] = useState(null);
  const [why, setWhy] = useState({});
  const [err, setErr] = useState('');
  useEffect(() => { http('/api/me/hire/invites').then(setList, () => setList([])); }, []);
  if (!list || !list.length) return null;
  const answer = async (i, a, reason) => {
    setErr('');
    try {
      const x = await http(`/api/me/hire/invites/${i.id}`, { method: 'POST', body: { answer: a, reason } });
      setList(list.map((y) => (y.id === i.id ? { ...y, ...x } : y)));
      setWhy({ ...why, [i.id]: undefined });
      toast(a === 'accept' ? 'Accepted: the company will contact you' : 'Thanks, we told the company');
    } catch (e) { setErr(e.message); }
  };
  return (
    <section id="invites" className="card stack g12" aria-labelledby="hire-inv-h" data-testid="hire-invites">
      <strong id="hire-inv-h">Invites from companies hiring now</strong>
      {err && <p className="error" role="alert" style={{ margin: 0 }}>{err}</p>}
      <ul className="stack g12" style={{ listStyle: 'none', padding: 0, margin: 0 }}>
        {list.map((i) => (
          <li key={i.id} className="card-sm stack g8" data-testid="hire-invite">
            <strong>{i.role} · {i.company}</strong>
            <span className="small">{[i.where, i.salary && (i.salary.min || i.salary.max) ? `₹${(i.salary.min || i.salary.max).toLocaleString('en-IN')}${i.salary.max && i.salary.min ? `–${i.salary.max.toLocaleString('en-IN')}` : ''} ${i.salary.period === 'monthly' ? 'a month' : 'a year'}` : ''].filter(Boolean).join(' · ')}</span>
            {i.note && <span className="small">“{i.note}”</span>}
            {i.jobUrl && <a href={i.jobUrl} className="small">See the job</a>}
            {i.status === 'sent' && i.live ? (
              why[i.id] ? (
                <fieldset className="stack g4" style={{ border: 0, padding: 0, margin: 0 }}>
                  <legend className="label">Why not? The company sees only this reason.</legend>
                  {REASONS.map(([k, l]) => <button key={k} type="button" className="btn btn-outline btn-sm" style={{ alignSelf: 'flex-start' }} onClick={() => answer(i, 'decline', k)} data-testid={`hire-why-${k}`}>{l}</button>)}
                  <button type="button" className="btn btn-ghost btn-sm" style={{ alignSelf: 'flex-start' }} onClick={() => setWhy({ ...why, [i.id]: false })}>Back</button>
                </fieldset>
              ) : (
                <span className="row g8" style={{ flexWrap: 'wrap' }}>
                  <button type="button" className="btn btn-ink" onClick={() => answer(i, 'accept')} data-testid="hire-accept">Accept</button>
                  <button type="button" className="btn btn-outline" onClick={() => setWhy({ ...why, [i.id]: true })} data-testid="hire-decline">Not interested</button>
                </span>
              )
            ) : <span className="badge b-neutral" style={{ alignSelf: 'flex-start', maxWidth: '100%', whiteSpace: 'normal', height: 'auto' }} data-testid="hire-invite-state">{i.status === 'sent' ? 'This job is closed' : STATE[i.status]}</span>}
            {i.status === 'sent' && <span className="xs muted">Accepting shares your email and phone with {i.company} only.</span>}
          </li>
        ))}
      </ul>
    </section>
  );
}

const at = (ms) => new Date(ms).toLocaleString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Kolkata' });

/** Interview times (H5): for each job where I accepted an invite, the company's open times; one tap books, another
 * time moves it (with a reason), Cancel needs a reason. A calendar file comes by email and can be downloaded here. */
export function Slots() {
  const toast = useToast();
  const [list, setList] = useState(null);
  const [why, setWhy] = useState({});
  const [err, setErr] = useState('');
  const load = () => http('/api/me/hire/slots').then(setList, () => setList([]));
  useEffect(() => { load(); }, []);
  if (!list || !list.length) return null;
  const go = async (path, body, said) => {
    setErr('');
    try { await http(path, { method: 'POST', body }); toast(said); setWhy({}); await load(); } catch (e) { setErr(e.message); }
  };
  return (
    <section className="card stack g12" aria-labelledby="hire-slots-h" data-testid="hire-slots">
      <strong id="hire-slots-h">Pick your interview time</strong>
      {err && <p className="error" role="alert" style={{ margin: 0 }}>{err}</p>}
      {list.map((j) => (
        <div key={j.jobId} className="card-sm stack g8" data-testid="hire-slot-job">
          <strong className="small">{j.role} · {j.company}</strong>
          {j.mine && (
            <div className="stack g4" data-testid="hire-slot-mine">
              <span className="small">Booked: <strong>{at(j.mine.at)}</strong> ({j.mine.minutes} min){j.mine.place ? ` · ${j.mine.place}` : ''}{j.mine.link ? ' · online' : ''}</span>
              {j.mine.link && <a className="small" href={j.mine.link} target="_blank" rel="noopener noreferrer">Join link</a>}
              <span className="row g8" style={{ flexWrap: 'wrap' }}>
                <a className="btn btn-ghost btn-sm" href={`${API_BASE}/api/me/hire/slots/${j.mine.id}/ics`} download="interview.ics">Calendar file</a>
                {why[j.jobId] === undefined && <button type="button" className="btn btn-outline btn-sm" onClick={() => setWhy({ [j.jobId]: '' })} data-testid="hire-slot-change">Reschedule or cancel</button>}
              </span>
            </div>
          )}
          {why[j.jobId] !== undefined && (
            <label className="field"><span className="label">Why? (the company sees this)</span><input className="input" maxLength={300} value={why[j.jobId]} onChange={(e) => setWhy({ [j.jobId]: e.target.value })} data-testid="hire-slot-reason" /></label>
          )}
          {(!j.mine || why[j.jobId] !== undefined) && (
            <div className="row g8" style={{ flexWrap: 'wrap' }}>
              {j.open.length === 0 && <span className="small muted">No open times yet. You will see them here.</span>}
              {j.open.map((s) => <button key={s.id} type="button" className="btn btn-outline btn-sm" onClick={() => go(`/api/me/hire/slots/${s.id}/book`, { reason: why[j.jobId] || '' }, j.mine ? 'Moved: both of you got the new time' : 'Booked: the calendar file is in your email')} data-testid="hire-slot-pick">{at(s.at)}</button>)}
              {j.mine && <button type="button" className="btn btn-ghost btn-sm" onClick={() => go(`/api/me/hire/slots/${j.mine.id}/cancel`, { reason: why[j.jobId] || '' }, 'Cancelled: the company was told')} data-testid="hire-slot-cancel">Cancel the interview</button>}
            </div>
          )}
        </div>
      ))}
      <span className="xs muted">Reminders come 1 day and 1 hour before. Times are India time (IST).</span>
    </section>
  );
}

const OFFER_STATE = { accepted: 'Accepted', joined: 'Joined', declined: 'Declined', dropped: 'Not joining', expired: 'Expired' };

/** Offers (H6): read the letter, accept by typing your name and ticking the box (a record of your answer, not a legal
 * e-signature) or decline; download the PDF; the joining check-in ("still joining?") and Joined. */
export function Offers() {
  const toast = useToast();
  const [list, setList] = useState(null);
  const [f, setF] = useState({});
  const [err, setErr] = useState('');
  const load = () => http('/api/me/hire/offers').then(setList, () => setList([]));
  useEffect(() => { load(); }, []);
  if (!list || !list.length) return null;
  const v = (id) => f[id] || { name: '', agree: false, reason: '', mode: '' };
  const put = (id, x) => setF({ ...f, [id]: { ...v(id), ...x } });
  const go = async (path, body, said) => {
    setErr('');
    try { await http(path, { method: 'POST', body }); toast(said); setF({}); await load(); } catch (e) { setErr(e.message); }
  };
  const today = new Date().toISOString().slice(0, 10);
  return (
    <section id="offers" className="card stack g12" aria-labelledby="hire-offers-h" data-testid="hire-offers">
      <strong id="hire-offers-h">Your offers</strong>
      {err && <p className="error" role="alert" style={{ margin: 0 }}>{err}</p>}
      {list.map((o) => (
        <article key={o.id} className="card-sm stack g8" data-testid="hire-offer">
          <div className="row between g8" style={{ flexWrap: 'wrap' }}><strong>{o.title} · {o.company}</strong>{o.status !== 'sent' && <span className="badge b-neutral" data-testid="hire-offer-state">{OFFER_STATE[o.status]}</span>}</div>
          <p className="small" style={{ margin: 0, whiteSpace: 'pre-line' }} data-testid="hire-offer-letter">{o.letter}</p>
          <a className="btn btn-ghost btn-sm" style={{ alignSelf: 'flex-start' }} href={`${API_BASE}/api/me/hire/offers/${o.id}/pdf`} download="offer.pdf">Download PDF</a>
          {o.status === 'sent' && (v(o.id).mode === 'decline' ? (
            <div className="stack g8">
              <label className="field"><span className="label">Why not? (optional, the company sees it)</span><input className="input" maxLength={300} value={v(o.id).reason} onChange={(e) => put(o.id, { reason: e.target.value })} /></label>
              <span className="row g8"><button type="button" className="btn btn-outline" onClick={() => go(`/api/me/hire/offers/${o.id}/answer`, { answer: 'decline', reason: v(o.id).reason }, 'Declined: the company was told')} data-testid="hire-offer-decline-ok">Decline the offer</button><button type="button" className="btn btn-ghost" onClick={() => put(o.id, { mode: '' })}>Back</button></span>
            </div>
          ) : (
            <div className="stack g8">
              <label className="field"><span className="label">Type your full name to accept</span><input className="input" maxLength={120} autoComplete="name" value={v(o.id).name} onChange={(e) => put(o.id, { name: e.target.value })} data-testid="hire-offer-name" /></label>
              <label className="row g8 small" style={{ alignItems: 'flex-start', flexWrap: 'nowrap' }}><input type="checkbox" checked={v(o.id).agree} onChange={(e) => put(o.id, { agree: e.target.checked })} style={{ marginTop: 3 }} data-testid="hire-offer-agree" /><span>I accept this offer and plan to join on {o.joinDate}.</span></label>
              <span className="row g8" style={{ flexWrap: 'wrap' }}>
                <button type="button" className="btn btn-ink" onClick={() => go(`/api/me/hire/offers/${o.id}/answer`, { answer: 'accept', typedName: v(o.id).name, agree: v(o.id).agree }, 'Accepted: the company was told')} data-testid="hire-offer-accept">Accept</button>
                <button type="button" className="btn btn-outline" onClick={() => put(o.id, { mode: 'decline' })} data-testid="hire-offer-decline">Decline</button>
              </span>
              <span className="xs muted">{o.notESign}</span>
            </div>
          ))}
          {o.status === 'accepted' && (v(o.id).mode === 'drop' ? (
            <div className="stack g8">
              <label className="field"><span className="label">Why can’t you join? (the company sees it)</span><input className="input" maxLength={300} value={v(o.id).reason} onChange={(e) => put(o.id, { reason: e.target.value })} data-testid="hire-offer-drop-reason" /></label>
              <span className="row g8"><button type="button" className="btn btn-outline" onClick={() => go(`/api/me/hire/offers/${o.id}/joining`, { joining: false, reason: v(o.id).reason }, 'Thanks for telling them early')}>Tell the company</button><button type="button" className="btn btn-ghost" onClick={() => put(o.id, { mode: '' })}>Back</button></span>
            </div>
          ) : (
            <span className="row g8" style={{ flexWrap: 'wrap' }}>
              {o.joinDate <= today
                ? <button type="button" className="btn btn-ink btn-sm" onClick={() => go(`/api/me/hire/offers/${o.id}/joined`, { joined: true }, 'Congratulations on joining!')} data-testid="hire-offer-joined">I joined</button>
                : <button type="button" className="btn btn-outline btn-sm" onClick={() => go(`/api/me/hire/offers/${o.id}/joining`, { joining: true }, 'Thanks: see you on your first day')} data-testid="hire-offer-still">Still joining on {o.joinDate}</button>}
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => put(o.id, { mode: 'drop' })}>I can’t join</button>
            </span>
          ))}
        </article>
      ))}
    </section>
  );
}

/** My reliability (H4): from real events only (invite replies, interviews, offers); new people show "New - no history
 * yet" and are never ranked lower. */
export function Reliability() {
  const [r, setR] = useState(null);
  useEffect(() => { http('/api/me/hire/reliability').then(setR, () => {}); }, []);
  if (!r) return null;
  return (
    <section className="card stack g8" aria-labelledby="hire-rel-h" data-testid="hire-reliability">
      <div className="row between g8" style={{ flexWrap: 'wrap' }}><strong id="hire-rel-h">Your reliability</strong><span className="badge b-neutral" data-testid="hire-rel-label">{r.score == null ? r.label : `${r.label} · ${r.score}%`}</span></div>
      {r.lines.length > 0 && <ul className="small" style={{ margin: 0, paddingLeft: 18 }}>{r.lines.map((l) => <li key={l}>{l}</li>)}</ul>}
      <span className="small">How to keep it high: {r.tips.join(' ')}</span>
      <span className="xs muted">Companies hiring now see this label and these lines, never which company marked what.</span>
    </section>
  );
}

/** The small card on My dashboard. */
export function HireCard() {
  const [s, setS] = useState(null);
  useEffect(() => { http('/api/me/hire').then(setS, () => {}); }, []);
  if (!s || (!s.siteOn && !s.on)) return null;
  const still = async () => { try { setS(await http('/api/me/hire/confirm', { method: 'POST' })); } catch { /* stays */ } };
  return (
    <section className="card stack g8" style={{ flex: '1 1 300px' }} aria-labelledby="hire-card-h" data-testid="hire-card">
      <strong id="hire-card-h">Ready to join</strong>
      <span className="small" data-testid="hire-card-line">{hireLine(s)}</span>
      <span className="row g8" style={{ flexWrap: 'wrap' }}>
        {s.on && !s.paused && (s.due || s.stale) && <button type="button" className="btn btn-ink" onClick={still} data-testid="hire-card-still">Still ready</button>}
        <a href="/me/hire" className="btn btn-outline">{s.on ? 'Change' : 'I can join now'}</a>
      </span>
    </section>
  );
}
