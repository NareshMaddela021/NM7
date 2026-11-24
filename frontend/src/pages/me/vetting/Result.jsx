// A skill check's result (Vetting V2): the score out of 100, pass or not (70), a bar for each topic with "Strong /
// Improve", the experience band and when it can be taken again. A result we couldn't confirm gets a polite free
// retest; a pass opens the practical task (Task.jsx, loaded when opened); the test and the task together give the
// "Skill verified" badge for 90 days.
// Vetting V5: a calm line on how the test went (integrityNote), the top 3 topics to improve with Learn / Practice links,
// "I think this is wrong" on the check and on a graded task (Appeal.jsx), and a refresher result (kind "refresh") that
// renews the badge instead of opening a task.
import { Suspense, lazy, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useToast } from '../../../components/ui';
import { http } from '../../../services/http';
import { lazyRetry } from '../../../lib/chunks';
import { Bar, Chip, MeCard, ScoreRing, Skel } from '../kit';
import { API, badgeLine, day } from './lib';
import { Appeal, useAppeals } from './Appeal';
import '../../../styles/me-vet.css';
import { IcCheck, IcCheckCircle, IcClock, IcEdit, IcInfo, IcStar, IcTrend } from '../../../components/icons';

const Task = lazy(lazyRetry(() => import('./Task')));
// Vetting Trust T9 (only when the server sends them: people Vetting Trust is on for): the pledge, limits, pledge record
const Pledge = lazy(lazyRetry(() => import('../trust/Honesty').then((m) => ({ default: m.Pledge }))));
const RetakeInfo = lazy(lazyRetry(() => import('../trust/Honesty').then((m) => ({ default: m.RetakeInfo }))));
const PledgeNote = lazy(lazyRetry(() => import('../trust/Honesty').then((m) => ({ default: m.PledgeNote }))));

export function VerifiedBadge({ v, role }) {
  if (!v) return null;
  return (
    <div className={`vet-badge ${v.expired ? 'expired' : ''}`} data-testid="vt-verified">
      <strong><IcCheck size={14} /> {badgeLine(v, role)}</strong>
      <span className="xs">{v.expired ? `Expired on ${day(v.expiresAt)}. Take the check again to renew it.` : `Valid until ${day(v.expiresAt)}`}</span>
    </div>
  );
}

function TaskState({ r, onOpen, appeals, onRefresh }) {
  const t = r.task;
  const [pledge, setPledge] = useState(); // T9: undefined = not asked, null = not ticked yet, n = the version ticked
  const [replayOk, setReplayOk] = useState(false); // T14: the "Coding replay" consent, ticked in the task start
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  if (!t || r.retest || r.kind === 'refresh') return null;
  if (t.status === 'locked') return null;
  const cl = t.coding?.consent; // T14: this task opens as a coding task (Vetting Trust only)
  const open = async () => {
    setErr('');
    if (cl && replayOk && !cl.given) {
      setBusy(true);
      try { await http(`/api/me/trust/consents/${cl.purpose}`, { method: 'POST' }); } catch (e) { setErr(e.message); setBusy(false); return; }
      setBusy(false);
    }
    onOpen(pledge);
  };
  if (t.status === 'open' || t.status === 'started') {
    return (
      <MeCard tone="accent" icon={<IcEdit />} title={cl ? 'Do the coding task' : 'Do the practical task'} sub={cl ? 'The last step to get “Skill verified”. Write code in the browser, run it on the sample tests, then submit: hidden tests decide the score (you need 60/100).' : 'The last step to get “Skill verified”. A short real-work task; it is marked out of 5 stars and you need 3 (60/100).'} testid="vt-task-card">
        {t.status === 'open' && r.retake && <Suspense fallback={null}><Pledge kind="task" lang={r.lang} onChange={setPledge} /></Suspense>}
        {t.status === 'open' && cl && !cl.given && (
          <label className="vet-toggle" data-testid="vt-replay-consent">
            <input type="checkbox" checked={replayOk} onChange={(e) => setReplayOk(e.target.checked)} aria-label={`Optional: ${cl.title}`} data-testid="vt-replay-tick" />
            <span><strong>Optional: {cl.title}.</strong> We record your typing in this editor only to show reviewers how the solution was written. <span className="xs muted">{cl.text}</span></span>
          </label>
        )}
        {err && <p className="error" role="alert">{err}</p>}
        <div className="mrow">
          <button type="button" className="btn btn-signal btn-lg" disabled={busy || (t.status === 'open' && pledge === null)} onClick={open} data-testid="vt-task-open">{t.status === 'started' ? 'Carry on with the task' : cl ? 'Start the coding task' : 'Start the practical task'}</button>
          <span className="xs muted">The clock starts when you open it.</span>
        </div>
      </MeCard>
    );
  }
  if (t.coding && t.status === 'grading') {
    const check = async () => {
      setBusy(true);
      try { await http(`/api/me/trust/code/${r.id}`); onRefresh?.(); } catch (e) { setErr(e.message); } finally { setBusy(false); }
    };
    return (
      <MeCard tone="flat" icon={<IcClock />} title="Your code is saved and waiting to be checked" sub="The code sandbox runs it against the hidden tests as soon as it can. Nothing is lost; your result appears here." testid="vt-code-queued">
        {err && <p className="error" role="alert">{err}</p>}
        <div><button type="button" className="btn btn-outline" disabled={busy} onClick={check} data-testid="vt-code-check">Check now</button></div>
      </MeCard>
    );
  }
  if (t.status === 'review' || t.status === 'grading') {
    return <MeCard tone="flat" icon={<IcClock />} title="Your task is with our team" sub="Our team will grade it within a day. We will tell you by email and here." testid="vt-task-review" />;
  }
  return (
    <MeCard tone={t.score >= 60 ? 'ok' : 'warn'} icon={<IcStar />} title={t.coding ? `Coding task: ${t.stars}/5` : `Practical task: ${t.stars}/5`} sub={t.score >= 60 ? 'Passed.' : 'Not passed this time. You can take the skill check again from the date above.'} testid="vt-task-done">
      {t.feedback?.length > 0 && (
        <ul className="mlist">
          {t.feedback.map((f) => (
            <li key={f.label} className="mitem" data-testid="vt-feedback">
              <span className="mitem-main"><span className="mitem-title">{f.label} · {f.score}/5</span><span className="mitem-meta">{f.reason}</span></span>
            </li>
          ))}
        </ul>
      )}
      {t.coding?.total != null && (
        <p className="small" style={{ margin: 0 }} data-testid="vt-code-result"><strong>{t.coding.passed} of {t.coding.total} hidden tests passed.</strong>{t.coding.failingSamples?.length ? ` Sample tests that failed: ${t.coding.failingSamples.join(', ')}.` : ''}</p>
      )}
      {t.photo && <span className="xs muted">{t.photo.checked ? 'Your photo was checked.' : 'We couldn’t use your photo; that doesn’t change the score.'}</span>}
      {t.status === 'graded' && <Appeal kind="task" refId={r.id} what="the practical task’s marks" appeals={appeals} />}
    </MeCard>
  );
}

/** `improve` is [{ topic, score, learn, practice }] (V5); older results had plain topic names. */
const improveList = (r) => (r.improve || []).map((x) => (typeof x === 'string' ? { topic: x } : x)).filter((x) => x?.topic);

function Refreshed({ r }) {
  const v = r.verified;
  const renewed = r.pass && !r.retest && v && !v.expired && v.expiresAt - r.startedAt > 60 * 86_400_000; // renewed: about 90 days from now
  return renewed
    ? <MeCard tone="ok" icon={<IcCheckCircle />} title="Badge renewed" sub={`Your badge is valid until ${day(v.expiresAt)}. Nothing else to do.`} testid="vt-renewed" />
    : <MeCard tone="flat" icon={<IcInfo />} title="Not renewed this time" sub="The refresher needs 70 or more. You can take the full skill check to earn the badge again." testid="vt-renewed" />;
}

export default function Result({ id, initial, onRetest }) {
  const toast = useToast();
  const appeals = useAppeals();
  const [r, setR] = useState(initial || null);
  const [err, setErr] = useState('');
  const [task, setTask] = useState(false); // false, or { pledge } once opened
  // the result handed over by the test shows at once; the server's copy (always fresh, e.g. after a reload) follows
  useEffect(() => {
    http(`${API}/${id}`).then(setR, (e) => { if (initial?.id !== id) setErr(e.message); });
  }, [id]); // eslint-disable-line react-hooks/exhaustive-deps

  const share = async (on) => {
    try { setR(await http(`${API}/${id}/share`, { method: 'PUT', body: { share: on } })); toast(on ? 'Companies hiring now can see your score' : 'Hidden from companies'); } catch (e) { toast(e.message); }
  };

  if (err) return <p className="error" role="alert">{err}</p>;
  if (!r) return <Skel cards={1} lines={4} label="Loading your result" />;
  if (!r.done) return <MeCard title="This test isn’t finished" sub="Go back to the skill checks to carry on." />;
  const name = r.role || r.skill;
  const improve = improveList(r);
  return (
    <div className="mstack" data-testid="vt-result">
      <section className={`mcard ${r.pass && !r.retest ? 'mcard-accent' : ''}`} aria-label={`${name} result`}>
        <div className="vet-result">
          <ScoreRing value={r.score} label={`${name} score`} good={70} fair={50} testid="vt-ring" />
          <div className="stack g8" style={{ minWidth: 0 }}>
            <span className="mkicker">Your result · {day(r.startedAt)}</span>
            <h2 className="vet-h2">{name}</h2>
            <span className="mrow">
              {r.retest ? <Chip tone="info" testid="vt-pass">Not confirmed yet</Chip>
                : r.pass ? <Chip tone="ok" testid="vt-pass">Passed · {r.score}/100</Chip>
                  : <Chip tone="warn" testid="vt-pass">Not passed · {r.score}/100 (pass is 70)</Chip>}
              <Chip tone="neutral">{r.bandLabel}</Chip>
              {r.kind === 'refresh' && <Chip tone="accent">Badge refresher</Chip>}
              {r.late && <Chip tone="warn">Time ran out</Chip>}
            </span>
            <span className="small">{r.right} of {r.total} right.</span>
            <span className="xs muted" data-testid="vt-again">{r.canRetry ? 'You can take this check again now.' : `Next try from ${day(r.againAt)}.`}</span>
          </div>
        </div>
        {r.retake && <Suspense fallback={null}><RetakeInfo rk={r.retake} /><PledgeNote items={[r.pledge && { ...r.pledge, what: 'test' }, r.taskPledge && { ...r.taskPledge, what: 'practical task' }]} /></Suspense>}
        <VerifiedBadge v={r.verified} role={name} />
        <Appeal kind="skill" refId={r.id} what="this skill check" appeals={appeals} />
      </section>

      {r.kind === 'refresh' && <Refreshed r={r} />}

      {!r.retest && r.integrityNote && (
        <div className="vet-calm" data-testid="vt-integrity-note"><IcInfo /><span className="small"><strong>How the test went:</strong> {r.integrityNote}</span></div>
      )}

      {r.retest && (
        <MeCard tone="flat" icon={<IcInfo />} title="Please take a free retest" testid="vt-retest">
          <p className="small" style={{ margin: 0 }}>We couldn’t confirm this result — please take a free retest under quieter conditions. This doesn’t mean anything is wrong.</p>
          {r.freeRetest
            ? <div className="mrow"><button type="button" className="btn btn-signal btn-lg" onClick={() => onRetest?.(r)} data-testid="vt-retest-start">Start my free retest</button><span className="xs muted">New questions. Find a quiet place and keep this page open.</span></div>
            : <span className="xs muted">Our team is looking at it and will write to you.</span>}
        </MeCard>
      )}

      {Object.keys(r.topics || {}).length > 0 && (
        <MeCard title="By topic" sub={[r.strong?.length ? `Strong: ${r.strong.join(', ')}` : '', improve.length ? `Improve: ${improve.map((x) => x.topic).join(', ')}` : ''].filter(Boolean).join(' · ') || 'Steady across the topics.'} testid="vt-topics">
          <div className="vet-topics">
            {Object.entries(r.topics).map(([t, s]) => <Bar key={t} label={t} value={s} tone={s >= 75 ? 'ok' : s < 60 ? 'warn' : 'accent'} testid="vt-topic" />)}
          </div>
        </MeCard>
      )}

      {improve.length > 0 && (
        <MeCard title="Top things to improve" sub="Your lowest topics in this check, with free ways to get better." testid="vt-improve">
          <ol className="vet-improve">
            {improve.map((x) => (
              <li key={x.topic} className="vet-improve-i" data-testid="vt-improve-item">
                <span className="stack g2" style={{ minWidth: 0 }}>
                  <strong>{x.topic}</strong>
                  {x.score != null && <span className="xs muted">{x.score}/100 in this check</span>}
                </span>
                <span className="vet-improve-go">
                  <Link className="btn btn-outline btn-sm" to={x.learn || '/me/learn'} aria-label={`Learn: ${x.topic}`}>Learn</Link>
                  <Link className="btn btn-ghost btn-sm" to={x.practice || '/me/practice'} aria-label={`Practise: ${x.topic}`}>Practice</Link>
                </span>
              </li>
            ))}
          </ol>
        </MeCard>
      )}

      {task ? (
        <Suspense fallback={<Skel cards={1} lines={4} label="Opening the task" />}>
          <Task attempt={r} pledge={task.pledge} onDone={(x) => { setR(x); setTask(false); window.scrollTo?.(0, 0); http(`${API}/${id}`).then(setR, () => {}); }} onCancel={() => setTask(false)} />
        </Suspense>
      ) : <TaskState r={r} onOpen={(pledge) => setTask({ pledge })} appeals={appeals} onRefresh={() => http(`${API}/${id}`).then(setR, () => {})} />}

      <MeCard tone="flat" className="mcard-tight" icon={<IcTrend />} title="Keep learning" sub={improve.length ? `Practise ${improve.slice(0, 2).map((x) => x.topic).join(' and ')} for free, then try again.` : 'Free learning paths and practice tests for this role.'}>
        <div className="mrow">
          <Link className="btn btn-outline" to="/me/learn">Learning paths</Link>
          <Link className="btn btn-outline" to="/me/practice">Practice tests</Link>
          <Link className="btn btn-ghost" to="/me/skill-checks">All skill checks</Link>
        </div>
      </MeCard>

      {!r.retest && (
        <label className="vet-toggle">
          <input type="checkbox" checked={!!r.share} onChange={(e) => share(e.target.checked)} aria-label="Show this score to companies hiring now" data-testid="vt-share" />
          <span>Show this score to companies hiring now <span className="xs muted">(a “Skill verified” badge is always shown once earned)</span></span>
        </label>
      )}
    </div>
  );
}
