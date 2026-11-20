// Profile setup P2: the checklist card at the top of each dashboard (job seeker, student, expert), for the active role.
// Its own lazy chunk (loaded by MeHome, MeLearn and the expert pages; never by the Easy dashboard). The server works
// out each step from the person's own data (backend app/setup/checklist.py), so finished steps tick themselves.
// Phone: a compact card with a progress ring and one "Next step" button; "See all steps" opens every step with its
// status, a one-line reward, the time it takes and "Skip for now". Complete: a small "Profile complete" line with the
// level, and the card comes back only for renewals (an expired skill badge, the weekly "Still looking?").
// P3: the same card shows the company's and the college's checklists (TeamChecklist.jsx): a step this member can't do
// says who can (canAct false, actBy), members who can't skip (canSkip false) get no Skip for now, and a step's page
// can open inside the dashboard (onOpen: the company dashboard's tabs).
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Icon, useToast } from '../../components/ui';
import { Chip } from './kit';
import { ROLE_TITLE, STATUS_TEXT, STATUS_TONE, completeText, getChecklist, markOpened, minutes, nextStep, showCard, skipStep } from '../../lib/checklist';
import '../../styles/setup-checklist.css';

/** A small progress ring: done of total. */
export function Ring({ done, total, size = 56 }) {
  const r = 22; const c = 2 * Math.PI * r;
  const pct = total ? done / total : 1;
  return (
    <span className="sc-ring" style={{ width: size, height: size }} role="img" aria-label={`${done} of ${total} steps done`} data-testid="sc-ring">
      <svg viewBox="0 0 56 56" aria-hidden="true"><circle className="sc-ring-track" cx="28" cy="28" r={r} /><circle className="sc-ring-val" cx="28" cy="28" r={r} strokeDasharray={`${c * pct} ${c}`} transform="rotate(-90 28 28)" /></svg>
      <span className="sc-ring-num" aria-hidden="true">{done}/{total}</span>
    </span>
  );
}

function StepLink({ step, className, children, testid, onOpen }) {
  const open = (e) => { markOpened(); if (onOpen) onOpen(step, e); };
  return <Link to={step.link} className={className} onClick={open} data-testid={testid}>{children}</Link>;
}

function Row({ s, onSkip, busy, onOpen, canSkip }) {
  return (
    <li className="sc-row" data-testid="sc-row" data-step={s.id} data-status={s.status}>
      <span className="sc-row-main">
        <span className="sc-row-top">
          <Chip tone={STATUS_TONE[s.status]} testid="sc-status">{STATUS_TEXT[s.status]}</Chip>
          {s.skipped && <span className="xs muted">Skipped</span>}
          {!s.required && <span className="xs muted">Optional</span>}
          {s.testersOnly && <span className="xs muted" title="Only testers see this until it is switched on for everyone">Testers only</span>}
        </span>
        <strong className="sc-row-title">{s.title}</strong>
        <span className="small sc-reward">{s.reward}</span>
        <span className="xs muted">{minutes(s.minutes)}</span>
      </span>
      {s.status !== 'done' && s.canAct === false && <span className="xs muted sc-who" data-testid="sc-row-who">{s.actBy} can do this.</span>}
      {s.status !== 'done' && s.canAct !== false && (
        <span className="sc-row-act">
          {s.status !== 'waiting' && <StepLink step={s} onOpen={onOpen} className={`btn btn-sm ${s.status === 'next' ? 'btn-ink' : 'btn-outline'}`} testid="sc-row-open">{s.status === 'next' ? 'Start' : 'Open'}</StepLink>}
          {s.status === 'waiting' && <StepLink step={s} onOpen={onOpen} className="btn btn-sm btn-outline" testid="sc-row-open">See status</StepLink>}
          {canSkip && (s.status === 'next' || s.status === 'later') && !s.skipped && <button type="button" className="btn btn-sm btn-ghost sc-skip" disabled={busy} onClick={() => onSkip(s.id)} data-testid="sc-row-skip">Skip for now</button>}
        </span>
      )}
    </li>
  );
}

export default function SetupChecklist({ role }) {
  const toast = useToast();
  const [c, setC] = useState(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => { let dead = false; getChecklist(role).then((x) => { if (!dead) setC(x); }, () => {}); return () => { dead = true; }; }, [role]);
  const skip = async (id) => {
    setBusy(true);
    try { setC(await skipStep(c.role, id)); toast('Skipped for now. You can do it any time.'); } catch (e) { toast(e.message || 'Couldn’t skip that. Please try again.'); } finally { setBusy(false); }
  };
  return <ChecklistView c={c} open={open} busy={busy} onSkip={skip} onToggle={() => setOpen(!open)} />;
}

/** The card itself (pure: tested in SetupChecklist.test.jsx). */
export function ChecklistView({ c, open, busy, onSkip, onToggle, onOpen, onReminders }) {
  if (!showCard(c)) return null;
  const skip = onSkip;
  const canSkip = c.canSkip !== false;

  if (c.complete) {
    return (
      <section className="mcard sc-card sc-done" aria-label="Profile setup" data-testid="sc-complete">
        <span className="sc-done-line"><span className="sc-tick" aria-hidden="true"><Icon name="check" size={16} /></span><strong data-testid="sc-complete-text">{completeText(c)}</strong></span>
        {c.renewals?.length > 0 && (
          <ul className="sc-list">
            {c.renewals.map((r) => (
              <li key={r.id} className="sc-row" data-testid="sc-renewal" data-step={r.id}>
                <span className="sc-row-main"><strong className="sc-row-title">{r.title}</strong><span className="small sc-reward">{r.reward}</span><span className="xs muted">{minutes(r.minutes)}</span></span>
                <span className="sc-row-act"><StepLink step={r} className="btn btn-sm btn-ink">Open</StepLink></span>
              </li>
            ))}
          </ul>
        )}
      </section>
    );
  }

  const nx = nextStep(c);
  const waiting = c.steps.filter((s) => s.status === 'waiting');
  return (
    <section className="mcard sc-card" aria-labelledby="sc-h" data-testid="sc-card" data-role={c.role}>
      <div className="sc-head">
        <Ring done={c.done} total={c.total} />
        <span className="sc-head-text">
          <h2 id="sc-h" className="mcard-title">{c.title || ROLE_TITLE[c.role] || 'Set up your profile'}</h2>
          {nx ? (
            <span className="sc-next">
              <span className="small"><span className="muted">Next: </span><strong data-testid="sc-next-title">{nx.title}</strong></span>
              <span className="small sc-reward sc-next-reward">{nx.reward} <span className="muted">· {minutes(nx.minutes)}</span></span>
            </span>
          ) : waiting.length > 0 ? (
            <span className="small" data-testid="sc-waiting">Waiting for review: {waiting.map((s) => s.title).join(', ')}. {c.role === 'expert' ? 'You can use your other roles while you wait.' : 'We’ll tell you when it’s done.'}</span>
          ) : null}
        </span>
      </div>
      {nx && nx.canAct === false && <p className="xs muted sc-who" style={{ margin: 0 }} data-testid="sc-next-who">{nx.actBy} can do this.</p>}
      <div className="sc-actions">
        {nx && nx.canAct !== false && <StepLink step={nx} onOpen={onOpen} className="btn btn-signal sc-btn" testid="sc-next">Next step</StepLink>}
        {nx && canSkip && <button type="button" className="btn btn-ghost sc-btn sc-head-skip" disabled={busy} onClick={() => skip(nx.id)} data-testid="sc-skip">Skip for now</button>}
        <button type="button" className="btn btn-outline sc-btn" aria-expanded={open} aria-controls="sc-all" onClick={onToggle} data-testid="sc-toggle">{open ? 'Hide steps' : `See all steps (${c.steps.length})`}</button>
      </div>
      {open && <ul id="sc-all" className="sc-list" data-testid="sc-list">{c.steps.map((s) => <Row key={s.id} s={s} onSkip={skip} busy={busy} onOpen={onOpen} canSkip={canSkip} />)}</ul>}
      {open && onReminders && canSkip && (
        <label className="small sc-remind"><input type="checkbox" checked={!!c.reminders} disabled={busy} onChange={(e) => onReminders(e.target.checked)} data-testid="sc-remind" /> Email a weekly reminder of the next step</label>
      )}
    </section>
  );
}
