// Apply on a job (job board J5, company jobs C5, Vetting Trust T6): the job page's Apply, and the same steps in a
// dialog when Apply is pressed on a job card (loaded only then). By the job's apply method: on Nm7 one "Send?" step
// (company jobs: their questions and the consent box), the company's own site (opens in a new tab and is saved as
// "outside Nm7"), or by email (a filled-in mailto draft). Signed out: create a free account or sign in, then back to
// /jobs/<slug>?apply=1 to carry on. Applied: "Applied ✓", on this page and on every card for the job.
import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Dialog } from '../../components/ui';
import { AuthAsk, useWords } from '../../components/JobActions';
import { useAuth } from '../../lib/auth';
import { reloadMe } from '../../lib/customerStore';
import { matchJob } from '../../lib/jobs';
import { useLang } from '../../lib/i18n';
import { applyToJob, getJob, mailtoLink, markApplied, useApplied } from '../../lib/jobBoard';
import { NeverPay } from './EmployerTrust';

export function ApplyBox({ job, t, onApplied, autoStart = '', inDialog = false }) {
  const { user } = useAuth();
  const nav = useNavigate();
  const w = useWords();
  const appliedNow = useApplied();
  const [ask, setAsk] = useState(null); // signed out: the "create an account or sign in" dialog
  const applyRef = useRef(null);
  const [busy, setBusy] = useState('');
  const [err, setErr] = useState('');
  const [mail, setMail] = useState(null);
  const [asking, setAsking] = useState(false); // company jobs: the questions and the consent box first (C5)
  const [confirm, setConfirm] = useState(false); // other jobs on Nm7: one "Send?" step first (item 19)
  const signedIn = user?.role === 'customer';
  const go = async (extra, sure) => {
    if (job.consent && !extra) { setAsking(true); return; }
    if (!job.consent && job.apply.method === 'nm7' && !sure) { setConfirm(true); return; }
    setConfirm(false);
    setBusy('apply'); setErr('');
    try {
      const r = await applyToJob(job.id, null, extra || {});
      setAsking(false);
      if (r.method === 'email') setMail(r.email);
      onApplied({ status: r.application.status, at: Date.now() });
      markApplied(job.id, r.application.status);
      reloadMe();
    } catch (e) { setErr(e.message); } finally { setBusy(''); }
  };
  const fit = async () => {
    setBusy('fit'); setErr('');
    try {
      // item 7, 8: this job's own skills and the same number as its card; an earlier match for it opens again
      const m = await matchJob({ text: `${job.title}\n${job.company.name}\n${job.description}`, title: job.title, company: job.company.name, jobId: job.id });
      nav(`/me/ats?match=${encodeURIComponent(m.id)}`);
    } catch (e) { setErr(e.message); setBusy(''); }
  };
  const applied = job.application || (appliedNow.has(job.id) ? { status: appliedNow.status(job.id) } : null);
  const linkJob = job.apply.method === 'link' && job.apply.url;
  // ?apply=1 (back from sign-up / sign-in) or Apply on a card: carry on as if Apply was pressed. "send": they pressed
  // Apply before signing up, so a plain Nm7 job is sent at once; the company's questions and consent box, the email
  // draft and the company's own site (it can only open from a tap) still wait for the person.
  const started = useRef(false);
  useEffect(() => {
    if (!autoStart || !signedIn || applied || started.current) return;
    started.current = true;
    if (linkJob) { applyRef.current?.focus(); return; }
    go(undefined, autoStart === 'send');
  }, [autoStart, signedIn]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!signedIn) {
    return (
      <>
        <button type="button" className="btn btn-ink" onClick={(e) => setAsk(e.currentTarget)} data-testid="apply">{linkJob ? <>{t('jobs.apply.link')} <span aria-hidden="true">↗</span></> : t('jobs.apply.signin')}</button>
        {ask && <AuthAsk job={job} onClose={() => setAsk(null)} returnTo={ask} />}
      </>
    );
  }
  return (
    <div className="stack g8" style={{ flexBasis: '100%' }}>
      <div className="row g8">
        {applied ? (
          <span className="badge b-success" data-testid="applied">{applied.status === 'applied' || !applied.status ? w.applied : t('jobs.apply.done', { status: t(`jobs.app.${applied.status}`) })}</span>
        ) : job.apply.method === 'link' && job.apply.url ? (
          // the link opens straight away (no pop-up blocker); the application is saved alongside
          <a ref={applyRef} className="btn btn-ink" href={job.apply.url} target="_blank" rel="noopener noreferrer nofollow" data-testid="apply" onClick={() => { go(); }}>{t('jobs.apply.link')} <span aria-hidden="true">↗</span></a>
        ) : (
          <button type="button" className="btn btn-ink" data-testid="apply" disabled={!!busy || asking || confirm} onClick={() => go()}>{job.apply.method === 'email' ? t('jobs.apply.email') : t('jobs.apply.nm7')}</button>
        )}
        {!inDialog && <button type="button" className="btn btn-outline" disabled={!!busy} onClick={fit} data-testid="make-fit">{busy === 'fit' ? t('jobs.loading') : t('jobs.apply.fit')}</button>}
      </div>
      {autoStart && linkJob && !applied && <p className="card-sm small" role="status" style={{ margin: 0 }} data-testid="apply-finish">{w.finish}</p>}
      {confirm && !applied && (
        <div className="card-sm row g8" role="group" aria-label={t('jobs.apply.confirmTitle')} data-testid="apply-confirm" style={{ flexWrap: 'wrap', alignItems: 'center' }}>
          <span className="small" style={{ flex: '1 1 220px' }}>{t('jobs.apply.confirm', { company: job.company.name })}</span>
          <button type="button" className="btn btn-ink" disabled={busy === 'apply'} onClick={() => go(undefined, true)} data-testid="apply-send">{t('jobs.apply.send')}</button>
          <button type="button" className="btn btn-outline" onClick={() => setConfirm(false)}>{t('jobs.apply.cancel')}</button>
        </div>
      )}
      {asking && !applied && <ApplyQuestions job={job} t={t} busy={busy === 'apply'} onSend={go} onCancel={() => setAsking(false)} />}
      {!inDialog && <span className="xs muted">{t('jobs.apply.fitHint')}</span>}
      {applied && <Link className="xs" to="/me/jobs">{t('jobs.apply.track')}</Link>}
      {mail && (
        <div className="card-sm stack g8" data-testid="email-apply">
          <strong>{t('jobs.apply.emailTitle')}</strong>
          <ol className="stack g4" style={{ margin: 0, paddingLeft: 20 }}>
            <li><Link to="/me/resumes">{t('jobs.apply.emailStep1')}</Link></li>
            <li><a href={mailtoLink(mail)} data-testid="mailto">{t('jobs.apply.emailStep2', { to: mail.to })}</a></li>
          </ol>
          <span className="xs muted">{t('jobs.apply.emailHint')}</span>
        </div>
      )}
      {err && <p role="alert" className="xs" style={{ color: 'var(--danger)', margin: 0 }}>{err}</p>}
    </div>
  );
}


/** Company jobs on Nm7: the screening questions (never the company's rules) and the consent box, before applying. */
function ApplyQuestions({ job, t, busy, onSend, onCancel }) {
  const [answers, setAnswers] = useState({});
  const [consent, setConsent] = useState(false);
  const [err, setErr] = useState('');
  const [known, setKnown] = useState(() => job.known || {}); // Vetting Trust T6: answered before: shown, not asked again
  const set = (id, v) => setAnswers((a) => ({ ...a, [id]: v }));
  const ask = job.questions.filter((q) => !(q.id in known));
  const send = (e) => {
    e.preventDefault();
    if (ask.some((q) => answers[q.id] == null || String(answers[q.id]).trim() === '')) { setErr(t('jobs.apply.qMissing')); return; }
    if (!consent) { setErr(t('jobs.apply.consentNeeded', { company: job.company.name })); return; }
    setErr('');
    onSend({ consent: true, answers: Object.fromEntries(ask.map((q) => [q.id, q.kind === 'number' ? Number(answers[q.id]) : answers[q.id]])) });
  };
  const saved = job.questions.filter((q) => q.id in known);
  return (
    <form className="card-sm stack g12" onSubmit={send} data-testid="apply-form" aria-labelledby="apply-form-h">
      <strong id="apply-form-h">{t('jobs.apply.formTitle', { company: job.company.name })}</strong>
      {saved.length > 0 && (
        <div className="stack g4" data-testid="apply-known">
          <span className="xs muted">Already answered (your saved answers and Work preferences):</span>
          {saved.map((q) => (
            <span key={q.id} className="row g8 small" style={{ flexWrap: 'wrap', alignItems: 'center' }} data-testid="apply-known-item">
              <span style={{ flex: '1 1 200px', minWidth: 0, overflowWrap: 'anywhere' }}>{q.text} <strong>{q.kind === 'yesno' ? t(`jobs.apply.${known[q.id]}`) : String(known[q.id])}</strong></span>
              <button type="button" className="link-btn xs" style={{ minHeight: 44 }} onClick={() => setKnown((k) => { const n = { ...k }; delete n[q.id]; return n; })}>Change</button>
            </span>
          ))}
        </div>
      )}
      {ask.map((q) => (
        <fieldset key={q.id} className="stack g4" style={{ border: 0, margin: 0, padding: 0 }}>
          {q.kind === 'number' ? (
            <div className="field"><label className="label" htmlFor={`aq-${q.id}`}>{q.text}</label>
              <input id={`aq-${q.id}`} className="input" inputMode="numeric" maxLength={6} value={answers[q.id] ?? ''} onChange={(e) => set(q.id, e.target.value.replace(/[^\d]/g, ''))} /></div>
          ) : (
            <>
              <legend className="label">{q.text}</legend>
              <div className="row g12" style={{ flexWrap: 'wrap' }}>
                {(q.kind === 'yesno' ? [['yes', t('jobs.apply.yes')], ['no', t('jobs.apply.no')]] : q.options.map((o) => [o, o])).map(([v, l]) => (
                  <label key={v} className="row g4 small"><input type="radio" name={`aq-${q.id}`} value={v} aria-label={l} checked={answers[q.id] === v} onChange={() => set(q.id, v)} /> {l}</label>
                ))}
              </div>
            </>
          )}
        </fieldset>
      ))}
      <label className="row g8 small" style={{ alignItems: 'flex-start', flexWrap: 'nowrap' }}>
        <input type="checkbox" value="consent" checked={consent} onChange={(e) => setConsent(e.target.checked)} style={{ marginTop: 3 }} data-testid="apply-consent" />
        <span>{t('jobs.apply.consent', { company: job.company.name })}</span>
      </label>
      <span className="xs muted">{t('jobs.apply.consentMore')} <Link to="/grievance">{t('jobs.apply.yourData')}</Link></span>
      {job.employerTrust && <NeverPay safety={job.employerTrust} compact />}
      {err && <p role="alert" className="xs" style={{ color: 'var(--danger)', margin: 0 }}>{err}</p>}
      <div className="row g8">
        <button type="submit" className="btn btn-ink" disabled={busy} data-testid="apply-send">{busy ? t('jobs.loading') : t('jobs.apply.send')}</button>
        <button type="button" className="btn btn-outline" onClick={onCancel}>{t('jobs.report.cancel')}</button>
      </div>
    </form>
  );
}


/** Apply pressed on a job card: the job page's own apply steps, in a dialog. */
export default function ApplyDialog({ slug, title, onClose, returnTo }) {
  const [t] = useLang();
  const w = useWords();
  const [st, setSt] = useState({ job: null, error: '' });
  useEffect(() => {
    let live = true;
    getJob(slug).then((job) => { if (live) setSt({ job, error: '' }); }, (e) => { if (live) setSt({ job: null, error: e?.message || w.error }); });
    return () => { live = false; };
  }, [slug]); // eslint-disable-line react-hooks/exhaustive-deps
  const { job } = st;
  return (
    <Dialog title={`${w.apply}: ${title}`} showTitle onClose={onClose} returnTo={returnTo}>
      <div className="stack g12" data-testid="apply-dialog">
        {st.error ? <p role="alert" style={{ margin: 0 }}>{st.error}</p>
          : !job ? <p className="muted" aria-live="polite" style={{ margin: 0 }}>{w.loading}</p>
            : job.status !== 'active' ? <p role="status" style={{ margin: 0 }}>{t('jobs.closedNote')}</p>
              : <ApplyBox job={job} t={t} autoStart="ask" inDialog onApplied={(a) => setSt((x) => ({ ...x, job: { ...x.job, application: a } }))} />}
        <button type="button" className="btn btn-ghost" style={{ alignSelf: 'flex-start' }} onClick={onClose}>{w.close}</button>
      </div>
    </Dialog>
  );
}
