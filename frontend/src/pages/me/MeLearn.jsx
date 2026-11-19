// Learning paths with proof (Phase 6, S2). /me/learn lists my paths and the ones I can start (the role finder's
// first); /me/learn?role=<id> opens one: free courses in order ("I finished this" is progress only, never a skill),
// a small guided project (send a link or a few lines), then the role's skill check. "Skill verified" shows only when
// the check is passed and the project is sent; companies hiring now and the public resume link see it, with the date.
import { useVettingOn } from '../../lib/vettingAccess';
import { Suspense, lazy, useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { http } from '../../services/http';
import { MeHead } from './MeLayout';
import { LIVE, useAuth } from '../../lib/auth';
import ResumeCard from '../start/ResumeCard'; // profile setup P1: "Pick up where you left off"

const SetupChecklist = lazy(() => import('./SetupChecklist')); // profile setup P2: the checklist, its own chunk
import { Bar, Chip, Empty, MeCard, Skel } from './kit';
import '../../styles/me-learn.css';

const day = (ms) => (ms ? new Date(ms).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '');

function Project({ role, p, onDone }) {
  const [link, setLink] = useState(p.sent.link || '');
  const [text, setText] = useState(p.sent.text || '');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const send = async (e) => {
    e.preventDefault();
    setBusy(true); setErr('');
    try { onDone(await http(`/api/me/learn/${role}/project`, { method: 'POST', body: p.submit === 'link' ? { link: link.trim(), text } : { text } })); } catch (x) { setErr(x.message); } finally { setBusy(false); }
  };
  return (
    <form className="mcard ml-step-card" onSubmit={send} data-testid="lp-project" aria-label="Project">
      <span className="ml-qno">Step 2 · Project</span>
      <h3 className="ml-step-title">{p.title}</h3>
      <p className="small" style={{ margin: 0 }}>{p.brief}</p>
      {(p.steps || []).length > 0 && (
        <ol className="msteps" style={{ marginTop: 4 }}>
          {p.steps.map((s, k) => <li key={s}><span className="msteps-dot" aria-hidden="true">{k + 1}</span><span className="small" style={{ paddingTop: 5 }}>{s}</span></li>)}
        </ol>
      )}
      <span className="xs muted">Free to do. Nobody pays you or asks you to pay for this; it is your own practice work.</span>
      {p.submit === 'link'
        ? <label className="field"><span className="label">Link to your work (sheet, document, GitHub…)</span><input className="input" type="url" maxLength={500} value={link} onChange={(e) => setLink(e.target.value)} placeholder="https://" data-testid="lp-link" /></label>
        : <label className="field"><span className="label">Your answer</span><textarea className="input" rows={5} maxLength={4000} value={text} onChange={(e) => setText(e.target.value)} data-testid="lp-text" /></label>}
      {err && <p className="error" role="alert">{err}</p>}
      <div className="mrow">
        <button type="submit" className="btn btn-signal" disabled={busy} data-testid="lp-send">{p.sent.at ? 'Update my project' : 'Send my project'}</button>
        {p.sent.at && <Chip tone="ok" testid="lp-sent">✓ Sent {day(p.sent.at)}</Chip>}
      </div>
    </form>
  );
}

function Path({ role }) {
  const vet = useVettingOn(); // Vetting V2 wording only for people who get it (Admin → Skill checks → Launch)
  const [d, setD] = useState(null);
  const [err, setErr] = useState('');
  useEffect(() => { http(`/api/me/learn/${role}`).then(setD, (e) => setErr(e.message)); }, [role]);
  if (err) return <p className="error" role="alert">{err}</p>;
  if (!d) return <Skel cards={1} lines={4} label="Loading the path" />;
  const tick = async (c) => { try { setD(await http(`/api/me/learn/${role}/course`, { method: 'PUT', body: { courseId: c.id, done: !c.done } })); } catch (e) { setErr(e.message); } };
  const start = async () => { try { setD(await http(`/api/me/learn/${role}/start`, { method: 'POST' })); } catch (e) { setErr(e.message); } };
  const t = d.test;
  const coursesDone = d.courses.length > 0 && d.courses.every((c) => c.done);
  const sent = !!d.project?.sent?.at;
  const state = (done, now) => (done ? 'done' : now ? 'now' : '');
  return (
    <div className="stack g16" data-testid="lp-path">
      <MeCard tone="accent" title={null} label={d.title}>
        <div className="mspread" style={{ alignItems: 'flex-start' }}>
          <div className="stack g4" style={{ minWidth: 0 }}>
            <span className="mkicker">Learning path</span>
            <h2 className="ml-hero-title">{d.title}</h2>
          </div>
          {d.verified ? <Chip tone="ok" testid="lp-badge">✓ Skill verified: {d.verified.skill} · {day(d.verified.at)}</Chip> : <strong className="mserif" style={{ fontSize: 28, color: 'var(--ink)' }} data-testid="lp-pct">{d.progress}% done</strong>}
        </div>
        <Bar value={d.progress} label="Progress" showValue={false} tone="student" />
        <ol className="ml-track" aria-label="Steps">
          <li className={coursesDone ? 'done' : ''}>Free courses</li>
          <li className={sent ? 'done' : ''}>Project</li>
          <li className={d.verified ? 'done' : ''}>Skill check</li>
          <li className={d.verified ? 'done' : ''}>Skill verified</li>
        </ol>
        {!d.started && <div><button type="button" className="btn btn-signal" onClick={start} data-testid="lp-start">Start this path (free)</button></div>}
      </MeCard>
      {d.started && (
        <ol className="msteps">
          <li className={state(coursesDone, !coursesDone)}>
            <span className="msteps-dot" aria-hidden="true">{coursesDone ? '✓' : 1}</span>
            <section className="mcard ml-step-card" aria-label="Courses" data-testid="lp-courses">
              <span className="ml-qno">Step 1 · Free courses</span>
              <span className="xs muted">Ticking a course moves your progress. It doesn't add a skill to your resume: the skill check and the project prove it.</span>
              <ul className="mlist">
                {d.courses.map((c) => (
                  <li key={c.id} className={`ml-check ${c.done ? 'done' : ''}`} data-testid="lp-course">
                    <input type="checkbox" checked={c.done} onChange={() => tick(c)} aria-label={`I finished ${c.title}`} />
                    <span className="stack g4" style={{ minWidth: 0 }}>
                      <a href={c.url} target="_blank" rel="noopener noreferrer">{c.title}</a>
                      <span className="xs muted">{c.skill} · {c.provider}{c.hours ? ` · about ${c.hours} h` : ''}</span>
                    </span>
                  </li>
                ))}
              </ul>
              {d.missingCourses.length > 0 && <span className="xs muted">No free course listed yet for {d.missingCourses.join(', ')}. NPTEL and SWAYAM have free courses for many skills.</span>}
            </section>
          </li>
          <li className={state(sent, coursesDone && !sent)}>
            <span className="msteps-dot" aria-hidden="true">{sent ? '✓' : 2}</span>
            <Project role={role} p={d.project} onDone={setD} />
          </li>
          <li className={state(!!d.verified, sent && !d.verified)}>
            <span className="msteps-dot" aria-hidden="true">{d.verified ? '✓' : 3}</span>
            <section className="mcard ml-step-card" aria-label="Skill check" data-testid="lp-check">
              <span className="ml-qno">Step 3 · Skill check</span>
              {t.skill ? (
                <>
                  <span className="small">{vet
                    ? <>The {t.skill} skill check: about 15 minutes, 18 questions, then a short practical task. Pass mark {t.pass}.{t.best ? ` Your best: ${t.best.score}/100.` : ''}</>
                    : <>The {t.skill} skill check: 10 minutes, 10 questions. Pass mark {t.pass}%.{t.best ? ` Your best: ${t.best.score}%.` : ''}</>}</span>
                  {t.best && <Bar value={t.best.score} label="Your best" tone={t.best.score >= t.pass ? 'ok' : 'warn'} />}
                  <div className="ml-actions">
                    <Link className="btn btn-outline" to="/me/practice">Practise first (free)</Link>
                    <Link className="btn btn-signal" to={`/me/skill-checks?skill=${encodeURIComponent(t.skill)}`}>Open the skill check</Link>
                  </div>
                  <span className="xs muted">Practice tests never count; only the official check does.</span>
                </>
              ) : <span className="small">This role has no skill check yet, so no badge for now. The courses and the project still help.</span>}
            </section>
          </li>
        </ol>
      )}
      <Link to="/me/learn" className="small" style={{ minHeight: 44, display: 'inline-flex', alignItems: 'center' }}>← All learning paths</Link>
    </div>
  );
}

export default function MeLearn() {
  const [q] = useSearchParams();
  const role = q.get('role');
  const { user } = useAuth();
  const [d, setD] = useState(null);
  const [err, setErr] = useState('');
  useEffect(() => { if (!role) http('/api/me/learn').then(setD, (e) => setErr(e.message)); }, [role]);
  return (
    <div className="stack g16" data-testid="me-learn">
      <MeHead title="Learning paths" sub="Free courses, a small project, then a skill check. Pass the check and send the project to get “Skill verified”." />
      {LIVE && !role && user?.activeRole === 'student' && <ResumeCard user={user} role="student" />}
      {LIVE && !role && user?.activeRole === 'student' && <Suspense fallback={null}><SetupChecklist /></Suspense>}
      {role ? <Path key={role} role={role} /> : err ? <p className="error" role="alert">{err}</p> : !d ? <Skel cards={3} label="Loading learning paths" /> : (
        <>
          {d.started.length > 0 ? (
            <section className="stack g12" aria-label="My paths" data-testid="lp-mine">
              <h2 className="mcard-title">My paths</h2>
              <div className="mgrid">
                {d.started.map((p) => (
                  <Link key={p.role} to={`/me/learn?role=${p.role}`} className="mcard mcard-link">
                    <span className="mspread"><strong className="ml-role-title" style={{ fontSize: 21 }}>{p.title}</strong>{p.verified ? <Chip tone="ok">✓ {p.verified.skill} verified</Chip> : <Chip tone="accent">In progress</Chip>}</span>
                    <Bar value={p.progress} label="Progress" tone="student" />
                    <span className="ml-tile-go">Continue →</span>
                  </Link>
                ))}
              </div>
            </section>
          ) : (
            <Empty shape="cap" tint="student" title="No path started yet" action={<Link className="btn btn-signal" to="/me/roles">Find my role</Link>}>
              Pick a path below, or answer ten quick questions and we put the roles that fit you at the top.
            </Empty>
          )}
          <section className="stack g12" aria-label="All paths">
            <div className="stack g4">
              <h2 className="mcard-title">{d.started.length ? 'Start another' : 'Pick a path'}</h2>
              <span className="small muted">Not sure? <Link to="/me/roles">Find my role</Link> first: its roles come at the top.</span>
            </div>
            <ul className="mgrid-3 ml-tiles" style={{ listStyle: 'none', padding: 0, margin: 0 }}>
              {d.paths.map((p) => (
                <li key={p.role}>
                  <Link to={`/me/learn?role=${p.role}`} className="ml-tile" data-testid="lp-pick">
                    <span className="ml-tile-ic" aria-hidden="true">🎓</span>
                    <span className="ml-tile-title">{p.title}</span>
                    {(p.suggested || !p.test) && <span className="ml-tags">{p.suggested && <span className="ml-tag">From your role finder</span>}{!p.test && <span className="xs muted">No skill check yet</span>}</span>}
                    <span className="ml-tile-go" aria-hidden="true">Open →</span>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        </>
      )}
    </div>
  );
}
