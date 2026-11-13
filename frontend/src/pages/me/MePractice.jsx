// Practice tests (Phase 6, S3): unlimited and free. Aptitude (numbers, reasoning), English (grammar, reading, emails at
// work), basic coding (read the code; nothing runs) and practice for each official skill check. One question at a
// time; after each answer: right or not, the right option and why. At the end: the score by topic; weak topics come
// with free courses. Practice never counts as a verified score: only the official skill check does.
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { http } from '../../services/http';
import { MeHead } from './MeLayout';
import { countOf } from '../../lib/format';

function Weak({ weak }) {
  if (!weak?.length) return null;
  return (
    <section className="card stack g8" aria-label="Topics to work on" data-testid="pr-weak">
      <strong>Topics to work on</strong>
      {weak.map((w) => (
        <div key={w.topic} className="stack g4">
          <span className="small"><strong>{w.topic}</strong> · {w.pct}% right in {countOf(w.answered, 'answer')}</span>
          {w.courses.length ? w.courses.map((c) => <a key={c.id} className="xs" href={c.url} target="_blank" rel="noopener noreferrer" style={{ overflowWrap: 'anywhere' }}>Free: {c.title} ({c.provider})</a>) : <span className="xs muted">Practise this topic again; free courses for it will show here.</span>}
        </div>
      ))}
    </section>
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
    <section className="card stack g12" aria-label={t.title} data-testid="pr-test">
      <div className="row between g8" style={{ flexWrap: 'wrap' }}><strong>{t.title}</strong><span className="xs muted" data-testid="pr-count">Question {i + 1} of {t.questions.length} · {q.topic}</span></div>
      <fieldset className="stack g8" style={{ border: 0, padding: 0, margin: 0 }}>
        <legend className="small" style={{ fontWeight: 600 }} data-testid="pr-q">{head}</legend>
        {code.length > 0 && <pre className="small" style={{ margin: 0, padding: 10, background: 'var(--surface-2, #f4f4f4)', borderRadius: 8, overflowX: 'auto', maxWidth: '100%' }}>{code.join('\n')}</pre>}
        {q.options.map((o, k) => {
          const mark = res ? (k === res.answer ? ' ✓' : k === pick ? ' ✗' : '') : '';
          return (
            <label key={o} className="row g8 small" style={{ alignItems: 'flex-start', fontWeight: res && k === res.answer ? 700 : 400 }}>
              <input type="radio" name={`pr-${q.id}`} checked={pick === k} disabled={!!res} onChange={() => setPick(k)} data-testid="pr-opt" style={{ marginTop: 3 }} />
              <span style={{ overflowWrap: 'anywhere' }}>{o}{mark}</span>
            </label>
          );
        })}
      </fieldset>
      {res && <p className={`small ${res.right ? '' : 'error'}`} role="status" data-testid="pr-why" style={{ margin: 0 }}><strong>{res.right ? 'Right.' : `Not quite. The answer is “${q.options[res.answer]}”.`}</strong> {res.why}</p>}
      {err && <p className="error" role="alert">{err}</p>}
      <div className="row g8">
        {!res ? <button type="button" className="btn btn-ink btn-sm" disabled={busy} onClick={check} data-testid="pr-check">Check my answer</button>
          : <button type="button" className="btn btn-ink btn-sm" disabled={busy} onClick={next} data-testid="pr-next">{i + 1 < t.questions.length ? 'Next question' : 'See my score'}</button>}
      </div>
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
        <section className="card stack g8" aria-label="Your score" data-testid="pr-end">
          <strong data-testid="pr-score">{end.right} of {end.total} right</strong>
          <ul className="small" style={{ margin: 0, paddingLeft: 18 }}>{end.topics.map((x) => <li key={x.topic}>{x.topic}: {x.right} of {x.total}</li>)}</ul>
          <span className="xs muted">Practice only: this is not a verified score. <Link to="/me/skill-checks">Take the official skill check</Link> when you're ready.</span>
        </section>
      )}
      {!d ? !err && <p className="muted">Loading…</p> : (
        <>
          <Weak weak={d.weak} />
          {!t && areas.map((a) => (
            <section key={a} className="stack g8" aria-label={a}>
              <strong>{a}</strong>
              <div className="row g8" style={{ flexWrap: 'wrap' }}>
                {d.sets.filter((s) => s.area === a).map((s) => <button key={s.id} type="button" className="btn btn-outline btn-sm" onClick={() => start(s.id)} data-testid={`pr-start-${s.id}`}>{s.title}</button>)}
              </div>
            </section>
          ))}
          {d.topics.length > 0 && (
            <section className="card stack g4" aria-label="My scores by topic" data-testid="pr-topics">
              <strong>My scores by topic (last 90 days)</strong>
              {d.topics.map((x) => <span key={x.topic} className="small">{x.topic}: {x.pct}% · {countOf(x.answered, 'answer')}</span>)}
            </section>
          )}
        </>
      )}
    </div>
  );
}
