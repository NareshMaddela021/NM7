// Profile setup P3: the company's checklist (top of the company dashboard's Overview) and the college's (top of the
// coordinator portal's My groups and Dashboard). The same card as a person's (ChecklistView), its own lazy chunk; the
// server works every step out from what the company / college already has (backend app/setup/teams.py).
//   company  GET /api/company/{id}/checklist (X-Recruiter-Account): every team role sees it; main / full admins skip.
//            A step's page is a tab of the dashboard, so onOpen switches the tab instead of loading a page.
//   college  GET /api/org/{id}/checklist: Owners, coordinators and viewers see it; Owners and coordinators skip.
import { useEffect, useState } from 'react';
import { useToast } from '../../components/ui';
import { rq } from '../../lib/company';
import { takeFresh } from '../../lib/checklist';
import { LIVE, http } from '../../services/http';
import { ChecklistView } from './SetupChecklist';

/** The API base of one team's checklist. */
export const teamBase = (kind, id) => (kind === 'company' ? `/api/company/${encodeURIComponent(id)}/checklist` : `/api/org/${encodeURIComponent(id)}/checklist`);

/** The company dashboard's tab for a step link like "/company#jobs" (else null: a normal page). */
export const companyTab = (link) => ((/^\/company#([a-z]+)$/.exec(link || '') || [])[1] || null);

export default function TeamChecklist({ kind, id, onTab }) {
  const toast = useToast();
  const [c, setC] = useState(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const call = kind === 'company' ? rq : (path, init) => http(path, init);
  const base = teamBase(kind, id);
  useEffect(() => {
    if (!LIVE) return undefined;
    let dead = false;
    call(`${base}${takeFresh() ? '?fresh=1' : ''}`).then((x) => { if (!dead) setC(x); }, () => {});
    return () => { dead = true; };
  }, [base]); // eslint-disable-line react-hooks/exhaustive-deps
  const act = async (fn, ok) => {
    setBusy(true);
    try { setC(await fn()); if (ok) toast(ok); } catch (e) { toast(e.message || 'Couldn’t save that. Please try again.'); } finally { setBusy(false); }
  };
  const skip = (step) => act(() => call(`${base}/skip`, { method: 'POST', body: { step } }), 'Skipped for now. You can do it any time.');
  const reminders = (on) => act(async () => { await call(`${base}/reminders`, { method: 'PUT', body: { on } }); return { ...c, reminders: on }; }, on ? 'Weekly reminder on' : 'Weekly reminder off');
  const openStep = (step, e) => {
    const tab = kind === 'company' && onTab ? companyTab(step.link) : null;
    if (tab) { e.preventDefault(); onTab(tab); return; }
    const [path, hash] = step.link.split('#'); // a part of the page already open (a college's groups): scroll to it
    const el = hash && path === window.location.pathname ? document.getElementById(hash) : null;
    if (el) { e.preventDefault(); el.scrollIntoView({ behavior: 'smooth', block: 'start' }); }
  };
  return <ChecklistView c={c} open={open} busy={busy} onSkip={skip} onToggle={() => setOpen(!open)} onOpen={openStep} onReminders={reminders} />;
}
