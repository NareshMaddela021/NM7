// The screening interview itself (Vetting V3), loaded only when an interview starts: one question at a time with its own
// countdown (said out loud at 60, 30 and 10 seconds), "Question n of 7", and a follow-up shown as "Follow-up: …".
// Typed answers: pasting (and dropping text) is turned off and counted, with a polite note. Spoken answers: the
// browser turns speech into text (en-IN / te-IN / hi-IN); no audio leaves the phone. A browser without speech falls
// back to typing. Time away from the page is sent with each answer. When the time runs out the answer goes by itself.
// After the 7th answer the interview is finished (graded) and the result is handed back.
// Vetting Trust T10 (only when the server says the interview measures spoken English: `iv.spoken`): each spoken answer
// also sends the time actually spent speaking and its long pauses (from the speech events), and, when a provider is
// set (`iv.spoken.audio`), a short WAV clip of it for pronunciation (recorder.js; sent, then dropped).
import { useCallback, useEffect, useRef, useState } from 'react';
import { http } from '../../../services/http';
import { appendSpeech, speechSupported, useSpeech } from '../../../lib/speechCore';
import { Bar } from '../kit';
import { SPEECH_LANG, clock, emptySignals, useSignals, words } from '../vetting/lib';
import { API, answerAnnounce, signalDelta } from './lib';
import { SnapNote, useSnapshots } from '../trust/Snapshots'; // Vetting Trust T8: optional webcam stills (consent only)
import { speechTiming } from '../trust/spokenLib'; // Vetting Trust T10: timing of a spoken answer
import { createRecorder } from './recorder'; // T10: the clip for pronunciation (only with a provider)
import '../../../styles/me-vet.css';
import '../../../styles/me-iv.css';
import { IcLock, IcMic, IcStop } from '../../../components/icons';

function Typed({ text, setText, onPasteTry, pasteNote, lang, label }) {
  const n = words(text);
  const block = (e) => { e.preventDefault(); onPasteTry(); };
  return (
    <div className="field">
      <label className="label" htmlFor="iv-text">{label}</label>
      <textarea id="iv-text" className="input vet-text iv-text" rows={7} maxLength={2500} value={text} lang={lang}
        onChange={(e) => setText(e.target.value)} onPaste={block} onDrop={block} aria-describedby="iv-text-help" data-testid="iv-text" />
      <span id="iv-text-help" className="xs muted">{n} word{n === 1 ? '' : 's'} · type in your own words (pasting is turned off)</span>
      {pasteNote && <p className="vet-note" role="status" data-testid="iv-paste-note">Please type your answer. Pasting is turned off during the interview.</p>}
    </div>
  );
}

function Spoken({ lang, transcript, setTranscript, sp, measured }) {
  return (
    <div className="stack g12">
      <div className="vet-mic">
        <button type="button" className={`btn btn-lg ${sp.listening ? 'btn-outline' : 'btn-signal'}`} onClick={sp.listening ? sp.stop : sp.start} data-testid="iv-mic">
          {sp.listening ? <><IcStop size={18} /> Stop</> : <><IcMic size={18} /> {transcript ? 'Speak more' : 'Start speaking'}</>}
        </button>
        {transcript && !sp.listening && <button type="button" className="btn btn-ghost" onClick={() => setTranscript('')}>Clear and start again</button>}
      </div>
      <p className="sr-only" aria-live="polite">{sp.listening ? 'Listening' : ''}</p>
      {sp.error && <p className="error" role="alert">{sp.error}</p>}
      <div className="vet-transcript" aria-label="What you said, as text" data-testid="iv-transcript" lang={lang}>
        {transcript || <span className="muted">Your words will appear here as you speak.</span>}
        {sp.interim && <span className="muted"> {sp.interim}</span>}
      </div>
      <span className="xs muted" data-testid="iv-sound-note">{measured === 'audio' ? 'Your speech is turned into text in this browser. For your spoken-English score a short recording of each answer goes to our speech-assessment partner and is then deleted; it is not kept.'
        : 'Your speech is turned into text in this browser. The sound itself is never recorded or sent.'}</span>
    </div>
  );
}

export default function Runner({ start, onDone, onError }) {
  const [iv, setIv] = useState(start);
  const [text, setText] = useState('');
  const [transcript, setTranscript] = useState('');
  const [busy, setBusy] = useState(''); // '' | 'send' | 'finish'
  const [err, setErr] = useState('');
  const [say, setSay] = useState('');
  const [pasteNote, setPasteNote] = useState(false);
  const pastes = useRef(0);
  const sig = useRef(emptySignals());
  const sentSig = useRef({ blurs: 0, blurMs: 0 });
  useSignals(sig);
  const snap = useSnapshots('interview', start.id);

  const a = iv.asking;
  const voice = iv.mode === 'voice' && speechSupported();
  const fellBack = iv.mode === 'voice' && !voice;
  const turnKey = a ? `${a.n}-${a.followUp ? 'f' : 'q'}` : 'end';
  const now = useRef(transcript);
  now.current = transcript;
  // T10: when words were recognised (per listening session) and the clip, only while spoken English is measured
  const measure = !!iv.spoken && voice;
  const heard = useRef([]);
  const session = useRef(0);
  const mark = () => { if (measure) heard.current.push({ t: Date.now(), s: session.current }); };
  const rec = useRef(null);
  if (measure && iv.spoken.audio && !rec.current) rec.current = createRecorder();
  useEffect(() => () => rec.current?.close(), []);
  const sp = useSpeech({ lang: SPEECH_LANG[iv.lang] || 'en-IN', onText: (w) => { mark(); setTranscript(appendSpeech(now.current, w).slice(0, 2500)); } });
  useEffect(() => { if (sp.interim) mark(); }, [sp.interim]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!measure) return;
    if (sp.listening) { session.current += 1; rec.current?.start(); } else rec.current?.pause();
  }, [sp.listening]); // eslint-disable-line react-hooks/exhaustive-deps

  // this answer's clock
  const shownAt = useRef(Date.now());
  const [left, setLeft] = useState(a?.seconds || 0);
  useEffect(() => {
    if (!a) return undefined;
    shownAt.current = Date.now();
    setLeft(a.seconds);
    const id = setInterval(() => setLeft(Math.max(0, a.seconds - Math.floor((Date.now() - shownAt.current) / 1000))), 250);
    return () => clearInterval(id);
  }, [turnKey]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { const m = answerAnnounce(left); if (m) setSay(m); }, [left]);

  const heading = useRef(null);
  useEffect(() => { heading.current?.focus({ preventScroll: true }); window.scrollTo?.(0, 0); }, [turnKey]);

  const finish = useCallback(async () => {
    setBusy('finish'); setErr('');
    try { onDone(await http(`${API}/${iv.id}/finish`, { method: 'POST', timeout: 90_000, retry: 1 })); }
    catch (e) { setErr(e.message); setBusy(''); }
  }, [iv.id, onDone]);

  const sending = useRef(false);
  const send = useCallback(async () => {
    if (sending.current || !a) return;
    sending.current = true;
    if (sp.listening) sp.stop();
    setBusy('send'); setErr('');
    const d = signalDelta(sig.current, sentSig.current);
    const body = { text: (voice ? `${now.current} ${sp.interim || ''}` : text).trim().slice(0, 2500), seconds: Math.round((Date.now() - shownAt.current) / 100) / 10, pasteAttempts: pastes.current, ...d };
    let clip = null;
    if (iv.spoken) { // T10: timing (and the clip, sent alongside; the result waits for it)
      Object.assign(body, measure ? speechTiming(heard.current) : { typed: true });
      heard.current = [];
      const audio = rec.current?.take();
      if (audio && body.text) {
        clip = http(`/api/me/trust/spoken/${iv.id}/clip`, { method: 'POST', body: { turn: a.n - 1, part: a.followUp ? 'follow' : 'answer', audio, text: body.text }, timeout: 30_000 }).catch(() => null);
      }
    }
    try {
      const next = await http(`${API}/${iv.id}/answer`, { method: 'POST', body, timeout: 60_000 });
      if (clip) await clip;
      sentSig.current = { blurs: sig.current.blurs, blurMs: sig.current.blurMs };
      pastes.current = 0;
      setText(''); setTranscript(''); setPasteNote(false);
      setIv(next);
      if (next.status === 'answered') { sending.current = false; await finish(); return; }
      if (next.status !== 'running') { onDone(next); return; }
      setBusy('');
    } catch (e) {
      if (e.code === 'done') { await finish(); return; }
      if (e.status === 404) { onError?.(e.message); return; }
      setErr(e.message); setBusy('');
    } finally { sending.current = false; }
  }, [a, iv.id, iv.spoken, measure, sp, text, voice, finish, onDone, onError]);

  // time is up: the answer goes by itself
  useEffect(() => { if (a && left === 0 && !busy) send(); }, [left]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!a) {
    return (
      <section className="mcard mcard-accent iv-q" aria-label="Finishing your interview" data-testid="iv-finishing">
        <h2 className="mcard-title">All 7 questions answered</h2>
        <p className="small" style={{ margin: 0 }} role="status">{busy === 'finish' ? 'Grading your interview… this takes up to a minute.' : 'Send your interview to see your result.'}</p>
        {err && <p className="error" role="alert">{err}</p>}
        {busy !== 'finish' && <div className="vet-actions"><button type="button" className="btn btn-signal btn-lg" onClick={finish} data-testid="iv-finish">See my result</button></div>}
      </section>
    );
  }

  const answer = voice ? `${transcript} ${sp.interim || ''}`.trim() : text;
  const low = left <= 10;
  return (
    <div className="vet-run iv-run" data-testid="iv-runner">
      <div className={`mcard mcard-tight vet-bar ${low ? 'low' : ''}`}>
        <div className="vet-bar-row">
          <span className="stack g2" style={{ minWidth: 0 }}>
            <span className="mkicker">{iv.role || iv.test} · {voice ? 'spoken' : 'typed'}</span>
            <strong className="vet-bar-title" data-testid="iv-progress">Question {a.n} of {a.of}{a.followUp ? ' · follow-up' : ''}</strong>
          </span>
          <span className={`vet-clock ${low ? 'low' : ''}`} role="timer" aria-live="off" aria-label={`${clock(left)} left for this answer`} data-testid="iv-time"><small>Time for this answer</small>{clock(left)}</span>
        </div>
        <Bar value={a.n - 1} max={a.of} label={`${a.n - 1} of ${a.of} answered`} showValue={false} tone="accent" />
      </div>
      <p className="sr-only" aria-live="assertive" data-testid="iv-say">{say}</p>

      <section className="mcard iv-q" aria-labelledby="iv-qtext" data-testid="iv-q">
        <h2 id="iv-qtext" ref={heading} tabIndex={-1} className="vet-qtext iv-qtext" lang={a.followUp ? undefined : iv.lang}>
          {a.followUp ? <><span className="iv-follow">Follow-up:</span> {a.q}</> : a.q}
        </h2>
        {a.followUp && <span className="xs muted">A short question about what you just said.</span>}
        {fellBack && <p className="vet-note" role="note">Your browser can’t turn speech into text, so please type your answers instead.</p>}
        {voice ? <Spoken lang={iv.lang} transcript={transcript} setTranscript={(v) => { setTranscript(v); if (!v) { heard.current = []; rec.current?.take(); } }} sp={sp} measured={iv.spoken?.audio ? 'audio' : iv.spoken ? 'timing' : ''} />
          : <Typed key={turnKey} text={text} setText={setText} lang={iv.lang} label={a.followUp ? 'Your answer to the follow-up' : 'Your answer'} pasteNote={pasteNote}
            onPasteTry={() => { pastes.current += 1; setPasteNote(true); }} />}
        {err && <p className="error" role="alert">{err}</p>}
        <div className="vet-actions">
          <button type="button" className="btn btn-signal btn-lg" onClick={send} disabled={!!busy} data-testid="iv-send">
            {busy === 'send' ? 'Sending…' : busy === 'finish' ? 'Grading…' : !answer.trim() ? 'Skip this question' : 'Send answer'}
          </button>
          <span className="xs muted">When the time ends, what you have is sent by itself.</span>
        </div>
      </section>
      {iv.spoken && <p className="xs muted" style={{ margin: 0 }} data-testid="iv-spoken-on">Your spoken English is being measured (English answers only). It never changes your interview score.</p>}
      {snap ? <SnapNote st={snap} /> : <p className="xs muted" style={{ margin: 0 }}><IcLock size={14} /> No camera and no audio stored. Leaving this page is counted.</p>}
    </div>
  );
}
