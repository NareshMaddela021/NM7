// The skill check itself (Vetting V2), loaded only when a test starts: one question at a time with big answer
// buttons, the question's own countdown (it moves on by itself) and the whole test's time left (the server's clock).
// Answers are saved after each one and every 20 seconds, and kept in this tab too, so a reload or a dropped
// connection carries on where it stopped. Keyboard: 1–4 pick an answer, arrows move, Enter goes on.
import { useCallback, useEffect, useRef, useState } from 'react';
import { http } from '../../../services/http';
import { Bar } from '../kit';
import { API, clock, emptySignals, fingerprint, questionAnnounce, readStore, runKey, totalAnnounce, useSignals, writeStore } from './lib';
import { SnapNote, useSnapshots } from '../trust/Snapshots'; // Vetting Trust T8: optional webcam stills (consent only)
import '../../../styles/me-vet.css';
import { IcLock } from '../../../components/icons';

const SAVE_EVERY = 20_000;

export default function TestRunner({ paper, onDone, onError }) {
  const qs = paper.questions;
  const kept = readStore(runKey(paper.id)) || {};
  const [answers, setAnswers] = useState(() => ({ ...(paper.answers || {}), ...(kept.answers || {}) }));
  const times = useRef({ ...(kept.times || {}) });
  const signals = useRef({ ...emptySignals(), ...(kept.signals || {}) });
  const [idx, setIdx] = useState(() => {
    const a = { ...(paper.answers || {}), ...(kept.answers || {}) };
    const at = Math.max(kept.idx || 0, qs.findIndex((q) => !(q.id in a)));
    return at < 0 ? qs.length : Math.min(at, qs.length);
  });
  const [save, setSave] = useState('idle'); // idle | saving | saved | offline
  const [sending, setSending] = useState(false);
  const [sendErr, setSendErr] = useState('');
  const [say, setSay] = useState('');
  const fp = useRef('');
  const sent = useRef(false);
  const answersRef = useRef(answers);
  answersRef.current = answers;

  // the whole test's clock: counts down here, corrected by the server's answer to each save
  const anchor = useRef({ ms: paper.remainingMs, at: Date.now() });
  const [totalLeft, setTotalLeft] = useState(Math.ceil(paper.remainingMs / 1000));
  // this question's clock
  const q = qs[idx];
  const shownAt = useRef(Date.now());
  const [qLeft, setQLeft] = useState(q?.seconds || 0);

  useSignals(signals);
  const snap = useSnapshots('skill', paper.id);
  useEffect(() => { fingerprint().then((x) => { fp.current = x; }); }, []);

  const persist = useCallback((extra = {}) => {
    writeStore(runKey(paper.id), { answers: answersRef.current, times: times.current, signals: signals.current, idx, ...extra });
  }, [paper.id, idx]);

  const body = () => ({ answers: answersRef.current, times: times.current, signals: signals.current, fp: fp.current });

  const submit = useCallback(async () => {
    if (sent.current) return;
    sent.current = true; setSending(true); setSendErr('');
    persist();
    try {
      const r = await http(`${API}/${paper.id}/submit`, { method: 'POST', body: body(), retry: 2 });
      writeStore(runKey(paper.id), null);
      onDone(r);
    } catch (e) {
      if (e.code === 'done') { writeStore(runKey(paper.id), null); onDone(null); return; } // finished already: show the result
      sent.current = false; setSending(false);
      setSendErr(e.status === 0 || e.status >= 500 ? 'Your answers are kept on this phone. Check the internet and tap “Send again”.' : e.message);
    }
  }, [paper.id, persist, onDone]); // eslint-disable-line react-hooks/exhaustive-deps

  const saveNow = useCallback(async () => {
    if (sent.current) return;
    setSave('saving');
    try {
      const r = await http(`${API}/${paper.id}/progress`, { method: 'PUT', body: body() });
      if (r.done) { writeStore(runKey(paper.id), null); sent.current = true; onDone(null); return; }
      anchor.current = { ms: r.remainingMs, at: Date.now() };
      setSave('saved');
    } catch (e) {
      if (e.status === 404) { onError?.(e.message); return; }
      setSave('offline');
    }
  }, [paper.id, onDone, onError]); // eslint-disable-line react-hooks/exhaustive-deps

  // tick both clocks; announce politely at a few points only
  useEffect(() => {
    const id = setInterval(() => {
      const total = Math.max(0, Math.ceil((anchor.current.ms - (Date.now() - anchor.current.at)) / 1000));
      setTotalLeft((old) => { if (old !== total) { const m = totalAnnounce(total); if (m) setSay(m); } return total; });
      if (qs[idx]) {
        const left = Math.max(0, Math.ceil(qs[idx].seconds - (Date.now() - shownAt.current) / 1000));
        setQLeft((old) => { if (old !== left) { const m = questionAnnounce(left); if (m) setSay(m); } return left; });
      }
    }, 250);
    return () => clearInterval(id);
  }, [idx, qs]);

  // every 20 seconds, and when the connection comes back
  useEffect(() => {
    const id = setInterval(saveNow, SAVE_EVERY);
    const online = () => saveNow();
    window.addEventListener('online', online);
    return () => { clearInterval(id); window.removeEventListener('online', online); };
  }, [saveNow]);

  useEffect(() => { persist(); }, [persist, answers]);
  useEffect(() => { if (totalLeft <= 0) submit(); }, [totalLeft, submit]);

  const next = useCallback(() => {
    const cur = qs[idx];
    if (!cur) return;
    const skipped = !(cur.id in answersRef.current);
    if (skipped) times.current[cur.id] = Date.now() - shownAt.current; // skipped (or its time ran out)
    shownAt.current = Date.now();
    const to = idx + 1;
    setIdx(to);
    setQLeft(qs[to]?.seconds || 0);
    writeStore(runKey(paper.id), { answers: answersRef.current, times: times.current, signals: signals.current, idx: to });
    if (skipped) saveNow(); // an answer was saved the moment it was picked
  }, [idx, qs, paper.id, saveNow]);

  // the question's own time is up: on to the next one
  useEffect(() => { if (q && qLeft <= 0) { setSay('Time is up for this question. Next question.'); next(); } }, [qLeft]); // eslint-disable-line react-hooks/exhaustive-deps

  const pick = useCallback((k) => {
    const cur = qs[idx];
    if (!cur || k < 0 || k >= cur.options.length) return;
    times.current[cur.id] = Date.now() - shownAt.current;
    const a = { ...answersRef.current, [cur.id]: k };
    answersRef.current = a;
    setAnswers(a);
    saveNow();
  }, [idx, qs, saveNow]);

  // keyboard: 1–4, arrows, Enter
  const card = useRef(null);
  useEffect(() => {
    const onKey = (e) => {
      if (e.altKey || e.ctrlKey || e.metaKey || !qs[idx]) return;
      const tag = e.target?.tagName;
      if (tag === 'TEXTAREA' || (tag === 'INPUT' && e.target.type !== 'radio')) return;
      const n = Number(e.key);
      const cur = answersRef.current[qs[idx].id];
      if (n >= 1 && n <= qs[idx].options.length) { e.preventDefault(); pick(n - 1); return; }
      if (e.target?.type === 'radio') {
        if (e.key === 'Enter' && cur != null) { e.preventDefault(); next(); }
        return; // the browser moves between radios with the arrows itself
      }
      if (e.key === 'ArrowDown' || e.key === 'ArrowRight') { e.preventDefault(); pick(cur == null ? 0 : Math.min(qs[idx].options.length - 1, cur + 1)); }
      else if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') { e.preventDefault(); pick(cur == null ? 0 : Math.max(0, cur - 1)); }
      else if (e.key === 'Enter' && cur != null && tag !== 'BUTTON' && tag !== 'A') { e.preventDefault(); next(); }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [idx, qs, pick, next]);

  // move focus to the new question so a screen reader reads it
  useEffect(() => { card.current?.focus({ preventScroll: true }); window.scrollTo?.(0, 0); }, [idx]);

  const done = Object.keys(answers).length;
  const total = qs.length;
  const low = totalLeft <= 60;
  const status = save === 'offline' ? 'Offline — your answers are kept' : save === 'saving' ? 'Saving…' : save === 'saved' ? 'Saved' : '';

  return (
    <div className="vet-run" data-testid="vt-runner">
      <div className={`mcard mcard-tight vet-bar ${low ? 'low' : ''}`}>
        <div className="vet-bar-row">
          <span className="stack g2" style={{ minWidth: 0 }}>
            <span className="mkicker">{paper.role || paper.skill} · {paper.bandLabel}</span>
            <strong className="vet-bar-title">{idx < total ? `Question ${idx + 1} of ${total}` : 'All questions seen'}</strong>
          </span>
          <span className="vet-clocks">
            {q && <span className={`vet-clock ${qLeft <= 10 ? 'low' : ''}`} role="timer" aria-live="off" aria-label={`This question: ${clock(qLeft)} left`} data-testid="vt-qtime"><small>This question</small>{clock(qLeft)}</span>}
            <span className={`vet-clock ${low ? 'low' : ''}`} role="timer" aria-live="off" aria-label={`Whole test: ${clock(totalLeft)} left`} data-testid="vt-time"><small>Whole test</small>{clock(totalLeft)}</span>
          </span>
        </div>
        <Bar value={done} max={total} label={`${done} of ${total} answered`} showValue={false} tone="accent" />
        <span className={`vet-save ${save}`} aria-live="polite" data-testid="vt-save">{status}</span>
        <SnapNote st={snap} />
      </div>
      <p className="sr-only" aria-live="polite" data-testid="vt-say">{say}</p>

      {q ? (
        <section className="mcard vet-q" ref={card} tabIndex={-1} aria-labelledby="vt-qtext" data-testid="vt-q">
          <fieldset className="vet-fs">
            <legend id="vt-qtext" className="vet-qtext" lang={paper.lang}>{q.question}</legend>
            <div className="vet-opts" lang={paper.lang}>
              {q.options.map((o, k) => (
                <label key={k} className={`vet-opt ${answers[q.id] === k ? 'on' : ''}`} data-testid="vt-opt">
                  <input type="radio" name={`vq-${q.id}`} value={k} checked={answers[q.id] === k} onChange={() => pick(k)} aria-label={`${k + 1}. ${o}`} />
                  <span className="vet-opt-k" aria-hidden="true">{k + 1}</span>
                  <span className="vet-opt-t">{o}</span>
                </label>
              ))}
            </div>
          </fieldset>
          <div className="vet-actions">
            <button type="button" className="btn btn-signal btn-lg" onClick={next} data-testid="vt-next">{answers[q.id] == null ? 'Skip this question' : idx + 1 < total ? 'Next question' : 'Finish'}</button>
            <span className="xs muted vet-keys">Keys: 1–{q.options.length} to pick, Enter for next</span>
          </div>
        </section>
      ) : (
        <section className="mcard mcard-accent vet-q" ref={card} tabIndex={-1} aria-label="Send your answers" data-testid="vt-end">
          <h2 className="mcard-title">You have seen every question</h2>
          <p className="small" style={{ margin: 0 }}>{done} of {total} answered. Send your answers to see your score now.</p>
          {sendErr && <p className="error" role="alert">{sendErr}</p>}
          <div className="vet-actions">
            <button type="button" className="btn btn-signal btn-lg" onClick={submit} disabled={sending} data-testid="vt-submit">{sending ? 'Sending…' : sendErr ? 'Send again' : 'Send and see my score'}</button>
          </div>
        </section>
      )}
      {q && sendErr && <p className="error" role="alert">{sendErr} <button type="button" className="btn btn-outline" onClick={submit}>Send again</button></p>}
      <p className="xs muted" style={{ margin: 0 }}><IcLock size={14} /> No camera. Leaving this page, copy / paste and right-click are counted, never blocked.</p>
    </div>
  );
}
