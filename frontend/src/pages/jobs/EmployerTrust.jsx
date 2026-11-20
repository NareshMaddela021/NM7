// Vetting Trust T4, for candidates: the "Verified employer" badge (the company's business registration was checked in
// the GST, Udyam or MCA registry), the "Never pay for a job on Nm7" promise with what to do when someone asks for
// money, and "Report fraud" (a reason + an optional note; a person at Nm7 checks it, the company never learns who).
// Shown only when the API sends them: job cards carry `employer`, the job page and the company page `employerTrust`,
// and /api/me/trust/employer serves invites and offers; all only while the Trust switch lets this person in
// (Admin -> Skill checks -> Vetting Trust). English only for now.
import { useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useAuth } from '../../lib/auth';
import { http } from '../../services/http';
import { IcCheck } from '../../components/icons';

const day = (v) => (v ? new Date(v).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '');

/** "Verified employer · GST". `chip`: the dashboard chip style (MeHire) instead of the job board's badge. */
export function EmployerBadge({ v, chip = false, full = false }) {
  if (!v) return null;
  const title = `Business registration checked in the ${v.registry} registry${v.checkedAt ? ` on ${day(v.checkedAt)}` : ''}${v.test ? ' (test provider)' : ''}`;
  const text = `${v.label} · ${v.registry}${full && v.checkedAt ? `, checked ${day(v.checkedAt)}` : ''}${v.test ? ' (test)' : ''}`;
  return <span className={chip ? 'mchip mchip-ok' : 'badge b-success'} title={title} data-testid="employer-badge" style={{ whiteSpace: 'normal', overflowWrap: 'anywhere', alignSelf: 'flex-start', maxWidth: '100%' }}><IcCheck size={14} style={{ marginRight: 4, flex: 'none' }} />{text}</span>;
}

/** The promise in one plain line, and (open = false) a short "What to do if anyone asks for money" list. */
export function NeverPay({ safety, compact = false }) {
  if (!safety?.promise) return null;
  return (
    <div className="stack g4" data-testid="never-pay" style={{ minWidth: 0 }}>
      <p className="small" style={{ margin: 0 }}><strong>{safety.promise.split('. ')[0]}.</strong>{compact ? '' : ` ${safety.promise.split('. ').slice(1).join('. ')}`}</p>
      {safety.help?.length > 0 && (
        <details className="xs" data-testid="never-pay-help">
          <summary style={{ cursor: 'pointer', minHeight: 24 }}>What to do if anyone asks you for money</summary>
          <ol className="stack g4" style={{ margin: '6px 0 0', paddingLeft: 18 }}>{safety.help.map((h) => <li key={h}>{h}</li>)}</ol>
        </details>
      )}
    </div>
  );
}

/** "Report fraud": context job | company | invite | offer, id = what is reported. Opens in place (no pop-up). */
export function FraudReport({ safety, context, id, label = 'Report fraud' }) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [note, setNote] = useState('');
  const [st, setSt] = useState({});
  const { user } = useAuth();
  const { pathname } = useLocation();
  if (!safety?.reasons) return null;
  if (!user) return <Link className="small" style={{ color: 'var(--danger)' }} to={`/login?next=${encodeURIComponent(pathname)}`} data-testid="fraud-signin">Sign in to report fraud</Link>;
  const fid = `fr-${context}-${id}`.replace(/[^a-zA-Z0-9_-]/g, '');
  if (st.done) return <p className="small" role="status" style={{ margin: 0 }} data-testid="fraud-done">{st.done}</p>;
  if (!open) return <button type="button" className="link-btn small" style={{ alignSelf: 'flex-start', minHeight: 44, color: 'var(--danger)' }} onClick={() => setOpen(true)} data-testid="fraud-open">{label}</button>;
  const send = async (e) => {
    e.preventDefault();
    if (!reason) { setSt({ error: 'Pick what happened.' }); return; }
    setSt({ busy: true });
    try {
      const r = await http('/api/me/trust/fraud', { method: 'POST', body: { context, id, reason, note: note.trim() } });
      setSt({ done: r.next });
    } catch (x) {
      if (x?.code === 'already') setSt({ done: x.message });
      else setSt({ error: x?.message || 'Not sent. Please try again.' });
    }
  };
  return (
    <form className="card-sm stack g8" onSubmit={send} aria-labelledby={`${fid}-h`} data-testid="fraud-form" style={{ minWidth: 0 }}>
      <strong id={`${fid}-h`}>{label}</strong>
      <fieldset className="stack g4" style={{ border: 0, margin: 0, padding: 0, minWidth: 0 }}>
        <legend className="label">What happened?</legend>
        {safety.reasons.map((r) => (
          <label key={r.key} className="row g8 small" style={{ alignItems: 'flex-start', flexWrap: 'nowrap', minHeight: 32 }}>
            <input type="radio" name={`${fid}-r`} value={r.key} checked={reason === r.key} onChange={() => setReason(r.key)} style={{ marginTop: 3, width: 18, height: 18, flex: 'none' }} data-testid={`fraud-reason-${r.key}`} />
            <span>{r.title}</span>
          </label>
        ))}
      </fieldset>
      <div className="field">
        <label className="label" htmlFor={`${fid}-n`}>Tell us more (optional)</label>
        <textarea id={`${fid}-n`} className="input" rows={3} maxLength={1000} value={note} onChange={(e) => setNote(e.target.value)} data-testid="fraud-note" />
      </div>
      <span className="xs muted">A person at Nm7 checks every report. The company is never told who reported it.</span>
      {st.error && <p role="alert" className="xs" style={{ color: 'var(--danger)', margin: 0 }}>{st.error}</p>}
      <div className="row g8" style={{ flexWrap: 'wrap' }}>
        <button type="submit" className="btn btn-ink" style={{ minHeight: 44 }} disabled={st.busy} data-testid="fraud-send">{st.busy ? 'Sending…' : 'Send report'}</button>
        <button type="button" className="btn btn-outline" style={{ minHeight: 44 }} onClick={() => { setOpen(false); setSt({}); }}>Cancel</button>
      </div>
    </form>
  );
}
