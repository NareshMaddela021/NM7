// Interview prep for one job match (Phase 3): 10 questions with model answers from the resume (STAR for the situation
// question) and "make it yours" tips, "Tell me about yourself" in 60 seconds and 2 minutes, weak spots with honest
// answers, 5 questions to ask, a homework checklist, and practice mode: one question at a time, typed or spoken
// (Speak), with feedback and saved progress. Free: the first 3 questions. The Interview pack unlocks the rest.
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Icon, Spinner, useToast } from '../../components/ui';
import { getInterview, getMatch, jobAccess, makeInterview, practise } from '../../lib/jobs';
import { KEYBOARD_TIP, appendSpeech, defaultSpeechLang, useSpeech } from '../../lib/summary/speech';
import { MeHead } from './MeLayout';
import { PackOffer } from './JobMatch';

const STAR = [['situation', 'Situation'], ['task', 'Task'], ['action', 'Action'], ['result', 'Result']];
const mmss = (s) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
const homeKey = (id) => `nm7.homework.${id}`;

/** [gaps] in an answer stand out, so people fill them with what really happened. */
function Gaps({ text }) {
  return text.split(/(\[[^\]]+\])/).map((part, i) => (part.startsWith('[') ? <mark key={i} className="gap">{part}</mark> : part));
}

function Answer({ q }) {
  if (q.star) {
    return (
      <dl className="stack g4 small" style={{ margin: 0 }}>
        {STAR.map(([k, l]) => <div key={k} className="row g8" style={{ alignItems: 'baseline' }}><dt style={{ minWidth: 72 }}><strong>{l}</strong></dt><dd style={{ margin: 0 }}><Gaps text={q.star[k]} /></dd></div>)}
      </dl>
    );
  }
  return <p className="small" style={{ margin: 0, lineHeight: 1.6 }}><Gaps text={q.answer} /></p>;
}

function Question({ q, n, groups, onPractise }) {
  const [open, setOpen] = useState(n === 1);
  return (
    <article className="card stack g8" style={{ padding: 14 }} data-testid="iv-q">
      <button type="button" className="row between g8 link-plain" style={{ textAlign: 'left', minHeight: 44, background: 'none', border: 0, padding: 0, cursor: 'pointer', color: 'inherit', flexWrap: 'nowrap', width: '100%' }} aria-expanded={open} onClick={() => setOpen(!open)}>
        <span className="stack g4" style={{ flex: 1, minWidth: 0 }}><span className="xs faint">{n}. {groups[q.group]}</span><strong>{q.q}</strong></span>
        <span className="row g8" style={{ alignItems: 'center', flex: 'none' }}>{q.practised && <span className="badge b-success">Practised</span>}<span aria-hidden="true">{open ? '−' : '+'}</span></span>
      </button>
      {open && (
        <div className="stack g8">
          <span className="xs muted">Model answer, from your resume{q.source === 'ai' ? ' (AI, checked)' : ''}:</span>
          <Answer q={q} />
          {q.tips?.length > 0 && <div className="well stack g4"><strong className="xs">Make it yours</strong><ul className="small" style={{ margin: 0, paddingLeft: 18 }}>{q.tips.map((t) => <li key={t}>{t}</li>)}</ul></div>}
          <button type="button" className="btn btn-outline" style={{ alignSelf: 'flex-start', minHeight: 38 }} onClick={() => onPractise(q.id)}>Practise this question</button>
        </div>
      )}
    </article>
  );
}

function Feedback({ fb }) {
  const rows = [['Structure', fb.structure], ['Result', fb.result], ['Length', fb.length], ['Filler words', fb.filler]];
  return (
    <div className="well stack g8" data-testid="iv-feedback" aria-live="polite">
      <strong className="small">Feedback{fb.source === 'ai' ? ' (AI, checked)' : ''}</strong>
      {rows.map(([k, v]) => <span key={k} className="small"><strong>{k}: </strong>{v}</span>)}
      {fb.note && <span className="xs muted">{fb.note}</span>}
      <div className="stack g4"><strong className="small">A better version</strong><p className="small" style={{ margin: 0, lineHeight: 1.6 }} data-testid="iv-better"><Gaps text={fb.better} /></p></div>
    </div>
  );
}

function Practice({ id, pack, start, onSaved, onClose }) {
  const toast = useToast();
  const qs = pack.questions;
  const [i, setI] = useState(Math.max(0, qs.findIndex((q) => q.id === start)));
  const q = qs[i];
  const [text, setText] = useState('');
  const [fb, setFb] = useState(q.practised?.feedback || null);
  const [busy, setBusy] = useState(false);
  const now = useRef('');
  now.current = text;
  const speech = useSpeech({ lang: defaultSpeechLang(), onText: (w) => setText(appendSpeech(now.current, w).slice(0, 4000)) });
  useEffect(() => { setText(''); setFb(qs[i].practised?.feedback || null); }, [i]); // eslint-disable-line react-hooks/exhaustive-deps
  const send = async () => {
    if (speech.listening) speech.stop();
    setBusy(true);
    try { const r = await practise(id, { qid: q.id, answer: text }); setFb(r.feedback); onSaved(q.id, text, r); } catch (e) { toast(e.message); } finally { setBusy(false); }
  };
  return (
    <section className="card stack g12" aria-label="Practice" data-testid="iv-practice">
      <span className="row between g8"><span className="xs faint">Question {i + 1} of {qs.length}{pack.locked.length ? ` (${pack.locked.length} more in the Interview pack)` : ''}</span><button type="button" className="link-btn xs" onClick={onClose}>Close practice</button></span>
      <strong style={{ fontSize: 18 }} data-testid="iv-practice-q">{q.q}</strong>
      <div className="field">
        <label htmlFor="iv-answer" className="label">Your answer (type it, or tap Speak and say it)</label>
        <textarea id="iv-answer" className="input" rows={6} value={text} onChange={(e) => setText(e.target.value)} maxLength={4000} />
        {speech.interim && <span className="xs muted" style={{ fontStyle: 'italic' }}>{speech.interim}…</span>}
      </div>
      <div className="row g8" style={{ flexWrap: 'wrap', alignItems: 'center' }}>
        {speech.supported ? (
          <button type="button" className={`btn ${speech.listening ? 'btn-ink' : 'btn-outline'}`} aria-pressed={speech.listening} data-testid="iv-speak" onClick={() => (speech.listening ? speech.stop() : speech.start())}>
            {speech.listening ? <span className="pulse-dot" aria-hidden="true" /> : <Icon name="mic" size={18} />}{speech.listening ? `Stop ${mmss(speech.seconds)}` : 'Speak'}
          </button>
        ) : <span className="xs muted">{KEYBOARD_TIP}</span>}
        <button type="button" className="btn btn-ink" data-testid="iv-send" disabled={busy || !text.trim()} onClick={send}>{busy && <Spinner />}{busy ? 'Checking…' : 'Get feedback'}</button>
      </div>
      {speech.error && <span className="small" role="alert" style={{ color: 'var(--danger)' }}>{speech.error}</span>}
      {fb && <Feedback fb={fb} />}
      <div className="row between g8">
        <button type="button" className="btn btn-outline" disabled={i === 0} onClick={() => setI(i - 1)}>Previous</button>
        <button type="button" className="btn btn-outline" data-testid="iv-next" disabled={i === qs.length - 1} onClick={() => setI(i + 1)}>Next question</button>
      </div>
    </section>
  );
}

function Homework({ id, items }) {
  const [done, setDone] = useState(() => { try { return JSON.parse(localStorage.getItem(homeKey(id)) || '[]'); } catch { return []; } });
  const toggle = (k) => {
    const next = done.includes(k) ? done.filter((x) => x !== k) : [...done, k];
    setDone(next);
    try { localStorage.setItem(homeKey(id), JSON.stringify(next)); } catch { /* storage blocked */ }
  };
  return (
    <ul className="stack g8" style={{ listStyle: 'none', margin: 0, padding: 0 }} data-testid="iv-homework">
      {items.map((t) => <li key={t}><label className="row g8 small check" style={{ alignItems: 'flex-start', flexWrap: 'nowrap' }}><input type="checkbox" checked={done.includes(t)} onChange={() => toggle(t)} style={{ marginTop: 3, flex: 'none' }} /><span>{t}</span></label></li>)}
    </ul>
  );
}

export default function MeInterview() {
  const { id } = useParams();
  const toast = useToast();
  const [m, setM] = useState(null);
  const [pack, setPack] = useState(undefined);
  const [acc, setAcc] = useState(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [intro, setIntro] = useState('sec60');
  const [practice, setPractice] = useState(null);
  const load = () => {
    jobAccess().then(setAcc);
    getMatch(id).then(setM).catch((e) => setErr(e.message));
    getInterview(id).then(setPack).catch((e) => (e.status === 404 ? setPack(null) : setErr(e.message)));
  };
  useEffect(load, [id]);
  const make = async () => {
    setBusy(true);
    try { setPack(await makeInterview(id)); } catch (e) { toast(e.message); } finally { setBusy(false); }
  };
  const saved = (qid, answer, r) => setPack((p) => ({ ...p, progress: r.progress, questions: p.questions.map((q) => (q.id === qid ? { ...q, practised: { answer, feedback: r.feedback, at: Date.now() } } : q)) }));
  const lockedGroups = useMemo(() => {
    if (!pack?.locked?.length) return '';
    const counts = {};
    pack.locked.forEach((q) => { counts[q.group] = (counts[q.group] || 0) + 1; });
    return Object.entries(counts).map(([g, n]) => `${n} × ${pack.groups[g]}`).join(' · ');
  }, [pack]);
  if (err) return <div className="card stack g8"><p role="alert" className="error" style={{ margin: 0 }}>{err}</p><Link to="/me/ats">Back to job match</Link></div>;
  if (!m || pack === undefined || !acc) return <div className="card"><Spinner /></div>;
  const job = `${m.title || 'Job'}${m.company ? ` · ${m.company}` : ''}`;
  return (
    <>
      <MeHead title="Interview prep" sub={job} right={<Link className="btn btn-outline" to="/me/ats">Back to job match</Link>} />
      {!pack ? (
        <section className="card stack g12" data-testid="iv-start">
          <strong>Get ready for the {m.title || 'interview'}</strong>
          <span className="small muted">10 likely questions with answers built from your resume, “Tell me about yourself”, honest answers for your weak spots, questions to ask them, and practice with feedback.</span>
          <button type="button" className="btn btn-ink" style={{ alignSelf: 'flex-start' }} data-testid="iv-make" disabled={busy} onClick={make}>{busy && <Spinner />}{busy ? 'Making your pack…' : 'Make my interview pack'}</button>
          {!acc.interview && <span className="xs muted">Free: the first 3 questions, with practice.</span>}
        </section>
      ) : (
        <>
          <section className="card stack g8">
            <span className="row between g8" style={{ flexWrap: 'wrap', alignItems: 'center' }}>
              <strong data-testid="iv-progress">{pack.progress.done} of {pack.progress.total} practised</strong>
              {!practice && <button type="button" className="btn btn-ink" data-testid="iv-practise" onClick={() => setPractice(pack.questions.find((q) => !q.practised)?.id || pack.questions[0].id)}>Practise one question at a time</button>}
            </span>
            {pack.note && <span className="xs muted" role="note">{pack.note}</span>}
            <span className="xs muted"><mark className="gap">[Brackets]</mark> are gaps for you to fill with what really happened. Never add something you didn’t do.</span>
          </section>
          {practice && <Practice key={practice} id={id} pack={pack} start={practice} onSaved={saved} onClose={() => setPractice(null)} />}
          <section className="stack g8" aria-label="Questions">
            <h2 className="small" style={{ margin: 0 }}>Likely questions</h2>
            {pack.questions.map((q, i) => <Question key={q.id} q={q} n={i + 1} groups={pack.groups} onPractise={(qid) => { setPractice(qid); window.scrollTo({ top: 0, behavior: 'smooth' }); }} />)}
            {pack.locked.length > 0 && (
              <div className="card stack g8" style={{ padding: 14 }} data-testid="iv-locked">
                <strong className="small">{pack.locked.length} more questions in the Interview pack</strong>
                <span className="xs muted">{lockedGroups}. Also: “Tell me about yourself” in 2 minutes, your weak spots, questions to ask, and the homework checklist.</span>
                <PackOffer kind="interview" acc={acc} onBought={load} />
              </div>
            )}
          </section>
          <section className="card stack g8" aria-label="Tell me about yourself" data-testid="iv-intro">
            <span className="row between g8" style={{ flexWrap: 'wrap' }}>
              <strong>Tell me about yourself</strong>
              <span className="segmented" role="tablist" aria-label="Intro length">
                <button type="button" role="tab" aria-selected={intro === 'sec60'} onClick={() => setIntro('sec60')}>60 seconds</button>
                <button type="button" role="tab" aria-selected={intro === 'min2'} disabled={!pack.intro.min2} onClick={() => setIntro('min2')}>2 minutes</button>
              </span>
            </span>
            <p className="small" style={{ margin: 0, lineHeight: 1.6 }} data-testid="iv-intro-text">{pack.intro[intro] || pack.intro.sec60}</p>
          </section>
          {pack.unlocked && (
            <>
              <section className="card stack g8" aria-label="Weak spots" data-testid="iv-weak">
                <strong>Weak spots: honest answers</strong>
                {pack.weak.map((w) => <div key={w.q} className="stack g4"><strong className="small">{w.q}</strong><p className="small" style={{ margin: 0 }}><Gaps text={w.answer} /></p>{w.tip && <span className="xs muted">{w.tip}</span>}</div>)}
              </section>
              <section className="card stack g8" aria-label="Questions to ask" data-testid="iv-ask">
                <strong>5 questions to ask them</strong>
                <ol className="small" style={{ margin: 0, paddingLeft: 18 }}>{pack.ask.map((a) => <li key={a}>{a}</li>)}</ol>
              </section>
              <section className="card stack g8" aria-label="Company homework">
                <strong>Company homework</strong>
                <Homework id={id} items={pack.homework} />
              </section>
            </>
          )}
          <button type="button" className="btn btn-ghost" style={{ alignSelf: 'flex-start' }} disabled={busy} onClick={make}>{busy && <Spinner />}Make the pack again (your practice is kept)</button>
        </>
      )}
    </>
  );
}
