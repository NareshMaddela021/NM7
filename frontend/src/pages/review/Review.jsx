// /review/:orgId — a faculty reviewer's screen: the students assigned to them, each student's shared resume in the
// college format, comments on a section (optionally quoting a line), and "needs changes" / "approved".
import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import Header from '../../components/Header';
import { useToast } from '../../components/ui';
import ErrorBoundary from '../../components/ErrorBoundary';
import ResumePreview from '../builder/ResumePreview';
import { brandDesign } from '../../lib/branding';
import { brandFor } from '../../lib/placementFormat';
import { designOf } from '../builder/design';
import { http } from '../../services/http';
import { Chip, Empty, Skel } from '../me/kit';
import { Still } from '../newhome/ParticleStage';
import { SHAPE_COLORS, TINTS } from '../newhome/shapes';
import '../../styles/me-kit.css';
import '../../styles/org-team.css';

TINTS.college = SHAPE_COLORS.college;
const STATUS = { none: 'Not reviewed', needs_changes: 'Needs changes', ready: 'Approved' };
const STATUS_TONE = { none: 'neutral', needs_changes: 'warn', ready: 'ok' };

function Student({ base, id, onBack }) {
  const toast = useToast();
  const [x, setX] = useState(null);
  const [f, setF] = useState({ section: 'general', line: '', text: '' });
  const load = () => http(`${base}/students/${id}`).then(setX, (e) => toast(e.message));
  useEffect(() => { load(); }, [id]); // eslint-disable-line react-hooks/exhaustive-deps
  const add = async (e) => { e.preventDefault(); try { await http(`${base}/students/${id}/comments`, { method: 'POST', body: f }); setF({ ...f, line: '', text: '' }); load(); toast('Comment added'); } catch (er) { toast(er.message); } };
  const status = async (s) => { try { await http(`${base}/students/${id}/status`, { method: 'PUT', body: { status: s } }); load(); toast(s === 'approved' ? 'Approved' : 'Marked needs changes'); } catch (er) { toast(er.message); } };
  if (!x) return <Skel cards={2} lines={3} label="Loading the resume" />;
  const brand = x.brand ? brandFor(x.brand, '') : null;
  // round P, Phase 4: the resume on a paper frame beside a decision card, the comment form and the comments so far
  return (
    <div className="rv-student" data-testid="rv-student">
      <button type="button" className="btn btn-ghost rv-back" onClick={onBack}>← My students</button>
      <div className="mcard rv-head">
        <span className="mavatar ot-av" aria-hidden="true">{(x.name || '?').trim().charAt(0).toUpperCase()}</span>
        <strong className="rv-name">{x.name}</strong>
        <span className={`mchip mchip-${STATUS_TONE[x.reviewStatus] || 'neutral'}`} data-testid="rv-status">{STATUS[x.reviewStatus] || x.reviewStatus}</span>
      </div>
      <div className="rv-grid">
        <div className="rv-desk"><div className="rv-paper"><ErrorBoundary title="This resume couldn’t be shown." text="Ask the student to open and save it once."><ResumePreview data={x.data} design={x.brand ? brandDesign(x.brand, x.data) : designOf(x.data)} brand={brand} /></ErrorBoundary></div></div>
        <div className="rv-side">
          <div className="mcard mcard-tight rv-decide">
            <span className="mkicker">Your decision</span>
            <div className="row g8" style={{ flexWrap: 'wrap' }}>
              <button type="button" className="btn btn-outline" onClick={() => status('needs_changes')} data-testid="rv-needs">Needs changes</button>
              <button type="button" className="btn btn-signal" onClick={() => status('approved')} data-testid="rv-approve">Approve</button>
            </div>
          </div>
          <form className="mcard mcard-tight rv-form" onSubmit={add} aria-label="Add a comment">
            <span className="mkicker">Add a comment</span>
            <label className="field"><span className="label">Section</span> <select className="input" value={f.section} onChange={(e) => setF({ ...f, section: e.target.value })} data-testid="rv-section">{Object.entries(x.sections).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
            <label className="field"><span className="label">Line (optional — copy the words you mean)</span> <input className="input" maxLength={200} value={f.line} onChange={(e) => setF({ ...f, line: e.target.value })} data-testid="rv-line" /></label>
            <label className="field"><span className="label">Comment</span> <textarea className="input" rows={3} minLength={2} maxLength={1000} required value={f.text} onChange={(e) => setF({ ...f, text: e.target.value })} data-testid="rv-text" /></label>
            <button type="submit" className="btn btn-outline" style={{ alignSelf: 'flex-start' }} data-testid="rv-comment">Add comment</button>
          </form>
          <ul className="rv-comments" aria-label="Comments">
            {x.comments.map((c) => <li key={c.id} className={`rv-comment ${c.resolved ? 'done' : ''}`} data-testid="rv-comment-item"><strong>{c.sectionName}</strong>{c.line ? <span className="faint"> · “{c.line}”</span> : null}<div>{c.text}</div><span className={`mchip ${c.resolved ? 'mchip-ok' : 'mchip-warn'}`}>{c.resolved ? 'Resolved by the student' : 'Open'}</span></li>)}
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
      <main id="main" className="container-wide rv-page">
        <div className="rv-top">
          <span className="stack g4" style={{ minWidth: 0 }}>
            <span className="mkicker">Faculty review</span>
            <h1 className="display rv-h1">Resume review{st ? ` · ${st.org}` : ''}</h1>
          </span>
          <span className="rv-art" aria-hidden="true"><Still shape="resume" tint="college" className="rv-still" /></span>
        </div>
        {err && <div className="mcard mcard-bad" role="alert">{err} <Link to="/org">My organizations</Link></div>}
        {open ? <Student base={base} id={open} onBack={() => setOpen(null)} /> : !st ? (!err && <Skel cards={3} lines={2} label="Loading your students" />) : st.students.length === 0 ? <Empty shape="resume" tint="college" title="No students assigned to you yet.">Your college’s coordinator assigns students to you. They’ll show up here.</Empty> : (
          <ul className="rv-list" aria-label="My students">
            {st.students.map((s) => (
              <li key={s.id}><button type="button" className="rv-item" onClick={() => setOpen(s.id)} data-testid="rv-item">
                <span className="mavatar ot-av" aria-hidden="true">{(s.name || '?').trim().charAt(0).toUpperCase()}</span>
                <span className="rv-item-main"><strong className="small">{s.name}</strong><span className="xs muted">{s.group}{s.openComments ? ` · ${s.openComments} open comment${s.openComments === 1 ? '' : 's'}` : ''}</span></span>
                <Chip tone={STATUS_TONE[s.reviewStatus] || 'neutral'}>{STATUS[s.reviewStatus] || s.reviewStatus}</Chip>
              </button></li>
            ))}
          </ul>
        )}
      </main>
    </>
  );
}
