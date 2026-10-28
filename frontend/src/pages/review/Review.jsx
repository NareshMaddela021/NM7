// /review/:orgId — a faculty reviewer's screen: the students assigned to them, each student's shared resume in the
// college format, comments on a section (optionally quoting a line), and "needs changes" / "approved".
import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import Header from '../../components/Header';
import { Spinner, useToast } from '../../components/ui';
import ErrorBoundary from '../../components/ErrorBoundary';
import ResumePreview from '../builder/ResumePreview';
import { brandDesign } from '../../lib/branding';
import { brandFor } from '../../lib/placementFormat';
import { designOf } from '../builder/design';
import { http } from '../../services/http';

const STATUS = { none: 'Not reviewed', needs_changes: 'Needs changes', ready: 'Approved' };

function Student({ base, id, onBack }) {
  const toast = useToast();
  const [x, setX] = useState(null);
  const [f, setF] = useState({ section: 'general', line: '', text: '' });
  const load = () => http(`${base}/students/${id}`).then(setX, (e) => toast(e.message));
  useEffect(() => { load(); }, [id]); // eslint-disable-line react-hooks/exhaustive-deps
  const add = async (e) => { e.preventDefault(); try { await http(`${base}/students/${id}/comments`, { method: 'POST', body: f }); setF({ ...f, line: '', text: '' }); load(); toast('Comment added'); } catch (er) { toast(er.message); } };
  const status = async (s) => { try { await http(`${base}/students/${id}/status`, { method: 'PUT', body: { status: s } }); load(); toast(s === 'approved' ? 'Approved' : 'Marked needs changes'); } catch (er) { toast(er.message); } };
  if (!x) return <div className="row g8"><Spinner /> Loading…</div>;
  const brand = x.brand ? brandFor(x.brand, '') : null;
  return (
    <div className="stack g16" data-testid="rv-student">
      <button type="button" className="link-btn xs" onClick={onBack} style={{ alignSelf: 'flex-start' }}>← My students</button>
      <div className="row between g8" style={{ flexWrap: 'wrap' }}><strong style={{ fontSize: 20 }}>{x.name}</strong><span className="badge b-neutral" data-testid="rv-status">{STATUS[x.reviewStatus] || x.reviewStatus}</span></div>
      <div className="row g16" style={{ alignItems: 'flex-start', flexWrap: 'wrap' }}>
        <div style={{ flex: '1 1 340px', minWidth: 0, maxWidth: 520 }}><ErrorBoundary title="This resume couldn’t be shown." text="Ask the student to open and save it once."><ResumePreview data={x.data} design={x.brand ? brandDesign(x.brand, x.data) : designOf(x.data)} brand={brand} /></ErrorBoundary></div>
        <div className="stack g12" style={{ flex: '1 1 280px', minWidth: 0 }}>
          <form className="card stack g8" onSubmit={add} aria-label="Add a comment">
            <label className="small">Section <select className="input" value={f.section} onChange={(e) => setF({ ...f, section: e.target.value })} data-testid="rv-section">{Object.entries(x.sections).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
            <label className="small">Line (optional — copy the words you mean) <input className="input" maxLength={200} value={f.line} onChange={(e) => setF({ ...f, line: e.target.value })} data-testid="rv-line" /></label>
            <label className="small">Comment <textarea className="input" rows={3} minLength={2} maxLength={1000} required value={f.text} onChange={(e) => setF({ ...f, text: e.target.value })} data-testid="rv-text" /></label>
            <button type="submit" className="btn btn-outline" style={{ alignSelf: 'flex-start' }} data-testid="rv-comment">Add comment</button>
          </form>
          <div className="row g8" style={{ flexWrap: 'wrap' }}>
            <button type="button" className="btn btn-outline" onClick={() => status('needs_changes')} data-testid="rv-needs">Needs changes</button>
            <button type="button" className="btn btn-ink" onClick={() => status('approved')} data-testid="rv-approve">Approve</button>
          </div>
          <ul className="stack g8" style={{ listStyle: 'none', margin: 0, padding: 0 }} aria-label="Comments">
            {x.comments.map((c) => <li key={c.id} className="well small" data-testid="rv-comment-item"><strong>{c.sectionName}</strong>{c.line ? <span className="faint"> · “{c.line}”</span> : null}<div>{c.text}</div><span className="xs muted">{c.resolved ? 'Resolved by the student' : 'Open'}</span></li>)}
          </ul>
        </div>
      </div>
    </div>
  );
}

export default function Review() {
  const { orgId } = useParams();
  const base = `/api/review/${encodeURIComponent(orgId)}`;
  const [st, setSt] = useState(null);
  const [err, setErr] = useState('');
  const [open, setOpen] = useState(null);
  useEffect(() => { http(`${base}/students`).then(setSt, (e) => setErr(e.status === 404 ? 'You aren’t a reviewer for this organization.' : e.message)); }, [base, open]);
  return (
    <>
      <Header variant="me" />
      <main id="main" className="container-wide stack g16" style={{ padding: '24px 16px 72px' }}>
        <h1 className="display" style={{ fontSize: 28 }}>Resume review{st ? ` · ${st.org}` : ''}</h1>
        {err && <div className="card" role="alert">{err} <Link to="/org">My organizations</Link></div>}
        {open ? <Student base={base} id={open} onBack={() => setOpen(null)} /> : !st ? (!err && <div className="row g8"><Spinner /> Loading…</div>) : st.students.length === 0 ? <p className="small muted">No students assigned to you yet.</p> : (
          <ul className="stack g8" style={{ listStyle: 'none', margin: 0, padding: 0 }} aria-label="My students">
            {st.students.map((s) => (
              <li key={s.id}><button type="button" className="card row between g8" style={{ width: '100%', textAlign: 'left', flexWrap: 'wrap' }} onClick={() => setOpen(s.id)} data-testid="rv-item">
                <span className="stack g4"><strong className="small">{s.name}</strong><span className="xs muted">{s.group}{s.openComments ? ` · ${s.openComments} open comment${s.openComments === 1 ? '' : 's'}` : ''}</span></span>
                <span className="badge b-neutral">{STATUS[s.reviewStatus] || s.reviewStatus}</span>
              </button></li>
            ))}
          </ul>
        )}
      </main>
    </>
  );
}
