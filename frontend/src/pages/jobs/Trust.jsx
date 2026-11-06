// Company trust on the job board (C4): the badge and score on job cards and pages, the "why" list in plain words,
// the "Usually replies in N days" badge (only from real answers; never shown without data), and "Report this job".
// English, Telugu and Hindi (pages.json, jobs.trust.* and jobs.report.*).
import { useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useAuth } from '../../lib/auth';
import { reportJob, REPORT_REASONS } from '../../lib/jobBoard';

/** "Verified company · Trust 93/100 · Usually replies in 3 days" (cards and the job page). */
export function TrustLine({ trust, t }) {
  if (!trust || !['verified', 'basic'].includes(trust.level)) return null;
  return (
    <span className="row g8 xs" data-testid="trust-line" style={{ flexWrap: 'wrap' }}>
      <span className={`badge ${trust.level === 'verified' ? 'b-success' : 'b-neutral'}`}>{t(`jobs.trust.${trust.level}`)}</span>
      {trust.score != null && <span className="muted" data-testid="trust-score">{t('jobs.trust.score', { n: trust.score })}</span>}
      <ReplyBadge days={trust.replyDays} t={t} />
    </span>
  );
}

export function ReplyBadge({ days, t }) {
  if (!days) return null;
  return <span className="badge b-signal" data-testid="reply-badge">{days === 1 ? t('jobs.trust.reply1') : t('jobs.trust.reply', { n: days })}</span>;
}

/** The parts behind the score, each with its points ("Verified by Nm7 … +45"). */
export function TrustWhy({ parts, t, open = false }) {
  if (!parts?.length) return null;
  return (
    <details className="xs trust-why" open={open} data-testid="trust-why">
      <summary>{t('jobs.trust.why')}</summary>
      <ul className="stack g4" style={{ margin: '6px 0 0', paddingLeft: 18 }}>
        {parts.map((p) => <li key={p.code}>{t(`jobs.trust.part.${p.code}`)} <span className="muted">· +{p.points}</span></li>)}
      </ul>
      <p className="muted" style={{ margin: '6px 0 0' }}>{t('jobs.trust.how')}</p>
    </details>
  );
}

/** "Report this job": signed-in students pick a reason and may add a note. No pop-up dialogs; it opens in place. */
export function ReportJob({ job, t }) {
  const { user } = useAuth();
  const { pathname } = useLocation();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState('');
  const [err, setErr] = useState('');
  if (!user) return <Link className="xs" to={`/login?next=${encodeURIComponent(pathname)}`} data-testid="report-signin">{t('jobs.report.signin')}</Link>;
  if (done) return <p className="xs" role="status" style={{ margin: 0 }} data-testid="report-done">{done}</p>;
  if (!open) return <button type="button" className="link-btn xs" style={{ alignSelf: 'flex-start' }} onClick={() => setOpen(true)} data-testid="report-open">{t('jobs.report.open')}</button>;
  const send = async (e) => {
    e.preventDefault();
    if (!reason) { setErr(t('jobs.report.pick')); return; }
    setBusy(true); setErr('');
    try {
      await reportJob(job.id, reason, note.trim());
      setDone(t('jobs.report.done'));
    } catch (x) {
      if (x?.code === 'already') setDone(t('jobs.report.already'));
      else setErr(t('jobs.report.error'));
    } finally { setBusy(false); }
  };
  return (
    <form className="card-sm stack g8" onSubmit={send} aria-labelledby="report-h" data-testid="report-form">
      <strong id="report-h">{t('jobs.report.title')}</strong>
      <div className="field">
        <label className="label" htmlFor="report-reason">{t('jobs.report.reason')}</label>
        <select id="report-reason" className="input" value={reason} onChange={(e) => setReason(e.target.value)} aria-invalid={!!err && !reason}>
          <option value="">{t('jobs.report.choose')}</option>
          {REPORT_REASONS.map((r) => <option key={r} value={r}>{t(`jobs.report.r.${r}`)}</option>)}
        </select>
      </div>
      <div className="field">
        <label className="label" htmlFor="report-note">{t('jobs.report.note')}</label>
        <textarea id="report-note" className="input" rows={3} maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} />
      </div>
      <span className="xs muted">{t('jobs.report.hint')}</span>
      {err && <p role="alert" className="xs" style={{ color: 'var(--danger)', margin: 0 }}>{err}</p>}
      <div className="row g8">
        <button type="submit" className="btn btn-ink" disabled={busy}>{busy ? t('jobs.loading') : t('jobs.report.send')}</button>
        <button type="button" className="btn btn-outline" onClick={() => { setOpen(false); setErr(''); }}>{t('jobs.report.cancel')}</button>
      </div>
    </form>
  );
}
