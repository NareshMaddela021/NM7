// The "Hire now" tab of the company dashboard (Phase 5, H2: instant shortlist). Pick a live job and see, at once, the
// top 10 people who are ready to join now and agreed to be seen: match score and reasons (the job board's words), when
// they can join, the salary they expect against the job's range, the skill check and reliability. Invite one person or
// all of them; the list shows each answer (Accept, or Not interested with the reason). Email and phone show only after
// the person accepts, then they are also in Applicants (Shortlisted). Only Verified companies; Basic accounts see a
// note. No pop-up dialogs. English, Telugu and Hindi (co.hire.*).
import { useCallback, useEffect, useState } from 'react';
import { rq } from '../../lib/company';
import { reasons } from './CompanyApplicants';

const rupees = (n) => (n == null ? '' : `₹${Math.round(n).toLocaleString('en-IN')}`);
const day = (s) => (s ? new Date(`${s}T00:00:00`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }) : '');
const TONE = { sent: 'b-neutral', accepted: 'b-success', declined: 'b-danger', expired: 'b-neutral' };

/** "Joins 1 Dec · 15 days' notice · Hyderabad, Pune / remote". */
export function whenLine(a, t) {
  const parts = [];
  if (a.joinDate) parts.push(t('co.hire.joins', { date: day(a.joinDate) }));
  parts.push(a.noticeDays ? t('co.hire.notice', { n: a.noticeDays }) : t('co.hire.noNotice'));
  const where = [...(a.cities || []), ...(a.remote ? [t('co.hire.remote')] : [])].join(', ');
  if (where) parts.push(where);
  return parts.join(' · ');
}

/** "Expects ₹25,000 a month · within your range" (or above / below / no range). */
export function salaryLine(s, t) {
  if (!s?.want) return t('co.hire.salary.none');
  const want = t('co.hire.salary.want', { amount: rupees(s.want) });
  return `${want} · ${t(`co.hire.salary.${s.fit}`)}`;
}

export default function CompanyHire({ t, c }) {
  const [jobs, setJobs] = useState(null);
  const [job, setJob] = useState('');
  const [d, setD] = useState(null);
  const [invites, setInvites] = useState([]);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState('');
  const [msg, setMsg] = useState('');
  const verified = c.trust === 'verified';
  const canInvite = ['main', 'full', 'posting'].includes(c.myRole);
  useEffect(() => {
    rq(`/api/company/${c.id}/jobs`).then((js) => {
      const live = (js || []).filter((j) => j.status === 'active');
      setJobs(live);
      if (live[0]) setJob(live[0].id);
    }, () => setJobs([]));
  }, [c.id]);
  const load = useCallback(async () => {
    if (!job || !verified) return;
    setErr(''); setD(null);
    try {
      const [s, inv] = await Promise.all([rq(`/api/company/${c.id}/hire/shortlist?job=${encodeURIComponent(job)}`), rq(`/api/company/${c.id}/hire/invites?job=${encodeURIComponent(job)}`)]);
      setD(s); setInvites(inv);
    } catch (x) { setErr(x.message); setD({ items: [] }); }
  }, [c.id, job, verified]);
  useEffect(() => { load(); }, [load]);
  const invite = async (people) => {
    setBusy(true); setMsg(''); setErr('');
    try {
      const r = await rq(`/api/company/${c.id}/hire/invite`, { method: 'POST', body: { job, people, note } });
      setMsg(t('co.hire.sent', { n: r.sent }));
      await load();
    } catch (x) { setErr(x.message); } finally { setBusy(false); }
  };
  if (!verified) return <section className="card stack g8" data-testid="co-hire"><strong>{t('co.hire.title')}</strong><p className="small" data-testid="co-hire-basic">{t('co.hire.basic')}</p></section>;
  if (!jobs) return <p className="muted">{t('co.loading')}</p>;
  if (!jobs.length) return <section className="card stack g8" data-testid="co-hire"><strong>{t('co.hire.title')}</strong><p className="small">{t('co.hire.noJobs')}</p></section>;
  const open = (d?.items || []).filter((x) => !x.invite && !x.applied).map((x) => x.key);
  return (
    <section className="stack g12" aria-label={t('co.hire.title')} data-testid="co-hire">
      <div className="card stack g8">
        <strong>{t('co.hire.title')}</strong>
        <span className="small muted">{t('co.hire.intro')}</span>
        <label className="row g8 small" style={{ flexWrap: 'wrap' }}>{t('co.hire.job')}
          <select className="input" style={{ height: 38, width: 'auto', maxWidth: '100%' }} value={job} onChange={(e) => setJob(e.target.value)} data-testid="co-hire-job">
            {jobs.map((j) => <option key={j.id} value={j.id}>{j.title}</option>)}
          </select>
        </label>
        {d?.usage && <span className="xs muted" data-testid="co-hire-usage">{t('co.hire.usage', { used: d.usage.used, free: d.usage.free })}</span>}
      </div>
      {err && <p className="error" role="alert">{err}</p>}
      {!d && !err && <p className="muted">{t('co.loading')}</p>}
      {d && !err && (
        <>
          <p className="small" data-testid="co-hire-count">{d.items.length ? t('co.hire.found', { n: d.available }) : t('co.hire.none')}</p>
          {canInvite && open.length > 0 && (
            <div className="card-sm stack g8">
              <label className="field"><span className="label">{t('co.hire.note')}</span><input className="input" maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} placeholder={t('co.hire.notePh')} data-testid="co-hire-note" /></label>
              <button type="button" className="btn btn-ink" style={{ alignSelf: 'flex-start' }} disabled={busy} onClick={() => invite(open)} data-testid="co-hire-all">{t('co.hire.inviteAll', { n: open.length })}</button>
            </div>
          )}
          {msg && <p className="small" role="status" data-testid="co-hire-msg">{msg}</p>}
          <ol className="stack g8" style={{ listStyle: 'none', padding: 0, margin: 0 }}>
            {d.items.map((x, i) => (
              <li key={x.key} className="card stack g4" data-testid="co-hire-row">
                <div className="row between g8" style={{ flexWrap: 'wrap' }}>
                  <strong>{i + 1}. {x.name}</strong>
                  <span className="badge b-signal" data-testid="co-hire-score">{t('co.hire.score', { score: x.match.score })}</span>
                </div>
                <span className="small">{reasons(x.match, t).join(' · ')}</span>
                <span className="small" data-testid="co-hire-when">{whenLine(x.availability, t)}</span>
                <span className="small" data-testid="co-hire-salary">{salaryLine(x.salary, t)}</span>
                <span className="xs muted" data-testid="co-hire-trust">{x.skillCheck ? t('co.hire.check', { score: x.skillCheck.score }) : t('co.hire.noCheck')} · {x.reliability.score == null ? x.reliability.label : `${x.reliability.label} (${x.reliability.score}%)`}{x.reliability.lines?.length ? `: ${x.reliability.lines.join('; ')}` : ''}</span>
                <div className="row g8" style={{ flexWrap: 'wrap' }}>
                  {x.invite ? <span className={`badge ${TONE[x.invite.status]}`} data-testid="co-hire-state">{t(`co.hire.state.${x.invite.status}`)}</span>
                    : x.applied ? <span className="badge b-neutral">{t('co.hire.applied')}</span>
                      : canInvite && <button type="button" className="btn btn-outline btn-sm" disabled={busy} onClick={() => invite([x.key])} data-testid="co-hire-invite">{t('co.hire.invite')}</button>}
                </div>
              </li>
            ))}
          </ol>
        </>
      )}
      {invites.length > 0 && (
        <section className="card stack g8" aria-labelledby="co-hire-inv-h" data-testid="co-hire-invites">
          <strong id="co-hire-inv-h">{t('co.hire.invites')}</strong>
          <ul className="stack g8" style={{ listStyle: 'none', padding: 0, margin: 0 }}>
            {invites.map((x) => (
              <li key={x.id} className="row between g8" style={{ flexWrap: 'wrap' }} data-testid="co-hire-inv">
                <span className="stack g4" style={{ minWidth: 0 }}>
                  <strong>{x.name}</strong>
                  {x.contact && <span className="small" data-testid="co-hire-contact">{[x.contact.email, x.contact.phone].filter(Boolean).join(' · ')}</span>}
                  {x.reasonText && <span className="small muted">{x.reasonText}</span>}
                </span>
                <span className={`badge ${TONE[x.status]}`}>{t(`co.hire.state.${x.status}`)}</span>
              </li>
            ))}
          </ul>
          <span className="xs muted">{t('co.hire.privacy')}</span>
        </section>
      )}
    </section>
  );
}
