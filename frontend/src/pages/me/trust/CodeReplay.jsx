// Vetting Trust T14: play back how a coding task's solution was written — the code editor only, nothing else (Admin,
// and the company where Vetting Trust allows). Play / pause, 1x / 4x / 16x (long pauses play as 3 s), a slider, the
// paste moments marked on the timeline (big ones in red) and the pasted text highlighted when it lands.
import { useEffect, useMemo, useRef, useState } from 'react';
import { SPEEDS, delayFor, pasteMarks, pasteSpan, statsLine } from './codeLib';
import '../../../styles/code-task.css';

export default function CodeReplay({ replay, title = 'How the code was written' }) {
  const n = replay.events.length;
  const [i, setI] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(4);
  const marks = useMemo(() => pasteMarks(replay), [replay]);
  const timer = useRef(null);
  useEffect(() => {
    if (!playing) return undefined;
    if (i >= n) { setPlaying(false); return undefined; }
    timer.current = setTimeout(() => setI((x) => x + 1), delayFor(replay, i, speed));
    return () => clearTimeout(timer.current);
  }, [playing, i, n, speed, replay]);
  const span = pasteSpan(replay, i);
  const ev = replay.events[i - 1];
  return (
    <section className="ct-replay stack g8" aria-label={title} data-testid="ct-replay">
      <strong className="small">{title}</strong>
      <span className="xs muted">Only the code editor was recorded (with the candidate’s consent). {statsLine(replay.stats)}{replay.truncated ? ' · the recording stopped at its size limit' : ''}</span>
      <div className="ct-row">
        <button type="button" className="btn btn-outline btn-sm" onClick={() => { if (i >= n) setI(0); setPlaying(!playing); }} data-testid="ct-play">{playing ? 'Pause' : i >= n ? 'Play again' : 'Play'}</button>
        <span role="group" aria-label="Speed" className="ct-speeds">
          {SPEEDS.map((s) => <button key={s} type="button" className={`btn btn-sm ${speed === s ? 'btn-signal' : 'btn-ghost'}`} aria-pressed={speed === s} onClick={() => setSpeed(s)} data-testid={`ct-speed-${s}`}>{s}x</button>)}
        </span>
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => { setPlaying(false); setI(n); }} data-testid="ct-end">Final code</button>
      </div>
      <div className="ct-track">
        <input type="range" min={0} max={n} value={i} onChange={(e) => { setPlaying(false); setI(Number(e.target.value)); }} aria-label="Position in the replay" className="ct-range" data-testid="ct-range" />
        <div className="ct-marks" aria-hidden="true">{marks.map((m) => <span key={m.i} className={`ct-mark ${m.big ? 'big' : ''}`} style={{ left: `${m.at * 100}%` }} title={`Paste of ${m.size} characters`} />)}</div>
      </div>
      {marks.length > 0 && (
        <ul className="ct-pastes" aria-label="Paste moments" data-testid="ct-pastes">
          {marks.map((m) => <li key={m.i}><button type="button" className={`btn btn-ghost btn-sm ${m.big ? 'ct-big' : ''}`} onClick={() => { setPlaying(false); setI(m.i + 1); }}>Paste of {m.size} characters{m.big ? ' (large)' : ''}</button></li>)}
        </ul>
      )}
      <span className="xs muted" aria-live="polite" data-testid="ct-step">Step {i} of {n}{ev?.[1] === 'p' ? ` · pasted ${ev[4].length} characters` : ev?.[1] === 'b' ? ' · left the editor' : ev?.[1] === 'f' ? ' · came back to the editor' : ev?.[1] === 's' ? ' · switched language / reset' : ''}</span>
      <pre className="ct-code ct-play-code" tabIndex={0} aria-label="The code at this point" data-testid="ct-code">{span.before}{span.mark && <mark className="ct-paste" data-testid="ct-paste-mark">{span.mark}</mark>}{span.after}</pre>
    </section>
  );
}
