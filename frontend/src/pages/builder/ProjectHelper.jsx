// Projects → "Make this project stronger": six short questions (typed or spoken in any language), then 2-4 bullets
// written only from the answers (AI while today's 3 free uses last, fact-checked on the server; else made from the
// answers by rules). Before → after with Accept / Edit / Skip. Nothing is added to the resume until Accept.
import { useRef, useState } from 'react';
import { Spinner } from '../../components/ui';
import { http, LIVE } from '../../services/http';
import { KEYBOARD_TIP, SPEECH_LANGUAGES, appendSpeech, defaultSpeechLang, rememberSpeechLang, useSpeech } from '../../lib/summary/speech';
import { localBullets } from '../../lib/projectHelper';

export const QUESTIONS = [
  ['built', 'What did you build?', 'e.g. a college attendance app'],
  ['tools', 'Which tools or languages?', 'e.g. Flutter, Firebase'],
  ['part', 'What was your part?', 'e.g. the login and attendance screens'],
  ['team', 'Team size', 'e.g. 3 (1 if alone)'],
  ['does', 'What does it do?', 'e.g. lets teachers mark attendance from their phone'],
  ['result', 'Any real result or number? (optional)', 'e.g. used by 40 students, 92% accuracy — leave empty if none'],
];

function Answer({ id, label, ph, value, onChange, speak, active }) {
  const short = id === 'team';
  return (
    <div className="field" style={{ flex: short ? '0 1 140px' : '1 1 260px' }}>
      <label className="label" htmlFor={`ph-${id}`}>{label}</label>
      <div className="row g4">
        <input id={`ph-${id}`} className="input" style={{ height: 40, minWidth: 0, flex: 1 }} maxLength={short ? 60 : 300} placeholder={ph}
          inputMode={short ? 'numeric' : undefined} value={value} onChange={(e) => onChange(e.target.value)} data-testid={`ph-${id}`} />
        {speak && !short && (
          <button type="button" className="btn btn-outline" style={{ minHeight: 40, padding: '0 10px' }} aria-pressed={active} aria-label={`${active ? 'Stop' : 'Speak'}: ${label}`} onClick={speak}>{active ? '■' : '🎤'}</button>
        )}
      </div>
    </div>
  );
}

export default function ProjectHelper({ project, onAccept }) {
  const [open, setOpen] = useState(false);
  const [a, setA] = useState(() => ({ built: '', tools: project?.tech || '', part: '', team: '', does: '', result: '' }));
  const [busy, setBusy] = useState(false);
  const [out, setOut] = useState(null); // { bullets, source, tip, note }
  const [edit, setEdit] = useState(null);
  const [lang, setLang] = useState(defaultSpeechLang);
  const [field, setField] = useState(null);
  const now = useRef(a); now.current = a;
  const speech = useSpeech({ lang, onText: (w) => { if (field) setA((x) => ({ ...x, [field]: appendSpeech(now.current[field], w).slice(0, 300) })); } });
  const speakFor = (k) => () => {
    if (speech.listening && field === k) { speech.stop(); return; }
    if (speech.listening) speech.stop();
    setField(k); setTimeout(() => speech.start(), 0);
  };
  const write = async () => {
    setBusy(true); setOut(null); setEdit(null);
    try {
      setOut(LIVE ? await http('/api/me/projects/strengthen', { method: 'POST', body: { title: project?.title || '', answers: a } })
        : { ...localBullets(a, project?.title), source: 'rules' });
    } catch (e) {
      // never stuck: the browser makes them from the answers the same way
      setOut({ ...localBullets(a, project?.title), source: 'rules', note: e.status === 400 ? e.message : '' });
    } finally { setBusy(false); }
  };
  const before = (project?.description || '').trim();
  if (!open) {
    return <button type="button" className="btn btn-outline" style={{ alignSelf: 'flex-start' }} onClick={() => setOpen(true)} data-testid="ph-open">✨ Make this project stronger</button>;
  }
  const text = (out?.bullets || []).join('\n');
  return (
    <section className="well stack g12" aria-label="Make this project stronger" data-testid="project-helper">
      <div className="row between g8" style={{ flexWrap: 'wrap' }}>
        <strong className="small">Make this project stronger</strong>
        <button type="button" className="link-btn xs" onClick={() => { speech.stop(); setOpen(false); }}>Close</button>
      </div>
      <span className="xs muted">Answer in any language. We only use what you write — nothing is made up.</span>
      {speech.supported && (
        <label className="xs row g4" style={{ alignItems: 'center' }}>Speak in
          <select className="input" style={{ height: 32, width: 'auto' }} value={lang} onChange={(e) => { setLang(e.target.value); rememberSpeechLang(e.target.value); }}>
            {SPEECH_LANGUAGES.map(([c, l]) => <option key={c} value={c}>{l}</option>)}
          </select>
        </label>
      )}
      {!speech.supported && <span className="xs faint">{KEYBOARD_TIP}</span>}
      <div className="row g12" style={{ flexWrap: 'wrap' }}>
        {QUESTIONS.map(([k, label, ph]) => (
          <Answer key={k} id={k} label={label} ph={ph} value={a[k]} onChange={(v) => setA({ ...a, [k]: v })}
            speak={speech.supported ? speakFor(k) : null} active={speech.listening && field === k} />
        ))}
      </div>
      <button type="button" className="btn btn-ink" style={{ alignSelf: 'flex-start' }} disabled={busy || (!a.built.trim() && !project?.title)} onClick={write} data-testid="ph-write">
        {busy && <Spinner />}{out ? 'Write again' : 'Write my bullets'}
      </button>
      {out && (
        <div className="stack g8" data-testid="ph-result">
          <div className="row g12" style={{ flexWrap: 'wrap', alignItems: 'stretch' }}>
            <div className="stack g4" style={{ flex: '1 1 240px', minWidth: 0 }}>
              <span className="xs muted">Before</span>
              <div className="small" style={{ whiteSpace: 'pre-wrap', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8, padding: 8, minHeight: 48 }} data-testid="ph-before">{before || <span className="faint">(empty)</span>}</div>
            </div>
            <div className="stack g4" style={{ flex: '1 1 240px', minWidth: 0 }}>
              <span className="xs muted">After{out.source === 'ai' ? ' · written by AI from your answers' : ' · made from your answers'}</span>
              {edit === null ? (
                <ul className="small" style={{ margin: 0, paddingLeft: 18, background: 'var(--successbg)', borderRadius: 8, padding: '8px 8px 8px 24px' }} data-testid="ph-after">
                  {out.bullets.map((b, i) => <li key={i}>{b}</li>)}
                </ul>
              ) : (
                <textarea className="input" rows={5} value={edit} onChange={(e) => setEdit(e.target.value)} aria-label="Edit the bullets" data-testid="ph-edit" />
              )}
            </div>
          </div>
          {out.tip && <span className="xs" data-testid="ph-tip">💡 {out.tip}</span>}
          {out.note && <span className="xs muted" data-testid="ph-note">{out.note}</span>}
          <div className="row g8" style={{ flexWrap: 'wrap' }}>
            <button type="button" className="btn btn-ink" onClick={() => { onAccept(edit ?? text); setOpen(false); setOut(null); }} data-testid="ph-accept">Accept</button>
            {edit === null && <button type="button" className="btn btn-outline" onClick={() => setEdit(text)} data-testid="ph-edit-btn">Edit</button>}
            <button type="button" className="btn btn-outline" onClick={() => { setOut(null); setEdit(null); setOpen(false); }} data-testid="ph-skip">Skip</button>
          </div>
        </div>
      )}
    </section>
  );
}
