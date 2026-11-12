// Interview feedback (Phase 6, S6). What companies said after "Not selected", in kind words, with free practice and
// courses to help (never the interviewer's name); and my own private notes after any interview, with tips.
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { http } from '../../services/http';
import { MeHead } from './MeLayout';

const day = (ms) => (ms ? new Date(ms).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '');
const WENT = [['well', 'It went well'], ['ok', 'It was OK'], ['badly', 'It went badly']];
const BLANK = { company: '', role: '', date: '', asked: '', went: 'ok', notes: '' };

function Help({ h }) {
  return (
    <div className="stack g4" data-testid="fb-help">
      <span className="small">{h.text}</span>
      {h.note && <q className="small muted">{h.note}</q>}
      <div className="row g8" style={{ flexWrap: 'wrap' }}>
        {h.practice && <Link className="btn btn-outline btn-sm" to="/me/practice">Free practice test</Link>}
        {h.interview && <Link className="btn btn-outline btn-sm" to="/me/simple/practice">Practise speaking</Link>}
        {h.learn && <Link className="btn btn-outline btn-sm" to="/me/learn">Learning paths (small projects)</Link>}
        {(h.courses || []).map((c) => <a key={c.id} className="btn btn-outline btn-sm" style={{ whiteSpace: 'normal', textAlign: 'left', maxWidth: '100%', height: 'auto' }} href={c.url} target="_blank" rel="noopener noreferrer">Free: {c.title}</a>)}
      </div>
    </div>
  );
}

export default function MeFeedback() {
  const [d, setD] = useState(null);
  const [f, setF] = useState(BLANK);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const load = () => http('/api/me/feedback').then(setD, (e) => setErr(e.message));
  useEffect(() => { load(); }, []);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const save = async (e) => {
    e.preventDefault();
    setBusy(true); setErr('');
    try { await http('/api/me/feedback/self', { method: 'POST', body: f }); setF(BLANK); await load(); } catch (x) { setErr(x.message); } finally { setBusy(false); }
  };
  const del = async (id) => { try { await http(`/api/me/feedback/self/${id}`, { method: 'DELETE' }); load(); } catch (x) { setErr(x.message); } };
  return (
    <div className="stack g16" data-testid="me-feedback">
      <MeHead title="Interview feedback" sub="What companies told you, with free help to improve, and your own private notes after an interview." />
      {!d ? (err ? <p className="error" role="alert">{err}</p> : <p className="muted">Loading…</p>) : (
        <>
          <section className="stack g8" aria-label="From companies">
            <strong>From companies</strong>
            {!d.feedback.length && <span className="small muted">Nothing yet. When a company shares a reason after an interview, it shows here.</span>}
            {d.feedback.map((x) => (
              <div key={x.id} className="card stack g8" data-testid="fb-item">
                <span className="small"><strong>{x.job}</strong>{x.company ? ` · ${x.company}` : ''} · {day(x.at)}</span>
                {x.help.map((h, i) => <Help key={i} h={h} />)}
              </div>
            ))}
          </section>
          <form className="card stack g8" onSubmit={save} aria-label="Add my own notes" data-testid="fb-self-form">
            <strong>My notes after an interview (only you see these)</strong>
            <div className="co-grid">
              <label className="field"><span className="label">Company</span><input className="input" maxLength={120} value={f.company} onChange={set('company')} /></label>
              <label className="field"><span className="label">Role</span><input className="input" maxLength={120} value={f.role} onChange={set('role')} /></label>
              <label className="field"><span className="label">Date</span><input className="input" type="date" value={f.date} onChange={set('date')} /></label>
            </div>
            <label className="field"><span className="label">What did they ask?</span><textarea className="input" rows={3} maxLength={2000} value={f.asked} onChange={set('asked')} data-testid="fb-asked" /></label>
            <fieldset style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}>
              <legend className="label">How did it go?</legend>
              <div className="row g12" style={{ flexWrap: 'wrap' }}>
                {WENT.map(([k, l]) => <label key={k} className="row g4 small"><input type="radio" name="fb-went" checked={f.went === k} onChange={() => setF({ ...f, went: k })} data-testid={`fb-went-${k}`} />{l}</label>)}
              </div>
            </fieldset>
            <label className="field"><span className="label">Anything else</span><textarea className="input" rows={2} maxLength={2000} value={f.notes} onChange={set('notes')} /></label>
            {err && <p className="error" role="alert">{err}</p>}
            <button type="submit" className="btn btn-ink btn-sm" style={{ alignSelf: 'flex-start' }} disabled={busy} data-testid="fb-self-save">Save my notes</button>
          </form>
          {d.reviews.map((r) => (
            <div key={r.id} className="card-sm stack g4" data-testid="fb-review">
              <div className="row between g8" style={{ flexWrap: 'wrap' }}><strong className="small">{[r.company, r.role, r.date].filter(Boolean).join(' · ') || 'Interview'}</strong><button type="button" className="btn btn-outline btn-sm" onClick={() => del(r.id)}>Delete</button></div>
              {r.asked && <span className="xs muted" style={{ overflowWrap: 'anywhere' }}>Asked: {r.asked}</span>}
              <ul className="small" style={{ margin: 0, paddingLeft: 18 }} data-testid="fb-tips">{r.tips.map((t) => <li key={t}>{t}</li>)}</ul>
            </div>
          ))}
        </>
      )}
    </div>
  );
}
