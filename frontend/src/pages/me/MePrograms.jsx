// Internships and live projects (Phase 6, S8). Browse what Verified companies offer, apply (you share your resume
// only when you tick the box), send your work once accepted, and get a certificate with a verification link when the
// company accepts the work. The suggested resume entry is added only when you press the button.
import { useEffect, useState } from 'react';
import { API_BASE, http } from '../../services/http';
import { MeHead } from './MeLayout';

const pay = (p) => (p.stipend ? `₹${p.stipend.toLocaleString('en-IN')}${p.kind === 'internship' ? ' a month' : ''}` : 'Unpaid');
const STATUS = { applied: 'Applied', accepted: 'Accepted: send your work', submitted: 'Work sent: waiting for review', completed: 'Completed', not_completed: 'Not completed' };

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
    <li className="card stack g8" data-testid="pg-open">
      <div className="row between g8" style={{ flexWrap: 'wrap' }}><strong>{p.title}</strong><span className="badge b-neutral">{p.kind === 'internship' ? 'Internship' : 'Live project'}</span></div>
      <span className="xs muted">{p.company.name} · {pay(p)} · {p.weeks} week{p.weeks === 1 ? '' : 's'} · {p.remote ? 'Remote' : p.city}{p.deadline ? ` · send by ${p.deadline}` : ''}</span>
      <p className="small" style={{ margin: 0 }}>{p.brief}</p>
      {p.deliverable && <span className="small"><strong>You send: </strong>{p.deliverable}</span>}
      {applied ? <span className="small muted">You applied.</span> : !open ? <button type="button" className="btn btn-outline btn-sm" style={{ alignSelf: 'flex-start' }} onClick={() => setOpen(true)} data-testid="pg-apply-open">Apply</button> : (
        <div className="stack g8">
          <label className="field"><span className="label">A short note (optional)</span><input className="input" maxLength={600} value={note} onChange={(e) => setNote(e.target.value)} /></label>
          <label className="row g8 small"><input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} data-testid="pg-consent" />Share my resume with {p.company.name}</label>
          {err && <p className="error" role="alert">{err}</p>}
          <button type="button" className="btn btn-ink btn-sm" style={{ alignSelf: 'flex-start' }} onClick={go} data-testid="pg-apply">Send application</button>
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
  return (
    <li className="card stack g8" data-testid="pg-mine">
      <div className="row between g8" style={{ flexWrap: 'wrap' }}><strong>{p.title}</strong><span className="badge b-neutral" data-testid="pg-status">{STATUS[a.status]}</span></div>
      <span className="xs muted">{p.company?.name}</span>
      {(a.status === 'accepted' || a.status === 'submitted') && (
        <div className="stack g4">
          {p.deliverable && <span className="small"><strong>Send: </strong>{p.deliverable}</span>}
          <label className="field"><span className="label">Link to your work</span><input className="input" type="url" maxLength={500} value={link} onChange={(e) => setLink(e.target.value)} placeholder={a.submission.link || 'https://'} data-testid="pg-link" /></label>
          <button type="button" className="btn btn-ink btn-sm" style={{ alignSelf: 'flex-start' }} onClick={send} data-testid="pg-send">{a.status === 'submitted' ? 'Send again' : 'Send my work'}</button>
        </div>
      )}
      {a.review.note && <span className="small">Company's note: {a.review.note}</span>}
      {a.status === 'completed' && (
        <div className="stack g8" data-testid="pg-done">
          <div className="row g8" style={{ flexWrap: 'wrap' }}>
            <a className="btn btn-outline btn-sm" href={`${API_BASE}/api/public/certificates/${a.certificate}.pdf`} target="_blank" rel="noopener noreferrer" data-testid="pg-cert">Certificate (PDF)</a>
            <a className="btn btn-outline btn-sm" href={`/verify/${a.certificate}`} target="_blank" rel="noopener noreferrer">Verification page</a>
          </div>
          <span className="xs muted" style={{ overflowWrap: 'anywhere' }}>Anyone can check it at {a.verifyUrl}</span>
          {a.resumeEntry && !a.resumeAdded && (
            <div className="card-sm stack g4" data-testid="pg-entry">
              <span className="small"><strong>Add to your resume?</strong> {a.resumeEntry.role} · {a.resumeEntry.company} · {a.resumeEntry.from} – {a.resumeEntry.to}</span>
              <button type="button" className="btn btn-ink btn-sm" style={{ alignSelf: 'flex-start' }} onClick={toResume} data-testid="pg-add-resume">Add to my resume</button>
            </div>
          )}
          {a.resumeAdded && <span className="xs muted">On your resume.</span>}
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
      {mine && mine.length > 0 && <section className="stack g8" aria-label="Mine"><strong>Mine</strong><ul className="stack g8" style={{ listStyle: 'none', padding: 0, margin: 0 }}>{mine.map((a) => <Mine key={a.id} a={a} onChange={load} />)}</ul></section>}
      {open && (
        <section className="stack g8" aria-label="Open now">
          <strong>Open now</strong>
          {!open.length && <span className="small muted">Nothing open right now. Check again soon.</span>}
          <ul className="stack g8" style={{ listStyle: 'none', padding: 0, margin: 0 }}>{open.map((p) => <Open key={p.id} p={p} applied={applied.has(p.id)} onApplied={load} />)}</ul>
        </section>
      )}
    </div>
  );
}
