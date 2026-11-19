// Admin -> Skill checks -> Interviews (Vetting V3, the AI screening interview). Three lists from
// /api/admin/vetting/interviews?status=…:
//   Review queue  interviews the AI could not grade (no key, the day's allowance used, an unusable answer): read the
//                 transcript and give 0–5 per rubric line, up to 3 strengths and 1 concern -> POST …/{id}/grade.
//   Bias checks   the weekly second grading: first and second score per line with the gap; a gap over 1 is an alert
//                 (highlighted). Re-grading by hand clears it.
//   Graded        the latest graded interviews with their scores (a grade can be corrected by hand).
import { useState } from 'react';
import { useToast } from '../../../components/ui';
import { Loading, http, useAction, useApi, when } from './common';
import { signalLines } from './VettingPages';

const VIEWS = [['review', 'Review queue'], ['bias', 'Bias checks'], ['graded', 'Graded']];
const LANG = { en: 'English', te: 'Telugu', hi: 'Hindi' };

function Who({ x }) {
  return (
    <div className="vq-who">
      <span className="vq-av" aria-hidden="true">{(x.person || '?').charAt(0).toUpperCase()}</span>
      <span className="stack g2" style={{ minWidth: 0 }}>
        <strong className="vq-name">{x.person || 'Unnamed'}</strong>
        <span className="xs muted">{x.test}{x.role ? ` · ${x.role}` : ''} · {x.mode === 'voice' ? 'spoken' : 'typed'} · {LANG[x.lang] || x.lang} · started {when(x.startedAt)}</span>
      </span>
    </div>
  );
}

function Transcript({ rows, open }) {
  if (!rows?.length) return null;
  return (
    <details className="vt-tr" open={open}>
      <summary>Transcript ({rows.length} questions)</summary>
      <ol className="small iv-ad-tr">
        {rows.map((t, i) => (
          <li key={i}>
            <p className="iv-ad-q">{t.q}</p>
            <div className="vq-answer" tabIndex={0} aria-label={`Answer ${i + 1}`}>{t.a || '(no answer)'}</div>
            {t.followUp && <><p className="iv-ad-q">Follow-up: {t.followUp}</p><div className="vq-answer" tabIndex={0} aria-label={`Follow-up answer ${i + 1}`}>{t.followAnswer || '(no answer)'}</div></>}
          </li>
        ))}
      </ol>
    </details>
  );
}

function GradeForm({ x, criteria, onDone, again }) {
  const toast = useToast();
  const [busy, run] = useAction(toast);
  const prev = Object.fromEntries((x.scores || []).map((s) => [s.key, String(s.score)]));
  const [g, setG] = useState(() => Object.fromEntries(criteria.map((c) => [c.key, again ? prev[c.key] ?? '' : ''])));
  const [strengths, setStrengths] = useState(() => [0, 1, 2].map((i) => (again && x.strengths?.[i]) || ''));
  const [concern, setConcern] = useState(again ? x.concern || '' : '');
  const [err, setErr] = useState('');
  const submit = (e) => {
    e.preventDefault();
    setErr('');
    if (criteria.some((c) => g[c.key] === '')) { setErr('Give a 0–5 score for every rubric line.'); return; }
    run(async () => {
      const r = await http(`/api/admin/vetting/interviews/${x.id}/grade`, { method: 'POST', body: {
        scores: Object.fromEntries(criteria.map((c) => [c.key, Number(g[c.key])])),
        strengths: strengths.map((s) => s.trim()).filter(Boolean), concern: concern.trim() } });
      toast(`Graded: average ${r.average}/5 · ${r.passed ? 'passed (Interview-ready)' : 'not passed'}`);
      onDone();
    });
  };
  return (
    <form className="stack g12 vq-grade" onSubmit={submit} aria-label={`Grade the interview of ${x.person || 'this candidate'}`} data-testid="ivq-form">
      {criteria.map((c) => (
        <fieldset key={c.key} className="vq-crit">
          <legend><strong>{c.label}</strong></legend>
          <span className="xs muted">{c.guide}</span>
          <label className="field vq-score"><span className="label">Score for {c.label}</span>
            <select className="input" required value={g[c.key]} onChange={(e) => setG({ ...g, [c.key]: e.target.value })} data-testid={`ivq-score-${c.key}`}>
              <option value="">Pick 0–5</option>{[0, 1, 2, 3, 4, 5].map((n) => <option key={n} value={n}>{n}</option>)}
            </select>
          </label>
        </fieldset>
      ))}
      <fieldset className="vq-crit">
        <legend><strong>Strengths</strong> <span className="xs muted">(up to 3; the candidate and companies see them)</span></legend>
        {strengths.map((s, i) => (
          <label key={i} className="field"><span className="label">Strength {i + 1}</span>
            <input className="input" maxLength={160} value={s} onChange={(e) => setStrengths(strengths.map((v, j) => (j === i ? e.target.value : v)))} data-testid={`ivq-strength-${i}`} />
          </label>
        ))}
      </fieldset>
      <label className="field"><span className="label">One concern (about the work only)</span>
        <input className="input" maxLength={200} value={concern} onChange={(e) => setConcern(e.target.value)} data-testid="ivq-concern" />
      </label>
      {err && <p className="error" role="alert" style={{ margin: 0 }}>{err}</p>}
      <button type="submit" className="btn btn-signal vt-btn" style={{ alignSelf: 'flex-start' }} disabled={busy} data-testid="ivq-grade">{again ? 'Save the new grade' : 'Save the grade'}</button>
    </form>
  );
}

function Scores({ x }) {
  if (!x.scores?.length) return null;
  return (
    <ul className="small vq-fb">
      {x.scores.map((s) => <li key={s.key}><strong>{s.label}: {s.score}/5</strong>{s.reason ? ` · ${s.reason}` : ''}</li>)}
    </ul>
  );
}

function Item({ x, criteria, view, onDone }) {
  const [regrade, setRegrade] = useState(false);
  const sig = signalLines(x.signals);
  const extra = [];
  if (x.signals?.pasteAttempts) extra.push(['Paste attempts (blocked)', String(x.signals.pasteAttempts)]);
  if (x.signals?.late) extra.push(['Answers sent after the time', String(x.signals.late)]);
  const lines = [...extra, ...sig.map(([k, v]) => [k === 'Time away from the test' ? 'Time away from the interview' : k, v])];
  return (
    <li className={`card stack g12 vq-item ${x.bias?.alert ? 'iv-ad-alert' : ''}`} data-testid="ivq-item" data-status={x.status}>
      <Who x={x} />
      <div className="vt-chips">
        {x.status === 'review' && <span className="mchip mchip-warn">Waiting for a person</span>}
        {x.status === 'graded' && <span className={`mchip ${x.passed ? 'mchip-ok' : 'mchip-neutral'}`}>{x.passed ? 'Passed' : 'Not passed'} · {x.average}/5</span>}
        {x.bias && <span className={`mchip ${x.bias.alert ? 'mchip-bad' : 'mchip-neutral'}`}>Bias check gap: {x.bias.gap}{x.bias.alert ? ' · alert' : ''}</span>}
      </div>
      {lines.length > 0 && <dl className="vi-signals">{lines.map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}</dl>}
      {view === 'bias' && x.bias ? <BiasTable x={x} criteria={criteria} /> : <Scores x={x} />}
      {x.strengths?.length > 0 && <span className="small"><strong>Strengths:</strong> {x.strengths.join(' · ')}</span>}
      {x.concern && <span className="small"><strong>Concern:</strong> {x.concern}</span>}
      <Transcript rows={x.transcript} open={x.status === 'review'} />
      {x.status === 'review' ? <GradeForm x={x} criteria={criteria} onDone={onDone} />
        : regrade ? <GradeForm x={x} criteria={criteria} onDone={onDone} again />
          : <button type="button" className="btn btn-outline btn-sm vt-btn" style={{ alignSelf: 'flex-start' }} onClick={() => setRegrade(true)} data-testid="ivq-regrade">{view === 'bias' ? 'Grade it by hand' : 'Correct the grade'}</button>}
    </li>
  );
}

function BiasTable({ x, criteria }) {
  const first = Object.fromEntries((x.scores || []).map((s) => [s.key, s.score]));
  const second = Object.fromEntries((x.bias.second || []).map((s) => [s.key, s.score]));
  return (
    <div className="table-wrap mtable-wrap">
      <table className="table mtable vt-table" data-testid="ivq-bias">
        <caption className="sr-only">First and second grade per rubric line</caption>
        <thead><tr><th scope="col">Rubric line</th><th scope="col">First grade</th><th scope="col">Second grade</th><th scope="col">Gap</th></tr></thead>
        <tbody>
          {criteria.map((c) => {
            const a = first[c.key]; const b = second[c.key];
            const gap = a != null && b != null ? Math.abs(a - b) : null;
            return (
              <tr key={c.key} className={gap > 1 ? 'iv-ad-gap' : ''}>
                <th scope="row">{c.label}</th>
                <td data-label="First grade" className="num">{a ?? '—'}</td>
                <td data-label="Second grade" className="num">{b ?? '—'}</td>
                <td data-label="Gap" className="num">{gap ?? '—'}{gap > 1 ? <span className="sr-only"> (more than 1 point apart)</span> : ''}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export function InterviewQueue({ onDone }) {
  const [view, setView] = useState('review');
  const st = useApi(`/api/admin/vetting/interviews?status=${view}`);
  const done = () => { st.reload(); onDone?.(); };
  const EMPTY = { review: 'Nothing waiting: every interview has a grade.', bias: 'No bias alerts. The weekly check re-grades 5% of AI-graded interviews.', graded: 'No graded interviews yet.' };
  return (
    <section className="stack g12" aria-label="Interviews">
      <div className="ad-toolbar vt-wrap">
        <div className="segmented vt-seg" role="group" aria-label="Show">
          {VIEWS.map(([v, l]) => <button key={v} type="button" aria-pressed={view === v} onClick={() => setView(v)} data-testid={`ivq-${v}`}>{l}</button>)}
        </div>
        <span className="small muted">
          {view === 'review' ? 'Screening interviews the AI could not grade. Read the transcript and score each line 0–5; a pass (average 3.2+, nothing below 2) makes the person Interview-ready.'
            : view === 'bias' ? 'Each week a second, differently worded grader re-scores a sample. A line more than 1 point apart is highlighted.'
              : 'The latest graded interviews.'}
        </span>
      </div>
      <Loading st={st}>{(d) => (d.items.length === 0 ? <div className="well small muted vt-empty">{EMPTY[view]}</div> : (
        <ul className="vq-list">{d.items.map((x) => <Item key={x.id} x={x} criteria={d.criteria} view={view} onDone={done} />)}</ul>
      ))}</Loading>
    </section>
  );
}
