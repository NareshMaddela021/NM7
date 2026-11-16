// The Applicants and Talent pool tabs of the company dashboard (Phase 2, C5). People who applied on Nm7, ranked: a fit
// first, then the best match score, then the newest, each with the match reasons in plain words. Screening answers
// that break the company's rules add a "Not a fit" label with the reasons: the person is never hidden or deleted.
// Contact details show once shortlisted. Stages (the student sees each one), compare up to 3 side by side, schedule an
// interview (the student gets a calendar file), the talent pool, the resume they applied with. No pop-up dialogs.
// English, Telugu and Hindi (co.ap.*). Vetting V1: the level chip and ⚡ Ready now on each card and in the profile.
import { useCallback, useEffect, useState } from 'react';
import { rq } from '../../lib/company';
import { matchReasons } from '../../lib/jobBoard';
import ResumePreview from '../builder/ResumePreview';
import { designOf } from '../builder/design';
import ErrorBoundary from '../../components/ErrorBoundary';
import { Dialog } from '../../components/ui';
import { Chip, Empty, Pipeline, ScoreRing, Skel } from '../me/kit';
import '../../styles/company-jobs.css';

import ApplicantFeedback from './ApplicantFeedback';
import SkillBadge from './SkillBadge';
import LevelBadge from '../../components/LevelBadge';
import { lt } from '../../components/levelStrings';
import { useLang } from '../../lib/i18n';

/** The level chip and ⚡ for an applicant row (`level` is null for people without a level yet). */
function ApLevel({ lv }) {
  const [, lang] = useLang();
  if (!lv) return null;
  return <LevelBadge level={lv.level} label={lv.label} readyNow={lv.readyNow} lang={lang} className="ca-level" />;
}

const STAGES = ['viewed', 'shortlisted', 'interview', 'offer', 'rejected'];
const TONE = { applied: 'neutral', viewed: 'neutral', shortlisted: 'info', interview: 'accent', offer: 'ok', rejected: 'bad', no_reply: 'neutral' };
/** The board's columns, in the order people move through them (Phase 3). */
const BOARD = ['applied', 'viewed', 'shortlisted', 'interview', 'offer', 'rejected', 'no_reply'];
const initial = (n) => (n || '?').trim().charAt(0).toUpperCase();
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
  const [view, setView] = useState('list'); // list (default) or board
  const [stage, setStage] = useState(null); // list filter by stage
  const [drawer, setDrawer] = useState(null); // the applicant whose profile is open
  const can = ['main', 'full', 'posting'].includes(c.myRole);
  const load = useCallback(() => {
    rq(`/api/company/${c.id}/applicants${job ? `?job=${encodeURIComponent(job)}` : ''}`).then((x) => { setD(x); setErr(''); }, (x) => setErr(x.message));
  }, [c.id, job]);
  useEffect(() => { load(); }, [load]);
  if (err && !d) return <p className="error" role="alert">{err}</p>;
  if (!d) return <Skel cards={3} lines={3} label={t('co.loading')} />;
  const chosen = d.items.filter((x) => pick.includes(x.id));
  const toggle = (id) => setPick((p) => (p.includes(id) ? p.filter((x) => x !== id) : p.length < 3 ? [...p, id] : p));
  const counts = BOARD.map((st) => ({ key: st, label: t(`jobs.app.${st}`), count: d.items.filter((a) => a.status === st).length, tone: TONE[st] === 'bad' ? 'bad' : TONE[st] === 'ok' ? 'ok' : TONE[st] === 'info' || TONE[st] === 'accent' ? 'info' : undefined }))
    .filter((x) => x.count > 0 || ['viewed', 'shortlisted', 'interview', 'offer'].includes(x.key));
  const shown = stage ? d.items.filter((a) => a.status === stage) : d.items;
  const profile = d.items.find((a) => a.id === drawer);
  return (
    <section className="stack g16" aria-label={t('co.dash.tab.applicants')} data-testid="co-applicants">
      <div className="ca-top mcard">
        <div className="ca-filter">
          <div className="field" style={{ minWidth: 0, flex: '1 1 240px' }}>
            <label className="label" htmlFor="ap-job">{t('co.ap.job')}</label>
            <select id="ap-job" className="input" value={job} onChange={(e) => { setJob(e.target.value); setPick([]); setOpen(null); setStage(null); }}>
              <option value="">{t('co.ap.allJobs')}</option>
              {d.jobs.map((j) => <option key={j.id} value={j.id}>{`${j.title} (${j.count})`}</option>)}
            </select>
          </div>
          {d.items.length > 0 && (
            <div className="ca-view" role="group" aria-label={t('co.ap.view')}>
              <button type="button" aria-pressed={view === 'list'} onClick={() => setView('list')}><span aria-hidden="true">☰ </span>{t('co.ap.viewList')}</button>
              <button type="button" aria-pressed={view === 'board'} onClick={() => { setView('board'); setStage(null); }}><span aria-hidden="true">▥ </span>{t('co.ap.viewBoard')}</button>
            </div>
          )}
        </div>
        {d.items.length > 0 && <Pipeline steps={counts} label={t('co.ap.cStage')} active={view === 'list' ? stage : null} onPick={view === 'list' ? setStage : undefined} />}
        <span className="xs muted">{t('co.ap.keep', { n: d.keepMonths })}</span>
      </div>
      {d.items.length === 0 && <Empty shape="magnifier" tint="company" compact>{t('co.ap.none')}</Empty>}
      {view === 'list' ? (
        <ul className="ca-list">
          {shown.map((a) => (
            <Applicant key={a.id} t={t} c={c} a={a} rank={d.items.indexOf(a) + 1} can={can} picked={pick.includes(a.id)} canPick={pick.length < 3 || pick.includes(a.id)}
              onPick={() => toggle(a.id)} open={open === a.id} onOpen={() => setOpen(open === a.id ? null : a.id)} onProfile={() => setDrawer(a.id)} onChanged={load} />
          ))}
        </ul>
      ) : (
        <Board t={t} items={d.items} onProfile={setDrawer} />
      )}
      {profile && <Profile t={t} a={profile} rank={d.items.indexOf(profile) + 1} onClose={() => setDrawer(null)} />}
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

/** The board: one column per stage (stacked on a phone); a card opens the person's profile. */
function Board({ t, items, onProfile }) {
  const [, lang] = useLang();
  const lv = lt(lang);
  const cols = BOARD.filter((st) => items.some((a) => a.status === st) || ['viewed', 'shortlisted', 'interview', 'offer'].includes(st));
  return (
    <div className="ca-board" style={{ '--cols': cols.length }}>
      {cols.map((st) => {
        const list = items.filter((a) => a.status === st);
        return (
          <section key={st} className={`ca-col ca-col-${TONE[st]}`} aria-label={`${t(`jobs.app.${st}`)}: ${list.length}`}>
            <header className="ca-col-h"><span>{t(`jobs.app.${st}`)}</span><span className="ca-col-n">{list.length}</span></header>
            <ul className="ca-col-list">
              {list.map((a) => (
                <li key={a.id}>
                  <button type="button" className="ca-mini" onClick={() => onProfile(a.id)}>
                    <span className="mavatar ca-av-sm" aria-hidden="true">{initial(a.name)}</span>
                    <span className="ca-mini-main"><strong>{a.name}</strong><span className="xs muted">{a.job}</span>{a.level && <span className="xs ca-mini-lv" data-testid="co-ap-mini-level">L{a.level.level} · {lv(`lv.${a.level.level}`)}{a.level.readyNow ? <> · <span aria-hidden="true">⚡</span>{lv('lv.ready')}</> : ''}</span>}</span>
                    {a.match && <span className="ca-mini-score">{a.match.score}</span>}
                  </button>
                </li>
              ))}
              {list.length === 0 && <li className="ca-col-empty" aria-hidden="true">—</li>}
            </ul>
          </section>
        );
      })}
    </div>
  );
}

/** The candidate's profile in a side panel: only what the list already loaded (no extra calls). */
function Profile({ t, a, rank, onClose }) {
  return (
    <Dialog title={a.name} onClose={onClose} showTitle overlayStyle={{ justifyContent: 'flex-end', alignItems: 'stretch', padding: 0 }}
      panelStyle={{ width: 'min(460px, 100vw)', maxWidth: '100vw', height: '100vh', maxHeight: '100vh', margin: 0, borderRadius: '22px 0 0 22px' }}>
      <div className="ca-profile stack g16">
        <div className="ca-p-head">
          {a.match ? <ScoreRing value={a.match.score} size={96} label={t('co.ap.cScore')} /> : <span className="mavatar ca-av-lg" aria-hidden="true">{initial(a.name)}</span>}
          <div className="stack g4" style={{ minWidth: 0 }}>
            <span className="small muted">#{rank} · {a.job}</span>
            <span className="xs muted">{t('co.ap.applied', { date: day(a.appliedAt) })}</span>
            <span className="ca-chips"><Chip tone={TONE[a.status] || 'neutral'}>{t(`jobs.app.${a.status}`)}</Chip><Chip tone={a.origin === 'auto' ? 'accent' : 'neutral'}>{t(`aa.badge.${a.origin === 'auto' ? 'auto' : 'manual'}`)}</Chip>{a.pooled && <Chip tone="info">{t('co.ap.inPool')}</Chip>}</span>
          </div>
        </div>
        <ApLevel lv={a.level} />
        <SkillBadge sv={a.skillVerified} t={t} />
        <ul className="ca-reasons">{reasons(a.match, t).map((r) => <li key={r}>{r}</li>)}</ul>
        {a.match?.found.length > 0 && <div className="stack g4"><span className="mkicker">{t('co.ap.cFound')}</span><span className="ca-skills">{a.match.found.map((x) => <span key={x} className="ca-skill ok">{x}</span>)}</span></div>}
        {a.match?.missing.length > 0 && <div className="stack g4"><span className="mkicker">{t('co.ap.cMissing')}</span><span className="ca-skills">{a.match.missing.map((x) => <span key={x} className="ca-skill">{x}</span>)}</span></div>}
        {a.match && <div className="stack g4"><span className="mkicker">{t('co.ap.cYears')}</span><span className="small">{yearsText(a.match.years, t)}</span></div>}
        <div className={`mcard mcard-tight ${a.fit.ok ? 'mcard-ok' : 'mcard-warn'}`}>
          <strong className="small">{t('co.ap.cFit')}: {a.fit.ok ? t('co.ap.fitOk') : t('co.ap.notFit')}</strong>
          {!a.fit.ok && <ul className="xs" style={{ margin: 0, paddingLeft: 18 }}>{a.fit.reasons.map((r, i) => <li key={i}>{r}</li>)}</ul>}
        </div>
        {a.answers.length > 0 && (
          <div className="stack g8"><span className="mkicker">{t('co.ap.answers')}</span>
            <dl className="ca-answers">{a.answers.map((x, i) => <div key={i}><dt>{x.q}</dt><dd>{String(x.a)}</dd></div>)}</dl></div>
        )}
        <div className="stack g4">
          {a.contact ? <span className="small"><a href={`mailto:${a.contact.email}`}>{a.contact.email}</a>{a.contact.phone ? ` · ${a.contact.phone}` : ''}</span> : <span className="xs muted">{t('co.ap.contactLater')}</span>}
          {a.interview && <span className="small">{t('co.ap.ivOn', { when: new Date(a.interview.at).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' }) })}{[a.interview.round, a.interview.interviewer].filter(Boolean).map((x) => ` · ${x}`).join('')}</span>}
        </div>
      </div>
    </Dialog>
  );
}

function Applicant({ t, c, a, rank, can, picked, canPick, onPick, open, onOpen, onProfile, onChanged }) {
  const [busy, setBusy] = useState('');
  const [err, setErr] = useState('');
  const [iv, setIv] = useState(null);
  const act = async (what, fn) => { setBusy(what); setErr(''); try { await fn(); onChanged(); } catch (x) { setErr(x.message); } finally { setBusy(''); } };
  const stage = (s) => act(s, () => rq(`/api/company/${c.id}/applicants/${a.id}/status`, { method: 'POST', body: { status: s } }));
  const pool = () => act('pool', () => rq(`/api/company/${c.id}/applicants/${a.id}/pool`, { method: 'PUT', body: { on: !a.pooled } }));
  return (
    <li className={`mcard ca-card ${picked ? 'is-picked' : ''}`} data-testid="co-applicant">
      <div className="ca-head">
        <span className="mavatar" aria-hidden="true">{initial(a.name)}</span>
        <div className="ca-who">
          <strong className="ca-name"><span className="ca-rank">#{rank}</span>{a.name}</strong>
          <span className="xs muted">{a.job} · {t('co.ap.applied', { date: day(a.appliedAt) })}</span>
        </div>
        <div className="ca-chips">
          {a.match && <Chip tone={a.match.score >= 70 ? 'ok' : a.match.score >= 40 ? 'info' : 'neutral'} testid="co-ap-score">{t('jobs.match.pct', { n: a.match.score })}</Chip>}
          <Chip tone={a.origin === 'auto' ? 'accent' : 'neutral'} testid="co-ap-origin" title={t(`aa.badge.${a.origin === 'auto' ? 'autoHint' : 'manualHint'}`)}>{t(`aa.badge.${a.origin === 'auto' ? 'auto' : 'manual'}`)}</Chip>
          <Chip tone={TONE[a.status] || 'neutral'} testid="co-ap-stage">{t(`jobs.app.${a.status}`)}</Chip>
        </div>
      </div>
      <ApLevel lv={a.level} />
      <p className="ca-why">{reasons(a.match, t).join(' · ')}</p>
      {(a.match?.found.length > 0 || a.match?.missing.length > 0) && (
        <div className="ca-skillrow">
          {a.match.found.length > 0 && <span className="xs ca-found">{t('jobs.match.found', { list: a.match.found.join(', ') })}</span>}
          {a.match.missing.length > 0 && <span className="xs muted ca-missing">{t('jobs.match.missing', { list: a.match.missing.join(', ') })}</span>}
        </div>
      )}
      {!a.fit.ok && (
        <div className="ca-notfit" data-testid="co-ap-notfit">
          <Chip tone="warn">{t('co.ap.notFit')}</Chip>
          <ul className="xs" style={{ margin: 0, paddingLeft: 18 }}>{a.fit.reasons.map((r, i) => <li key={i}>{r}</li>)}</ul>
        </div>
      )}
      {a.answers.length > 0 && (
        <details className="xs ca-answers-fold"><summary>{t('co.ap.answers')}</summary>
          <dl className="ca-answers">{a.answers.map((x, i) => <div key={i}><dt>{x.q}</dt><dd>{String(x.a)}</dd></div>)}</dl>
        </details>
      )}
      <div className="ca-info">
        {a.contact ? (
          <span className="xs" data-testid="co-ap-contact"><span aria-hidden="true">✉ </span><a href={`mailto:${a.contact.email}`}>{a.contact.email}</a>{a.contact.phone ? ` · ${a.contact.phone}` : ''}</span>
        ) : <span className="xs muted"><span aria-hidden="true">🔒 </span>{t('co.ap.contactLater')}</span>}
        {a.interview && <span className="xs" data-testid="co-ap-interview"><span aria-hidden="true">📅 </span>{t('co.ap.ivOn', { when: new Date(a.interview.at).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' }) })}{[a.interview.round, a.interview.interviewer].filter(Boolean).map((x) => ` · ${x}`).join('')}</span>}
        {a.pooled && <span className="xs">☆ {t('co.ap.inPool')}</span>}
        {a.irrelevant && <span className="xs muted" data-testid="co-ap-marked">{t('aa.co.marked')}</span>}
      </div>
      <div className="ca-tools">
        <button type="button" className="btn btn-outline btn-sm" onClick={onProfile}>{t('co.ap.profile')}</button>
        <button type="button" className="btn btn-outline btn-sm" aria-expanded={open} onClick={onOpen}>{open ? t('co.ap.hideResume') : t('co.ap.resume')}</button>
        <label className="ca-compare"><input type="checkbox" value={a.id} aria-label={`${t('co.ap.compare')}: ${a.name}`} checked={picked} disabled={!canPick} onChange={onPick} /> {t('co.ap.compare')}</label>
        {can && <button type="button" className="link-btn small" disabled={!!busy} onClick={pool}>{a.pooled ? t('co.ap.unpool') : t('co.ap.pool')}</button>}
        {can && a.origin === 'auto' && <button type="button" className="link-btn small" disabled={!!busy} data-testid="co-ap-irrelevant" onClick={() => act('irr', () => rq(`/api/company/${c.id}/applicants/${a.id}/irrelevant`, { method: 'POST', body: { on: !a.irrelevant } }))}>{a.irrelevant ? t('aa.co.relevant') : t('aa.co.irrelevant')}</button>}
      </div>
      {can && (
        <div className="ca-stages" role="group" aria-label={t('co.ap.stage', { name: a.name })}>
          {STAGES.filter((s) => s !== 'viewed' && s !== 'interview' && s !== a.status).map((s) => (
            <button key={s} type="button" className={`btn btn-sm ${s === 'rejected' ? 'btn-outline' : 'btn-signal'}`} disabled={!!busy} onClick={() => stage(s)}>{t(`co.ap.to.${s}`)}</button>
          ))}
          {a.status !== 'rejected' && !iv && <button type="button" className="btn btn-outline btn-sm" disabled={!!busy} onClick={() => setIv({ date: '', time: '10:30', minutes: '30', round: '', interviewer: '', place: '', link: '', notes: '' })}>{a.interview ? t('co.ap.ivChange') : t('co.ap.ivNew')}</button>}
        </div>
      )}
      {can && a.status === 'rejected' && <ApplicantFeedback t={t} c={c} a={a} />}
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
    <form className="stack g8 ca-ivform" onSubmit={(e) => { e.preventDefault(); onSend(); }} data-testid="co-ap-ivform">
      <strong className="ca-iv-title"><span aria-hidden="true">📅 </span>{t('co.ap.ivTitle')}</strong>
      <div className="cj-grid">
        <div className="field"><label className="label" htmlFor="iv-d">{t('co.ap.ivDate')}</label><input id="iv-d" type="date" className="input" required value={iv.date} onChange={set('date')} /></div>
        <div className="field"><label className="label" htmlFor="iv-t">{t('co.ap.ivTime')}</label><input id="iv-t" type="time" className="input" required value={iv.time} onChange={set('time')} /></div>
        <div className="field"><label className="label" htmlFor="iv-m">{t('co.ap.ivMinutes')}</label><input id="iv-m" className="input" inputMode="numeric" value={iv.minutes} onChange={set('minutes')} /></div>
      </div>
      <div className="cj-grid">
        <div className="field"><label className="label" htmlFor="iv-r">{t('co.ap.ivRound')}</label><input id="iv-r" className="input" maxLength={80} placeholder={t('co.ap.ivRoundEg')} value={iv.round} onChange={set('round')} /></div>
        <div className="field"><label className="label" htmlFor="iv-w">{t('co.ap.ivWho')}</label><input id="iv-w" className="input" maxLength={80} value={iv.interviewer} onChange={set('interviewer')} /></div>
      </div>
      <div className="field"><label className="label" htmlFor="iv-p">{t('co.ap.ivPlace')}</label><input id="iv-p" className="input" maxLength={200} value={iv.place} onChange={set('place')} /></div>
      <div className="field"><label className="label" htmlFor="iv-l">{t('co.ap.ivLink')}</label><input id="iv-l" className="input" inputMode="url" maxLength={300} placeholder="https://" value={iv.link} onChange={set('link')} /></div>
      <div className="field"><label className="label" htmlFor="iv-n">{t('co.ap.ivNotes')}</label><textarea id="iv-n" className="input" rows={2} maxLength={500} value={iv.notes} onChange={set('notes')} /></div>
      <span className="xs muted">{t('co.ap.ivHint')}</span>
      <div className="row g8"><button type="submit" className="btn btn-signal" disabled={busy}>{busy ? t('co.wait') : t('co.ap.ivSend')}</button>
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
    <div className="stack g8 ca-resume" data-testid="co-ap-resume" style={{ overflowX: 'auto' }}>
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
        <table className="table ca-compare-table" style={{ minWidth: 0 }}>
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
  if (!rows) return <Skel cards={3} lines={2} label={t('co.loading')} />;
  return (
    <section className="stack g16" aria-label={t('co.dash.tab.pool')} data-testid="co-pool">
      <p className="ca-pool-hint">{t('co.pool.hint')}</p>
      {rows.length === 0 && <Empty shape="magnifier" tint="company" compact>{t('co.pool.none')}</Empty>}
      <ul className="ca-pool">
        {rows.map((p) => (
          <li key={p.appId} className="mcard ca-person">
            <div className="ca-person-head">
              <span className="mavatar" aria-hidden="true">{initial(p.name)}</span>
              <div className="stack g4" style={{ minWidth: 0 }}>
                <strong className="ca-name">{p.name}</strong>
                <span className="xs muted">{p.job}</span>
              </div>
            </div>
            <span className="ca-chips"><Chip tone={TONE[p.status] || 'neutral'}>{t(`jobs.app.${p.status}`)}</Chip><span className="xs muted">{t('co.pool.added', { date: day(p.at) })}</span></span>
            {p.note && <p className="ca-note">{p.note}</p>}
          </li>
        ))}
      </ul>
    </section>
  );
}
