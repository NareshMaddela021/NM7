// Appeals (Vetting V5): "I think this is wrong" on a skill check, its practical task or a screening interview → a small
// dialog with the reason (10 characters or more) → POST /api/me/appeals. A person on our team replies within 72 hours
// with a free retest, a corrected score, or the result kept as it is, with a reason. The status comes from
// GET /api/me/appeals. Used by vetting/Result and interview/IvResult (both load only when a result opens).
import { useCallback, useEffect, useId, useState } from 'react';
import { Dialog } from '../../../components/ui';
import { http } from '../../../services/http';
import { day } from './lib';

export const APPEALS = '/api/me/appeals';
const MIN = 10;
const MAX = 1000;
const OUTCOME = {
  retest: ['A free retest is open for you', 'ok'],
  corrected: ['Your score was corrected', 'ok'],
  kept: ['We looked again: the result stays as it is', 'neutral'],
};

/** The person's appeals: { items, reload }. Nothing breaks if the list can't load. */
export function useAppeals() {
  const [items, setItems] = useState(null);
  const reload = useCallback(() => http(APPEALS).then((d) => setItems(d.items || []), () => setItems((x) => x || [])), []);
  useEffect(() => { reload(); }, [reload]);
  return { items, reload };
}

function AppealDialog({ kind, refId, what, onClose, onSent }) {
  const id = useId();
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const n = reason.trim().length;
  const send = async (e) => {
    e.preventDefault();
    if (n < MIN) { setErr(`Please write at least ${MIN} characters, so our team knows what to look at.`); return; }
    setBusy(true); setErr('');
    try {
      await http(APPEALS, { method: 'POST', body: { kind, ref: refId, reason: reason.trim() } });
      onSent();
    } catch (x) {
      if (x.code === 'already') onSent(); else { setErr(x.message); setBusy(false); }
    }
  };
  return (
    <Dialog title="I think this is wrong" onClose={onClose} showTitle>
      <form className="stack g12" onSubmit={send} noValidate data-testid="ap-dialog">
        <p className="small" style={{ margin: 0 }}>Tell us what looks wrong with {what}. A person on our team looks at it again and replies within 72 hours: a free retest, a corrected score, or the reason it stays as it is.</p>
        <div className="field">
          <label className="label" htmlFor={`${id}-r`}>What looks wrong?</label>
          <textarea id={`${id}-r`} className="input" rows={4} maxLength={MAX} value={reason} onChange={(e) => setReason(e.target.value)}
            aria-describedby={`${id}-h${err ? ` ${id}-e` : ''}`} aria-invalid={err ? 'true' : undefined} data-testid="ap-reason"
            placeholder="e.g. Question 5 has two right answers" />
          <span id={`${id}-h`} className="xs muted">{n < MIN ? `At least ${MIN} characters (${n} so far).` : `${n} of ${MAX} characters.`}</span>
          {err && <span id={`${id}-e`} className="error" role="alert">{err}</span>}
        </div>
        <div className="vet-actions">
          <button type="submit" className="btn btn-signal" disabled={busy} data-testid="ap-send">{busy ? 'Sending…' : 'Send to our team'}</button>
          <button type="button" className="btn btn-ghost" onClick={onClose}>Cancel</button>
        </div>
      </form>
    </Dialog>
  );
}

/**
 * The appeal line for one result: the link (and dialog) when nothing was asked yet, else the status.
 * kind: skill | task | interview; refId: the attempt or interview id; what: "this skill check" (for the dialog text).
 */
export function Appeal({ kind, refId, what, appeals }) {
  const [open, setOpen] = useState(false);
  const [sent, setSent] = useState(false);
  const mine = (appeals.items || []).find((a) => a.what === kind && a.ref === refId);
  if (appeals.items === null) return null;
  if (!mine && !sent) {
    return (
      <div className="vet-appeal" data-testid={`ap-${kind}`}>
        <button type="button" className="btn btn-ghost vet-appeal-link" onClick={() => setOpen(true)} data-testid="ap-open">I think this is wrong</button>
        {open && <AppealDialog kind={kind} refId={refId} what={what} onClose={() => setOpen(false)} onSent={() => { setOpen(false); setSent(true); appeals.reload(); }} />}
      </div>
    );
  }
  if (!mine || mine.status === 'open') {
    return (
      <div className="vet-appeal-box" role="status" data-testid={`ap-${kind}`}>
        <strong>We are looking at it again</strong>
        <span className="small" data-testid="ap-status">Our team will reply within 72 hours{mine?.dueAt ? ` (by ${day(mine.dueAt)})` : ''}. We will tell you by email and here.</span>
      </div>
    );
  }
  const [title, tone] = OUTCOME[mine.outcome] || ['Our team replied', 'neutral'];
  return (
    <div className={`vet-appeal-box vet-appeal-${tone}`} data-testid={`ap-${kind}`}>
      <strong data-testid="ap-status">{title}</strong>
      {mine.note && <span className="small">“{mine.note}”</span>}
      <span className="xs muted">You asked on {day(mine.createdAt)}.</span>
    </div>
  );
}
