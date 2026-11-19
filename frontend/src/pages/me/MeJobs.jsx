// Application tracker: Saved -> Applied -> Viewed (Nm7 jobs) -> Shortlisted -> Interview -> Offer / Rejected, with
// follow-up reminders and simple stats. Applications sent on Nm7 move when the company moves them; the rest you move.
import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useLang } from '../../lib/i18n';
import { Dialog, useToast } from '../../components/ui';
import { useMe, setMe, newId, APP_STAGES, openInBuilder, reloadMe } from '../../lib/customerStore';
import { http } from '../../services/http';
import { BarChart } from '../admin/AdminUI';
import { Chip, Empty, MeCard, Pipeline, Stat } from './kit';
import '../../styles/me-jobs.css';
import { MeHead } from './MeLayout';
import { fmtShort, fmtDay } from './shared';
import { webLink } from '../../lib/links';
import { IcArrowLeft, IcArrowRight, IcBriefcase, IcCalendar, IcClip, IcClock, IcExternal } from '../../components/icons';

const DAY = 864e5;
const CHANNEL = { nm7: 'Applied on Nm7', link: 'Applied (outside Nm7)', email: 'Applied by email' };
const BLANK = { company: '', role: '', status: 'applied', url: '', notes: '', resumeId: '', next: '' };

function AppForm({ app, resumes, onSave, onDelete, onClose }) {
  const [f, setF] = useState({ ...BLANK, ...app, resumeId: app.resumeId || resumes[0].id, next: app.next ? new Date(app.next).toISOString().slice(0, 10) : '' });
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const [linkErr, setLinkErr] = useState('');
  const submit = (e) => {
    e.preventDefault();
    const url = webLink(f.url);
    if (url === null) { setLinkErr('Enter a web link like https://company.com/jobs/123'); document.getElementById('ap-u')?.focus(); return; }
    onSave({ ...f, url, next: f.next ? new Date(f.next).getTime() : null, date: app.date || Date.now(), id: app.id || newId('a') });
  };
  return (
    <Dialog showTitle title={app.id ? `${app.company} · ${app.role}` : 'Add an application'} onClose={onClose}>
      <form className="stack g12" onSubmit={submit} noValidate>
        <div className="row g8">
          <div className="field" style={{ flex: 1 }}><label htmlFor="ap-c" className="label">Company *</label><input id="ap-c" className="input" style={{ height: 42 }} value={f.company} onChange={set('company')} /></div>
          <div className="field" style={{ flex: 1 }}><label htmlFor="ap-r" className="label">Role *</label><input id="ap-r" className="input" style={{ height: 42 }} value={f.role} onChange={set('role')} /></div>
        </div>
        <div className="row g8">
          <div className="field" style={{ flex: 1 }}><label htmlFor="ap-s" className="label">Stage</label><select id="ap-s" className="input" style={{ height: 42 }} value={f.status} onChange={set('status')}>{APP_STAGES.filter(([k]) => !['viewed', 'no_reply'].includes(k) || app.status === k).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></div>
          <div className="field" style={{ flex: 1 }}><label htmlFor="ap-res" className="label">Resume sent</label><select id="ap-res" className="input" style={{ height: 42 }} value={f.resumeId} onChange={set('resumeId')}>{resumes.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}</select></div>
        </div>
        <div className="row g8">
          <div className="field" style={{ flex: 2 }}><label htmlFor="ap-u" className="label">Job link · optional</label><input id="ap-u" className="input" style={{ height: 42 }} value={f.url} onChange={(e) => { setF({ ...f, url: e.target.value }); setLinkErr(''); }} placeholder="company.com/jobs/123" aria-invalid={linkErr ? 'true' : undefined} aria-describedby={linkErr ? 'ap-u-err' : undefined} />{linkErr && <span id="ap-u-err" role="alert" className="error">{linkErr}</span>}</div>
          <div className="field" style={{ flex: 1 }}><label htmlFor="ap-n" className="label">Next step date</label><input id="ap-n" type="date" className="input" style={{ height: 42 }} value={f.next} onChange={set('next')} /></div>
        </div>
        <div className="field"><label htmlFor="ap-no" className="label">Notes</label><textarea id="ap-no" className="input" rows={3} value={f.notes} onChange={set('notes')} placeholder="Who referred you, interview rounds, salary discussed…" /></div>
        <div className="row g8">
          <button type="submit" className="btn btn-signal" disabled={!f.company.trim() || !f.role.trim()}>Save</button>
          {app.id && <button type="button" className="btn btn-ghost" style={{ color: 'var(--danger)' }} onClick={onDelete}>Delete</button>}
        </div>
      </form>
    </Dialog>
  );
}

export default function MeJobs() {
  const me = useMe();
  const [t] = useLang();
  const toast = useToast();
  const nav = useNavigate();
  const [edit, setEdit] = useState(null);
  const [filter, setFilter] = useState(null);
  const apps = me.apps;
  const stages = (a) => APP_STAGES.filter(([k]) => !['viewed', 'no_reply'].includes(k) || a.status === k); // set by the company / by Nm7
  const move = (a, dir) => { const st = stages(a); const i = st.findIndex(([k]) => k === a.status); const n = st[Math.min(st.length - 1, Math.max(0, i + dir))][0]; setMe((s) => ({ apps: s.apps.map((x) => (x.id === a.id ? { ...x, status: n } : x)) })); };
  const due = (a) => ['applied', 'viewed'].includes(a.status) && (a.followUp || Date.now() - a.date > 7 * DAY) && !a.followed;
  const sent = apps.filter((a) => a.status !== 'saved');
  const iv = apps.filter((a) => ['interview', 'offer'].includes(a.status)).length;
  const weeks = Array.from({ length: 6 }, (_, i) => { const end = Date.now() - (5 - i) * 7 * DAY; const start = end - 7 * DAY; return { label: i === 5 ? 'This wk' : fmtShort(start), sent: sent.filter((a) => a.date > start && a.date <= end).length }; });
  const cols = APP_STAGES.filter(([k]) => k !== 'no_reply' || apps.some((a) => a.status === k)); // Closed (no reply) only when there are some
  const resumeName = (id) => me.resumes.find((r) => r.id === id)?.name || '—';
  // item 37: jobs saved on the job board show in the Saved column too (they live in Saved jobs, not here)
  const [boardSaved, setBoardSaved] = useState([]);
  useEffect(() => { http('/api/me/saved-jobs').then((r) => setBoardSaved(r.items || []), () => {}); }, []);
  const appliedJobs = new Set(apps.map((a) => a.jobId).filter(Boolean));
  const savedOnBoard = boardSaved.filter((j) => !appliedJobs.has(j.id));

  const TONE = { saved: 'neutral', applied: 'info', viewed: 'info', shortlisted: 'accent', interview: 'warn', offer: 'ok', rejected: 'bad', no_reply: 'neutral' };
  const countOf = (k) => apps.filter((a) => a.status === k).length + (k === 'saved' ? savedOnBoard.length : 0);
  const shown = cols.filter(([k]) => (filter ? filter === k : countOf(k) > 0));
  const nothing = apps.length === 0 && savedOnBoard.length === 0;

  return (
    <>
      <MeHead title="Applications" sub="Track every job you apply to and which resume you sent. Job matches you save land here with their score." right={<span className="row g8"><Link to="/me/auto-apply" className="btn btn-outline" data-testid="jobs-auto-apply">{t('aa.link')}</Link><button type="button" className="btn btn-signal" onClick={() => setEdit({})}>Add application</button></span>} />
      <div className="mjobs-top">
        <MeCard title="Where your applications are" sub="Tap a step to see only those jobs. Tap it again to see all." icon={<IcBriefcase />} className="mjobs-pipe">
          <Pipeline label="Applications by step" steps={cols.map(([k, l]) => ({ key: k, label: l, count: countOf(k), tone: TONE[k] }))} active={filter} onPick={setFilter} />
        </MeCard>
        <div className="mjobs-stats">
          <Stat label="Applied" value={sent.length} sub="excluding saved" />
          <Stat label="Interview rate" value={sent.length ? `${Math.round((iv / sent.length) * 100)}%` : '—'} sub={`${iv} reached interview or offer`} tone={iv ? 'ok' : undefined} />
          <Stat label="Follow-ups due" value={apps.filter(due).length} sub="applied 7+ days ago" tone={apps.some(due) ? 'warn' : undefined} />
        </div>
      </div>
      {nothing ? (
        <Empty shape="briefcase" title="No applications yet" action={<Link to="/jobs" className="btn btn-signal">Find a job</Link>}>
          Apply to a job on Nm7, or add one you applied to somewhere else with “Add application”. Every step shows up here.
        </Empty>
      ) : (
        <div className="mjobs-board" role="list" aria-label="Application board">
          {shown.length === 0 && <Empty compact shape="briefcase" title="Nothing at this step">Tap another step above, or tap this one again to see all.</Empty>}
          {shown.map(([k, l]) => {
            const col = apps.filter((a) => a.status === k);
            const extra = k === 'saved' ? savedOnBoard : [];
            return (
              <section key={k} className="mjobs-group" role="listitem" aria-label={`${l}: ${col.length + extra.length}`}>
                <h2 className="mjobs-gh"><Chip tone={TONE[k]}>{l}</Chip><span className="mjobs-gn" data-testid={`col-count-${k}`}>{col.length + extra.length}</span></h2>
                <div className="mjobs-cards">
                  {extra.map((j) => (
                    <article key={`job-${j.id}`} className="mjob" data-testid="saved-board-job">
                      <div className="mjob-top">
                        <span className="mavatar" aria-hidden="true">{(j.company?.name || '?').slice(0, 1).toUpperCase()}</span>
                        <span className="mjob-name"><Link to={`/jobs/${j.slug}`} className="mjob-co">{j.company?.name}</Link><span className="mjob-role">{j.title}</span></span>
                      </div>
                      <span className="mjob-meta">Saved on the job board</span>
                    </article>
                  ))}
                  {col.map((a) => (
                    <article key={a.id} className={`mjob ${due(a) ? 'mjob-due' : ''}`}>
                      <div className="mjob-top">
                        <span className="mavatar" aria-hidden="true">{(a.company || '?').slice(0, 1).toUpperCase()}</span>
                        <span className="mjob-name">
                          <button type="button" className="link-btn mjob-co" onClick={() => setEdit(a)}>{a.company}</button>
                          <span className="mjob-role">{a.role}</span>
                        </span>
                      </div>
                      {(a.channel || a.score != null) && (
                        <span className="mjob-chips">
                          {a.channel && <Chip tone="info" testid="app-channel">{a.sentEmail ? t('aa.items.sentByEmail') : CHANNEL[a.channel]}</Chip>}
                          {a.origin === 'auto' && <Chip tone="accent" testid="app-auto">{t('aa.badge.auto')}</Chip>}
                          {a.score != null && <Chip tone={a.score >= 70 ? 'ok' : 'warn'} testid="app-score">Job match {a.score}/100</Chip>}
                        </span>
                      )}
                      <span className="mjob-meta">{fmtDay(a.date)} · {a.resumeName || resumeName(a.resumeId)}</span>
                      {a.next && <span className="mjob-next"><IcCalendar size={14} /> Next: {fmtShort(a.next)}</span>}
                      {due(a) && <span className="mjob-follow"><IcClock size={14} /> Follow up? <button type="button" className="link-btn xs" onClick={() => { setMe((s) => ({ apps: s.apps.map((x) => (x.id === a.id ? { ...x, followed: Date.now(), notes: `${x.notes ? `${x.notes}\n` : ''}Followed up ${fmtDay(Date.now())}.` } : x)) })); toast('Marked as followed up'); }}>Done</button></span>}
                      {a.sentEmail && <details className="xs mjob-more" data-testid="app-sent-email"><summary>{t('aa.items.whatSent')}</summary><div className="stack g4" style={{ marginTop: 4 }}><span>{t('aa.items.sentTo', { to: a.sentEmail.to })}</span><strong>{a.sentEmail.subject}</strong><span style={{ whiteSpace: 'pre-line' }}>{a.sentEmail.text}</span>{a.sentEmail.attachment && <span className="muted"><IcClip size={14} /> {a.sentEmail.attachment}</span>}</div></details>}
                      {a.timeline?.length > 1 && <ol className="app-steps xs" aria-label={`Steps for ${a.company}`}>{a.timeline.map((s, i) => <li key={i}>{APP_STAGES.find(([x]) => x === s.status)?.[1] || s.status} · {fmtShort(s.at)}</li>)}</ol>}
                      {(webLink(a.url) || (a.tailoredResumeId && me.resumes.some((r) => r.id === a.tailoredResumeId)) || a.matchId) && (
                        <span className="mjob-links">
                          {webLink(a.url) && <a className="xs" href={webLink(a.url)} target="_blank" rel="noopener noreferrer" style={{ overflowWrap: 'anywhere' }}>Job post <IcExternal size={14} /><span className="sr-only"> for {a.company} (opens in a new tab)</span></a>}
                          {a.tailoredResumeId && me.resumes.some((r) => r.id === a.tailoredResumeId) && <button type="button" className="link-btn xs" style={{ textAlign: 'left' }} onClick={() => { openInBuilder(a.tailoredResumeId); nav('/builder', { state: { open: 'build' } }); }}>Open the tailored copy</button>}
                          {a.matchId && <button type="button" className="link-btn xs" style={{ textAlign: 'left' }} onClick={() => nav(`/me/interview/${a.matchId}`)}>Interview prep</button>}
                        </span>
                      )}
                      {a.toCompany && <Withdraw a={a} toast={toast} />}
                      {a.status === 'no_reply' && <span className="xs" data-testid="no-reply-note">The company didn’t reply in time, so Nm7 closed this. It isn’t about you.</span>}
                      {a.channel === 'nm7' ? <span className="mjob-foot xs faint">Updated by the company</span> : (
                        <span className="mjob-foot mjob-move">
                          <span className="xs faint">Move to</span>
                          <button type="button" className="btn btn-icon" aria-label={`Move ${a.company} back`} disabled={k === stages(a)[0][0]} onClick={() => move(a, -1)}><IcArrowLeft /></button>
                          <button type="button" className="btn btn-icon" aria-label={`Move ${a.company} forward`} disabled={k === stages(a)[stages(a).length - 1][0]} onClick={() => move(a, 1)}><IcArrowRight /></button>
                        </span>
                      )}
                    </article>
                  ))}
                </div>
              </section>
            );
          })}
        </div>
      )}
      <MeCard label="Applications sent per week" className="mcard-flat"><BarChart title="Applications sent per week" data={weeks} series={[{ key: 'sent', label: 'Applications', color: 'var(--viz-1)' }]} height={150} /></MeCard>
      {edit && <AppForm app={edit} resumes={me.resumes} onClose={() => setEdit(null)}
        onSave={(a) => { setMe((s) => ({ apps: s.apps.some((x) => x.id === a.id) ? s.apps.map((x) => (x.id === a.id ? a : x)) : [...s.apps, a] })); setEdit(null); toast('Saved'); }}
        onDelete={() => { setMe((s) => ({ apps: s.apps.filter((x) => x.id !== edit.id) })); setEdit(null); toast('Deleted'); }} />}
    </>
  );
}

/** Applications sent on Nm7 to a company's own job: withdraw takes back consent; the company no longer sees it. */
function Withdraw({ a, toast }) {
  const [ask, setAsk] = useState(false);
  const [busy, setBusy] = useState(false);
  if (a.withdrawn) return <span className="xs muted" data-testid="withdrawn">Withdrawn: the company no longer sees this application.</span>;
  if (!ask) return <button type="button" className="link-btn xs" style={{ textAlign: 'left' }} onClick={() => setAsk(true)}>Withdraw application</button>;
  const go = async () => {
    setBusy(true);
    try { await http(`/api/me/applications/${encodeURIComponent(a.id)}/withdraw`, { method: 'POST' }); toast('Withdrawn'); reloadMe(); } catch (e) { toast(e.message); setBusy(false); }
  };
  return (
    <span className="stack g4 xs" role="alert">
      <span>The company will no longer see your resume or answers for this job.</span>
      <span className="row g8"><button type="button" className="btn btn-outline" style={{ minHeight: 30, height: 30 }} disabled={busy} onClick={go}>Withdraw</button>
        <button type="button" className="link-btn xs" onClick={() => setAsk(false)}>Keep it</button></span>
    </span>
  );
}
