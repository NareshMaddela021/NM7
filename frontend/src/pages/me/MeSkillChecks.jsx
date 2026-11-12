// Skill checks (Phase 5, H3): a 10-minute multiple-choice test per skill (IT and non-IT), 10 questions picked at random
// from the question bank, with a timer on screen. One try per skill every 30 days. The page counts how often you leave
// the tab (shown with the result; no camera, nothing else is watched). Up to 3 spoken answers (speak or type), kept as
// text only, each with clarity feedback. You decide whether companies hiring now see your result.
import { useEffect, useRef, useState } from 'react';
import { useToast } from '../../components/ui';
import { http } from '../../services/http';
import { MeHead } from './MeLayout';
import { appendSpeech, useSpeech } from '../../lib/summary/speech';

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
      {sp.supported && <button type="button" className="btn btn-outline btn-sm" style={{ alignSelf: 'flex-start', marginTop: 6 }} onClick={sp.listening ? sp.stop : sp.start}>{sp.listening ? '⏹ Stop' : '🎤 Speak'}</button>}
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
  return (
    <form className="stack g12" onSubmit={(e) => { e.preventDefault(); submit(); }} aria-label={`${paper.skill} skill check`} data-testid="sk-paper">
      <div className="card row between g8" style={{ position: 'sticky', top: 8, zIndex: 2, flexWrap: 'wrap' }}>
        <strong>{paper.skill}</strong>
        <span className="small" role="timer" aria-live="off" data-testid="sk-timer">{clock(left)} left · {done} of {paper.questions.length} answered{shown ? ` · left the tab ${shown}×` : ''}</span>
      </div>
      <ol className="stack g12" style={{ paddingLeft: 20, margin: 0 }}>
        {paper.questions.map((q, i) => (
          <li key={q.id} className="card-sm">
            <fieldset style={{ border: 0, padding: 0, margin: 0 }} data-testid="sk-q">
              <legend className="small" style={{ fontWeight: 600, marginBottom: 6 }}>{q.question}</legend>
              <div className="stack g4">
                {q.options.map((o, k) => <label key={k} className="row g8 small" style={{ alignItems: 'flex-start' }}><input type="radio" name={`q${i}`} checked={answers[q.id] === k} onChange={() => setAnswers({ ...answers, [q.id]: k })} style={{ marginTop: 3 }} /><span>{o}</span></label>)}
              </div>
            </fieldset>
          </li>
        ))}
      </ol>
      <details className="card-sm">
        <summary className="small"><strong>Optional: 3 spoken answers</strong> (speak or type; kept as text, never audio)</summary>
        <div className="stack g12" style={{ marginTop: 8 }}>
          {spoken.map((s, i) => <Spoken key={s.q} i={i} q={s.q} value={s} onChange={(v) => setSpoken(spoken.map((x, j) => (j === i ? v : x)))} />)}
        </div>
      </details>
      {err && <p className="error" role="alert">{err}</p>}
      <button type="submit" className="btn btn-ink" style={{ alignSelf: 'flex-start' }} disabled={busy} data-testid="sk-submit">Finish and see my score</button>
    </form>
  );
}

function Result({ r, onShare }) {
  return (
    <section className="card stack g8" aria-label={`${r.skill} result`} data-testid="sk-result">
      <div className="row between g8" style={{ flexWrap: 'wrap' }}>
        <strong>{r.skill}</strong>
        <span className="badge b-signal" data-testid="sk-score">{r.late ? 'Time ran out' : `${r.score}% · ${r.right} of ${r.total} right`}</span>
      </div>
      <span className="xs muted">{day(r.startedAt)} · {r.tabSwitches ? `left the tab ${r.tabSwitches}×` : 'stayed on the test'} · next try from {day(r.againAt)}</span>
      {r.spoken.map((s, i) => (
        <div key={i} className="card-sm stack g4">
          <span className="small"><strong>{s.q}</strong></span>
          <span className="small">“{s.text}”</span>
          {Object.values(s.feedback).map((f, k) => <span key={k} className="xs muted">{f}</span>)}
        </div>
      ))}
      <label className="row g8 small"><input type="checkbox" checked={r.share} onChange={(e) => onShare(r, e.target.checked)} data-testid="sk-share" />Show this result to companies hiring now</label>
    </section>
  );
}

export default function MeSkillChecks() {
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
  if (!cat) return err ? <p className="error" role="alert">{err}</p> : <p className="muted">Loading…</p>;
  return (
    <>
      <MeHead title="Skill checks" sub={`A ${cat.minutes}-minute test per skill, ${cat.questions} questions. One try every ${cat.everyDays} days. You choose whether companies see your score.`} />
      {last && <Result r={last} onShare={share} />}
      {err && <p className="error" role="alert">{err}</p>}
      <ul className="stack g8" style={{ listStyle: 'none', padding: 0, margin: 0 }} data-testid="sk-list">
        {cat.skills.map((s) => (
          <li key={s.skill} className="card row between g8" style={{ flexWrap: 'wrap' }} data-testid="sk-skill">
            <span className="stack g4"><strong>{s.skill}</strong><span className="xs muted">{s.role}{s.last?.done ? ` · your score ${s.last.score}%${s.last.share ? ' (shared)' : ''}` : ''}</span></span>
            {s.last && !s.last.canRetry
              ? (s.last.done ? <button type="button" className="btn btn-outline btn-sm" onClick={() => setLast(s.last)}>See result</button> : <span className="xs muted">Next try from {day(s.last.againAt)}</span>)
              : <button type="button" className="btn btn-ink btn-sm" onClick={() => start(s.skill)} data-testid={`sk-start-${s.skill}`}>Start ({cat.minutes} min)</button>}
          </li>
        ))}
      </ul>
      <p className="xs muted">No camera and no screen recording. We only count how often you leave the test tab.</p>
    </>
  );
}
