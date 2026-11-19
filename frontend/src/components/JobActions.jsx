// View · Apply · Save on every job card (the job board, saved jobs, the home page's live jobs, company pages, Jobs for
// you). One row on a phone. Apply works exactly like the Apply on the job's own page:
//   - signed out: a small dialog to create a free account or sign in; both come back to /jobs/<slug>?apply=1 and the
//     job page carries on applying (the return path keeps the "apply" wish through sign-up and sign-in)
//   - a job on the company's own site: the site opens in a new tab and the application is saved as "outside Nm7"
//   - a job on Nm7 (or by email): the job page's own apply step opens in a dialog (the "Send?" step, the company's
//     questions and the consent box, or the email draft) — loaded only when it is needed
//   - applied: "Applied ✓" (disabled), here and on the job page, also after a reload (GET /api/me/applied-jobs)
// The words are here (English, Telugu, Hindi) so the strings bundle on every page stays small.
import { lazy, Suspense, useEffect, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { Dialog } from './ui';
import { useAuth } from '../lib/auth';
import { useLang } from '../lib/i18n';
import { applyToJob, loadApplied, loadSaved, markApplied, toggleSaved, useApplied, useSaved } from '../lib/jobBoard';

const ApplyDialog = lazy(() => import('../pages/jobs/ApplyFlow'));

const WORDS = {
  en: {
    view: 'View', apply: 'Apply', applied: 'Applied ✓', save: 'Save', saved: 'Saved', saveError: 'Not saved. Please try again.',
    askTitle: 'Create a free account to apply', askText: 'It takes a minute. You come straight back to this job and your application goes on from there.',
    create: 'Create free account', signin: 'Sign in', notNow: 'Not now', direct: 'Or go to the company’s site without an account',
    finish: 'You’re signed in. Tap “Apply” to open the company’s site and finish.', loading: 'Loading…', error: 'This job could not be loaded. Please try again.',
    close: 'Close', track: 'See it in My applications',
  },
  te: {
    view: 'చూడండి', apply: 'అప్లై', applied: 'అప్లై చేశారు ✓', save: 'సేవ్', saved: 'సేవ్ అయింది', saveError: 'సేవ్ కాలేదు. మళ్లీ ప్రయత్నించండి.',
    askTitle: 'అప్లై చేయడానికి ఉచిత ఖాతా తెరవండి', askText: 'ఒక్క నిమిషం చాలు. మీరు నేరుగా ఈ ఉద్యోగానికి తిరిగి వస్తారు, అక్కడి నుంచే అప్లై కొనసాగుతుంది.',
    create: 'ఉచిత ఖాతా తెరవండి', signin: 'సైన్ ఇన్', notNow: 'ఇప్పుడు కాదు', direct: 'లేదా ఖాతా లేకుండా కంపెనీ సైట్‌కు వెళ్లండి',
    finish: 'మీరు సైన్ ఇన్ అయ్యారు. కంపెనీ సైట్ తెరిచి పూర్తి చేయడానికి “అప్లై” నొక్కండి.', loading: 'లోడ్ అవుతోంది…', error: 'ఈ ఉద్యోగం లోడ్ కాలేదు. మళ్లీ ప్రయత్నించండి.',
    close: 'మూసివేయండి', track: 'నా అప్లికేషన్లలో చూడండి',
  },
  hi: {
    view: 'देखें', apply: 'आवेदन करें', applied: 'आवेदन किया ✓', save: 'सेव करें', saved: 'सेव किया', saveError: 'सेव नहीं हुआ। फिर से कोशिश करें।',
    askTitle: 'आवेदन के लिए मुफ़्त खाता बनाएं', askText: 'बस एक मिनट लगेगा। आप सीधे इसी नौकरी पर लौटेंगे और आवेदन वहीं से आगे बढ़ेगा।',
    create: 'मुफ़्त खाता बनाएं', signin: 'साइन इन', notNow: 'अभी नहीं', direct: 'या बिना खाते के कंपनी की साइट पर जाएं',
    finish: 'आप साइन इन हैं। कंपनी की साइट खोलकर पूरा करने के लिए “आवेदन करें” दबाएं।', loading: 'लोड हो रहा है…', error: 'यह नौकरी लोड नहीं हुई। फिर से कोशिश करें।',
    close: 'बंद करें', track: 'मेरे आवेदनों में देखें',
  },
};

/** The words in the page's language. */
export function useWords() {
  const [, lang] = useLang();
  return WORDS[lang] || WORDS.en;
}

/** /jobs/<slug>?apply=1: where sign-up and sign-in send the person back to, to carry on applying. */
export const applyPath = (slug) => `/jobs/${slug}?apply=1`;
const isCustomer = (user) => user?.role === 'customer';
const linkJob = (job) => job.apply?.method === 'link' && !!job.apply?.url;

/** Signed out: create a free account or sign in, then back to the job to carry on applying. */
export function AuthAsk({ job, onClose, returnTo }) {
  const w = useWords();
  const next = encodeURIComponent(applyPath(job.slug));
  return (
    <Dialog title={w.askTitle} showTitle onClose={onClose} returnTo={returnTo}>
      <div className="stack g12" data-testid="apply-ask">
        <p className="small" style={{ margin: 0 }}>{w.askText}</p>
        <div className="row g8" style={{ flexWrap: 'wrap' }}>
          <Link className="btn btn-ink" to={`/signup?next=${next}`} data-testid="apply-ask-signup">{w.create}</Link>
          <Link className="btn btn-outline" to={`/login?next=${next}`} data-testid="apply-ask-login">{w.signin}</Link>
          <button type="button" className="btn btn-ghost" onClick={onClose}>{w.notNow}</button>
        </div>
        {linkJob(job) && (
          <a className="xs" href={job.apply.url} target="_blank" rel="noopener noreferrer nofollow" style={{ minHeight: 44, display: 'inline-flex', alignItems: 'center' }} data-testid="apply-ask-direct">{w.direct} <span aria-hidden="true">↗</span></a>
        )}
      </div>
    </Dialog>
  );
}

/** Save / Saved (signed out: sign in first, then back here). */
export function SaveButton({ job, testid }) {
  const [t] = useLang();
  const { user } = useAuth();
  const saved = useSaved();
  const nav = useNavigate();
  const { pathname, search } = useLocation();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const on = saved.has(job.id);
  const click = async () => {
    if (!user) { nav(`/login?next=${encodeURIComponent(pathname + search)}`); return; }
    setBusy(true); setErr('');
    try { await toggleSaved(job.id); } catch { setErr(t('jobs.save.error')); } finally { setBusy(false); }
  };
  return (
    <>
      <button type="button" className="btn btn-outline" aria-pressed={on} disabled={busy} onClick={click} aria-label={`${on ? t('jobs.saved') : t('jobs.save')}: ${job.title}`} data-testid={testid}>
        <span aria-hidden="true">{on ? '★' : '☆'}</span> {on ? t('jobs.saved') : t('jobs.save')}
      </button>
      {err && <span role="alert" className="xs" style={{ color: 'var(--danger)' }}>{err}</span>}
    </>
  );
}

/** "Applied ✓" (disabled) once this person applied to the job. */
export function AppliedButton({ testid = 'card-applied' }) {
  const w = useWords();
  return <button type="button" className="btn btn-outline job-applied" disabled data-testid={testid}>{w.applied}</button>;
}

/** Apply on a card: the same as the job page's Apply (see the top of this file). */
export function ApplyAction({ job, desc }) {
  const w = useWords();
  const { user } = useAuth();
  const applied = useApplied();
  const [ask, setAsk] = useState(null); // the button that opened the dialog (focus goes back to it)
  const [flow, setFlow] = useState(null);
  const [err, setErr] = useState('');
  // the apply steps stay open after sending (they say "Applied ✓" and where to see it), while the card already says so
  const closeFlow = () => {
    const view = flow?.closest('.job-actions')?.querySelector('[data-testid="card-view"]');
    setFlow(null);
    setTimeout(() => { if (flow && !flow.isConnected) view?.focus(); }, 0); // Apply became "Applied ✓": focus View
  };
  const steps = flow && (
    <Suspense fallback={null}>
      <ApplyDialog slug={job.slug} title={job.title} onClose={closeFlow} returnTo={flow} />
    </Suspense>
  );
  if (isCustomer(user) && applied.has(job.id)) return <><AppliedButton />{steps}</>;
  if (!isCustomer(user)) {
    return (
      <>
        <button type="button" className="btn btn-ink" aria-describedby={desc} onClick={(e) => setAsk(e.currentTarget)} data-testid="card-apply">{w.apply}</button>
        {ask && <AuthAsk job={job} onClose={() => setAsk(null)} returnTo={ask} />}
      </>
    );
  }
  if (linkJob(job)) {
    // the company's site opens straight away (no pop-up blocker); the application is saved alongside, like the job page
    const record = () => {
      setErr('');
      applyToJob(job.id).then((r) => {
        markApplied(job.id, r.application?.status);
        import('../lib/customerStore').then((m) => m.reloadMe?.()).catch(() => {});
      }, (e) => setErr(e.message));
    };
    return (
      <>
        <a className="btn btn-ink" href={job.apply.url} target="_blank" rel="noopener noreferrer nofollow" aria-describedby={desc} onClick={record} data-testid="card-apply">{w.apply} <span aria-hidden="true">↗</span></a>
        {err && <span role="alert" className="xs" style={{ color: 'var(--danger)', flexBasis: '100%' }}>{err}</span>}
      </>
    );
  }
  return (
    <>
      <button type="button" className="btn btn-ink" aria-describedby={desc} onClick={(e) => setFlow(e.currentTarget)} data-testid="card-apply">{w.apply}</button>
      {steps}
    </>
  );
}

/** View · Apply · Save. Closed jobs: View only. */
/** titleId: the card's title element, which describes View and Apply to screen readers ("View, QA Trainee"). */
export default function JobActions({ job, save = true, titleId }) {
  const w = useWords();
  const { user } = useAuth();
  const desc = titleId;
  useEffect(() => { if (isCustomer(user)) { loadApplied(user.id); loadSaved(); } }, [user]);
  const open = job.status == null || job.status === 'active';
  return (
    <div className="job-actions" data-testid="job-actions">
      <Link className="btn btn-outline" to={`/jobs/${job.slug}`} aria-describedby={desc} data-testid="card-view">{w.view}</Link>
      {open && <ApplyAction job={job} desc={desc} />}
      {open && save && <SaveButton job={job} testid="card-save" />}
    </div>
  );
}
