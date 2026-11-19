// Internships and live projects (Phase 6, S8). Browse what Verified companies offer, apply (you share your resume
// only when you tick the box), send your work once accepted, and get a certificate with a verification link when the
// company accepts the work. The suggested resume entry is added only when you press the button.
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { API_BASE, http } from '../../services/http';
import { MeHead } from './MeLayout';
import { fmtRange } from '../../lib/format';
import { Chip, Empty, Skel } from './kit';
import '../../styles/me-learn.css';
import { IcClock, IcPin } from '../../components/icons';

const pay = (p) => (p.stipend ? `₹${p.stipend.toLocaleString('en-IN')}${p.kind === 'internship' ? ' a month' : ''}` : 'Unpaid');
const STATUS = { applied: 'Applied', accepted: 'Accepted: send your work', submitted: 'Work sent: waiting for review', completed: 'Completed', not_completed: 'Not completed' };
const TONE = { applied: 'info', accepted: 'accent', submitted: 'warn', completed: 'ok', not_completed: 'bad' };
const STEP = { applied: 1, accepted: 2, submitted: 3, completed: 4, not_completed: 3 };

function Open({ p, applied, onApplied }) {
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState('');
  const [consent, setConsent] = useState(false);
  const [err, setErr] = useState('');
  const go = async () => {
    setErr('');
    try { await http(`/api/programs/${p.id}/apply`, { method: 'POST', body: { note, consent } }); onApplied(); } catch (x) { setErr(x.message); }
  };
  return (
    <li className="mcard" data-testid="pg-open">
      <div className="mspread" style={{ alignItems: 'flex-start' }}>
        <div className="stack g4" style={{ minWidth: 0, flex: 1 }}>
          <span><Chip tone={p.kind === 'internship' ? 'accent' : 'info'}>{p.kind === 'internship' ? 'Internship' : 'Live project'}</Chip></span>
          <h3 className="ml-role-title" style={{ fontSize: 22 }}>{p.title}</h3>
          <span className="small muted">{p.company.name}</span>
        </div>
        <span className="mavatar" aria-hidden="true">{(p.company.name || '?').charAt(0)}</span>
      </div>
      <div className="ml-facts">
        <span className="ml-fact">₹ {pay(p)}</span>
        <span className="ml-fact"><IcClock size={14} /> {p.weeks} week{p.weeks === 1 ? '' : 's'}</span>
        <span className="ml-fact"><IcPin size={14} /> {p.remote ? 'Remote' : p.city}</span>
        {p.deadline && <span className="ml-fact">Send by {p.deadline}</span>}
      </div>
      <p className="small" style={{ margin: 0, lineHeight: 1.55 }}>{p.brief}</p>
      {p.deliverable && <div className="ml-box"><span className="ml-box-h">You send</span><span>{p.deliverable}</span></div>}
      {applied ? <span><Chip tone="ok">You applied.</Chip></span> : !open ? <div><button type="button" className="btn btn-signal" onClick={() => setOpen(true)} data-testid="pg-apply-open">Apply</button></div> : (
        <div className="stack g12 ml-box" style={{ background: '#fff' }}>
          <label className="field"><span className="label">A short note (optional)</span><input className="input" maxLength={600} value={note} onChange={(e) => setNote(e.target.value)} /></label>
          <label className="ml-toggle"><input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} data-testid="pg-consent" />Share my resume with {p.company.name}</label>
          {err && <p className="error" role="alert">{err}</p>}
          <div className="ml-actions">
            <button type="button" className="btn btn-signal" onClick={go} data-testid="pg-apply">Send application</button>
            <button type="button" className="btn btn-ghost" onClick={() => setOpen(false)}>Cancel</button>
          </div>
        </div>
      )}
    </li>
  );
}

function Mine({ a, onChange }) {
  const [link, setLink] = useState('');
  const [err, setErr] = useState('');
  const [msg, setMsg] = useState('');
  const send = async () => {
    setErr('');
    try { await http(`/api/me/programs/${a.id}/submit`, { method: 'POST', body: { link: link.trim() } }); onChange(); } catch (x) { setErr(x.message); }
  };
  const toResume = async () => {
    setErr('');
    try { await http(`/api/me/programs/${a.id}/resume`, { method: 'POST' }); setMsg('Added to your resume under Internships.'); onChange(); } catch (x) { setErr(x.message); }
  };
  const p = a.program || {};
  const step = STEP[a.status] || 1;
  const stop = a.status === 'not_completed';
  return (
    <li className={`mcard ${a.status === 'completed' ? 'mcard-ok' : ''}`} data-testid="pg-mine">
      <div className="stack g4" style={{ minWidth: 0 }}>
        <span><Chip tone={TONE[a.status] || 'neutral'} testid="pg-status">{STATUS[a.status]}</Chip></span>
        <h3 className="ml-role-title" style={{ fontSize: 22 }}>{p.title}</h3>
        <span className="small muted">{p.company?.name}</span>
      </div>
      <ol className="ml-track" aria-label="Progress">
        {['Applied', 'Accepted', 'Work sent', stop ? 'Not completed' : 'Completed'].map((l, k) => <li key={l} className={stop && k === 3 ? 'stop' : k < step ? 'done' : ''}>{l}</li>)}
      </ol>
      {(a.status === 'accepted' || a.status === 'submitted') && (
        <div className="stack g8 ml-box" style={{ background: '#fff' }}>
          {p.deliverable && <span className="small"><strong>Send: </strong>{p.deliverable}</span>}
          <label className="field"><span className="label">Link to your work</span><input className="input" type="url" maxLength={500} value={link} onChange={(e) => setLink(e.target.value)} placeholder={a.submission.link || 'https://'} data-testid="pg-link" /></label>
          <div><button type="button" className="btn btn-signal" onClick={send} data-testid="pg-send">{a.status === 'submitted' ? 'Send again' : 'Send my work'}</button></div>
        </div>
      )}
      {a.review.note && <p className="ml-quote">Company's note: {a.review.note}</p>}
      {a.status === 'completed' && (
        <div className="stack g12" data-testid="pg-done">
          <div className="ml-actions">
            <a className="btn btn-signal" href={`${API_BASE}/api/public/certificates/${a.certificate}.pdf`} target="_blank" rel="noopener noreferrer" data-testid="pg-cert">Certificate (PDF)</a>
            <a className="btn btn-outline" href={`/verify/${a.certificate}`} target="_blank" rel="noopener noreferrer">Verification page</a>
          </div>
          <span className="xs muted" style={{ overflowWrap: 'anywhere' }}>Anyone can check it at {a.verifyUrl}</span>
          {a.resumeEntry && !a.resumeAdded && (
            <div className="ml-box" data-testid="pg-entry" style={{ background: '#fff' }}>
              <span className="small"><strong>Add to your resume?</strong> {a.resumeEntry.role} · {a.resumeEntry.company} · {fmtRange(a.resumeEntry.from, a.resumeEntry.to)}</span>
              <div><button type="button" className="btn btn-outline" onClick={toResume} data-testid="pg-add-resume">Add to my resume</button></div>
            </div>
          )}
          {a.resumeAdded && <span><Chip tone="ok">On your resume.</Chip></span>}
        </div>
      )}
      {msg && <p className="small" role="status">{msg}</p>}
      {err && <p className="error" role="alert">{err}</p>}
    </li>
  );
}

export default function MePrograms() {
  const [open, setOpen] = useState(null);
  const [mine, setMine] = useState(null);
  const [err, setErr] = useState('');
  const load = () => Promise.all([http('/api/programs'), http('/api/me/programs')]).then(([o, m]) => { setOpen(o); setMine(m); }, (e) => setErr(e.message));
  useEffect(() => { load(); }, []);
  const applied = new Set((mine || []).map((a) => a.program?.id));
  return (
    <div className="stack g16" data-testid="me-programs">
      <MeHead title="Internships & projects" sub="Real work from Verified companies. Free to apply; you never pay. Finish one to get a certificate anyone can check." />
      {err && <p className="error" role="alert">{err}</p>}
      {!open && !err && <Skel cards={2} label="Loading internships and projects" />}
      {mine && mine.length > 0 && (
        <section className="stack g12" aria-label="Mine">
          <h2 className="mcard-title">Mine</h2>
          <ul className="mgrid" style={{ listStyle: 'none', padding: 0, margin: 0 }}>{mine.map((a) => <Mine key={a.id} a={a} onChange={load} />)}</ul>
        </section>
      )}
      {open && (
        <section className="stack g12" aria-label="Open now">
          <h2 className="mcard-title">Open now</h2>
          {!open.length && (
            <Empty shape="cap" tint="student" title="Nothing open right now" action={<Link className="btn btn-signal" to="/me/learn">Learn a skill meanwhile</Link>}>
              Check again soon. New internships and projects from Verified companies show up here.
            </Empty>
          )}
          <ul className="mgrid" style={{ listStyle: 'none', padding: 0, margin: 0 }}>{open.map((p) => <Open key={p.id} p={p} applied={applied.has(p.id)} onApplied={load} />)}</ul>
        </section>
      )}
    </div>
  );
}
