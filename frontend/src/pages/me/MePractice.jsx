// Practice tests (Phase 6, S3): unlimited and free. Aptitude (numbers, reasoning), English (grammar, reading, emails at
// work), basic coding (read the code; nothing runs) and practice for each official skill check. One question at a
// time; after each answer: right or not, the right option and why. At the end: the score by topic; weak topics come
// with free courses. Practice never counts as a verified score: only the official skill check does.
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { http } from '../../services/http';
import { MeHead } from './MeLayout';
import { countOf } from '../../lib/format';
import { Bar, Empty, MeCard, ScoreRing, Skel, StickyBar } from './kit';
import '../../styles/me-learn.css';
import { IcArrowRight, IcArrowUp, IcCheck, IcEdit, IcX } from '../../components/icons';

const ICONS = { Aptitude: '∑', English: 'Aa', Coding: '</>' };
const iconFor = (area) => Object.entries(ICONS).find(([k]) => area.toLowerCase().includes(k.toLowerCase()))?.[1] || <IcEdit size={20} />;
const toneOf = (pct) => (pct >= 70 ? 'ok' : pct >= 40 ? 'warn' : 'bad');

function Weak({ weak }) {
  if (!weak?.length) return null;
  return (
    <MeCard tone="warn" icon="!" title="Topics to work on" sub="Your weakest topics from recent practice, with free courses." testid="pr-weak">
      <ul className="mlist">
        {weak.map((w) => (
          <li key={w.topic} className="mitem" style={{ alignItems: 'flex-start' }}>
            <div className="mitem-main" style={{ gap: 8 }}>
              <Bar value={w.pct} label={w.topic} tone={toneOf(w.pct)} />
              <span className="xs muted">{w.pct}% right in {countOf(w.answered, 'answer')}</span>
              {w.courses.length ? w.courses.map((c) => <a key={c.id} className="small" href={c.url} target="_blank" rel="noopener noreferrer" style={{ overflowWrap: 'anywhere' }}>Free: {c.title} ({c.provider})</a>) : <span className="xs muted">Practise this topic again; free courses for it will show here.</span>}
            </div>
          </li>
        ))}
      </ul>
    </MeCard>
  );
}

function Test({ t, onEnd }) {
  const [i, setI] = useState(0);
  const [pick, setPick] = useState(null);
  const [res, setRes] = useState(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const q = t.questions[i];
  const check = async () => {
    if (pick == null) { setErr('Pick an answer first.'); return; }
    setBusy(true); setErr('');
    try { setRes(await http(`/api/me/practice/${t.id}/answer`, { method: 'POST', body: { q: q.id, choice: pick } })); } catch (e) { setErr(e.message); } finally { setBusy(false); }
  };
  const next = async () => {
    if (i + 1 < t.questions.length) { setI(i + 1); setPick(null); setRes(null); return; }
    setBusy(true);
    try { onEnd(await http(`/api/me/practice/${t.id}/finish`, { method: 'POST' })); } catch (e) { setErr(e.message); setBusy(false); }
  };
  const [head, ...code] = q.code ? q.question.split('\n') : [q.question];
  return (
    <section className="mcard" aria-label={t.title} data-testid="pr-test">
      <div className="mspread">
        <strong className="mserif" style={{ fontSize: 20, color: 'var(--ink)' }}>{t.title}</strong>
        <span className="small muted" data-testid="pr-count">Question {i + 1} of {t.questions.length} · {q.topic}</span>
      </div>
      <Bar value={i + (res ? 1 : 0)} max={t.questions.length} label="Done" showValue={false} tone="student" />
      <fieldset className="stack g12" style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}>
        <legend className="ml-qtext" data-testid="pr-q">{head}</legend>
        {code.length > 0 && <pre className="ml-code">{code.join('\n')}</pre>}
        <div className="ml-opts">
          {q.options.map((o, k) => {
            const right = res && k === res.answer;
            const wrong = res && !right && k === pick;
            return (
              <label key={o} className={`ml-opt ${right ? 'right' : ''} ${wrong ? 'wrong' : ''}`}>
                <input type="radio" name={`pr-${q.id}`} checked={pick === k} disabled={!!res} onChange={() => setPick(k)} data-testid="pr-opt" />
                <span>{o}{right ? <> <IcCheck size={16} label="Right answer" /></> : wrong ? <> <IcX size={16} label="Wrong answer" /></> : ''}</span>
              </label>
            );
          })}
        </div>
      </fieldset>
      {res && <p className={`ml-why-box ${res.right ? '' : 'bad'}`} role="status" data-testid="pr-why"><strong>{res.right ? 'Right.' : `Not quite. The answer is “${q.options[res.answer]}”.`}</strong> {res.why}</p>}
      {err && <p className="error" role="alert">{err}</p>}
      <StickyBar label="Answer">
        {!res ? <button type="button" className="btn btn-signal" disabled={busy} onClick={check} data-testid="pr-check">Check my answer</button>
          : <button type="button" className="btn btn-signal" disabled={busy} onClick={next} data-testid="pr-next">{i + 1 < t.questions.length ? 'Next question' : 'See my score'}</button>}
      </StickyBar>
    </section>
  );
}

export default function MePractice() {
  const [d, setD] = useState(null);
  const [t, setT] = useState(null);
  const [end, setEnd] = useState(null);
  const [err, setErr] = useState('');
  const load = () => http('/api/me/practice').then(setD, (e) => setErr(e.message));
  useEffect(() => { load(); }, []);
  const start = async (id) => {
    setErr(''); setEnd(null);
    try { setT(await http('/api/me/practice/start', { method: 'POST', body: { set: id } })); window.scrollTo?.(0, 0); } catch (e) { setErr(e.message); }
  };
  const areas = d ? [...new Set(d.sets.map((s) => s.area))] : [];
  return (
    <div className="stack g16" data-testid="me-practice">
      <MeHead title="Practice tests" sub="Free and unlimited. See why after every answer. Practice never counts as a verified score: only the official skill check does." />
      {err && <p className="error" role="alert">{err}</p>}
      {t && !end && <Test key={t.id} t={t} onEnd={(r) => { setEnd(r); setT(null); load(); }} />}
      {end && (
        <section className="mcard mcard-accent" aria-label="Your score" data-testid="pr-end">
          <div className="ml-result">
            <ScoreRing value={end.total ? (end.right / end.total) * 100 : 0} label="Practice score" good={70} fair={40} sub="%" />
            <div className="stack g8" style={{ minWidth: 0 }}>
              <span className="mkicker">Practice result</span>
              <strong className="ml-hero-title" data-testid="pr-score">{end.right} of {end.total} right</strong>
              <div className="stack g8">{end.topics.map((x) => <Bar key={x.topic} value={x.right} max={x.total} label={x.topic} tone={toneOf(x.total ? (x.right / x.total) * 100 : 0)} />)}</div>
            </div>
          </div>
          <span className="xs muted">Practice only: this is not a verified score. <Link to="/me/skill-checks">Take the official skill check</Link> when you're ready.</span>
        </section>
      )}
      {!d ? !err && <Skel cards={3} label="Loading practice tests" /> : (
        <>
          <Weak weak={d.weak} />
          {!t && areas.map((a) => (
            <section key={a} className="stack g12" aria-label={a}>
              <h2 className="mcard-title">{a}</h2>
              <div className="mgrid-3 ml-tiles">
                {d.sets.filter((s) => s.area === a).map((s) => (
                  <button key={s.id} type="button" className="ml-tile" onClick={() => start(s.id)} data-testid={`pr-start-${s.id}`}>
                    <span className="ml-tile-ic" aria-hidden="true">{iconFor(a)}</span>
                    <span className="ml-tile-title">{s.title}</span>
                    <span className="ml-tile-go" aria-hidden="true">Start <IcArrowRight size={16} /></span>
                  </button>
                ))}
              </div>
            </section>
          ))}
          {!t && d.sets.length === 0 && <Empty shape="cap" tint="student" title="No practice tests yet" action={<Link className="btn btn-signal" to="/me/learn">See learning paths</Link>}>New tests are added often. Meanwhile, start a free learning path.</Empty>}
          {d.topics.length > 0 && (
            <MeCard icon={<IcArrowUp />} title="My scores by topic (last 90 days)" testid="pr-topics">
              <div className="mgrid" style={{ gap: 14 }}>
                {d.topics.map((x) => (
                  <div key={x.topic} className="stack g4">
                    <Bar value={x.pct} label={x.topic} tone={toneOf(x.pct)} />
                    <span className="xs muted">{countOf(x.answered, 'answer')}</span>
                  </div>
                ))}
              </div>
            </MeCard>
          )}
        </>
      )}
    </div>
  );
}
