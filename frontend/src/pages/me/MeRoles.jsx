// Role finder (Phase 6, S1): ten simple questions → three roles that fit, each with plain reasons, what to learn, a
// typical starting salary from Nm7's own job data (only with enough jobs; otherwise "Not enough data yet"), live jobs
// and a link to the role's skill check (S2 adds the learning path). Rules decide the roles; AI only words the reasons (checked, with the rules' words
// as fallback). Retake any time; answers are saved to the profile and feed Auto Apply's role suggestions.
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { http } from '../../services/http';
import { MeHead } from './MeLayout';

const STUDIES = { '10th': '10th pass', '12th': '12th / Inter', iti: 'ITI', diploma: 'Diploma', graduate: 'Degree (BA, BCom, BSc, BTech…)', postgraduate: 'Master’s degree' };
const STYLES = { people: 'With people', numbers: 'With numbers', machines: 'With machines and tools', computers: 'On a computer', outdoors: 'Outdoors, moving around' };
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
const rupees = (n) => `₹${Math.round(n).toLocaleString('en-IN')}`;
const EMPTY = { studies: '', branch: '', likes: [], strengths: [], style: '', secondStyle: '', city: '', salaryNeed: '', languages: ['English'], laptop: null, hoursWeek: '5' };

/** Chips you can tick, up to `max`. */
function Pick({ label, hint, options, value, max, onChange, testid }) {
  const flip = (o) => onChange(value.includes(o) ? value.filter((x) => x !== o) : value.length < max ? [...value, o] : value);
  return (
    <fieldset className="field" style={{ border: 0, padding: 0, margin: 0 }} data-testid={testid}>
      <legend className="label">{label}</legend>
      {hint && <span className="xs muted">{hint}</span>}
      <div className="row g4" style={{ flexWrap: 'wrap', marginTop: 6 }}>
        {options.map((o) => (
          <button key={o} type="button" className={`badge ${value.includes(o) ? 'b-signal' : 'b-neutral'}`} aria-pressed={value.includes(o)} onClick={() => flip(o)} style={{ cursor: 'pointer', border: 0 }}>{value.includes(o) ? '✓ ' : ''}{cap(o)}</button>
        ))}
      </div>
    </fieldset>
  );
}

function Role({ r, i }) {
  return (
    <li className="card stack g8" data-testid="rf-role">
      <div className="row between g8" style={{ flexWrap: 'wrap' }}>
        <strong style={{ fontSize: 18 }}>{i + 1}. {r.title}</strong>
        <span className="badge b-neutral">{r.domain}</span>
      </div>
      <p className="small" style={{ margin: 0 }} data-testid="rf-why">{r.why}</p>
      {r.notes.map((n) => <p key={n} className="xs muted" style={{ margin: 0 }}>⚠ {n}</p>)}
      <span className="small"><strong>Learn: </strong>{r.learn.length ? r.learn.join(', ') : 'You already have the main skills. Prove them with a skill check.'}</span>
      {r.have.length > 0 && <span className="xs muted">On your resume already: {r.have.join(', ')}</span>}
      <span className="small" data-testid="rf-salary">
        <strong>Typical starting salary: </strong>
        {r.salary ? `${rupees(r.salary.min)}–${rupees(r.salary.max)} a month${r.salary.city ? ` in ${r.salary.city}` : ' (all India)'} · based on ${r.salary.jobs} jobs in the last ${r.salary.days} days` : 'Not enough data yet'}
      </span>
      <div className="stack g4">
        <strong className="small">Live jobs</strong>
        {r.jobs.length ? (
          <ul className="stack g4" style={{ margin: 0, paddingLeft: 18 }}>
            {r.jobs.map((j) => <li key={j.id} className="small"><Link to={`/jobs/${j.slug}`}>{j.title}</Link>{j.company ? ` · ${j.company}` : ''}{j.where ? ` · ${j.where}` : ''}</li>)}
          </ul>
        ) : <span className="xs muted">No live jobs for this role right now. Auto Apply can watch for them.</span>}
      </div>
      <div className="row g8" style={{ flexWrap: 'wrap' }}>
        {r.test && <Link className="btn btn-outline btn-sm" to="/me/skill-checks">Skill check: {r.test}</Link>}
      </div>
    </li>
  );
}

export default function MeRoles() {
  const [d, setD] = useState(null);
  const [a, setA] = useState(EMPTY);
  const [edit, setEdit] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  useEffect(() => {
    http('/api/me/roles').then((r) => {
      setD(r);
      if (r.answers) {
        const x = r.answers;
        setA({ studies: x.studies, branch: x.branch || '', likes: x.likes || [], strengths: x.strengths || [], style: x.style, secondStyle: x.second_style || '', city: x.city || '', salaryNeed: x.salary_need ? String(x.salary_need) : '', languages: x.languages || [], laptop: !!x.laptop, hoursWeek: String(x.hours_week || 5) });
      } else setEdit(true);
    }, (e) => setErr(e.message));
  }, []);
  const set = (k) => (v) => setA((p) => ({ ...p, [k]: v }));
  const ready = a.studies && a.style && a.laptop !== null;
  const submit = async (e) => {
    e.preventDefault();
    if (!ready) { setErr('Please answer what you studied, how you like to work, and the laptop question.'); return; }
    setBusy(true); setErr('');
    try {
      const body = { ...a, salaryNeed: Number(a.salaryNeed) || 0, hoursWeek: Math.min(60, Math.max(1, Number(a.hoursWeek) || 5)), city: a.city.trim(), branch: a.branch.trim() };
      setD(await http('/api/me/roles', { method: 'POST', body }));
      setEdit(false);
      window.scrollTo?.(0, 0);
    } catch (x) { setErr(x.message); } finally { setBusy(false); }
  };
  if (!d) return <div className="stack g16"><MeHead title="Find my role" />{err ? <p className="error" role="alert">{err}</p> : <p className="muted">Loading…</p>}</div>;
  const q = d.questions;
  return (
    <div className="stack g16" data-testid="me-roles">
      <MeHead title="Find my role" sub="Ten simple questions. We suggest three jobs that fit you, what to learn for free, and live jobs." />
      {!edit && d.roles.length > 0 && (
        <>
          <ol className="stack g12" style={{ listStyle: 'none', padding: 0, margin: 0 }}>{d.roles.map((r, i) => <Role key={r.id} r={r} i={i} />)}</ol>
          <div className="row g8" style={{ flexWrap: 'wrap' }}>
            <button type="button" className="btn btn-outline" onClick={() => setEdit(true)} data-testid="rf-retake">Change my answers</button>
            <Link className="btn btn-outline" to="/me/auto-apply">Use these roles in Auto Apply</Link>
          </div>
          <span className="xs muted">Suggestions only, from your answers. Salaries come from real jobs on Nm7; we never guess them.</span>
        </>
      )}
      {!edit && !d.roles.length && <p className="small">No role fits these answers yet. <button type="button" className="btn btn-outline btn-sm" onClick={() => setEdit(true)}>Change my answers</button></p>}
      {edit && (
        <form className="card stack g16" onSubmit={submit} data-testid="rf-form">
          <label className="field"><span className="label">1. What did you study? (highest, finished or nearly)</span>
            <select className="input" value={a.studies} onChange={(e) => set('studies')(e.target.value)} data-testid="rf-studies">
              <option value="">Choose…</option>
              {q.studies.map((s) => <option key={s} value={s}>{STUDIES[s] || s}</option>)}
            </select>
          </label>
          <label className="field"><span className="label">2. Your branch or group (optional)</span>
            <input className="input" maxLength={80} value={a.branch} onChange={(e) => set('branch')(e.target.value)} placeholder="e.g. B.Com, ITI Electrician, CSE, MPC" data-testid="rf-branch" />
          </label>
          <Pick label="3. Subjects or tasks you like" hint="Up to 5" options={q.likes} value={a.likes} max={5} onChange={set('likes')} testid="rf-likes" />
          <Pick label="4. What are you good at?" hint="Up to 3" options={q.strengths} value={a.strengths} max={3} onChange={set('strengths')} testid="rf-strengths" />
          <label className="field"><span className="label">5. How do you like to work most?</span>
            <select className="input" value={a.style} onChange={(e) => set('style')(e.target.value)} data-testid="rf-style">
              <option value="">Choose…</option>
              {q.styles.map((s) => <option key={s} value={s}>{STYLES[s]}</option>)}
            </select>
          </label>
          <label className="field"><span className="label">…and second? (optional)</span>
            <select className="input" value={a.secondStyle} onChange={(e) => set('secondStyle')(e.target.value)}>
              <option value="">None</option>
              {q.styles.filter((s) => s !== a.style).map((s) => <option key={s} value={s}>{STYLES[s]}</option>)}
            </select>
          </label>
          <label className="field"><span className="label">6. City where you want to work (optional)</span>
            <input className="input" maxLength={60} value={a.city} onChange={(e) => set('city')(e.target.value)} placeholder="e.g. Hyderabad" data-testid="rf-city" />
          </label>
          <label className="field"><span className="label">7. Salary you need to start, ₹ a month (optional)</span>
            <input className="input" inputMode="numeric" value={a.salaryNeed} onChange={(e) => set('salaryNeed')(e.target.value.replace(/\D/g, '').slice(0, 6))} placeholder="e.g. 15000" />
          </label>
          <Pick label="8. Languages you speak well" options={q.languages} value={a.languages} max={3} onChange={set('languages')} testid="rf-langs" />
          <fieldset className="field" style={{ border: 0, padding: 0, margin: 0 }}>
            <legend className="label">9. Do you have a laptop or computer to learn on?</legend>
            <div className="row g8">
              {[[true, 'Yes'], [false, 'No']].map(([v, l]) => <label key={l} className="row g4 small"><input type="radio" name="rf-laptop" checked={a.laptop === v} onChange={() => set('laptop')(v)} data-testid={`rf-laptop-${l.toLowerCase()}`} />{l}</label>)}
            </div>
          </fieldset>
          <label className="field"><span className="label">10. Hours a week you can spend learning</span>
            <input className="input" inputMode="numeric" style={{ maxWidth: 120 }} value={a.hoursWeek} onChange={(e) => set('hoursWeek')(e.target.value.replace(/\D/g, '').slice(0, 2))} data-testid="rf-hours" />
          </label>
          {err && <p className="error" role="alert">{err}</p>}
          <div className="row g8" style={{ flexWrap: 'wrap' }}>
            <button type="submit" className="btn btn-ink" disabled={busy} data-testid="rf-find">{busy ? 'Finding…' : 'Show my roles'}</button>
            {d.roles.length > 0 && <button type="button" className="btn btn-outline" onClick={() => setEdit(false)}>Cancel</button>}
          </div>
        </form>
      )}
    </div>
  );
}
