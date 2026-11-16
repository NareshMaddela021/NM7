// The practical task after a pass (Vetting V2), loaded when opened. Four kinds:
//   tech / written: a brief (and material: code or a table) and a written answer, with a word count
//   voice: speak for 60–90 seconds; the browser turns speech into text (no audio leaves the phone); typing if the
//          browser can't do that
//   proof: work situations as big answer cards, then an optional photo of past work or a certificate (made smaller
//          in the browser first)
// Pasted characters and time away from the page are counted (never blocked) and sent with the answer.
import { useEffect, useRef, useState } from 'react';
import { http } from '../../../services/http';
import { appendSpeech, useSpeech } from '../../../lib/speechCore';
import { MeCard, Skel } from '../kit';
import { API, SPEECH_LANG, clock, compressImage, emptySignals, useSignals, words } from './lib';

const MIN_SPEAK = 60;
const MAX_SPEAK = 90;

function useLeft(endsAt) {
  const [left, setLeft] = useState(() => Math.max(0, Math.round((endsAt - Date.now()) / 1000)));
  useEffect(() => {
    const tick = () => setLeft(Math.max(0, Math.round((endsAt - Date.now()) / 1000)));
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [endsAt]);
  return left;
}

function Written({ text, setText, label }) {
  const n = words(text);
  return (
    <div className="field">
      <label className="label" htmlFor="vt-text">{label}</label>
      <textarea id="vt-text" className="input vet-text" rows={10} maxLength={8000} value={text} onChange={(e) => setText(e.target.value)} data-testid="vt-task-text" />
      <span className="xs muted" aria-live="polite">{n} word{n === 1 ? '' : 's'}</span>
    </div>
  );
}

function Voice({ lang, transcript, setTranscript, seconds, setSeconds }) {
  const now = useRef(transcript);
  now.current = transcript;
  const sp = useSpeech({ lang: SPEECH_LANG[lang] || 'en-IN', onText: (w) => setTranscript(appendSpeech(now.current, w).slice(0, 6000)) });
  // seconds spoken, added up over each Start … Stop; stops by itself at 90
  useEffect(() => {
    if (!sp.listening) return undefined;
    const id = setInterval(() => setSeconds((s) => s + 1), 1000);
    return () => clearInterval(id);
  }, [sp.listening, setSeconds]);
  useEffect(() => { if (sp.listening && seconds >= MAX_SPEAK) sp.stop(); }, [seconds, sp]);
  return (
    <div className="stack g12">
      <div className="vet-mic">
        <button type="button" className={`btn btn-lg ${sp.listening ? 'btn-outline' : 'btn-signal'}`} onClick={sp.listening ? sp.stop : sp.start} disabled={!sp.listening && seconds >= MAX_SPEAK} data-testid="vt-mic">
          {sp.listening ? '⏹ Stop' : seconds ? '🎤 Speak more' : '🎤 Start speaking'}
        </button>
        <span className="vet-clock" role="timer" aria-live="off" aria-label={`Spoken for ${seconds} seconds`}><small>Spoken</small>{clock(seconds)} / 1:30</span>
        {(transcript || seconds > 0) && !sp.listening && <button type="button" className="btn btn-ghost" onClick={() => { setTranscript(''); setSeconds(0); }}>Start again</button>}
      </div>
      <p className="sr-only" aria-live="polite">{sp.listening ? 'Listening' : ''}{seconds === MIN_SPEAK ? '. One minute spoken.' : ''}</p>
      <span className="xs muted">Speak for 60 to 90 seconds. Your words appear below as text; the sound itself is never recorded or sent.</span>
      {sp.error && <p className="error" role="alert">{sp.error}</p>}
      <div className="vet-transcript" aria-label="What you said, as text" data-testid="vt-transcript" lang={lang}>
        {transcript || <span className="muted">Your words will appear here.</span>}
        {sp.interim && <span className="muted"> {sp.interim}</span>}
      </div>
      {seconds > 0 && seconds < MIN_SPEAK && !sp.listening && <span className="xs" style={{ color: '#92400e' }}>Try to speak for at least a minute: {MIN_SPEAK - seconds} seconds more.</span>}
    </div>
  );
}

function Situations({ items, picks, setPicks }) {
  return (
    <ol className="vet-sits">
      {items.map((s) => (
        <li key={s.i}>
          <fieldset className="vet-fs" data-testid="vt-sit">
            <legend className="vet-sit-q">{s.i + 1}. {s.q}</legend>
            <div className="vet-opts">
              {s.options.map((o, k) => (
                <label key={k} className={`vet-opt ${picks[s.i] === k ? 'on' : ''}`}>
                  <input type="radio" name={`vs-${s.i}`} value={k} checked={picks[s.i] === k} onChange={() => setPicks({ ...picks, [s.i]: k })} aria-label={o} />
                  <span className="vet-opt-k" aria-hidden="true">{String.fromCharCode(65 + k)}</span>
                  <span className="vet-opt-t">{o}</span>
                </label>
              ))}
            </div>
          </fieldset>
        </li>
      ))}
    </ol>
  );
}

function PhotoPick({ photo, setPhoto }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const pick = async (e) => {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (!f) return;
    setErr(''); setBusy(true);
    try { setPhoto(await compressImage(f)); } catch (x) { setErr(x.message); } finally { setBusy(false); }
  };
  return (
    <div className="stack g8" data-testid="vt-photo">
      <strong className="small">Optional: a photo of your past work or your ITI certificate</strong>
      <span className="xs muted">⚠ Please don’t include faces (yours or anyone’s). The photo is checked once and deleted after 30 days.</span>
      {photo ? (
        <div className="vet-photo">
          <img src={photo.preview} alt="The photo you picked" />
          <button type="button" className="btn btn-outline" onClick={() => setPhoto(null)}>Remove photo</button>
        </div>
      ) : (
        <label className="btn btn-outline vet-file">
          {busy ? 'Getting the photo ready…' : '📷 Add a photo'}
          <input type="file" accept="image/*" onChange={pick} className="sr-only" aria-label="Add a photo of your past work or certificate" data-testid="vt-photo-input" />
        </label>
      )}
      {err && <p className="error" role="alert">{err}</p>}
    </div>
  );
}

export default function Task({ attempt, onDone, onCancel }) {
  const [t, setT] = useState(null);
  const [err, setErr] = useState('');
  const [text, setText] = useState('');
  const [transcript, setTranscript] = useState('');
  const [seconds, setSeconds] = useState(0);
  const [picks, setPicks] = useState({});
  const [photo, setPhoto] = useState(null);
  const [busy, setBusy] = useState(false);
  const [sendErr, setSendErr] = useState('');
  const pasted = useRef(0);
  const sig = useRef(emptySignals());
  useSignals(sig, { on: !!t, onPaste: (n) => { pasted.current += n; } });

  useEffect(() => {
    http(`${API}/${attempt.id}/task/start`, { method: 'POST' }).then(setT, (e) => setErr(e.message));
  }, [attempt.id]);
  const left = useLeft(t?.endsAt || Date.now());
  const box = useRef(null);
  useEffect(() => { if (t) box.current?.scrollIntoView?.({ block: 'start', behavior: 'smooth' }); }, [t]);

  if (err) return <MeCard tone="warn" title="The task didn’t open" sub={err}><button type="button" className="btn btn-outline" onClick={onCancel}>Back</button></MeCard>;
  if (!t) return <Skel cards={1} lines={4} label="Opening the task" />;

  const speechOk = typeof window !== 'undefined' && !!(window.SpeechRecognition || window.webkitSpeechRecognition);
  const voice = t.type === 'voice' && speechOk;
  const ready = t.type === 'proof' ? t.situations.every((s) => s.i in picks) : voice ? words(transcript) >= 5 : words(text) >= 5;

  const send = async () => {
    setBusy(true); setSendErr('');
    const body = { blurs: sig.current.blurs, blurMs: sig.current.blurMs, pastedChars: Math.min(100_000, pasted.current) };
    if (t.type === 'proof') {
      body.situations = Object.fromEntries(Object.entries(picks).map(([k, v]) => [String(k), v]));
      if (photo) body.photo = { type: photo.type, data: photo.data };
    } else if (voice) {
      body.transcript = transcript.trim(); body.seconds = seconds;
    } else body.text = text.trim();
    try { onDone(await http(`${API}/${attempt.id}/task/submit`, { method: 'POST', body, timeout: 60_000 })); } catch (e) { setSendErr(e.message); setBusy(false); }
  };

  return (
    <section ref={box} className="mcard vet-task" aria-label={`Practical task: ${t.title}`} data-testid="vt-task">
      <div className="vet-bar-row">
        <span className="stack g2" style={{ minWidth: 0 }}>
          <span className="mkicker">Practical task · about {t.minutes} min</span>
          <h2 className="vet-h2">{t.title}</h2>
        </span>
        <span className={`vet-clock ${left < 120 ? 'low' : ''}`} role="timer" aria-live="off" aria-label={`${clock(left)} left for the task`}><small>Time left</small>{clock(left)}</span>
      </div>
      <p className="vet-brief" lang={attempt.lang}>{t.brief}</p>
      {t.material && <pre className="vet-material" tabIndex={0} aria-label="Material for the task">{t.material}</pre>}
      {t.rubric?.length > 0 && <p className="xs muted" style={{ margin: 0 }}>Marked on: {t.rubric.map((x) => x.label).join(' · ')}</p>}

      {t.type === 'proof' && <><Situations items={t.situations} picks={picks} setPicks={setPicks} />{t.photo && <PhotoPick photo={photo} setPhoto={setPhoto} />}</>}
      {t.type === 'voice' && (voice
        ? <Voice lang={attempt.lang} transcript={transcript} setTranscript={setTranscript} seconds={seconds} setSeconds={setSeconds} />
        : <><p className="vet-note" role="note">Your browser can’t turn speech into text — please type your answer instead.</p><Written text={text} setText={setText} label="Your answer (type what you would say)" /></>)}
      {(t.type === 'tech' || t.type === 'written') && <Written text={text} setText={setText} label="Your answer" />}

      {left === 0 && <p className="small" style={{ color: '#92400e', margin: 0 }}>The time is up. Please send what you have now.</p>}
      {sendErr && <p className="error" role="alert">{sendErr}</p>}
      <div className="vet-actions">
        <button type="button" className="btn btn-signal btn-lg" disabled={!ready || busy} onClick={send} data-testid="vt-task-send">{busy ? 'Sending…' : 'Send my task'}</button>
        <button type="button" className="btn btn-ghost" onClick={onCancel}>Do it later</button>
        {!ready && <span className="xs muted">{t.type === 'proof' ? 'Answer every situation to send.' : 'Write (or say) a little more to send.'}</span>}
      </div>
    </section>
  );
}
