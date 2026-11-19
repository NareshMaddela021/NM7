// Interview feedback (Phase 6, S6). What companies said after "Not selected", in kind words, with free practice and
// courses to help (never the interviewer's name); and my own private notes after any interview, with tips.
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { http } from '../../services/http';
import { MeHead } from './MeLayout';
import { Chip, Empty, FieldGroup, Skel } from './kit';
import '../../styles/me-work.css';
import { IcEdit, IcMessage } from '../../components/icons';

const day = (ms) => (ms ? new Date(ms).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '');
const WENT = [['well', 'It went well'], ['ok', 'It was OK'], ['badly', 'It went badly']];
const BLANK = { company: '', role: '', date: '', asked: '', went: 'ok', notes: '' };

function Help({ h }) {
  return (
    <div className="wk-help" data-testid="fb-help">
      <span className="small">{h.text}</span>
      {h.note && <q className="wk-quote">{h.note}</q>}
      <div className="mrow g8">
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
      {!d ? (err ? <p className="error" role="alert">{err}</p> : <Skel cards={2} label="Loading feedback" />) : (
        <div className="mgrid-2">
          <div className="mstack">
            <section className="mcard" aria-label="From companies">
              <header className="mcard-h"><span className="mcard-ic blue" aria-hidden="true"><IcMessage /></span><span className="mcard-ht"><h2 className="mcard-title">From companies</h2><span className="mcard-sub">Kind, useful reasons after an interview, with free help.</span></span>{d.feedback.length > 0 && <Chip tone="info">{d.feedback.length}</Chip>}</header>
              {!d.feedback.length && <Empty shape="handshake" tint="seeker" compact title="Nothing yet" action={<Link className="btn btn-outline btn-sm" to="/me/practice">Try a free practice test</Link>}>When a company shares a reason after an interview, it shows here.</Empty>}
              {d.feedback.map((x) => (
                <article key={x.id} className="wk-fb" data-testid="fb-item">
                  <div className="wk-fb-top"><span className="mavatar" aria-hidden="true">{(x.company || x.job || '?').slice(0, 1).toUpperCase()}</span><span className="stack" style={{ minWidth: 0 }}><strong className="wk-fb-job">{x.job}</strong><span className="xs muted">{x.company ? `${x.company} · ` : ''}{day(x.at)}</span></span></div>
                  {x.help.map((h, i) => <Help key={i} h={h} />)}
                </article>
              ))}
            </section>
            {d.reviews.length > 0 && (
              <section className="mcard" aria-label="My notes">
                <header className="mcard-h"><span className="mcard-ic violet" aria-hidden="true"><IcEdit /></span><span className="mcard-ht"><h2 className="mcard-title">My notes</h2><span className="mcard-sub">Only you see these. Tips come from what you wrote.</span></span></header>
                <ul className="mlist">
                  {d.reviews.map((r) => (
                    <li key={r.id} className="wk-note-card" data-testid="fb-review">
                      <div className="mspread"><strong className="wk-fb-job">{[r.company, r.role, r.date].filter(Boolean).join(' · ') || 'Interview'}</strong><button type="button" className="btn btn-outline btn-sm" onClick={() => del(r.id)}>Delete</button></div>
                      {r.asked && <span className="xs muted" style={{ overflowWrap: 'anywhere' }}>Asked: {r.asked}</span>}
                      <ul className="wk-tips" data-testid="fb-tips">{r.tips.map((t) => <li key={t}>{t}</li>)}</ul>
                    </li>
                  ))}
                </ul>
              </section>
            )}
          </div>
          <form className="mcard" onSubmit={save} aria-label="Add my own notes" data-testid="fb-self-form">
            <header className="mcard-h"><span className="mcard-ic" aria-hidden="true">＋</span><span className="mcard-ht"><h2 className="mcard-title">My notes after an interview (only you see these)</h2><span className="mcard-sub">Write it down while you remember. We give you tips for next time.</span></span></header>
            <FieldGroup title="The interview">
              <label className="field"><span className="label">Company</span><input className="input" maxLength={120} value={f.company} onChange={set('company')} /></label>
              <label className="field"><span className="label">Role</span><input className="input" maxLength={120} value={f.role} onChange={set('role')} /></label>
              <label className="field"><span className="label">Date</span><input className="input" type="date" value={f.date} onChange={set('date')} /></label>
            </FieldGroup>
            <label className="field"><span className="label">What did they ask?</span><textarea className="input" rows={3} maxLength={2000} value={f.asked} onChange={set('asked')} data-testid="fb-asked" /></label>
            <fieldset className="wk-went">
              <legend className="label">How did it go?</legend>
              <div className="wk-went-row">
                {WENT.map(([k, l]) => <label key={k} className={`wk-went-opt ${f.went === k ? 'on' : ''}`}><input type="radio" name="fb-went" checked={f.went === k} onChange={() => setF({ ...f, went: k })} data-testid={`fb-went-${k}`} />{l}</label>)}
              </div>
            </fieldset>
            <label className="field"><span className="label">Anything else</span><textarea className="input" rows={2} maxLength={2000} value={f.notes} onChange={set('notes')} /></label>
            {err && <p className="error" role="alert">{err}</p>}
            <button type="submit" className="btn btn-signal" style={{ alignSelf: 'flex-start' }} disabled={busy} data-testid="fb-self-save">Save my notes</button>
          </form>
        </div>
      )}
    </div>
  );
}
