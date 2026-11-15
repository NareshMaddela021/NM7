// My progress (Phase 6, S10). While searching: this week's real numbers (applications, interviews, skills verified,
// readiness change) and an honest, kind message. After joining a job: a first-90-days checklist (week 1, month 1,
// month 3), probation tips, and check-ins on day 7 and day 30 ("Is the job what was promised?"); a "No" goes to Nm7
// privately, and reports from more than one person lower that company's trust score.
import { useEffect, useState } from 'react';
import { http } from '../../services/http';
import { MeHead } from './MeLayout';
import { Bar, Chip, Empty, MeCard, Skel, Stat } from './kit';
import '../../styles/me-work.css';

const PROBLEMS = [['salary', 'Pay is lower than promised'], ['role', 'The work is different'], ['hours', 'Hours are longer'], ['location', 'A different place'], ['fee', 'Asked to pay a deposit or fee'], ['safety', "I don't feel safe"], ['other', 'Something else']];
export const problemText = (k) => (PROBLEMS.find(([x]) => x === k) || [k, k])[1];
const day = (ms) => new Date(ms).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
const PART = { week1: 'Week 1', month1: 'Month 1', month3: 'Month 3' };

/** The problems as big tappable chips (real checkboxes inside). */
function Problems({ probs, setProbs, prefix }) {
  return (
    <div className="wk-probs">
      {PROBLEMS.map(([k, l]) => <label key={k} className={`wk-prob ${probs.includes(k) ? 'on' : ''}`}><input type="checkbox" checked={probs.includes(k)} onChange={() => setProbs(probs.includes(k) ? probs.filter((x) => x !== k) : [...probs, k])} data-testid={`${prefix}${k}`} />{l}</label>)}
    </div>
  );
}

function Checkin({ j, onDone }) {
  const [no, setNo] = useState(false);
  const [probs, setProbs] = useState([]);
  const [note, setNote] = useState('');
  const [err, setErr] = useState('');
  const send = async (ok) => {
    setErr('');
    try { onDone(await http(`/api/me/progress/joined/${j.id}/checkin`, { method: 'POST', body: { day: j.due, ok, problems: ok ? [] : probs, note } })); } catch (x) { setErr(x.message); }
  };
  return (
    <div className="mcard mcard-tight mcard-accent wk-checkin" data-testid="pr-checkin">
      <span className="mkicker">Check-in</span>
      <strong className="wk-checkin-q">Day {j.due} check-in: is the job what was promised?</strong>
      {!no ? (
        <div className="mrow g8"><button type="button" className="btn btn-signal" onClick={() => send(true)} data-testid="pr-yes">Yes</button><button type="button" className="btn btn-outline" onClick={() => setNo(true)} data-testid="pr-no">No</button></div>
      ) : (
        <div className="stack g8">
          <span className="xs muted">Only Nm7 sees this. The company is not told who wrote it.</span>
          <Problems probs={probs} setProbs={setProbs} prefix="pr-p-" />
          <label className="field"><span className="label">What happened (optional)</span><textarea className="input" rows={2} maxLength={1000} value={note} onChange={(e) => setNote(e.target.value)} /></label>
          <button type="button" className="btn btn-signal" style={{ alignSelf: 'flex-start' }} onClick={() => send(false)} data-testid="pr-report">Tell Nm7</button>
        </div>
      )}
      {err && <p className="error" role="alert">{err}</p>}
    </div>
  );
}

/** Round E: "Something isn't as promised? Report it", any day of the first 90 (not only at the check-ins). */
function Report({ j, onDone }) {
  const [open, setOpen] = useState(false);
  const [probs, setProbs] = useState([]);
  const [note, setNote] = useState('');
  const [err, setErr] = useState('');
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const send = async () => {
    setErr('');
    if (!probs.length) { setErr('Pick what isn\'t as promised.'); return; }
    setBusy(true);
    try { onDone(await http(`/api/me/progress/joined/${j.id}/report`, { method: 'POST', body: { problems: probs, note } })); setSent(true); setOpen(false); setProbs([]); setNote(''); } catch (x) { setErr(x.message); } finally { setBusy(false); }
  };
  return (
    <div className={`mcard mcard-tight ${open ? 'mcard-warn' : ''} wk-report`} data-testid="pr-report-box">
      {j.reports.map((r) => <span key={r.at} className="wk-reported" data-testid="pr-reported"><Chip tone="warn">Reported</Chip> Reported to Nm7 on {day(r.at)}: {r.problems.map(problemText).join(', ')}</span>)}
      {sent && (
        <div className="stack g4 wk-sent" role="status" data-testid="pr-report-sent">
          <strong className="small">Thanks: Nm7 has your report.</strong>
          <span className="small">What happens next: our team reads it and may email you to ask more. Only Nm7 sees it; the company is not told who wrote it. If more than one person reports the same company, its trust score on Nm7 goes down. If you feel unsafe, put your safety first and talk to someone you trust.</span>
        </div>
      )}
      {!open ? (
        <div className="mspread">
          <span className="stack g4" style={{ minWidth: 0, flex: '1 1 220px' }}><strong className="small">Is something wrong at the new job?</strong><span className="xs muted">You can tell Nm7 any day in your first 90 days. Only Nm7 sees it.</span></span>
          <button type="button" className="btn btn-signal" onClick={() => { setOpen(true); setSent(false); }} data-testid="pr-report-open">Something isn&apos;t as promised? Report it</button>
        </div>
      ) : (
        <fieldset className="stack g8" style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}>
          <legend className="wk-legend">What isn&apos;t as promised?</legend>
          <span className="xs muted">Only Nm7 sees this. The company is not told who wrote it.</span>
          <Problems probs={probs} setProbs={setProbs} prefix="pr-r-" />
          <label className="field"><span className="label">A short note (optional)</span><textarea className="input" rows={2} maxLength={1000} value={note} onChange={(e) => setNote(e.target.value)} data-testid="pr-r-note" /></label>
          {err && <p className="error" role="alert" style={{ margin: 0 }}>{err}</p>}
          <div className="mrow g8"><button type="button" className="btn btn-signal" disabled={busy} onClick={send} data-testid="pr-r-send">Send to Nm7</button><button type="button" className="btn btn-outline" onClick={() => { setOpen(false); setErr(''); }}>Cancel</button></div>
        </fieldset>
      )}
    </div>
  );
}

/** The first 90 days as a journey: joined, the day 7 and day 30 check-ins, day 90. */
function Journey({ j }) {
  const stops = [[1, 'Joined'], [7, 'Day 7 check-in'], [30, 'Day 30 check-in'], [90, 'First 90 days done']];
  const nowIdx = stops.findIndex(([d]) => j.day < d);
  return (
    <ol className="msteps wk-journey" aria-label="Your first 90 days">
      {stops.map(([d, l], i) => {
        const c = j.checkins[d] || j.checkins[String(d)];
        const done = i === 0 || j.day >= d;
        const state = done ? 'done' : i === nowIdx ? 'now' : '';
        return (
          <li key={d} className={state}>
            <span className="msteps-dot" aria-hidden="true">{done ? '✓' : i + 1}</span>
            <span className="stack" style={{ minWidth: 0 }}>
              <strong className="small">{l}</strong>
              <span className="xs muted">{i === 0 ? 'Day 1' : `Day ${d}`}{c ? ` · ${c.ok ? 'as promised' : 'reported to Nm7'}` : ''}{state === 'now' ? ' · next' : ''}</span>
            </span>
          </li>
        );
      })}
    </ol>
  );
}

function Joined({ j: start }) {
  const [j, setJ] = useState(start);
  const tick = async (item, done) => { try { setJ(await http(`/api/me/progress/joined/${j.id}/item`, { method: 'PUT', body: { item, done } })); } catch { /* keep as is */ } };
  const all = Object.values(j.checklist).flat();
  const done = all.filter((i) => i.done).length;
  return (
    <section className="mcard wk-joined" data-testid="pr-joined" aria-label={`${j.role} at ${j.company}`}>
      <header className="wk-joined-h">
        <span className="mavatar" aria-hidden="true">{(j.company || '?').slice(0, 1).toUpperCase()}</span>
        <span className="stack" style={{ minWidth: 0, flex: 1 }}><span className="mkicker">New job</span><strong className="wk-joined-t">{j.role} · {j.company}</strong></span>
        <span className="wk-day" data-testid="pr-day">Day {j.day}</span>
      </header>
      <Bar value={Math.min(j.day, 90)} max={90} label="Your first 90 days" showValue={false} />
      <div className="mgrid-2 wk-joined-grid">
        <div className="mstack">
          {j.due && <Checkin j={j} onDone={setJ} />}
          {Object.entries(j.checkins).map(([d, c]) => <span key={d} className="wk-ci"><Chip tone={c.ok ? 'ok' : 'warn'}>{c.ok ? 'OK' : 'Reported'}</Chip>Day {d} check-in: {c.ok ? 'as promised' : 'reported to Nm7'}</span>)}
          <div className="wk-check">
            <div className="mspread"><strong className="wk-legend">Checklist</strong><span className="xs muted">{done} of {all.length} done</span></div>
            {Object.entries(j.checklist).map(([part, items]) => (
              <fieldset key={part} className="wk-part">
                <legend className="wk-part-h">{PART[part]}<span className="xs muted"> · {items.filter((i) => i.done).length}/{items.length}</span></legend>
                {items.map((i) => <label key={i.id} className={`wk-item ${i.done ? 'on' : ''}`}><input type="checkbox" checked={i.done} onChange={() => tick(i.id, !i.done)} data-testid={`pr-item-${i.id}`} /><span>{i.text}</span></label>)}
              </fieldset>
            ))}
          </div>
        </div>
        <div className="mstack">
          <div className="wk-journey-box"><strong className="wk-legend">Your journey</strong><Journey j={j} /></div>
          <details className="wk-tipsbox"><summary>Probation tips</summary><ul className="wk-tips">{j.tips.map((t) => <li key={t}>{t}</li>)}</ul></details>
        </div>
      </div>
      {j.canReport && <Report j={j} onDone={setJ} />}
    </section>
  );
}

export default function MeProgress() {
  const [d, setD] = useState(null);
  const [f, setF] = useState(null);
  const [err, setErr] = useState('');
  const load = () => http('/api/me/progress').then(setD, (e) => setErr(e.message));
  useEffect(() => { load(); }, []);
  const add = async (e) => {
    e.preventDefault(); setErr('');
    try { await http('/api/me/progress/joined', { method: 'POST', body: f }); setF(null); load(); } catch (x) { setErr(x.message); }
  };
  if (!d) return <div className="stack g16"><MeHead title="My progress" />{err ? <p className="error" role="alert">{err}</p> : <Skel cards={2} label="Loading your progress" />}</div>;
  const w = d.week;
  const addBtn = <button type="button" className={`btn ${d.joined.length ? 'btn-outline' : 'btn-signal'}`} onClick={() => setF({ company: '', role: '', joinDate: '' })} data-testid="pr-add">I joined a job</button>;
  return (
    <div className="stack g16" data-testid="me-progress">
      <MeHead title="My progress" sub="Real numbers from your week, and help for your first 90 days in a new job." />
      <section className="mcard" aria-label="This week" data-testid="pr-week">
        <header className="mcard-h"><span className="mcard-ic" aria-hidden="true">↑</span><span className="mcard-ht"><h2 className="mcard-title">This week</h2><span className="mcard-sub">Counted from what you did on Nm7 in the last 7 days.</span></span></header>
        <div className="mgrid-3 wk-stats">
          <Stat label="Applications" value={w.applications} testid="pr-apps" />
          <Stat label="Interviews" value={w.interviews} />
          <Stat label="Skills verified" value={w.skillsVerified.length} sub={w.skillsVerified.length ? w.skillsVerified.join(', ') : undefined} />
          <Stat label="Readiness" value={`${w.readiness}%`} sub={w.readinessChange ? `${w.readinessChange > 0 ? '+' : ''}${w.readinessChange} this week` : undefined} tone={w.readinessChange > 0 ? 'ok' : w.readinessChange < 0 ? 'warn' : undefined} />
        </div>
        <p className="wk-message" data-testid="pr-message">{d.message}</p>
      </section>
      {d.joined.map((j) => <Joined key={j.id} j={j} />)}
      {!f ? (d.joined.length ? <div>{addBtn}</div> : (
        <Empty shape="handshake" tint="seeker" title="Started a new job?" action={addBtn}>Add it here for a first-90-days checklist, probation tips and check-ins on day 7 and day 30.</Empty>
      )) : (
        <MeCard as="form" title="I joined a job" sub="We use the joining date to plan your check-ins." icon="＋" onSubmit={add} testid="pr-add-form">
          <div className="mfields-body">
            <label className="field"><span className="label">Company</span><input className="input" required maxLength={120} value={f.company} onChange={(e) => setF({ ...f, company: e.target.value })} data-testid="pr-company" /></label>
            <label className="field"><span className="label">Role</span><input className="input" required maxLength={120} value={f.role} onChange={(e) => setF({ ...f, role: e.target.value })} data-testid="pr-role" /></label>
            <label className="field"><span className="label">Joining date</span><input className="input" type="date" required value={f.joinDate} onChange={(e) => setF({ ...f, joinDate: e.target.value })} data-testid="pr-date" /></label>
          </div>
          {err && <p className="error" role="alert">{err}</p>}
          <div className="mrow g8"><button type="submit" className="btn btn-signal" data-testid="pr-save">Save</button><button type="button" className="btn btn-outline" onClick={() => setF(null)}>Cancel</button></div>
        </MeCard>
      )}
    </div>
  );
}
