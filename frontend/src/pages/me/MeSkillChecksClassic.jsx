// The skill checks as they were before Vetting V2 (10 questions, 10 minutes, a spoken answer). Shown while the vetting
// engine is hidden from this person (Admin -> Skill checks -> Launch); MeSkillChecks.jsx picks this or the V2 page.
// Skill checks (Phase 5, H3): a 10-minute multiple-choice test per skill (IT and non-IT), 10 questions picked at random
// from the question bank, with a timer on screen. One try per skill every 30 days. The page counts how often you leave
// the tab (shown with the result; no camera, nothing else is watched). Up to 3 spoken answers (speak or type), kept as
// text only, each with clarity feedback. You decide whether companies hiring now see your result.
import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useToast } from '../../components/ui';
import { http } from '../../services/http';
import { MeHead } from './MeLayout';
import { appendSpeech, useSpeech } from '../../lib/summary/speech';
import { Bar, Chip, Empty, MeCard, ScoreRing, Skel, Stat, StickyBar } from './kit';
import '../../styles/me-learn.css';
import { IcCheckCircle, IcLock, IcMic, IcStop } from '../../components/icons';

const day = (ms) => (ms ? new Date(ms).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }) : '');
const clock = (s) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;

/** Seconds left until `endsAt` (ms), ticking each second. */
export function useLeft(endsAt) {
  const [left, setLeft] = useState(() => Math.max(0, Math.round((endsAt - Date.now()) / 1000)));
  useEffect(() => {
    const tick = () => setLeft(Math.max(0, Math.round((endsAt - Date.now()) / 1000)));
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [endsAt]);
  return left;
}

function Spoken({ i, q, value, onChange }) {
  const now = useRef(value.text);
  now.current = value.text;
  const sp = useSpeech({ lang: 'en-IN', onText: (w) => onChange({ ...value, text: appendSpeech(now.current, w).slice(0, 1500) }) });
  useEffect(() => { if (sp.listening) onChange({ ...value, seconds: sp.seconds }); }, [sp.seconds]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div className="field">
      <label className="label" htmlFor={`sk-sp-${i}`}>{q}</label>
      <textarea id={`sk-sp-${i}`} className="input" rows={3} maxLength={1500} value={value.text} onChange={(e) => onChange({ ...value, text: e.target.value })} data-testid={`sk-spoken-${i}`} />
      {sp.supported && <button type="button" className="btn btn-outline" style={{ alignSelf: 'flex-start', marginTop: 6 }} onClick={sp.listening ? sp.stop : sp.start}>{sp.listening ? <><IcStop size={16} /> Stop</> : <><IcMic size={16} /> Speak</>}</button>}
    </div>
  );
}

function Paper({ paper, onDone }) {
  const [answers, setAnswers] = useState({});
  const [spoken, setSpoken] = useState(() => paper.spoken.map((q) => ({ q, text: '', seconds: null })));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const switches = useRef(0);
  const [shown, setShown] = useState(0);
  const left = useLeft(paper.endsAt);
  const sent = useRef(false);
  useEffect(() => {
    const away = () => { if (document.visibilityState === 'hidden') { switches.current += 1; setShown(switches.current); } };
    document.addEventListener('visibilitychange', away);
    return () => document.removeEventListener('visibilitychange', away);
  }, []);
  const submit = async () => {
    if (sent.current) return;
    sent.current = true; setBusy(true); setErr('');
    try {
      const body = { answers, tabSwitches: switches.current, spoken: spoken.filter((s) => s.text.trim()).map((s) => ({ q: s.q, text: s.text.trim(), seconds: s.seconds || null })) };
      onDone(await http(`/api/me/skill-checks/${paper.id}/submit`, { method: 'POST', body }));
    } catch (e) { sent.current = false; setErr(e.message); } finally { setBusy(false); }
  };
  useEffect(() => { if (left === 0) submit(); }, [left]); // eslint-disable-line react-hooks/exhaustive-deps
  const done = Object.keys(answers).length;
  const total = paper.questions.length;
  return (
    <form className="stack g16" onSubmit={(e) => { e.preventDefault(); submit(); }} aria-label={`${paper.skill} skill check`} data-testid="sk-paper">
      <div className={`mcard mcard-tight ml-timer ${left < 60 ? 'low' : ''}`}>
        <div className="mspread">
          <div className="stack g4" style={{ minWidth: 0 }}>
            <span className="ml-qno">Skill check</span>
            <strong className="mserif" style={{ fontSize: 20, color: 'var(--ink)' }}>{paper.skill}</strong>
          </div>
          <span className="ml-timer-clock" aria-hidden="true">{clock(left)}</span>
        </div>
        <Bar value={done} max={total} label="Answered" showValue={false} tone="student" />
        <span className="small" role="timer" aria-live="off" data-testid="sk-timer">{clock(left)} left · {done} of {total} answered{shown ? ` · left the tab ${shown}×` : ''}</span>
      </div>
      <ol className="stack g12" style={{ listStyle: 'none', padding: 0, margin: 0 }}>
        {paper.questions.map((q, i) => (
          <li key={q.id} className="mcard">
            <fieldset style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }} data-testid="sk-q">
              <legend className="ml-qsmall"><span className="ml-qno" style={{ display: 'block', marginBottom: 6 }}>Question {i + 1} of {total}</span>{q.question}</legend>
              <div className="ml-opts">
                {q.options.map((o, k) => <label key={k} className="ml-opt"><input type="radio" name={`q${i}`} checked={answers[q.id] === k} onChange={() => setAnswers({ ...answers, [q.id]: k })} /><span>{o}</span></label>)}
              </div>
            </fieldset>
          </li>
        ))}
      </ol>
      <details className="mcard ml-details">
        <summary><span><strong>Optional: 3 spoken answers</strong> (speak or type; kept as text, never audio)</span></summary>
        <div className="stack g12" style={{ marginTop: 4 }}>
          {spoken.map((s, i) => <Spoken key={s.q} i={i} q={s.q} value={s} onChange={(v) => setSpoken(spoken.map((x, j) => (j === i ? v : x)))} />)}
        </div>
      </details>
      {err && <p className="error" role="alert">{err}</p>}
      <StickyBar label="Finish">
        <button type="submit" className="btn btn-signal" disabled={busy} data-testid="sk-submit">Finish and see my score</button>
        <span className="small muted">{done} of {total} answered</span>
      </StickyBar>
    </form>
  );
}

function Result({ r, onShare }) {
  return (
    <section className="mcard mcard-accent" aria-label={`${r.skill} result`} data-testid="sk-result">
      <div className="ml-result">
        <ScoreRing value={r.late ? 0 : r.score} label={`${r.skill} score`} sub="%" />
        <div className="stack g8" style={{ minWidth: 0 }}>
          <span className="mkicker">Your result</span>
          <h2 className="ml-hero-title">{r.skill}</h2>
          <span><Chip tone={r.late ? 'warn' : 'accent'} testid="sk-score">{r.late ? 'Time ran out' : `${r.score}% · ${r.right} of ${r.total} right`}</Chip></span>
          <span className="xs muted">{day(r.startedAt)} · {r.tabSwitches ? `left the tab ${r.tabSwitches}×` : 'stayed on the test'} · next try from {day(r.againAt)}</span>
        </div>
      </div>
      {r.spoken.length > 0 && (
        <div className="stack g8">
          <span className="ml-box-h">Your spoken answers</span>
          {r.spoken.map((s, i) => (
            <div key={i} className="mitem" style={{ alignItems: 'flex-start' }}>
              <div className="mitem-main" style={{ gap: 6 }}>
                <strong className="small">{s.q}</strong>
                <p className="ml-quote">“{s.text}”</p>
                {Object.values(s.feedback).map((f, k) => <span key={k} className="xs muted">{f}</span>)}
              </div>
            </div>
          ))}
        </div>
      )}
      <label className="ml-toggle"><input type="checkbox" checked={r.share} onChange={(e) => onShare(r, e.target.checked)} data-testid="sk-share" />Show this result to companies hiring now</label>
    </section>
  );
}

export default function MeSkillChecksClassic() {
  const toast = useToast();
  const [cat, setCat] = useState(null);
  const [paper, setPaper] = useState(null);
  const [last, setLast] = useState(null);
  const [err, setErr] = useState('');
  const load = () => http('/api/me/skill-checks').then(setCat, (e) => setErr(e.message));
  useEffect(() => { load(); }, []);
  const start = async (skill) => {
    setErr('');
    try { setPaper(await http('/api/me/skill-checks/start', { method: 'POST', body: { skill } })); window.scrollTo(0, 0); } catch (e) { setErr(e.message); }
  };
  const share = async (r, on) => {
    try { const x = await http(`/api/me/skill-checks/${r.id}/share`, { method: 'PUT', body: { share: on } }); setLast((l) => (l?.id === x.id ? x : l)); toast(on ? 'Companies hiring now can see it' : 'Hidden from companies'); load(); } catch (e) { toast(e.message); }
  };
  if (paper) return <><MeHead title="Skill check" sub="10 minutes. Pick one answer for each question; it is sent by itself when the time ends." /><Paper paper={paper} onDone={(r) => { setPaper(null); setLast(r); load(); }} /></>;
  if (!cat) return err ? <p className="error" role="alert">{err}</p> : <><MeHead title="Skill checks" /><Skel cards={4} label="Loading skill checks" /></>;
  const doneCount = cat.skills.filter((s) => s.last?.done).length;
  return (
    <>
      <MeHead title="Skill checks" sub={`A ${cat.minutes}-minute test per skill, ${cat.questions} questions. One try every ${cat.everyDays} days. You choose whether companies see your score.`} />
      {last && <Result r={last} onShare={share} />}
      {err && <p className="error" role="alert">{err}</p>}
      <div className="mgrid-3">
        <Stat label="Time per test" value={`${cat.minutes} min`} />
        <Stat label="Questions" value={cat.questions} />
        <Stat label="Taken so far" value={doneCount} sub={`of ${cat.skills.length} skills`} />
      </div>
      {cat.skills.length === 0 ? <Empty shape="cap" tint="student" title="No skill checks yet" action={<Link className="btn btn-signal" to="/me/practice">Practise for free</Link>}>Skill checks are being added. Practice tests are open now.</Empty> : (
        <ul className="mgrid" style={{ listStyle: 'none', padding: 0, margin: 0 }} data-testid="sk-list">
          {cat.skills.map((s) => (
            <li key={s.skill} className="mcard mcard-tight" data-testid="sk-skill">
              <div className="mrow" style={{ flexWrap: 'nowrap', alignItems: 'flex-start' }}>
                <span className="mcard-ic student" aria-hidden="true"><IcCheckCircle /></span>
                <span className="stack g4" style={{ minWidth: 0, flex: 1 }}>
                  <strong className="mserif" style={{ fontSize: 20, color: 'var(--ink)', overflowWrap: 'anywhere' }}>{s.skill}</strong>
                  <span className="xs muted">{s.role}</span>
                </span>
              </div>
              {s.last?.done && <span className="mrow"><Chip tone={s.last.score >= 70 ? 'ok' : 'warn'}>Your score {s.last.score}%</Chip>{s.last.share && <Chip tone="info">Shared</Chip>}</span>}
              {s.last && !s.last.canRetry
                ? (s.last.done ? <button type="button" className="btn btn-outline" onClick={() => setLast(s.last)}>See result</button> : <Chip tone="neutral">Next try from {day(s.last.againAt)}</Chip>)
                : <button type="button" className="btn btn-signal" onClick={() => start(s.skill)} data-testid={`sk-start-${s.skill}`}>Start ({cat.minutes} min)</button>}
            </li>
          ))}
        </ul>
      )}
      <MeCard tone="flat" className="mcard-tight" icon={<IcLock />} title="Fair and private" sub="No camera and no screen recording. We only count how often you leave the test tab." headingLevel={2} />
    </>
  );
}
