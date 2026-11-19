// A screening interview's result (Vetting V3): passed or not yet, the average out of 5, a bar for each of the 5 rubric
// lines with the reason and the candidate's own words it was based on, 3 strengths and 1 concern, how long
// "Interview-ready" (L3) lasts and when the interview can be taken again. Not graded yet ("review") → our team grades
// it within a day. The answers themselves are in a fold at the end. Vetting V5: "I think this is wrong" on a graded
// interview (vetting/Appeal) and the appeal's status.
import { Suspense, lazy, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { http } from '../../../services/http';
import { Bar, Chip, MeCard, Skel } from '../kit';
import { day } from '../vetting/lib';
import { Appeal, useAppeals } from '../vetting/Appeal';
import { API, avg, scoreWord } from './lib';
import { lazyRetry } from '../../../lib/chunks';
import '../../../styles/me-vet.css';
import '../../../styles/me-iv.css';

// Vetting Trust T9 (only when the server sends them: people Vetting Trust is on for)
const RetakeInfo = lazy(lazyRetry(() => import('../trust/Honesty').then((m) => ({ default: m.RetakeInfo }))));
const PledgeNote = lazy(lazyRetry(() => import('../trust/Honesty').then((m) => ({ default: m.PledgeNote }))));

/** T9 "Explain your answer": how well they explained their own practical task (a plain label and the reason). */
function Explained({ e }) {
  if (!e) return null;
  const tone = e.key === 'strong' ? 'ok' : e.key === 'partial' ? 'flat' : 'warn';
  return (
    <MeCard tone={tone} icon="✎" title={e.label} sub="How well you explained your own practical task. It is shown to companies with the reason; it never changes your score." testid="iv-explained" headingLevel={3}>
      {e.reason && <p className="small" style={{ margin: 0 }} data-testid="iv-explained-reason">{e.reason}</p>}
    </MeCard>
  );
}

function Transcript({ rows }) {
  if (!rows?.length) return null;
  return (
    <details className="iv-tr" data-testid="iv-transcript-fold">
      <summary>Your answers ({rows.length} questions)</summary>
      <ol className="iv-tr-list">
        {rows.map((t, i) => (
          <li key={i}>
            <p className="iv-tr-q">{t.explain && <span className="iv-follow">About your task:</span>} {t.q}</p>
            <p className="iv-tr-a">{t.a || <span className="muted">(no answer)</span>}</p>
            {t.followUp && <><p className="iv-tr-q"><span className="iv-follow">Follow-up:</span> {t.followUp}</p><p className="iv-tr-a">{t.followAnswer || <span className="muted">(no answer)</span>}</p></>}
          </li>
        ))}
      </ol>
    </details>
  );
}

export default function IvResult({ id, initial, pass }) {
  const [r, setR] = useState(initial?.id === id ? initial : null);
  const [err, setErr] = useState('');
  const appeals = useAppeals();
  useEffect(() => {
    http(`${API}/${id}`).then(setR, (e) => { if (initial?.id !== id) setErr(e.message); });
  }, [id]); // eslint-disable-line react-hooks/exhaustive-deps

  if (err) return <p className="error" role="alert">{err}</p>;
  if (!r) return <Skel cards={1} lines={4} label="Loading your result" />;
  const name = r.role || r.test;
  const again = r.canRetry ? 'You can take this interview again now.' : `Next try from ${day(r.againAt)}.`;

  if (r.status === 'running' || r.status === 'answered') {
    return (
      <MeCard tone="flat" icon="⏳" title="This interview isn’t finished" sub="Go back to the interviews to carry on." testid="iv-unfinished">
        <div className="mrow"><Link className="btn btn-signal" to="/me/interviews">Carry on</Link></div>
      </MeCard>
    );
  }
  if (r.status === 'review') {
    return (
      <div className="mstack" data-testid="iv-result">
        <MeCard tone="accent" icon="⌛" title={`Thank you: your ${name} interview is in`} testid="iv-review">
          <p className="small" style={{ margin: 0 }} data-testid="iv-review-text">Our team will grade it within a day. We will tell you by email and here, with the reasons for each score.</p>
          <span className="xs muted">{again}</span>
        </MeCard>
        <Explained e={r.explained} />
        {r.retake && <Suspense fallback={null}><RetakeInfo rk={r.retake} what="interview" /><PledgeNote items={[r.pledge && { ...r.pledge, what: 'interview' }]} /></Suspense>}
        <Transcript rows={r.transcript} />
        <div className="mrow"><Link className="btn btn-outline" to="/me/interviews">All interviews</Link></div>
      </div>
    );
  }

  const ok = !!r.passed;
  return (
    <div className="mstack" data-testid="iv-result">
      <section className={`mcard ${ok ? 'mcard-accent' : ''}`} aria-label={`${name} interview result`}>
        <div className="iv-head">
          <div className="iv-avg" role="img" aria-label={`Average ${avg(r.average)} out of 5`} data-testid="iv-average">
            <strong aria-hidden="true">{avg(r.average)}</strong><small aria-hidden="true">/ 5</small>
          </div>
          <div className="stack g8" style={{ minWidth: 0 }}>
            <span className="mkicker">Screening interview · {day(r.startedAt)}</span>
            <h2 className="vet-h2">{name}</h2>
            <span className="mrow">
              {ok ? <Chip tone="ok" testid="iv-pass">Passed · L3 Interview-ready</Chip> : <Chip tone="warn" testid="iv-pass">Not yet</Chip>}
              <Chip tone="neutral">{r.mode === 'voice' ? 'Spoken' : 'Typed'}</Chip>
            </span>
            {ok && r.validUntil && <span className="small" data-testid="iv-valid">Interview-ready until {day(r.validUntil)}. Companies hiring now see you first.</span>}
            {!ok && <span className="small">{pass ? `To pass: an average of ${pass.average} or more and no line below ${pass.min}.` : 'Read the reasons below, practise, and try again.'}</span>}
            <span className="xs muted" data-testid="iv-again">{again}</span>
          </div>
        </div>
        {r.status === 'graded' && <Appeal kind="interview" refId={r.id} what="this interview’s scores" appeals={appeals} />}
        {r.retake && <Suspense fallback={null}><RetakeInfo rk={r.retake} what="interview" /><PledgeNote items={[r.pledge && { ...r.pledge, what: 'interview' }]} /></Suspense>}
      </section>

      <Explained e={r.explained} />

      {r.scores?.length > 0 && (
        <MeCard title="Your scores" sub="Each line is out of 5, with the words of yours it is based on." testid="iv-scores">
          <ul className="iv-scores">
            {r.scores.map((s) => {
              const [w, tone] = scoreWord(s.score);
              return (
                <li key={s.key} className="iv-score" data-testid="iv-score">
                  <Bar value={s.score} max={5} label={`${s.label} · ${w}`} tone={tone} />
                  {s.reason && <p className="iv-reason">{s.reason}</p>}
                  {s.quote && <blockquote className="iv-quote" lang={r.lang}>“{s.quote}”</blockquote>}
                </li>
              );
            })}
          </ul>
        </MeCard>
      )}

      {(r.strengths?.length > 0 || r.concern) && (
        <div className="iv-sc">
          {r.strengths?.length > 0 && (
            <MeCard tone="ok" icon="✓" title="Strengths" testid="iv-strengths" headingLevel={3}>
              <ul className="iv-list">{r.strengths.map((s) => <li key={s}>{s}</li>)}</ul>
            </MeCard>
          )}
          {r.concern && (
            <MeCard tone="warn" icon="!" title="One thing to work on" testid="iv-concern" headingLevel={3}>
              <p className="small" style={{ margin: 0 }}>{r.concern}</p>
            </MeCard>
          )}
        </div>
      )}

      <Transcript rows={r.transcript} />

      <MeCard tone="flat" className="mcard-tight" icon="↗" title="Keep practising" sub="Mock interviews and practice tests are free." headingLevel={3}>
        <div className="mrow">
          <Link className="btn btn-outline" to="/me/practice">Practice</Link>
          <Link className="btn btn-ghost" to="/me/interviews">All interviews</Link>
        </div>
      </MeCard>
    </div>
  );
}
