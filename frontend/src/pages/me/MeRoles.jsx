// Role finder (Phase 6, S1): ten simple questions → three roles that fit, each with plain reasons, what to learn, a
// typical starting salary from Nm7's own job data (only with enough jobs; otherwise "Not enough data yet"), live jobs
// and a "Start learning path" button (S2) and the role's skill check. Rules decide the roles; AI only words the reasons (checked, with the rules' words
// as fallback). Retake any time; answers are saved to the profile and feed Auto Apply's role suggestions.
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { http } from '../../services/http';
import { MeHead } from './MeLayout';
import { Bar, Chip, Empty, FieldGroup, MeCard, Skel, StickyBar } from './kit';
import '../../styles/me-learn.css';

const STUDIES = { '10th': '10th pass', '12th': '12th / Inter', iti: 'ITI', diploma: 'Diploma', graduate: 'Degree (BA, BCom, BSc, BTech…)', postgraduate: 'Master’s degree' };
const STYLES = { people: 'With people', numbers: 'With numbers', machines: 'With machines and tools', computers: 'On a computer', outdoors: 'Outdoors, moving around' };
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
const rupees = (n) => `₹${Math.round(n).toLocaleString('en-IN')}`;
const EMPTY = { studies: '', branch: '', likes: [], strengths: [], style: '', secondStyle: '', city: '', salaryNeed: '', languages: ['English'], laptop: null, hoursWeek: '5' };
const Qn = ({ n }) => <span className="ml-qn" aria-hidden="true">{n}</span>;

/** Chips you can tick, up to `max`. */
function Pick({ n, label, hint, options, value, max, onChange, testid }) {
  const flip = (o) => onChange(value.includes(o) ? value.filter((x) => x !== o) : value.length < max ? [...value, o] : value);
  return (
    <fieldset className="ml-q full" style={{ border: 0, padding: 0, margin: 0 }} data-testid={testid}>
      <legend className="label"><Qn n={n} />{label}{hint && <span className="xs muted" style={{ fontWeight: 600 }}> · {hint}</span>}</legend>
      <div className="ml-picks">
        {options.map((o) => (
          <button key={o} type="button" className="ml-pick" aria-pressed={value.includes(o)} onClick={() => flip(o)}>{value.includes(o) ? '✓ ' : ''}{cap(o)}</button>
        ))}
      </div>
    </fieldset>
  );
}

function Role({ r, i }) {
  const known = r.have.length + r.learn.length;
  return (
    <li className="mcard ml-role" data-testid="rf-role">
      <div className="mrow" style={{ alignItems: 'flex-start', flexWrap: 'nowrap' }}>
        <span className="ml-rank" aria-hidden="true">{i + 1}</span>
        <div className="stack g4" style={{ minWidth: 0, flex: 1 }}>
          <h2 className="ml-role-title"><span className="sr-only">{i + 1}. </span>{r.title}</h2>
          <span><Chip tone="accent">{r.domain}</Chip></span>
        </div>
      </div>
      <p className="ml-why" data-testid="rf-why">{r.why}</p>
      {r.notes.map((n) => <p key={n} className="ml-note">⚠ {n}</p>)}
      {known > 0 && <Bar value={r.have.length} max={known} label="Main skills you already have" tone="student" />}
      <div className="stack g4">
        <span className="ml-box-h">Learn</span>
        {r.learn.length ? <span className="ml-tags">{r.learn.map((x) => <span key={x} className="ml-tag">{x}</span>)}</span> : <span className="small">You already have the main skills. Prove them with a skill check.</span>}
        {r.have.length > 0 && <span className="ml-tags" aria-label="On your resume already"><span className="xs muted" style={{ alignSelf: 'center' }}>On your resume already:</span>{r.have.map((x) => <span key={x} className="ml-tag have">✓ {x}</span>)}</span>}
      </div>
      <div className="ml-box" data-testid="rf-salary">
        <span className="ml-box-h">Typical starting salary</span>
        <strong className="mserif" style={{ fontSize: 20, color: 'var(--ink)' }}>{r.salary ? `${rupees(r.salary.min)}–${rupees(r.salary.max)} a month` : 'Not enough data yet'}</strong>
        {r.salary && <span className="xs muted">{r.salary.city ? `in ${r.salary.city}` : '(all India)'} · based on {r.salary.jobs} jobs in the last {r.salary.days} days</span>}
      </div>
      <div className="stack g4">
        <span className="ml-box-h">Live jobs</span>
        {r.jobs.length ? (
          <ul className="ml-jobs">
            {r.jobs.map((j) => <li key={j.id}><Link to={`/jobs/${j.slug}`}>{j.title}</Link>{j.company ? ` · ${j.company}` : ''}{j.where ? ` · ${j.where}` : ''}</li>)}
          </ul>
        ) : <span className="xs muted">No live jobs for this role right now. Auto Apply can watch for them.</span>}
      </div>
      <div className="ml-actions">
        <Link className="btn btn-signal" to={`/me/learn?role=${encodeURIComponent(r.id)}`} data-testid="rf-learn">Start learning path</Link>
        {r.test && <Link className="btn btn-outline" to={`/me/skill-checks?skill=${encodeURIComponent(r.test)}`}>Skill check: {r.test}</Link>}
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
  const answered = [a.studies, a.branch, a.likes.length, a.strengths.length, a.style, a.city, a.salaryNeed, a.languages.length, a.laptop !== null, a.hoursWeek].filter(Boolean).length;
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
  if (!d) return <div className="stack g16"><MeHead title="Find my role" />{err ? <p className="error" role="alert">{err}</p> : <Skel cards={3} label="Loading your roles" />}</div>;
  const q = d.questions;
  return (
    <div className="stack g16" data-testid="me-roles">
      <MeHead title="Find my role" sub="Ten simple questions. We suggest three jobs that fit you, what to learn for free, and live jobs." />
      {!edit && d.roles.length > 0 && (
        <>
          <MeCard tone="accent" className="ml-hero" title={null}>
            <div className="stack g4">
              <span className="mkicker">Your top {d.roles.length} roles</span>
              <h2 className="ml-hero-title">Jobs that fit what you told us</h2>
              <p className="ml-hero-text">Suggestions only, from your answers. Salaries come from real jobs on Nm7; we never guess them.</p>
            </div>
            <div className="ml-actions">
              <button type="button" className="btn btn-outline" onClick={() => setEdit(true)} data-testid="rf-retake">Change my answers</button>
              <Link className="btn btn-outline" to="/me/auto-apply">Use these roles in Auto Apply</Link>
            </div>
          </MeCard>
          <ol className="mgrid" style={{ listStyle: 'none', padding: 0, margin: 0 }}>{d.roles.map((r, i) => <Role key={r.id} r={r} i={i} />)}</ol>
        </>
      )}
      {!edit && !d.roles.length && (
        <Empty shape="cap" tint="student" title="No role fits these answers yet" action={<button type="button" className="btn btn-signal" onClick={() => setEdit(true)}>Change my answers</button>}>
          Try different likes or a second way of working. It takes a minute.
        </Empty>
      )}
      {edit && (
        <form className="mcard" onSubmit={submit} data-testid="rf-form" aria-label="Your answers">
          <header className="mcard-h">
            <span className="mcard-ic student" aria-hidden="true">?</span>
            <span className="mcard-ht"><h2 className="mcard-title">Ten simple questions</h2><span className="mcard-sub">Only the first, fifth and ninth are needed. The more you answer, the better the match.</span></span>
          </header>
          <Bar value={answered} max={10} label="Answered" tone="student" />
          <FieldGroup title="About you">
            <label className="field ml-q"><span className="label"><Qn n={1} />What did you study? (highest, finished or nearly)</span>
              <select className="input" value={a.studies} onChange={(e) => set('studies')(e.target.value)} data-testid="rf-studies">
                <option value="">Choose…</option>
                {q.studies.map((s) => <option key={s} value={s}>{STUDIES[s] || s}</option>)}
              </select>
            </label>
            <label className="field ml-q"><span className="label"><Qn n={2} />Your branch or group (optional)</span>
              <input className="input" maxLength={80} value={a.branch} onChange={(e) => set('branch')(e.target.value)} placeholder="e.g. B.Com, ITI Electrician, CSE, MPC" data-testid="rf-branch" />
            </label>
          </FieldGroup>
          <FieldGroup title="What you like" help="Tap to choose. Tap again to remove.">
            <Pick n={3} label="Subjects or tasks you like" hint="Up to 5" options={q.likes} value={a.likes} max={5} onChange={set('likes')} testid="rf-likes" />
            <Pick n={4} label="What are you good at?" hint="Up to 3" options={q.strengths} value={a.strengths} max={3} onChange={set('strengths')} testid="rf-strengths" />
            <label className="field ml-q"><span className="label"><Qn n={5} />How do you like to work most?</span>
              <select className="input" value={a.style} onChange={(e) => set('style')(e.target.value)} data-testid="rf-style">
                <option value="">Choose…</option>
                {q.styles.map((s) => <option key={s} value={s}>{STYLES[s]}</option>)}
              </select>
            </label>
            <label className="field ml-q"><span className="label">…and second? (optional)</span>
              <select className="input" value={a.secondStyle} onChange={(e) => set('secondStyle')(e.target.value)}>
                <option value="">None</option>
                {q.styles.filter((s) => s !== a.style).map((s) => <option key={s} value={s}>{STYLES[s]}</option>)}
              </select>
            </label>
          </FieldGroup>
          <FieldGroup title="Work and learning">
            <label className="field ml-q"><span className="label"><Qn n={6} />City where you want to work (optional)</span>
              <input className="input" maxLength={60} value={a.city} onChange={(e) => set('city')(e.target.value)} placeholder="e.g. Hyderabad" data-testid="rf-city" />
            </label>
            <label className="field ml-q"><span className="label"><Qn n={7} />Salary you need to start, ₹ a month (optional)</span>
              <input className="input" inputMode="numeric" value={a.salaryNeed} onChange={(e) => set('salaryNeed')(e.target.value.replace(/\D/g, '').slice(0, 6))} placeholder="e.g. 15000" />
            </label>
            <Pick n={8} label="Languages you speak well" options={q.languages} value={a.languages} max={3} onChange={set('languages')} testid="rf-langs" />
            <fieldset className="ml-q" style={{ border: 0, padding: 0, margin: 0 }}>
              <legend className="label"><Qn n={9} />Do you have a laptop or computer to learn on?</legend>
              <div className="ml-seg">
                {[[true, 'Yes'], [false, 'No']].map(([v, l]) => <label key={l}><input type="radio" name="rf-laptop" checked={a.laptop === v} onChange={() => set('laptop')(v)} data-testid={`rf-laptop-${l.toLowerCase()}`} />{l}</label>)}
              </div>
            </fieldset>
            <label className="field ml-q"><span className="label"><Qn n={10} />Hours a week you can spend learning</span>
              <input className="input" inputMode="numeric" style={{ maxWidth: 140 }} value={a.hoursWeek} onChange={(e) => set('hoursWeek')(e.target.value.replace(/\D/g, '').slice(0, 2))} data-testid="rf-hours" />
            </label>
          </FieldGroup>
          {err && <p className="error" role="alert">{err}</p>}
          <StickyBar label="Show my roles">
            <button type="submit" className="btn btn-signal" disabled={busy} data-testid="rf-find">{busy ? 'Finding…' : 'Show my roles'}</button>
            {d.roles.length > 0 && <button type="button" className="btn btn-outline" onClick={() => setEdit(false)}>Cancel</button>}
          </StickyBar>
        </form>
      )}
    </div>
  );
}
