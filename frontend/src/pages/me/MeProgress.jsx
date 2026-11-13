// My progress (Phase 6, S10). While searching: this week's real numbers (applications, interviews, skills verified,
// readiness change) and an honest, kind message. After joining a job: a first-90-days checklist (week 1, month 1,
// month 3), probation tips, and check-ins on day 7 and day 30 ("Is the job what was promised?"); a "No" goes to Nm7
// privately, and reports from more than one person lower that company's trust score.
import { useEffect, useState } from 'react';
import { http } from '../../services/http';
import { MeHead } from './MeLayout';

const PROBLEMS = [['salary', 'Pay is lower than promised'], ['role', 'The work is different'], ['hours', 'Hours are longer'], ['location', 'A different place'], ['safety', "I don't feel safe"], ['other', 'Something else']];
const PART = { week1: 'Week 1', month1: 'Month 1', month3: 'Month 3' };

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
    <div className="card-sm stack g8" data-testid="pr-checkin">
      <strong className="small">Day {j.due} check-in: is the job what was promised?</strong>
      {!no ? (
        <div className="row g8"><button type="button" className="btn btn-ink btn-sm" onClick={() => send(true)} data-testid="pr-yes">Yes</button><button type="button" className="btn btn-outline btn-sm" onClick={() => setNo(true)} data-testid="pr-no">No</button></div>
      ) : (
        <div className="stack g8">
          <span className="xs muted">Only Nm7 sees this. The company is not told who wrote it.</span>
          <div className="row g8" style={{ flexWrap: 'wrap' }}>{PROBLEMS.map(([k, l]) => <label key={k} className="row g4 small"><input type="checkbox" checked={probs.includes(k)} onChange={() => setProbs(probs.includes(k) ? probs.filter((x) => x !== k) : [...probs, k])} data-testid={`pr-p-${k}`} />{l}</label>)}</div>
          <label className="field"><span className="label">What happened (optional)</span><textarea className="input" rows={2} maxLength={1000} value={note} onChange={(e) => setNote(e.target.value)} /></label>
          <button type="button" className="btn btn-ink btn-sm" style={{ alignSelf: 'flex-start' }} onClick={() => send(false)} data-testid="pr-report">Tell Nm7</button>
        </div>
      )}
      {err && <p className="error" role="alert">{err}</p>}
    </div>
  );
}

function Joined({ j: start }) {
  const [j, setJ] = useState(start);
  const tick = async (item, done) => { try { setJ(await http(`/api/me/progress/joined/${j.id}/item`, { method: 'PUT', body: { item, done } })); } catch { /* keep as is */ } };
  return (
    <section className="card stack g8" data-testid="pr-joined">
      <div className="row between g8" style={{ flexWrap: 'wrap' }}><strong>{j.role} · {j.company}</strong><span className="badge b-neutral" data-testid="pr-day">Day {j.day}</span></div>
      {j.due && <Checkin j={j} onDone={setJ} />}
      {Object.entries(j.checkins).map(([d, c]) => <span key={d} className="xs muted">Day {d} check-in: {c.ok ? 'as promised' : 'reported to Nm7'}</span>)}
      {Object.entries(j.checklist).map(([part, items]) => (
        <fieldset key={part} className="stack g4" style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}>
          <legend className="small" style={{ fontWeight: 600 }}>{PART[part]}</legend>
          {items.map((i) => <label key={i.id} className="row g8 small" style={{ alignItems: 'flex-start' }}><input type="checkbox" checked={i.done} onChange={() => tick(i.id, !i.done)} style={{ marginTop: 3 }} data-testid={`pr-item-${i.id}`} /><span>{i.text}</span></label>)}
        </fieldset>
      ))}
      <details className="small"><summary>Probation tips</summary><ul style={{ margin: '6px 0 0', paddingLeft: 18 }}>{j.tips.map((t) => <li key={t}>{t}</li>)}</ul></details>
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
  if (!d) return <div className="stack g16"><MeHead title="My progress" />{err ? <p className="error" role="alert">{err}</p> : <p className="muted">Loading…</p>}</div>;
  const w = d.week;
  return (
    <div className="stack g16" data-testid="me-progress">
      <MeHead title="My progress" sub="Real numbers from your week, and help for your first 90 days in a new job." />
      <section className="card stack g8" aria-label="This week" data-testid="pr-week">
        <strong>This week</strong>
        <div className="row g16" style={{ flexWrap: 'wrap' }}>
          <span className="small"><strong data-testid="pr-apps">{w.applications}</strong> applications</span>
          <span className="small"><strong>{w.interviews}</strong> interviews</span>
          <span className="small"><strong>{w.skillsVerified.length}</strong> skills verified{w.skillsVerified.length ? ` (${w.skillsVerified.join(', ')})` : ''}</span>
          <span className="small">Readiness <strong>{w.readiness}%</strong>{w.readinessChange ? ` (${w.readinessChange > 0 ? '+' : ''}${w.readinessChange})` : ''}</span>
        </div>
        <p className="small" style={{ margin: 0 }} data-testid="pr-message">{d.message}</p>
      </section>
      {d.joined.map((j) => <Joined key={j.id} j={j} />)}
      {!f ? <button type="button" className="btn btn-outline btn-sm" style={{ alignSelf: 'flex-start' }} onClick={() => setF({ company: '', role: '', joinDate: '' })} data-testid="pr-add">I joined a job</button> : (
        <form className="card stack g8" onSubmit={add} data-testid="pr-add-form">
          <div className="co-grid">
            <label className="field"><span className="label">Company</span><input className="input" required maxLength={120} value={f.company} onChange={(e) => setF({ ...f, company: e.target.value })} data-testid="pr-company" /></label>
            <label className="field"><span className="label">Role</span><input className="input" required maxLength={120} value={f.role} onChange={(e) => setF({ ...f, role: e.target.value })} data-testid="pr-role" /></label>
            <label className="field"><span className="label">Joining date</span><input className="input" type="date" required value={f.joinDate} onChange={(e) => setF({ ...f, joinDate: e.target.value })} data-testid="pr-date" /></label>
          </div>
          {err && <p className="error" role="alert">{err}</p>}
          <div className="row g8"><button type="submit" className="btn btn-ink btn-sm" data-testid="pr-save">Save</button><button type="button" className="btn btn-outline btn-sm" onClick={() => setF(null)}>Cancel</button></div>
        </form>
      )}
    </div>
  );
}
