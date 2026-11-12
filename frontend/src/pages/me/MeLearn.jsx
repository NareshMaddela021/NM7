// Learning paths with proof (Phase 6, S2). /me/learn lists my paths and the ones I can start (the role finder's
// first); /me/learn?role=<id> opens one: free courses in order ("I finished this" is progress only, never a skill),
// a small guided project (send a link or a few lines), then the role's skill check. "Skill verified" shows only when
// the check is passed and the project is sent; companies hiring now and the public resume link see it, with the date.
import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { http } from '../../services/http';
import { MeHead } from './MeLayout';

const day = (ms) => (ms ? new Date(ms).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '');

function Bar({ pct }) {
  return (
    <div role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label="Progress" style={{ height: 10, borderRadius: 6, background: 'var(--line, #ddd)', overflow: 'hidden' }}>
      <div style={{ width: `${pct}%`, height: '100%', background: 'var(--signal, #2a7)' }} />
    </div>
  );
}

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
    <form className="card stack g8" onSubmit={send} data-testid="lp-project">
      <strong>2. Project: {p.title}</strong>
      <p className="small" style={{ margin: 0 }}>{p.brief}</p>
      <ol className="small" style={{ margin: 0, paddingLeft: 20 }}>{(p.steps || []).map((s) => <li key={s}>{s}</li>)}</ol>
      <span className="xs muted">Free to do. Nobody pays you or asks you to pay for this; it is your own practice work.</span>
      {p.submit === 'link'
        ? <label className="field"><span className="label">Link to your work (sheet, document, GitHub…)</span><input className="input" type="url" maxLength={500} value={link} onChange={(e) => setLink(e.target.value)} placeholder="https://" data-testid="lp-link" /></label>
        : <label className="field"><span className="label">Your answer</span><textarea className="input" rows={5} maxLength={4000} value={text} onChange={(e) => setText(e.target.value)} data-testid="lp-text" /></label>}
      {err && <p className="error" role="alert">{err}</p>}
      <div className="row g8" style={{ flexWrap: 'wrap', alignItems: 'center' }}>
        <button type="submit" className="btn btn-ink btn-sm" disabled={busy} data-testid="lp-send">{p.sent.at ? 'Update my project' : 'Send my project'}</button>
        {p.sent.at && <span className="xs muted" data-testid="lp-sent">✓ Sent {day(p.sent.at)}</span>}
      </div>
    </form>
  );
}

function Path({ role }) {
  const [d, setD] = useState(null);
  const [err, setErr] = useState('');
  useEffect(() => { http(`/api/me/learn/${role}`).then(setD, (e) => setErr(e.message)); }, [role]);
  if (err) return <p className="error" role="alert">{err}</p>;
  if (!d) return <p className="muted">Loading…</p>;
  const tick = async (c) => { try { setD(await http(`/api/me/learn/${role}/course`, { method: 'PUT', body: { courseId: c.id, done: !c.done } })); } catch (e) { setErr(e.message); } };
  const start = async () => { try { setD(await http(`/api/me/learn/${role}/start`, { method: 'POST' })); } catch (e) { setErr(e.message); } };
  const t = d.test;
  return (
    <div className="stack g12" data-testid="lp-path">
      <div className="card stack g8">
        <div className="row between g8" style={{ flexWrap: 'wrap' }}>
          <strong style={{ fontSize: 18 }}>{d.title}</strong>
          {d.verified ? <span className="badge b-success" data-testid="lp-badge">✓ Skill verified: {d.verified.skill} · {day(d.verified.at)}</span> : <span className="small" data-testid="lp-pct">{d.progress}% done</span>}
        </div>
        <Bar pct={d.progress} />
        {!d.started && <button type="button" className="btn btn-ink" style={{ alignSelf: 'flex-start' }} onClick={start} data-testid="lp-start">Start this path (free)</button>}
      </div>
      {d.started && (
        <>
          <section className="card stack g8" aria-label="Courses" data-testid="lp-courses">
            <strong>1. Free courses</strong>
            <span className="xs muted">Ticking a course moves your progress. It doesn't add a skill to your resume: the skill check and the project prove it.</span>
            <ul className="stack g8" style={{ listStyle: 'none', padding: 0, margin: 0 }}>
              {d.courses.map((c) => (
                <li key={c.id} className="row g8" style={{ alignItems: 'flex-start' }} data-testid="lp-course">
                  <input type="checkbox" checked={c.done} onChange={() => tick(c)} aria-label={`I finished ${c.title}`} style={{ marginTop: 4 }} />
                  <span className="stack g4" style={{ minWidth: 0 }}>
                    <a href={c.url} target="_blank" rel="noopener noreferrer" className="small" style={{ overflowWrap: 'anywhere' }}>{c.title}</a>
                    <span className="xs muted">{c.skill} · {c.provider}{c.hours ? ` · about ${c.hours} h` : ''}</span>
                  </span>
                </li>
              ))}
            </ul>
            {d.missingCourses.length > 0 && <span className="xs muted">No free course listed yet for {d.missingCourses.join(', ')}. NPTEL and SWAYAM have free courses for many skills.</span>}
          </section>
          <Project role={role} p={d.project} onDone={setD} />
          <section className="card stack g8" aria-label="Skill check" data-testid="lp-check">
            <strong>3. Skill check</strong>
            {t.skill ? (
              <>
                <span className="small">The {t.skill} skill check: 10 minutes, 10 questions. Pass mark {t.pass}%.{t.best ? ` Your best: ${t.best.score}%.` : ''}</span>
                <div className="row g8" style={{ flexWrap: 'wrap' }}>
                  <Link className="btn btn-outline btn-sm" to="/me/practice">Practise first (free)</Link>
                  <Link className="btn btn-outline btn-sm" to="/me/skill-checks">Open skill checks</Link>
                </div>
                <span className="xs muted">Practice tests never count; only the official check does.</span>
              </>
            ) : <span className="small">This role has no skill check yet, so no badge for now. The courses and the project still help.</span>}
          </section>
        </>
      )}
      <Link to="/me/learn" className="small">← All learning paths</Link>
    </div>
  );
}

export default function MeLearn() {
  const [q] = useSearchParams();
  const role = q.get('role');
  const [d, setD] = useState(null);
  const [err, setErr] = useState('');
  useEffect(() => { if (!role) http('/api/me/learn').then(setD, (e) => setErr(e.message)); }, [role]);
  return (
    <div className="stack g16" data-testid="me-learn">
      <MeHead title="Learning paths" sub="Free courses, a small project, then a skill check. Pass the check and send the project to get “Skill verified”." />
      {role ? <Path key={role} role={role} /> : err ? <p className="error" role="alert">{err}</p> : !d ? <p className="muted">Loading…</p> : (
        <>
          {d.started.length > 0 && (
            <section className="stack g8" aria-label="My paths" data-testid="lp-mine">
              <strong>My paths</strong>
              {d.started.map((p) => (
                <Link key={p.role} to={`/me/learn?role=${p.role}`} className="card stack g4" style={{ textDecoration: 'none', color: 'inherit' }}>
                  <span className="row between g8" style={{ flexWrap: 'wrap' }}><strong>{p.title}</strong>{p.verified ? <span className="badge b-success">✓ {p.verified.skill} verified</span> : <span className="small">{p.progress}%</span>}</span>
                  <Bar pct={p.progress} />
                </Link>
              ))}
            </section>
          )}
          <section className="stack g8" aria-label="All paths">
            <strong>{d.started.length ? 'Start another' : 'Pick a path'}</strong>
            <span className="xs muted">Not sure? <Link to="/me/roles">Find my role</Link> first: its roles come at the top.</span>
            <ul className="stack g4" style={{ listStyle: 'none', padding: 0, margin: 0 }}>
              {d.paths.map((p) => <li key={p.role}><Link to={`/me/learn?role=${p.role}`} className="small" data-testid="lp-pick">{p.title}</Link>{p.suggested && <span className="badge b-signal" style={{ marginLeft: 8 }}>From your role finder</span>}{!p.test && <span className="xs muted"> · no skill check yet</span>}</li>)}
            </ul>
          </section>
        </>
      )}
    </div>
  );
}
