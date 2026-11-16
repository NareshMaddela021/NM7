// /me/verification (Vetting V4): the Nm7 human check, the last step to L4 "Nm7 verified". A company hiring on Nm7
// asks for it; then the candidate picks a 15-minute call time with an Nm7 reviewer (their local date and time) and
// names 1–2 referees (a past manager, HR contact, college teacher or senior colleague), who get a short email with 5
// questions. The page explains the check in plain words (what the reviewer checks, never ID numbers, free), shows the
// steps, each referee's status (sent / answered) and, once verified, the badge and the reference line.
// GET /api/me/verification · POST /api/me/verification/slot {at} · POST /api/me/verification/referees {referees}.
import { useCallback, useEffect, useId, useState } from 'react';
import { Link } from 'react-router-dom';
import { http } from '../../services/http';
import { useVettingOn } from '../../lib/vettingAccess';
import { MeHead } from './MeLayout';
import { Chip, Empty, MeCard, Skel } from './kit';
import { L4_STEPS, RELATIONS, byDay, l4Status, refereeProblems, stepIndex, timeText, whenText } from '../../lib/l4';
import '../../styles/me-vet.css';
import '../../styles/vetting-l4.css';

const API = '/api/me/verification';
const YEAR = 365 * 24 * 3600 * 1000;
const BLANK = { name: '', relation: 'past manager', company: '', email: '', phone: '' };

function Steps({ status }) {
  const at = status === 'failed' ? 2 : stepIndex(status);
  return (
    <ol className="l4-steps" aria-label="Where your check is" data-testid="l4-steps">
      {L4_STEPS.map(([k, l], i) => {
        const done = i < at || status === 'verified';
        const now = i === at && status !== 'verified';
        return (
          <li key={k} className={done ? 'done' : now ? 'now' : ''} aria-current={now ? 'step' : undefined}>
            <span className="l4-dot" aria-hidden="true">{done ? '✓' : i + 1}</span>{l}<span className="sr-only">{done ? ' (done)' : now ? ' (now)' : ''}</span>
          </li>
        );
      })}
    </ol>
  );
}

function SlotPicker({ slots, onBooked }) {
  const [pick, setPick] = useState(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const book = async () => {
    setBusy(true); setErr('');
    try { onBooked(await http(`${API}/slot`, { method: 'POST', body: { at: pick } })); }
    catch (e) { setErr(e.message); setPick(null); onBooked(null); } finally { setBusy(false); }
  };
  if (!slots.length) return <p className="small muted" data-testid="l4-no-slots">No call times are free right now. Please look again later today: reviewers add times every week.</p>;
  return (
    <div className="stack g12">
      <div className="l4-days" data-testid="l4-slots">
        {byDay(slots).map(([day, list]) => (
          <fieldset key={day} className="l4-day">
            <legend className="l4-legend">{day}</legend>
            <div className="l4-choices" role="radiogroup" aria-label={`Times on ${day}`}>
              {list.map((s) => (
                <button key={s.at} type="button" role="radio" className="l4-choice" aria-checked={pick === s.at} onClick={() => setPick(s.at)} data-testid="l4-slot">{timeText(s.at)}</button>
              ))}
            </div>
          </fieldset>
        ))}
      </div>
      <span className="xs muted">Times are in your own time zone. The call takes about 15 minutes.</span>
      {err && <p className="error" role="alert" style={{ margin: 0 }}>{err}</p>}
      <button type="button" className="btn btn-signal" style={{ alignSelf: 'flex-start' }} disabled={!pick || busy} onClick={book} data-testid="l4-book">
        {busy ? 'Booking…' : pick ? `Book ${whenText(pick)}` : 'Pick a time first'}
      </button>
    </div>
  );
}

function RefereeForm({ onSaved }) {
  const id = useId();
  const [rows, setRows] = useState([{ ...BLANK }]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const set = (i, k) => (e) => setRows((r) => r.map((x, j) => (j === i ? { ...x, [k]: e.target.value } : x)));
  const send = async (e) => {
    e.preventDefault(); setErr('');
    const bad = rows.map((r, i) => [i, refereeProblems(r)]).find(([, p]) => p.length);
    if (bad) { setErr(`Referee ${bad[0] + 1}: please add ${bad[1].join(', ')}.`); return; }
    setBusy(true);
    try { onSaved(await http(`${API}/referees`, { method: 'POST', body: { referees: rows.map((r) => ({ ...r, name: r.name.trim(), company: r.company.trim(), email: r.email.trim(), phone: r.phone.trim() })) } })); }
    catch (x) { setErr(x.message); } finally { setBusy(false); }
  };
  return (
    <form className="stack g12" onSubmit={send} noValidate data-testid="l4-ref-form">
      {rows.map((r, i) => (
        <fieldset key={i} className="l4-person">
          <legend>Referee {i + 1}</legend>
          <div className="l4-form">
            <label className="field"><span className="label">Their name</span>
              <input className="input" autoComplete="off" maxLength={80} value={r.name} onChange={set(i, 'name')} data-testid="l4-ref-name" /></label>
            <label className="field"><span className="label">How you know them</span>
              <select className="input" value={r.relation} onChange={set(i, 'relation')} data-testid="l4-ref-relation">
                {RELATIONS.map((x) => <option key={x} value={x}>{x.charAt(0).toUpperCase() + x.slice(1)}</option>)}
              </select></label>
            <label className="field"><span className="label">Company or college</span>
              <input className="input" autoComplete="off" maxLength={100} value={r.company} onChange={set(i, 'company')} data-testid="l4-ref-company" /></label>
            <label className="field"><span className="label">Their email</span>
              <input className="input" type="email" inputMode="email" autoComplete="off" maxLength={120} value={r.email} onChange={set(i, 'email')} aria-describedby={`${id}-c`} data-testid="l4-ref-email" /></label>
            <label className="field"><span className="label">Their phone</span>
              <input className="input" type="tel" inputMode="tel" autoComplete="off" maxLength={20} value={r.phone} onChange={set(i, 'phone')} aria-describedby={`${id}-c`} data-testid="l4-ref-phone" /></label>
          </div>
          {i > 0 && <button type="button" className="btn btn-ghost" style={{ alignSelf: 'flex-start' }} onClick={() => setRows((x) => x.slice(0, 1))}>Remove referee 2</button>}
        </fieldset>
      ))}
      <p className="l4-help" id={`${id}-c`}>Give an email or a phone number (or both). Use their own contact, not yours: we check.</p>
      {err && <p className="error" role="alert" style={{ margin: 0 }}>{err}</p>}
      <div className="row g8" style={{ flexWrap: 'wrap' }}>
        {rows.length < 2 && <button type="button" className="btn btn-outline" onClick={() => setRows((x) => [...x, { ...BLANK }])} data-testid="l4-ref-add">Add a second referee</button>}
        <button type="submit" className="btn btn-signal" disabled={busy} data-testid="l4-ref-send">{busy ? 'Sending…' : 'Send the questions'}</button>
      </div>
    </form>
  );
}

/** Hidden from this person (Admin → Skill checks → Launch): nothing to see yet. */
export default function MeVerification() {
  const on = useVettingOn();
  if (on == null) return <Skel cards={1} lines={3} label="Loading" />;
  if (!on) return <><MeHead title="Nm7 check" /><Empty shape="badge" title="Not open yet">The Nm7 human check is not open yet.</Empty></>;
  return <MeVerificationPage />;
}

function MeVerificationPage() {
  const [d, setD] = useState(null);
  const [err, setErr] = useState('');
  const load = useCallback(() => http(API).then((x) => { setD(x); setErr(''); }, (e) => setErr(e.message)), []);
  useEffect(() => { load(); }, [load]);
  const merge = (req) => (req ? setD((x) => ({ ...x, request: req, slots: req.slotAt ? [] : x.slots })) : load());

  const head = <MeHead title="Nm7 human check" sub="The last step to L4 · Nm7 verified: a short call with a real person and a word from someone you worked with." />;
  if (!d) return err ? <>{head}<p className="error" role="alert">{err}</p></> : <>{head}<Skel cards={2} label="Loading your check" /></>;
  const r = d.request;
  const [words, tone] = l4Status(r?.status);
  const open = r && !['verified', 'failed'].includes(r.status);

  return (
    <>
      {head}
      <section className="mcard mcard-accent vet-hero" aria-labelledby="l4-how-h" data-testid="l4-hero">
        <div className="stack g8" style={{ minWidth: 0 }}>
          <span className="mkicker">How it works</span>
          <h2 id="l4-how-h" className="vet-h2">Become Nm7 verified (L4)</h2>
          <ol className="vet-steps">
            <li><strong>A 15-minute video or phone call</strong> with an Nm7 reviewer at a time you pick.</li>
            <li><strong>They check</strong> that you match your profile, ask about two skills, and see that you are serious about the job.</li>
            <li><strong>One person who worked with you</strong> (a past manager, HR contact, teacher or senior colleague) answers 5 short questions.</li>
          </ol>
          <span className="small">We never ask for Aadhaar, PAN or any ID number. {d.free ? 'It’s free.' : ''} Verified lasts a year.</span>
        </div>
        {r?.status === 'verified'
          ? <div className="vet-badge" data-testid="l4-badge"><strong>✓ Nm7 verified</strong>{r.referenceLine && <span className="small" data-testid="l4-line">{r.referenceLine}</span>}{r.grantedAt && <span className="xs">Until {new Date(r.grantedAt + YEAR).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}</span>}</div>
          : d.free && <Chip tone="ok" testid="l4-free" style={{ justifySelf: 'start', alignSelf: 'start' }}>Free</Chip>}
      </section>

      {err && <p className="error" role="alert">{err}</p>}

      {!r ? (
        <Empty shape="badge" tint="student" title="No company has asked yet" testid="l4-none" action={<Link className="btn btn-outline" to="/me/interviews">Screening interview</Link>}>
          The human check starts when a company hiring on Nm7 asks for it. You’ll get an email, then you book your call here. Be Interview-ready (L3) first.
        </Empty>
      ) : (
        <>
          <MeCard title="Your check" icon="✓" sub={`Asked ${whenText(r.requestedAt)}`} testid="l4-status-card"
            actions={<Chip tone={tone} testid="l4-status">{words}</Chip>}>
            <Steps status={r.status} />
            {r.status === 'failed' && (
              <div className="stack g4" data-testid="l4-failed">
                <strong className="small">The check wasn’t passed this time.</strong>
                {r.check?.note && <p className="small" style={{ margin: 0, whiteSpace: 'pre-line' }}>{r.check.note}</p>}
                <span className="xs muted">You keep your other levels. A company can ask again later.</span>
              </div>
            )}
          </MeCard>

          {open && (
            <MeCard title={r.slotAt ? 'Your call' : '1. Pick a call time'} icon="☎" testid="l4-call"
              sub={r.slotAt ? 'An Nm7 reviewer will call you or send a video link before the time.' : 'Choose a time that suits you in the next 7 days.'}>
              {r.slotAt ? (
                <div className="stack g8">
                  <strong data-testid="l4-slot-at">{whenText(r.slotAt)}</strong>
                  {r.callLink && <a className="btn btn-signal" style={{ alignSelf: 'flex-start' }} href={r.callLink} target="_blank" rel="noopener noreferrer" data-testid="l4-call-link">Join the call</a>}
                  <span className="xs muted">Keep your phone near you, and have your work history in mind. No documents needed.</span>
                </div>
              ) : <SlotPicker slots={d.slots || []} onBooked={merge} />}
            </MeCard>
          )}

          {(open || r.referees.length > 0) && (
            <MeCard title={r.referees.length ? 'Your referees' : '2. Name 1 or 2 referees'} icon="✉" testid="l4-referees"
              sub={r.referees.length ? 'They got an email with 5 short questions (about 2 minutes).' : 'Someone who saw your work: they get 5 short questions by email. Only a one-line confirmation is shown to companies.'}>
              {r.referees.length ? (
                <ul className="l4-refs">
                  {r.referees.map((x, i) => (
                    <li key={i} className="l4-ref" data-testid="l4-ref">
                      <span className="l4-ref-main"><strong>{x.name}</strong><span className="xs muted">{x.relation}{x.company ? ` · ${x.company}` : ''}</span></span>
                      <Chip tone={x.answered ? 'ok' : 'info'}>{x.answered ? '✓ Answered' : 'Sent'}</Chip>
                    </li>
                  ))}
                </ul>
              ) : <RefereeForm onSaved={merge} />}
            </MeCard>
          )}
        </>
      )}

      <MeCard tone="flat" className="mcard-tight" icon="🔒" title="What the reviewer checks" headingLevel={2}>
        <ul className="l4-checklist" data-testid="l4-checklist">{(d.checklist || []).map((x) => <li key={x}>{x}</li>)}</ul>
      </MeCard>
    </>
  );
}
