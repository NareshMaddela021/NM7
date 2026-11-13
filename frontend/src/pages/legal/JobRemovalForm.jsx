// Round J: "Request removal of this job" (/contact?topic=job-removal, linked from every job found on a company's
// careers page). Company name, job link, email, reason → Admin → Jobs → Removal requests; one click closes the job.
// No pop-up dialogs.
import { useState } from 'react';
import { http } from '../../services/http';

export default function JobRemovalForm({ link = '' }) {
  const [f, setF] = useState({ company: '', jobLink: link, email: '', reason: '' });
  const [sent, setSent] = useState(false);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const send = async (e) => {
    e.preventDefault();
    setErr(''); setBusy(true);
    try { await http('/api/public/job-removal', { method: 'POST', body: f }); setSent(true); } catch (x) { setErr(x.message); } finally { setBusy(false); }
  };
  if (sent) {
    return (
      <section className="card stack g8" role="status" data-testid="jr-sent">
        <strong>Thanks: we have your request.</strong>
        <span className="small">Our team checks it and removes the job from Nm7, usually within 2 working days. We email you at the address you gave if we need anything.</span>
      </section>
    );
  }
  return (
    <form className="card stack g12" onSubmit={send} aria-labelledby="jr-h" data-testid="jr-form">
      <strong id="jr-h">Request removal of a job</strong>
      <span className="small muted">For a job on Nm7 that came from your company&apos;s careers page and should not be shown here.</span>
      <div className="field"><label className="label" htmlFor="jr-company">Company name</label><input id="jr-company" className="input" required maxLength={120} value={f.company} onChange={set('company')} data-testid="jr-company" /></div>
      <div className="field"><label className="label" htmlFor="jr-link">Job link (on Nm7 or your careers page)</label><input id="jr-link" className="input" type="url" required maxLength={2000} value={f.jobLink} onChange={set('jobLink')} data-testid="jr-link" /></div>
      <div className="field"><label className="label" htmlFor="jr-email">Your work email</label><input id="jr-email" className="input" type="email" required maxLength={200} value={f.email} onChange={set('email')} data-testid="jr-email" /></div>
      <div className="field"><label className="label" htmlFor="jr-reason">Reason (optional)</label><textarea id="jr-reason" className="input" rows={3} maxLength={1000} value={f.reason} onChange={set('reason')} data-testid="jr-reason" /></div>
      {err && <p className="error" role="alert" style={{ margin: 0 }}>{err}</p>}
      <button type="submit" className="btn btn-ink btn-sm" style={{ alignSelf: 'flex-start' }} disabled={busy} data-testid="jr-send">Send request</button>
    </form>
  );
}
