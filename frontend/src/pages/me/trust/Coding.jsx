// Vetting Trust T14: the coding task (loaded only when a practical task opens as "coding"). A light editor (a textarea:
// Tab indents, line numbers), the language picker with each language's starter code, "Run" against the VISIBLE samples
// (output vs expected), and "Submit" that runs the hidden tests in Nm7's code sandbox: "X of Y hidden tests passed" and
// the names of failing visible samples only. The code is saved as you type (no lost work); if the sandbox is down the
// submission waits in a queue and is checked by itself. With the "Coding replay" consent the editor's typing is recorded
// in a compact form and sent with the code (only the editor, nothing else).
import { useEffect, useRef, useState } from 'react';
import { http } from '../../../services/http';
import { API, emptySignals, useSignals } from '../vetting/lib';
import { createRecorder } from './codeLib';
import '../../../styles/code-task.css';

const CODE = '/api/me/trust/code';

function Results({ results }) {
  return (
    <ul className="ct-results" aria-label="Sample test results" data-testid="ct-results">
      {results.map((r) => (
        <li key={r.name} className={`ct-result ${r.passed ? 'ok' : 'bad'}`} data-testid="ct-result">
          <strong>{r.passed ? '✓' : '✗'} {r.name}</strong>
          {!r.passed && <span className="xs">{r.statusText}</span>}
          {!r.passed && (
            <div className="ct-io">
              <span className="xs muted">Your output</span><pre className="ct-out">{r.stdout || r.stderr || '(nothing)'}{r.truncated ? '\n… (cut: too long)' : ''}</pre>
              <span className="xs muted">Expected</span><pre className="ct-out">{r.expected}</pre>
            </div>
          )}
        </li>
      ))}
    </ul>
  );
}

export default function Coding({ attempt, task, left, onDone, onCancel }) {
  const cv = task.coding;
  const first = cv.draft?.language || cv.languages[0].key;
  const starters = Object.fromEntries(cv.languages.map((l) => [l.key, l.starter]));
  const [lang, setLang] = useState(first);
  const [code, setCode] = useState(cv.draft?.source ?? starters[first]);
  const [results, setResults] = useState(null);
  const [runsLeft, setRunsLeft] = useState(cv.runsLeft);
  const [busy, setBusy] = useState('');
  const [msg, setMsg] = useState('');
  const [sub, setSub] = useState(cv.submission);
  const [saved, setSaved] = useState('');
  const rec = useRef(null);
  if (!rec.current) rec.current = createRecorder(cv.draft?.source ?? starters[first], first, { keep: !!cv.consent?.given, maxEvents: cv.replayMax?.events, maxBytes: cv.replayMax?.bytes });
  const pasting = useRef(false);
  const sig = useRef(emptySignals());
  useSignals(sig, { on: !sub });
  const area = useRef(null);
  const nums = useRef(null);

  // saved as they type (2 s after the last key), so a reload or a dropped connection loses nothing
  useEffect(() => {
    if (sub) return undefined;
    const id = setTimeout(() => {
      http(`${CODE}/${attempt.id}/draft`, { method: 'PUT', body: { language: lang, source: code } }).then(() => setSaved('Saved'), () => setSaved('Not saved yet: offline?'));
    }, 2000);
    return () => clearTimeout(id);
  }, [code, lang, attempt.id, sub]);

  // a queued submission: check again every 15 s until it is done
  useEffect(() => {
    if (sub?.status !== 'queued' && sub?.status !== 'running') return undefined;
    const id = setInterval(async () => {
      try {
        const v = await http(`${CODE}/${attempt.id}`);
        setSub(v.submission);
        if (v.submission?.status === 'done' || v.submission?.status === 'review') onDone(await http(`${API}/${attempt.id}`));
      } catch { /* try again next time */ }
    }, 15_000);
    return () => clearInterval(id);
  }, [sub?.status, attempt.id, onDone]);

  const change = (next) => { rec.current.edit(code, next, pasting.current); pasting.current = false; setCode(next); setSaved(''); };
  const keyDown = (e) => {
    if (e.key !== 'Tab' || e.shiftKey || e.altKey || e.ctrlKey || e.metaKey) return;
    if (e.target.selectionStart !== e.target.selectionEnd) return; // keep Tab to move focus out when text is selected
    e.preventDefault();
    const s = e.target.selectionStart;
    const next = `${code.slice(0, s)}    ${code.slice(s)}`;
    change(next);
    requestAnimationFrame(() => { if (area.current) area.current.selectionStart = area.current.selectionEnd = s + 4; });
  };
  const pickLang = (k) => {
    if (k === lang) return;
    const fresh = code === starters[lang] || window.confirm('Switch language? Your code will be replaced by the starter code for the new language.');
    if (!fresh) return;
    setLang(k); setCode(starters[k]); setResults(null);
    rec.current.set(starters[k], k);
  };
  const run = async () => {
    setBusy('run'); setMsg('');
    try { const r = await http(`${CODE}/${attempt.id}/run`, { method: 'POST', body: { language: lang, source: code }, timeout: 70_000 }); setResults(r.results); setRunsLeft(r.runsLeft); } catch (x) { setMsg(x.message); } finally { setBusy(''); }
  };
  const submit = async () => {
    if (!window.confirm('Submit your code? It runs against the hidden tests and you can’t change it afterwards.')) return;
    setBusy('submit'); setMsg('');
    try {
      const body = { language: lang, source: code, stats: rec.current.counters(), blurs: sig.current.blurs, blurMs: sig.current.blurMs };
      const data = rec.current.data();
      if (data) body.replay = data;
      const r = await http(`${CODE}/${attempt.id}/submit`, { method: 'POST', body, timeout: 120_000 });
      setSub(r.submission);
      if (r.submission.status === 'done' || r.submission.status === 'review') onDone(await http(`${API}/${attempt.id}`));
    } catch (x) { setMsg(x.message); } finally { setBusy(''); }
  };
  const lines = code.split('\n').length;

  if (sub) {
    return (
      <div className="ct-wait" role="status" data-testid="ct-queued">
        <strong>{sub.status === 'done' ? sub.line : 'Your code is saved and waiting to be checked'}</strong>
        <span className="small">{sub.note || 'It runs against the hidden tests in a moment. You can leave this page: your result appears here.'}</span>
        <button type="button" className="btn btn-outline" onClick={onCancel}>Back to my result</button>
      </div>
    );
  }
  return (
    <div className="stack g12" data-testid="ct-task">
      <div className="ct-row">
        <label className="label" htmlFor="ct-lang">Language</label>
        <select id="ct-lang" className="input ct-lang" value={lang} onChange={(e) => pickLang(e.target.value)} data-testid="ct-lang">
          {cv.languages.map((l) => <option key={l.key} value={l.key}>{l.label}</option>)}
        </select>
        <span className="xs muted" aria-live="polite" data-testid="ct-saved">{saved}</span>
      </div>
      {cv.consent?.given
        ? <span className="xs muted" data-testid="ct-recording">Your typing in this editor is recorded to show reviewers how the solution was written (you agreed to “{cv.consent.title}”).</span>
        : <span className="xs muted">Your typing is not recorded.</span>}
      <div className="ct-editor">
        <pre ref={nums} className="ct-nums" aria-hidden="true">{Array.from({ length: lines }, (_, k) => k + 1).join('\n')}</pre>
        <textarea
          ref={area} className="ct-area" value={code} spellCheck={false} autoCapitalize="off" autoCorrect="off" wrap="off"
          aria-label={`Your code (${cv.languages.find((l) => l.key === lang)?.label}). Tab adds 4 spaces.`} data-testid="ct-code-input"
          onChange={(e) => change(e.target.value)} onKeyDown={keyDown} onPaste={() => { pasting.current = true; }}
          onBlur={() => rec.current.mark('b')} onFocus={() => rec.current.mark('f')}
          onScroll={(e) => { if (nums.current) nums.current.scrollTop = e.target.scrollTop; }}
        />
      </div>
      <details className="small" open data-testid="ct-samples">
        <summary style={{ minHeight: 44, display: 'flex', alignItems: 'center', cursor: 'pointer' }}>Sample tests ({cv.samples.length}) · {cv.hiddenCount} hidden tests check your code when you submit</summary>
        {cv.samples.map((s) => (
          <div key={s.name} className="ct-io"><strong className="xs">{s.name}</strong><span className="xs muted">Input</span><pre className="ct-out">{s.stdin}</pre><span className="xs muted">Expected output</span><pre className="ct-out">{s.expected}</pre></div>
        ))}
      </details>
      {results && <Results results={results} />}
      {msg && <p className="error" role="alert" data-testid="ct-msg">{msg}</p>}
      {left === 0 && <p className="small" style={{ color: '#92400e', margin: 0 }}>The time is up. Please submit what you have now.</p>}
      <div className="vet-actions">
        <button type="button" className="btn btn-outline btn-lg" disabled={!!busy || runsLeft <= 0} onClick={run} data-testid="ct-run">{busy === 'run' ? 'Running…' : 'Run the samples'}</button>
        <button type="button" className="btn btn-signal btn-lg" disabled={!!busy || !code.trim()} onClick={submit} data-testid="ct-submit">{busy === 'submit' ? 'Checking…' : 'Submit my code'}</button>
        <button type="button" className="btn btn-ghost" onClick={onCancel}>Do it later</button>
        <span className="xs muted">{runsLeft} runs left · limits: {cv.limits.cpuS} s, {cv.limits.memoryMb} MB, no internet</span>
      </div>
    </div>
  );
}
