// Vetting Trust T15: typing, situational-judgement (SJT) and aptitude tests in English, Hindi or Telugu, on Get skill
// verified (loaded lazily, only for people the Trust switch lets in; the server answers 404 to everyone else and this
// card then shows nothing). Each test: the T9 honesty pledge first (and the T9 retake limits), then
//   typing    a short work passage in the chosen script; 90 seconds from the first key; paste is switched off (and
//             counted), text that arrives in one big insert doesn't count toward the speed; live words a minute
//   SJT       10 work situations, one at a time: pick the most and the least effective response
//   aptitude  15 questions (numbers, words, reasoning), one at a time, 15 minutes (22½ with extra time)
// The clock is the server's (a reload carries on); answers are saved as they go and sent by themselves when the time
// ends. The result shows the badge companies can see ("Typing 35 wpm+ (Hindi)", "SJT: strong", "Aptitude: top 30%");
// below that nothing is shown to companies.
import { useEffect, useRef, useState } from 'react';
import { http } from '../../../services/http';
import { MeCard } from '../kit';
import { Pledge, RetakeInfo } from './Honesty';
import { LANGS, answered, clock, norm, pickSjt, secondsLeft, typingTracker, wpm } from './workLib';

const API = '/api/me/trust/worktests';
const L = {
  en: { start: 'Start', next: 'Next', back: 'Back', submit: 'Submit', left: 'Time left', most: 'Most effective', least: 'Least effective', of: 'of',
    typeHere: 'Type the passage here', noPaste: 'Paste is switched off for this test.', speed: 'words a minute', q: 'Question', done: 'Your result', again: 'Back to the tests' },
  hi: { start: 'शुरू करें', next: 'आगे', back: 'पीछे', submit: 'जमा करें', left: 'बचा समय', most: 'सबसे सही', least: 'सबसे कम सही', of: '/',
    typeHere: 'यहाँ पैराग्राफ़ टाइप करें', noPaste: 'इस टेस्ट में पेस्ट बंद है।', speed: 'शब्द प्रति मिनट', q: 'सवाल', done: 'आपका नतीजा', again: 'टेस्ट पर वापस' },
  te: { start: 'మొదలుపెట్టండి', next: 'తర్వాత', back: 'వెనక్కి', submit: 'సమర్పించండి', left: 'మిగిలిన సమయం', most: 'అత్యంత సరైనది', least: 'అత్యంత తక్కువ సరైనది', of: '/',
    typeHere: 'ఇక్కడ పేరాను టైప్ చేయండి', noPaste: 'ఈ పరీక్షలో పేస్ట్ పనిచేయదు.', speed: 'పదాలు నిమిషానికి', q: 'ప్రశ్న', done: 'మీ ఫలితం', again: 'పరీక్షలకు తిరిగి' },
};
const BTN = { minHeight: 44 };

function useSignals() {
  const s = useRef({ blurs: 0, blurMs: 0, copies: 0, away: 0 });
  useEffect(() => {
    const blur = () => { s.current.blurs += 1; s.current.away = Date.now(); };
    const focus = () => { if (s.current.away) s.current.blurMs += Date.now() - s.current.away; s.current.away = 0; };
    const copy = () => { s.current.copies += 1; };
    window.addEventListener('blur', blur); window.addEventListener('focus', focus); document.addEventListener('copy', copy);
    return () => { window.removeEventListener('blur', blur); window.removeEventListener('focus', focus); document.removeEventListener('copy', copy); };
  }, []);
  return () => ({ blurs: s.current.blurs, blurMs: s.current.blurMs, copies: s.current.copies });
}

function useClock(deadline, onZero) {
  const [left, setLeft] = useState(() => secondsLeft(deadline));
  const fired = useRef(false);
  useEffect(() => {
    const id = setInterval(() => {
      const s = secondsLeft(deadline);
      setLeft(s);
      if (s === 0 && !fired.current) { fired.current = true; onZero(); }
    }, 500);
    return () => clearInterval(id);
  }, [deadline]); // eslint-disable-line react-hooks/exhaustive-deps
  return left;
}

function Typing({ p, onDone }) {
  const t = L[p.lang] || L.en;
  const tr = useRef(typingTracker());
  const [typed, setTyped] = useState(p.typed || '');
  const [started, setStarted] = useState(0);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [, tick] = useState(0);
  const sent = useRef(false);
  const send = async (text) => {
    if (sent.current) return;
    sent.current = true; setBusy(true);
    try { onDone(await http(`${API}/${p.id}/submit`, { method: 'POST', body: tr.current.body(text) })); } catch (e) { setErr(e.message); sent.current = false; setBusy(false); }
  };
  const limit = started ? Math.min(p.deadline, started + p.seconds * 1000) : p.deadline;
  const left = useClock(limit, () => send(tr.current.st.prev || typed));
  useEffect(() => { const id = setInterval(() => tick((n) => n + 1), 1000); return () => clearInterval(id); }, []);
  const change = (e) => {
    const v = tr.current.change(e.target.value);
    if (!started) setStarted(Date.now());
    setTyped(v);
    if (norm(v) === norm(p.passage)) send(v);
  };
  return (
    <div className="stack g12" data-testid="wt-typing">
      <div className="row g8" style={{ justifyContent: 'space-between', flexWrap: 'wrap' }}>
        <span className="mchip mchip-info" data-testid="wt-clock">{t.left}: {clock(started ? left : p.seconds)}</span>
        <span className="mchip mchip-neutral" data-testid="wt-wpm">{wpm(typed, tr.current.ms())} {t.speed}</span>
      </div>
      <p lang={p.lang} className="wt-passage" data-testid="wt-passage" style={{ margin: 0, padding: 12, borderRadius: 8, background: 'var(--surface-2, #f4f4f5)', lineHeight: 1.8, overflowWrap: 'anywhere', userSelect: 'none' }}>{p.passage}</p>
      <label className="field stack g4"><span className="label">{t.typeHere}</span>
        <textarea className="input" lang={p.lang} rows={5} value={typed} onChange={change} disabled={busy} autoComplete="off" autoCorrect="off" spellCheck={false}
          onPaste={(e) => { e.preventDefault(); tr.current.paste(); setErr(t.noPaste); }} onDrop={(e) => { e.preventDefault(); tr.current.paste(); }}
          data-testid="wt-type" style={{ minHeight: 120, fontSize: 18, lineHeight: 1.7 }} />
      </label>
      {err && <p className="error" role="alert" data-testid="wt-error">{err}</p>}
      <button type="button" className="btn btn-signal" style={{ ...BTN, alignSelf: 'flex-start' }} disabled={busy || !typed} onClick={() => send(typed)} data-testid="wt-submit">{t.submit}</button>
    </div>
  );
}

function Questions({ p, onDone }) {
  const t = L[p.lang] || L.en;
  const sjt = p.test === 'sjt';
  const [i, setI] = useState(0);
  const [answers, setAnswers] = useState(p.answers || {});
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const times = useRef({});
  const shownAt = useRef(Date.now());
  const signals = useSignals();
  const sent = useRef(false);
  const note = () => { const id = p.items[i].id; times.current[id] = (times.current[id] || 0) + (Date.now() - shownAt.current); shownAt.current = Date.now(); };
  const send = async () => {
    if (sent.current) return;
    note(); sent.current = true; setBusy(true);
    try { onDone(await http(`${API}/${p.id}/submit`, { method: 'POST', body: { answers, times: times.current, signals: signals() } })); } catch (e) { setErr(e.message); sent.current = false; setBusy(false); }
  };
  const left = useClock(p.deadline, send);
  const save = (next) => { setAnswers(next); http(`${API}/${p.id}/progress`, { method: 'PUT', body: { answers: next, times: times.current } }).catch(() => {}); };
  const go = (n) => { note(); setI(n); };
  const it = p.items[i];
  const a = answers[it.id];
  const n = answered(p.test, p.items, answers);
  return (
    <div className="stack g12" data-testid="wt-questions">
      <div className="row g8" style={{ justifyContent: 'space-between', flexWrap: 'wrap' }}>
        <span className="mchip mchip-info" data-testid="wt-clock">{t.left}: {clock(left)}</span>
        <span className="mchip mchip-neutral" data-testid="wt-count">{t.q} {i + 1} {t.of} {p.items.length} · ✓ {n}</span>
      </div>
      <p lang={p.lang} style={{ margin: 0, fontWeight: 600, overflowWrap: 'anywhere' }} data-testid="wt-q">{it.q}</p>
      {sjt ? (
        <ul className="stack g8" style={{ listStyle: 'none', padding: 0, margin: 0 }} data-testid="wt-options">
          {it.options.map((o, k) => (
            <li key={k} className="mcard mcard-tight stack g8" data-testid="wt-option">
              <span lang={p.lang} style={{ overflowWrap: 'anywhere' }}>{o}</span>
              <span className="row g8" style={{ flexWrap: 'wrap' }}>
                <button type="button" className={`btn ${a?.most === k ? 'btn-signal' : 'btn-outline'}`} style={BTN} aria-pressed={a?.most === k} onClick={() => save({ ...answers, [it.id]: pickSjt(a, 'most', k) })} data-testid="wt-most">👍 {t.most}</button>
                <button type="button" className={`btn ${a?.least === k ? 'btn-ink' : 'btn-outline'}`} style={BTN} aria-pressed={a?.least === k} onClick={() => save({ ...answers, [it.id]: pickSjt(a, 'least', k) })} data-testid="wt-least">👎 {t.least}</button>
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <div className="stack g8" role="radiogroup" aria-label={it.q} data-testid="wt-options">
          {it.options.map((o, k) => (
            <label key={k} className="mcard mcard-tight row g8" style={{ alignItems: 'center', minHeight: 44, cursor: 'pointer' }} data-testid="wt-option">
              <input type="radio" name={`wt-${it.id}`} checked={a === k} onChange={() => save({ ...answers, [it.id]: k })} style={{ width: 20, height: 20 }} />
              <span lang={p.lang} style={{ overflowWrap: 'anywhere' }}>{o}</span>
            </label>
          ))}
        </div>
      )}
      {err && <p className="error" role="alert">{err}</p>}
      <div className="row g8" style={{ flexWrap: 'wrap' }}>
        <button type="button" className="btn btn-outline" style={BTN} disabled={i === 0} onClick={() => go(i - 1)} data-testid="wt-back">{t.back}</button>
        {i < p.items.length - 1 && <button type="button" className="btn btn-signal" style={BTN} onClick={() => go(i + 1)} data-testid="wt-next">{t.next}</button>}
        <button type="button" className={`btn ${i === p.items.length - 1 ? 'btn-signal' : 'btn-ghost'}`} style={BTN} disabled={busy} onClick={send} data-testid="wt-submit">{t.submit}</button>
      </div>
    </div>
  );
}

function Result({ r, onBack }) {
  const t = L[r.lang] || L.en;
  return (
    <div className="stack g12" data-testid="wt-result">
      <strong>{t.done}</strong>
      {r.test === 'typing' ? (
        <p style={{ margin: 0 }} data-testid="wt-result-line"><strong>{r.wpm}</strong> words a minute · {r.accuracy}% accuracy · {r.seconds} s</p>
      ) : (
        <p style={{ margin: 0 }} data-testid="wt-result-line"><strong>{r.score}</strong>/100{r.sections ? ` · numbers ${r.sections.numerical ?? '–'}, words ${r.sections.verbal ?? '–'}, reasoning ${r.sections.logical ?? '–'}` : ''}</p>
      )}
      {r.badge ? <span className="mchip mchip-ok" style={{ alignSelf: 'flex-start', whiteSpace: 'normal' }} data-testid="wt-badge">✓ {r.badge}</span>
        : <span className="small muted" data-testid="wt-no-badge">Companies don’t see this result. You can try again when your retake opens.</span>}
      {(r.flags || []).map((f) => <p key={f} className="small vet-calm" style={{ margin: 0 }} data-testid="wt-flag">{f} Nothing is decided by this alone.</p>)}
      <button type="button" className="btn btn-outline" style={{ ...BTN, alignSelf: 'flex-start' }} onClick={onBack} data-testid="wt-again">{t.again}</button>
    </div>
  );
}

function StartBox({ x, langs, rule, onStart }) {
  const [lang, setLang] = useState('en');
  const [pledge, setPledge] = useState(null);
  const [extra, setExtra] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const rk = x.retake[x.test === 'typing' ? lang : 'any'];
  const go = async () => {
    setBusy(true); setErr('');
    try { onStart(await http(`${API}/start`, { method: 'POST', body: { test: x.test, lang, pledge, extraTime: extra } })); } catch (e) { setErr(e.message); setBusy(false); }
  };
  return (
    <div className="stack g12" data-testid="wt-startbox">
      <fieldset className="vet-fs"><legend className="vet-legend">Language</legend>
        <div className="row g8" style={{ flexWrap: 'wrap' }}>
          {langs.map(([k, l]) => <label key={k} className="row g8" style={{ minHeight: 44, alignItems: 'center' }}><input type="radio" name={`wt-lang-${x.test}`} checked={lang === k} onChange={() => setLang(k)} data-testid={`wt-lang-${k}`} /><span lang={k}>{l}</span></label>)}
        </div>
      </fieldset>
      {x.test === 'typing' && <p className="xs muted" style={{ margin: 0 }}>{rule}</p>}
      {x.test !== 'typing' && <label className="vet-check"><input type="checkbox" checked={extra} onChange={(e) => setExtra(e.target.checked)} data-testid="wt-extra" /><span>I need extra time (1.5×), for example because of a disability. Nobody else sees this.</span></label>}
      <RetakeInfo rk={rk} testid="wt-retake" />
      <Pledge kind="skill" lang={lang} onChange={setPledge} />
      {err && <p className="error" role="alert" data-testid="wt-start-error">{err}</p>}
      <button type="button" className="btn btn-signal" style={{ ...BTN, alignSelf: 'flex-start' }} disabled={busy || !pledge || !rk?.canStart} onClick={go} data-testid="wt-go">{(L[lang] || L.en).start}</button>
    </div>
  );
}

export default function WorkTests() {
  const [d, setD] = useState(null);
  const [open, setOpen] = useState('');
  const [paper, setPaper] = useState(null);
  const [result, setResult] = useState(null);
  const load = () => http(API).then(setD, () => setD(false));
  useEffect(() => { load(); }, []);
  if (!d) return null;
  const back = () => { setPaper(null); setResult(null); setOpen(''); load(); };
  const running = paper || d.tests.map((x) => x.running).find(Boolean);
  return (
    <MeCard icon="⌨️" title="Typing, work situations and aptitude" sub="Short tests for many jobs, in English, हिन्दी or తెలుగు. Good results show as badges companies can filter on." testid="wt" headingLevel={2}>
      {result ? <Result r={result} onBack={back} />
        : running ? (running.test === 'typing' ? <Typing key={running.id} p={running} onDone={setResult} /> : <Questions key={running.id} p={running} onDone={setResult} />)
          : (
            <ul className="stack g12" style={{ listStyle: 'none', padding: 0, margin: 0 }}>
              {d.tests.map((x) => (
                <li key={x.test} className="mcard mcard-tight stack g8" data-testid={`wt-test-${x.test}`}>
                  <strong>{x.name}</strong>
                  <span className="small muted">{x.about}</span>
                  {x.results.map((r) => <span key={r.id} className={`mchip ${r.badge ? 'mchip-ok' : 'mchip-neutral'}`} style={{ alignSelf: 'flex-start', whiteSpace: 'normal' }} data-testid="wt-mine">{r.badge || (r.test === 'typing' ? `${r.wpm} wpm (${r.lang})` : `${r.score}/100`)}</span>)}
                  {open === x.test ? <StartBox x={x} langs={LANGS} rule={d.typingRule} onStart={setPaper} />
                    : <button type="button" className="btn btn-outline" style={{ ...BTN, alignSelf: 'flex-start' }} onClick={() => setOpen(x.test)} data-testid={`wt-open-${x.test}`}>{x.results.length ? 'Take it again' : 'Take this test'}</button>}
                </li>
              ))}
            </ul>
          )}
    </MeCard>
  );
}
