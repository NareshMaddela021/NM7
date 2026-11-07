// The Applicants and Talent pool tabs of the company dashboard (Phase 2, C5). People who applied on Nm7, ranked: a fit
// first, then the best match score, then the newest, each with the match reasons in plain words. Screening answers
// that break the company's rules add a "Not a fit" label with the reasons: the person is never hidden or deleted.
// Contact details show once shortlisted. Stages (the student sees each one), compare up to 3 side by side, schedule an
// interview (the student gets a calendar file), the talent pool, the resume they applied with. No pop-up dialogs.
// English, Telugu and Hindi (co.ap.*).
import { useCallback, useEffect, useState } from 'react';
import { rq } from '../../lib/company';
import { matchReasons } from '../../lib/jobBoard';
import ResumePreview from '../builder/ResumePreview';
import { designOf } from '../builder/design';
import ErrorBoundary from '../../components/ErrorBoundary';

const STAGES = ['viewed', 'shortlisted', 'interview', 'offer', 'rejected'];
const TONE = { applied: 'b-neutral', viewed: 'b-neutral', shortlisted: 'b-signal', interview: 'b-signal', offer: 'b-success', rejected: 'b-danger', no_reply: 'b-neutral' };
const day = (ms) => (ms ? new Date(ms).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '');

/** "Matches 3 of 4 skills · Fresher OK · In Hyderabad" (the job board's own words). */
export function reasons(m, t) {
  if (!m) return [t('co.ap.noResume')];
  const { good, gaps } = matchReasons(m, t);
  return [...good, ...gaps];
}

export default function CompanyApplicants({ t, c }) {
  const [job, setJob] = useState('');
  const [d, setD] = useState(null);
  const [err, setErr] = useState('');
  const [pick, setPick] = useState([]);
  const [open, setOpen] = useState(null);
  const can = ['main', 'full', 'posting'].includes(c.myRole);
  const load = useCallback(() => {
    rq(`/api/company/${c.id}/applicants${job ? `?job=${encodeURIComponent(job)}` : ''}`).then((x) => { setD(x); setErr(''); }, (x) => setErr(x.message));
  }, [c.id, job]);
  useEffect(() => { load(); }, [load]);
  if (err && !d) return <p className="error" role="alert">{err}</p>;
  if (!d) return <p className="muted">{t('co.loading')}</p>;
  const chosen = d.items.filter((x) => pick.includes(x.id));
  const toggle = (id) => setPick((p) => (p.includes(id) ? p.filter((x) => x !== id) : p.length < 3 ? [...p, id] : p));
  return (
    <section className="stack g12" aria-label={t('co.dash.tab.applicants')} data-testid="co-applicants">
      <div className="row g8" style={{ justifyContent: 'space-between', alignItems: 'flex-end' }}>
        <div className="field" style={{ minWidth: 0, flex: '1 1 220px' }}>
          <label className="label" htmlFor="ap-job">{t('co.ap.job')}</label>
          <select id="ap-job" className="input" value={job} onChange={(e) => { setJob(e.target.value); setPick([]); setOpen(null); }}>
            <option value="">{t('co.ap.allJobs')}</option>
            {d.jobs.map((j) => <option key={j.id} value={j.id}>{`${j.title} (${j.count})`}</option>)}
          </select>
        </div>
        <span className="xs muted" style={{ flex: '1 1 220px' }}>{t('co.ap.keep', { n: d.keepMonths })}</span>
      </div>
      {d.items.length === 0 && <p className="card-sm small muted" style={{ margin: 0 }}>{t('co.ap.none')}</p>}
      <ul className="stack g12" style={{ listStyle: 'none', margin: 0, padding: 0 }}>
        {d.items.map((a, i) => (
          <Applicant key={a.id} t={t} c={c} a={a} rank={i + 1} can={can} picked={pick.includes(a.id)} canPick={pick.length < 3 || pick.includes(a.id)}
            onPick={() => toggle(a.id)} open={open === a.id} onOpen={() => setOpen(open === a.id ? null : a.id)} onChanged={load} />
        ))}
      </ul>
      {/* a bar that stays at the bottom of the screen while ticking, so the result is right there (fix round item 23) */}
      {chosen.length > 0 && (
        <div className="co-ap-bar" data-testid="co-ap-bar">
          <div className="row g8" style={{ justifyContent: 'space-between', flexWrap: 'wrap' }}>
            <span className="small" role="status"><strong>{t('co.ap.picked', { n: chosen.length })}</strong>{chosen.length < 2 ? ` ${t('co.ap.pickMore')}` : ''}</span>
            <button type="button" className="link-btn small" onClick={() => setPick([])}>{t('co.ap.compareClear')}</button>
          </div>
          {chosen.length >= 2 && <Compare t={t} rows={chosen} />}
        </div>
      )}
    </section>
  );
}

function Applicant({ t, c, a, rank, can, picked, canPick, onPick, open, onOpen, onChanged }) {
  const [busy, setBusy] = useState('');
  const [err, setErr] = useState('');
  const [iv, setIv] = useState(null);
  const act = async (what, fn) => { setBusy(what); setErr(''); try { await fn(); onChanged(); } catch (x) { setErr(x.message); } finally { setBusy(''); } };
  const stage = (s) => act(s, () => rq(`/api/company/${c.id}/applicants/${a.id}/status`, { method: 'POST', body: { status: s } }));
  const pool = () => act('pool', () => rq(`/api/company/${c.id}/applicants/${a.id}/pool`, { method: 'PUT', body: { on: !a.pooled } }));
  return (
    <li className="card-sm stack g8" data-testid="co-applicant">
      <div className="row g8" style={{ justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div className="stack g4" style={{ minWidth: 0 }}>
          <strong style={{ overflowWrap: 'anywhere' }}><span className="muted xs">#{rank} </span>{a.name}</strong>
          <span className="xs muted">{a.job} · {t('co.ap.applied', { date: day(a.appliedAt) })}</span>
        </div>
        <div className="row g4" style={{ flexWrap: 'wrap', justifyContent: 'flex-end' }}>
          {a.match && <span className="badge b-signal" data-testid="co-ap-score">{t('jobs.match.pct', { n: a.match.score })}</span>}
          <span className={`badge ${a.origin === 'auto' ? 'b-signal' : 'b-neutral'}`} data-testid="co-ap-origin" title={t(`aa.badge.${a.origin === 'auto' ? 'autoHint' : 'manualHint'}`)}>{t(`aa.badge.${a.origin === 'auto' ? 'auto' : 'manual'}`)}</span>
          <span className={`badge ${TONE[a.status] || 'b-neutral'}`} data-testid="co-ap-stage">{t(`jobs.app.${a.status}`)}</span>
        </div>
      </div>
      <span className="small">{reasons(a.match, t).join(' · ')}</span>
      {a.match?.found.length > 0 && <span className="xs">{t('jobs.match.found', { list: a.match.found.join(', ') })}</span>}
      {a.match?.missing.length > 0 && <span className="xs muted">{t('jobs.match.missing', { list: a.match.missing.join(', ') })}</span>}
      {!a.fit.ok && (
        <div className="stack g4" data-testid="co-ap-notfit">
          <span className="badge b-warning" style={{ alignSelf: 'flex-start' }}>{t('co.ap.notFit')}</span>
          <ul className="xs" style={{ margin: 0, paddingLeft: 18 }}>{a.fit.reasons.map((r, i) => <li key={i}>{r}</li>)}</ul>
        </div>
      )}
      {a.answers.length > 0 && (
        <details className="xs"><summary>{t('co.ap.answers')}</summary>
          <dl className="stack g4" style={{ margin: '6px 0 0' }}>{a.answers.map((x, i) => <div key={i}><dt className="muted">{x.q}</dt><dd style={{ margin: 0 }}>{String(x.a)}</dd></div>)}</dl>
        </details>
      )}
      {a.contact ? (
        <span className="xs" data-testid="co-ap-contact"><a href={`mailto:${a.contact.email}`}>{a.contact.email}</a>{a.contact.phone ? ` · ${a.contact.phone}` : ''}</span>
      ) : <span className="xs muted">{t('co.ap.contactLater')}</span>}
      {a.interview && <span className="xs" data-testid="co-ap-interview">{t('co.ap.ivOn', { when: new Date(a.interview.at).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' }) })}{[a.interview.round, a.interview.interviewer].filter(Boolean).map((x) => ` · ${x}`).join('')}</span>}
      {a.pooled && <span className="xs">{t('co.ap.inPool')}</span>}
      {a.irrelevant && <span className="xs muted" data-testid="co-ap-marked">{t('aa.co.marked')}</span>}
      <div className="row g8" style={{ flexWrap: 'wrap' }}>
        <button type="button" className="link-btn small" aria-expanded={open} onClick={onOpen}>{open ? t('co.ap.hideResume') : t('co.ap.resume')}</button>
        <label className="row g4 small"><input type="checkbox" value={a.id} aria-label={`${t('co.ap.compare')}: ${a.name}`} checked={picked} disabled={!canPick} onChange={onPick} /> {t('co.ap.compare')}</label>
        {can && <button type="button" className="link-btn small" disabled={!!busy} onClick={pool}>{a.pooled ? t('co.ap.unpool') : t('co.ap.pool')}</button>}
        {can && a.origin === 'auto' && <button type="button" className="link-btn small" disabled={!!busy} data-testid="co-ap-irrelevant" onClick={() => act('irr', () => rq(`/api/company/${c.id}/applicants/${a.id}/irrelevant`, { method: 'POST', body: { on: !a.irrelevant } }))}>{a.irrelevant ? t('aa.co.relevant') : t('aa.co.irrelevant')}</button>}
      </div>
      {can && (
        <div className="row g8" style={{ flexWrap: 'wrap' }} role="group" aria-label={t('co.ap.stage', { name: a.name })}>
          {STAGES.filter((s) => s !== 'viewed' && s !== 'interview' && s !== a.status).map((s) => (
            <button key={s} type="button" className={`btn ${s === 'rejected' ? 'btn-outline' : 'btn-ink'}`} disabled={!!busy} onClick={() => stage(s)}>{t(`co.ap.to.${s}`)}</button>
          ))}
          {a.status !== 'rejected' && !iv && <button type="button" className="btn btn-outline" disabled={!!busy} onClick={() => setIv({ date: '', time: '10:30', minutes: '30', round: '', interviewer: '', place: '', link: '', notes: '' })}>{a.interview ? t('co.ap.ivChange') : t('co.ap.ivNew')}</button>}
        </div>
      )}
      {iv && <InterviewForm t={t} iv={iv} setIv={setIv} busy={busy === 'iv'}
        onSend={() => act('iv', async () => { await rq(`/api/company/${c.id}/applicants/${a.id}/interview`, { method: 'POST', body: { ...iv, minutes: Number(iv.minutes) } }); setIv(null); })} />}
      {err && <p className="error" role="alert">{err}</p>}
      {open && <ResumeBox t={t} c={c} id={a.id} />}
    </li>
  );
}

function InterviewForm({ t, iv, setIv, busy, onSend }) {
  const set = (k) => (e) => setIv({ ...iv, [k]: e.target.value });
  return (
    <form className="stack g8 well" onSubmit={(e) => { e.preventDefault(); onSend(); }} data-testid="co-ap-ivform">
      <strong className="small">{t('co.ap.ivTitle')}</strong>
      <div className="co-grid">
        <div className="field"><label className="label" htmlFor="iv-d">{t('co.ap.ivDate')}</label><input id="iv-d" type="date" className="input" required value={iv.date} onChange={set('date')} /></div>
        <div className="field"><label className="label" htmlFor="iv-t">{t('co.ap.ivTime')}</label><input id="iv-t" type="time" className="input" required value={iv.time} onChange={set('time')} /></div>
        <div className="field"><label className="label" htmlFor="iv-m">{t('co.ap.ivMinutes')}</label><input id="iv-m" className="input" inputMode="numeric" value={iv.minutes} onChange={set('minutes')} /></div>
      </div>
      <div className="co-grid">
        <div className="field"><label className="label" htmlFor="iv-r">{t('co.ap.ivRound')}</label><input id="iv-r" className="input" maxLength={80} placeholder={t('co.ap.ivRoundEg')} value={iv.round} onChange={set('round')} /></div>
        <div className="field"><label className="label" htmlFor="iv-w">{t('co.ap.ivWho')}</label><input id="iv-w" className="input" maxLength={80} value={iv.interviewer} onChange={set('interviewer')} /></div>
      </div>
      <div className="field"><label className="label" htmlFor="iv-p">{t('co.ap.ivPlace')}</label><input id="iv-p" className="input" maxLength={200} value={iv.place} onChange={set('place')} /></div>
      <div className="field"><label className="label" htmlFor="iv-l">{t('co.ap.ivLink')}</label><input id="iv-l" className="input" inputMode="url" maxLength={300} placeholder="https://" value={iv.link} onChange={set('link')} /></div>
      <div className="field"><label className="label" htmlFor="iv-n">{t('co.ap.ivNotes')}</label><textarea id="iv-n" className="input" rows={2} maxLength={500} value={iv.notes} onChange={set('notes')} /></div>
      <span className="xs muted">{t('co.ap.ivHint')}</span>
      <div className="row g8"><button type="submit" className="btn btn-ink" disabled={busy}>{busy ? t('co.wait') : t('co.ap.ivSend')}</button>
        <button type="button" className="link-btn small" onClick={() => setIv(null)}>{t('co.cancel')}</button></div>
    </form>
  );
}

function ResumeBox({ t, c, id }) {
  const [r, setR] = useState(null);
  const [err, setErr] = useState('');
  useEffect(() => { rq(`/api/company/${c.id}/applicants/${id}`).then(setR, (x) => setErr(x.message)); }, [c.id, id]);
  if (err) return <p className="error" role="alert">{err}</p>;
  if (!r) return <p className="muted xs">{t('co.loading')}</p>;
  if (!r.data) return <p className="xs muted">{t('co.ap.noResume')}</p>;
  return (
    <div className="stack g8" data-testid="co-ap-resume" style={{ overflowX: 'auto' }}>
      {!r.contact && <span className="xs muted">{t('co.ap.contactLater')}</span>}
      <ErrorBoundary title={t('co.ap.resumeError')} text=""><ResumePreview data={r.data} design={designOf(r.data)} /></ErrorBoundary>
    </div>
  );
}

/** Years of experience in plain words: "Less than a year", "1.5 years" (never "0.2"; fix round item 23). */
export const yearsText = (y, t) => (y == null ? '—' : y < 1 ? t('co.ap.lessYear') : t('co.ap.yearsN', { n: Math.round(y * 2) / 2 }));

function Compare({ t, rows }) {
  const line = (label, f) => <tr><th scope="row" className="xs muted" style={{ textAlign: 'left', fontWeight: 600 }}>{label}</th>{rows.map((a) => <td key={a.id} className="xs">{f(a)}</td>)}</tr>;
  return (
    <section className="stack g8" aria-label={t('co.ap.compareTitle')} data-testid="co-ap-compare">
      <strong className="small">{t('co.ap.compareTitle')}</strong>
      <div style={{ overflowX: 'auto' }}>
        <table className="table" style={{ minWidth: 0 }}>
          <thead><tr><td />{rows.map((a) => <th key={a.id} scope="col" className="small">{a.name}</th>)}</tr></thead>
          <tbody>
            {line(t('co.ap.cScore'), (a) => (a.match ? `${a.match.score}/100` : '—'))}
            {line(t('co.ap.cFound'), (a) => a.match?.found.join(', ') || '—')}
            {line(t('co.ap.cMissing'), (a) => a.match?.missing.join(', ') || '—')}
            {line(t('co.ap.cYears'), (a) => (a.match ? yearsText(a.match.years, t) : '—'))}
            {line(t('co.ap.cFit'), (a) => (a.fit.ok ? t('co.ap.fitOk') : t('co.ap.notFit')))}
            {line(t('co.ap.cStage'), (a) => t(`jobs.app.${a.status}`))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

export function TalentPool({ t, c }) {
  const [rows, setRows] = useState(null);
  useEffect(() => { rq(`/api/company/${c.id}/pool`).then(setRows, () => setRows([])); }, [c.id]);
  if (!rows) return <p className="muted">{t('co.loading')}</p>;
  return (
    <section className="card stack g8" aria-label={t('co.dash.tab.pool')} data-testid="co-pool">
      <span className="small muted">{t('co.pool.hint')}</span>
      {rows.length === 0 && <p className="small muted" style={{ margin: 0 }}>{t('co.pool.none')}</p>}
      <ul className="stack g8" style={{ listStyle: 'none', margin: 0, padding: 0 }}>
        {rows.map((p) => (
          <li key={p.appId} className="card-sm stack g4">
            <strong>{p.name}</strong>
            <span className="xs muted">{p.job} · {t(`jobs.app.${p.status}`)} · {t('co.pool.added', { date: day(p.at) })}</span>
            {p.note && <span className="xs">{p.note}</span>}
          </li>
        ))}
      </ul>
    </section>
  );
}
