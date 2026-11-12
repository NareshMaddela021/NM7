// The Jobs tab of the company dashboard (Phase 2, C3): the company's jobs (live, waiting for review, paused, closed)
// and the posting form. "Check" shows what Nm7 would do before posting: unfair wording (can't be posted), scam signs
// (waits for our team), fresher-fit warnings and a duplicate open job. "Write it for me" turns 3 lines into a
// description and never adds a salary, perks or company facts that weren't typed. A live job can be edited twice.
// No pop-up dialogs. English, Telugu and Hindi (co.jobs.*, jobs.*).
import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { rq } from '../../lib/company';
import { EXPERIENCE, JOB_TYPES, WORK_TYPES, salaryText } from '../../lib/jobBoard';

const BLANK = { title: '', cities: '', workType: 'onsite', jobType: 'full_time', experience: 'fresher', education: '', salaryMin: '', salaryMax: '', period: 'yearly', skills: '', description: '', applyMethod: 'nm7', applyUrl: '', applyEmail: '', closesAt: '', questions: [] };
const NEW_Q = { text: '', kind: 'yesno', options: '', want: '', min: '', accept: '' };
const MAX_Q = 5;
const csv = (s) => String(s || '').split(',').map((x) => x.trim()).filter(Boolean);
/** Screening questions as the API takes them (the rules are only seen by the company). */
export const questionsBody = (qs) => qs.filter((q) => q.text.trim()).map((q) => ({
  text: q.text.trim(), kind: q.kind,
  ...(q.kind === 'yesno' ? { want: q.want } : {}),
  ...(q.kind === 'number' && String(q.min).trim() !== '' ? { min: Number(q.min) } : {}),
  ...(q.kind === 'choice' ? { options: csv(q.options), accept: csv(q.accept) } : {}),
}));
const questionsForm = (qs) => (qs || []).map((q) => ({ text: q.text, kind: q.kind, options: (q.options || []).join(', '), want: q.want || '', min: q.min ?? '', accept: (q.accept || []).join(', ') }));
const TONE = { active: 'b-success', review: 'b-warning', paused: 'b-neutral', closed: 'b-danger' };

const EDU = ['', '10th', '12th', 'iti', 'diploma', 'graduate', 'postgraduate'];

/** "Start from a template" (Phase 5, H8): IT and non-IT roles; the salary stays blank for the company to fill. */
function Templates({ t, onPick }) {
  const [list, setList] = useState([]);
  useEffect(() => { rq('/api/hire/templates').then(setList, () => setList([])); }, []);
  if (!list.length) return null;
  return (
    <div className="field">
      <label className="label" htmlFor="cj-tpl">{t('co.jobs.template')}</label>
      <select id="cj-tpl" className="input" defaultValue="" onChange={(e) => { const x = list.find((y) => y.id === e.target.value); if (x) onPick(x); }} data-testid="cj-template">
        <option value="">{t('co.jobs.templateNone')}</option>
        {[...new Set(list.map((x) => x.domain))].map((d) => <optgroup key={d} label={d}>{list.filter((x) => x.domain === d).map((x) => <option key={x.id} value={x.id}>{x.title}</option>)}</optgroup>)}
      </select>
    </div>
  );
}

function toBody(f) {
  const list = (s) => s.split(',').map((x) => x.trim()).filter(Boolean);
  const num = (v) => (String(v).trim() ? Number(String(v).replace(/[^\d]/g, '')) : null);
  const salary = num(f.salaryMin) != null || num(f.salaryMax) != null ? { min: num(f.salaryMin), max: num(f.salaryMax), period: f.period } : null;
  return {
    title: f.title, locations: f.workType === 'remote' && !f.cities.trim() ? [] : list(f.cities), workType: f.workType, jobType: f.jobType, experience: f.experience, education: f.education || '',
    salary, skills: list(f.skills), description: f.description, applyMethod: f.applyMethod,
    applyUrl: f.applyMethod === 'link' ? f.applyUrl : '', applyEmail: f.applyMethod === 'email' ? f.applyEmail : '',
    ...(f.closesAt ? { closesAt: new Date(`${f.closesAt}T23:59:00+05:30`).toISOString() } : {}),
    questions: f.applyMethod === 'nm7' ? questionsBody(f.questions || []) : [],
  };
}

function fromJob(j) {
  return {
    title: j.title, cities: (j.locations || []).join(', '), workType: j.workType, jobType: j.jobType, experience: j.experience, education: j.education || '',
    salaryMin: j.salary?.min ?? '', salaryMax: j.salary?.max ?? '', period: j.salary?.period || 'yearly', skills: (j.skills || []).join(', '),
    description: j.description, applyMethod: j.apply.method, applyUrl: j.apply.url || '', applyEmail: j.apply.email || '',
    closesAt: j.closesAt ? new Date(j.closesAt).toISOString().slice(0, 10) : '',
    questions: questionsForm(j.questions),
  };
}

export default function CompanyJobs({ t, c }) {
  const [jobs, setJobs] = useState(null);
  const [room, setRoom] = useState(null);
  const [form, setForm] = useState(null); // { id?, f }
  const can = ['main', 'full', 'posting'].includes(c.myRole);
  const load = useCallback(() => {
    rq(`/api/company/${c.id}/jobs`).then(setJobs, () => setJobs([]));
    rq(`/api/company/${c.id}/room`).then(setRoom, () => {});
  }, [c.id]);
  useEffect(() => { load(); }, [load]);
  if (!jobs) return <p className="muted">{t('co.loading')}</p>;
  return (
    <section className="stack g12" aria-label={t('co.dash.tab.jobs')} data-testid="co-jobs">
      <div className="row g8" style={{ justifyContent: 'space-between' }}>
        {room && <span className="small" data-testid="co-jobs-room">{room.allowed ? t(`co.room.${room.period}`, { used: room.used, limit: room.limit }) : room.reason}</span>}
        {can && !form && <button type="button" className="btn btn-ink" disabled={room && !room.allowed} onClick={() => setForm({ f: { ...BLANK } })}>{t('co.jobs.post')}</button>}
      </div>
      {form && <JobForm t={t} c={c} init={form} onDone={(msg) => { setForm(null); load(); if (msg) setJobs((x) => x); }} onCancel={() => setForm(null)} />}
      {jobs.length === 0 && !form && <p className="card-sm small muted" style={{ margin: 0 }}>{t('co.jobs.none')}</p>}
      <ul className="stack g12" style={{ listStyle: 'none', margin: 0, padding: 0 }}>
        {jobs.map((j) => <JobRow key={j.id} t={t} c={c} j={j} can={can} onEdit={() => setForm({ id: j.id, f: fromJob(j), editsLeft: j.editsLeft, live: j.status === 'active' })} onChanged={load} />)}
      </ul>
    </section>
  );
}

function JobRow({ t, c, j, can, onEdit, onChanged }) {
  const [closing, setClosing] = useState(false);
  const [err, setErr] = useState('');
  const status = async (s) => { setErr(''); try { await rq(`/api/company/${c.id}/jobs/${j.id}/status`, { method: 'POST', body: { status: s } }); setClosing(false); onChanged(); } catch (x) { setErr(x.message); } };
  return (
    <li className="card-sm stack g8" data-testid="co-job">
      <div className="row g8" style={{ justifyContent: 'space-between' }}>
        <strong style={{ overflowWrap: 'anywhere' }}>{j.title}</strong>
        <span className={`badge ${TONE[j.status]}`} data-testid="co-job-status">{t(`co.jobs.status.${j.status}`)}</span>
      </div>
      <span className="xs muted">{[(j.locations || []).join(', ') || (j.remote ? t('jobs.remote') : ''), t(`jobs.exp.${j.experience}`), t(`jobs.type.${j.jobType}`), salaryText(j.salary, t)].filter((x, i, all) => x && all.indexOf(x) === i).join(' · ')}</span>
      {j.status === 'review' && <p className="xs" style={{ margin: 0, color: 'var(--warning)' }}>{t('co.jobs.reviewNote')}</p>}
      {j.status === 'closed' && j.closedReason && <p className="xs muted" style={{ margin: 0 }}>{j.closedReason}</p>}
      {can && j.status !== 'closed' && (
        <div className="row g8">
          {j.status === 'active' && <Link to={`/jobs/${j.slug}`} className="link-btn small">{t('co.jobs.view')}</Link>}
          {(j.status !== 'active' || j.editsLeft > 0) && <button type="button" className="link-btn small" onClick={onEdit}>{t('co.jobs.edit')}{j.status === 'active' ? ` (${t('co.jobs.editsLeft', { n: j.editsLeft })})` : ''}</button>}
          {j.status === 'active' && <button type="button" className="link-btn small" onClick={() => status('paused')}>{t('co.jobs.pause')}</button>}
          {j.status === 'paused' && <button type="button" className="link-btn small" onClick={() => status('active')}>{t('co.jobs.resume')}</button>}
          {closing ? (
            <span className="row g4" role="alert"><span className="xs">{t('co.jobs.closeAsk')}</span>
              <button type="button" className="btn btn-outline" onClick={() => status('closed')}>{t('co.jobs.close')}</button>
              <button type="button" className="link-btn small" onClick={() => setClosing(false)}>{t('co.cancel')}</button></span>
          ) : <button type="button" className="link-btn small" onClick={() => setClosing(true)}>{t('co.jobs.close')}</button>}
        </div>
      )}
      {err && <p className="error" role="alert">{err}</p>}
    </li>
  );
}

function JobForm({ t, c, init, onDone, onCancel }) {
  const [f, setF] = useState(init.f);
  const [check, setCheck] = useState(null);
  const [busy, setBusy] = useState('');
  const [err, setErr] = useState('');
  const [writer, setWriter] = useState({ open: false, role: init.f.title, skills: init.f.skills, place: '', duties: '' });
  const [note, setNote] = useState('');
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const run = async (what, fn) => { setBusy(what); setErr(''); try { await fn(); } catch (x) { setErr(x.message); } finally { setBusy(''); } };
  const doCheck = () => run('check', async () => setCheck(await rq(`/api/company/${c.id}/jobs/check`, { method: 'POST', body: { job: toBody(f) } })));
  const write = () => run('write', async () => {
    // the title the company typed stays word for word; only the duties they typed are used (fix round item 20)
    const role = (f.title.trim() || writer.role).trim();
    const r = await rq(`/api/company/${c.id}/jobs/write`, { method: 'POST', body: { role, skills: writer.skills, place: writer.place, duties: writer.duties } });
    setF({ ...f, description: r.description, title: f.title || writer.role, skills: f.skills || writer.skills });
    setNote(r.source === 'ai' ? t('co.jobs.writerAi') : r.removed.length ? t('co.jobs.writerRemoved') : t('co.jobs.writerTemplate'));
  });
  const submit = (e) => {
    e.preventDefault();
    run('post', async () => {
      const r = init.id
        ? await rq(`/api/company/${c.id}/jobs/${init.id}`, { method: 'PUT', body: { job: toBody(f) } })
        : await rq(`/api/company/${c.id}/jobs`, { method: 'POST', body: { job: toBody(f) } });
      onDone(r.status);
    });
  };
  const blocked = check?.blocked?.length > 0;
  return (
    <form className="card stack g12" onSubmit={submit} aria-label={init.id ? t('co.jobs.editTitle') : t('co.jobs.post')} data-testid="co-job-form">
      <h2 className="co-h2">{init.id ? t('co.jobs.editTitle') : t('co.jobs.post')}</h2>
      {init.live && <p className="xs muted" style={{ margin: 0 }}>{t('co.jobs.editsNote', { n: init.editsLeft })}</p>}
      {!init.id && <Templates t={t} onPick={(x) => setF({ ...f, title: x.title, jobType: x.jobType, experience: x.experience, education: x.education, skills: x.skills.join(', '), description: x.description })} />}
      <div className="field"><label className="label" htmlFor="cj-title">{t('co.jobs.f.title')}</label><input id="cj-title" className="input" required minLength={2} maxLength={120} value={f.title} onChange={set('title')} /></div>
      <details className="card-sm" open={writer.open} onToggle={(e) => setWriter({ ...writer, open: e.currentTarget.open })}>
        <summary className="small"><strong>{t('co.jobs.writer')}</strong></summary>
        <div className="stack g8" style={{ marginTop: 8 }}>
          <span className="xs muted">{t('co.jobs.writerHint')}</span>
          {!f.title.trim() && <div className="field"><label className="label" htmlFor="cw-role">{t('co.jobs.w.role')}</label><input id="cw-role" className="input" maxLength={120} value={writer.role} onChange={(e) => setWriter({ ...writer, role: e.target.value })} /></div>}
          <div className="field"><label className="label" htmlFor="cw-skills">{t('co.jobs.w.skills')}</label><input id="cw-skills" className="input" maxLength={300} value={writer.skills} onChange={(e) => setWriter({ ...writer, skills: e.target.value })} /></div>
          <div className="field"><label className="label" htmlFor="cw-duties">{t('co.jobs.w.duties')}</label><textarea id="cw-duties" className="input" rows={3} maxLength={1500} value={writer.duties} onChange={(e) => setWriter({ ...writer, duties: e.target.value })} /></div>
          <div className="field"><label className="label" htmlFor="cw-place">{t('co.jobs.w.place')}</label><input id="cw-place" className="input" maxLength={200} value={writer.place} onChange={(e) => setWriter({ ...writer, place: e.target.value })} /></div>
          <button type="button" className="btn btn-outline" style={{ alignSelf: 'flex-start' }} disabled={!!busy || (f.title.trim() || writer.role).trim().length < 2} onClick={write}>{busy === 'write' ? t('co.wait') : t('co.jobs.writeIt')}</button>
        </div>
      </details>
      {note && <p className="xs" role="status" style={{ margin: 0 }} data-testid="co-writer-note">{note}</p>}
      <div className="field"><label className="label" htmlFor="cj-desc">{t('co.jobs.f.description')}</label><textarea id="cj-desc" className="input" rows={8} required minLength={30} maxLength={20000} value={f.description} onChange={set('description')} /></div>
      <div className="co-grid">
        <div className="field"><label className="label" htmlFor="cj-cities">{t('co.jobs.f.cities')}</label><input id="cj-cities" className="input" value={f.cities} onChange={set('cities')} /></div>
        <div className="field"><label className="label" htmlFor="cj-work">{t('jobs.f.workType')}</label><select id="cj-work" className="input" value={f.workType} onChange={set('workType')}>{WORK_TYPES.map((x) => <option key={x} value={x}>{t(`jobs.work.${x}`)}</option>)}</select></div>
        <div className="field"><label className="label" htmlFor="cj-type">{t('jobs.f.jobType')}</label><select id="cj-type" className="input" value={f.jobType} onChange={set('jobType')}>{JOB_TYPES.map((x) => <option key={x} value={x}>{t(`jobs.type.${x}`)}</option>)}</select></div>
        <div className="field"><label className="label" htmlFor="cj-exp">{t('jobs.f.experience')}</label><select id="cj-exp" className="input" value={f.experience} onChange={set('experience')}>{EXPERIENCE.map((x) => <option key={x} value={x}>{t(`jobs.exp.${x}`)}</option>)}</select></div>
        <div className="field"><label className="label" htmlFor="cj-edu">{t('jobs.f.education')}</label><select id="cj-edu" className="input" value={f.education || ''} onChange={set('education')} data-testid="cj-edu">{EDU.map((x) => <option key={x} value={x}>{t(`jobs.edu.${x || 'any'}`)}</option>)}</select></div>
        <div className="field"><label className="label" htmlFor="cj-min">{t('co.jobs.f.salaryMin')}</label><input id="cj-min" className="input" inputMode="numeric" value={f.salaryMin} onChange={set('salaryMin')} /></div>
        <div className="field"><label className="label" htmlFor="cj-max">{t('co.jobs.f.salaryMax')}</label><input id="cj-max" className="input" inputMode="numeric" value={f.salaryMax} onChange={set('salaryMax')} /></div>
        <div className="field"><label className="label" htmlFor="cj-per">{t('co.jobs.f.per')}</label><select id="cj-per" className="input" value={f.period} onChange={set('period')}><option value="yearly">{t('jobs.perYear')}</option><option value="monthly">{t('jobs.perMonth')}</option></select></div>
        <div className="field"><label className="label" htmlFor="cj-close">{t('co.jobs.f.closes')}</label><input id="cj-close" type="date" className="input" value={f.closesAt} onChange={set('closesAt')} /></div>
      </div>
      <div className="field"><label className="label" htmlFor="cj-skills">{t('co.jobs.f.skills')}</label><input id="cj-skills" className="input" value={f.skills} onChange={set('skills')} /></div>
      <div className="co-grid">
        <div className="field"><label className="label" htmlFor="cj-apply">{t('co.jobs.f.apply')}</label>
          <select id="cj-apply" className="input" value={f.applyMethod} onChange={set('applyMethod')}><option value="nm7">{t('co.jobs.applyNm7')}</option><option value="link">{t('co.jobs.applyLink')}</option><option value="email">{t('co.jobs.applyEmail')}</option></select></div>
        {f.applyMethod === 'link' && <div className="field"><label className="label" htmlFor="cj-url">{t('co.jobs.f.url')}</label><input id="cj-url" className="input" inputMode="url" required value={f.applyUrl} onChange={set('applyUrl')} /></div>}
        {f.applyMethod === 'email' && <div className="field"><label className="label" htmlFor="cj-mail">{t('co.jobs.f.email')}</label><input id="cj-mail" type="email" className="input" required value={f.applyEmail} onChange={set('applyEmail')} /></div>}
      </div>
      {f.applyMethod === 'nm7' && <Questions t={t} qs={f.questions || []} onChange={(questions) => setF({ ...f, questions })} />}
      {check && (
        <div className="card-sm stack g4" role="status" data-testid="co-job-check">
          {check.errors.map((x, i) => <span key={`e${i}`} className="small" style={{ color: 'var(--danger)' }}>{x}</span>)}
          {check.blocked.length > 0 && <span className="small" style={{ color: 'var(--danger)' }}>{t('co.jobs.blocked', { list: check.blocked.join(', ') })}</span>}
          {check.scam.length > 0 && <span className="small" style={{ color: 'var(--warning)' }}>{t('co.jobs.scam', { list: check.scam.join(', ') })}</span>}
          {check.warnings.map((x, i) => <span key={`w${i}`} className="small" style={{ color: 'var(--warning)' }}>{x}</span>)}
          {check.duplicate && <span className="small" style={{ color: 'var(--danger)' }}>{t('co.jobs.duplicate')}</span>}
          {!check.errors.length && !blocked && !check.scam.length && !check.warnings.length && !check.duplicate && <span className="small" style={{ color: 'var(--success)' }}>{t('co.jobs.checkOk')}</span>}
        </div>
      )}
      <div className="row g8">
        <button type="button" className="btn btn-outline" disabled={!!busy} onClick={doCheck}>{busy === 'check' ? t('co.wait') : t('co.jobs.check')}</button>
        <button type="submit" className="btn btn-ink" disabled={!!busy || blocked}>{busy === 'post' ? t('co.wait') : init.id ? t('co.dash.save') : t('co.jobs.postNow')}</button>
        <button type="button" className="link-btn small" onClick={onCancel}>{t('co.cancel')}</button>
      </div>
      {err && <p className="error" role="alert">{err}</p>}
    </form>
  );
}

/** Up to 5 screening questions. An answer that doesn't fit only adds a "Not a fit" label: the company still sees everyone. */
function Questions({ t, qs, onChange }) {
  const put = (i, patch) => onChange(qs.map((q, k) => (k === i ? { ...q, ...patch } : q)));
  return (
    <fieldset className="card-sm stack g8" data-testid="co-questions" style={{ border: 0, margin: 0 }}>
      <legend className="small"><strong>{t('co.q.title')}</strong></legend>
      <span className="xs muted">{t('co.q.hint')}</span>
      {qs.map((q, i) => (
        <div key={i} className="stack g8 well" data-testid="co-question">
          <div className="field"><label className="label" htmlFor={`cq-t${i}`}>{t('co.q.text', { n: i + 1 })}</label><input id={`cq-t${i}`} className="input" maxLength={200} value={q.text} onChange={(e) => put(i, { text: e.target.value })} /></div>
          <div className="co-grid">
            <div className="field"><label className="label" htmlFor={`cq-k${i}`}>{t('co.q.kind')}</label>
              <select id={`cq-k${i}`} className="input" value={q.kind} onChange={(e) => put(i, { kind: e.target.value })}>{['yesno', 'number', 'choice'].map((k) => <option key={k} value={k}>{t(`co.q.kind.${k}`)}</option>)}</select></div>
            {q.kind === 'yesno' && <div className="field"><label className="label" htmlFor={`cq-w${i}`}>{t('co.q.want')}</label>
              <select id={`cq-w${i}`} className="input" value={q.want} onChange={(e) => put(i, { want: e.target.value })}><option value="">{t('co.q.any')}</option><option value="yes">{t('co.q.yes')}</option><option value="no">{t('co.q.no')}</option></select></div>}
            {q.kind === 'number' && <div className="field"><label className="label" htmlFor={`cq-m${i}`}>{t('co.q.min')}</label><input id={`cq-m${i}`} className="input" inputMode="numeric" value={q.min} onChange={(e) => put(i, { min: e.target.value.replace(/[^\d]/g, '') })} /></div>}
          </div>
          {q.kind === 'choice' && <>
            <div className="field"><label className="label" htmlFor={`cq-o${i}`}>{t('co.q.options')}</label><input id={`cq-o${i}`} className="input" value={q.options} onChange={(e) => put(i, { options: e.target.value })} /></div>
            <div className="field"><label className="label" htmlFor={`cq-a${i}`}>{t('co.q.accept')}</label><input id={`cq-a${i}`} className="input" value={q.accept} onChange={(e) => put(i, { accept: e.target.value })} /></div>
          </>}
          <button type="button" className="link-btn small" style={{ alignSelf: 'flex-start' }} onClick={() => onChange(qs.filter((_, k) => k !== i))}>{t('co.q.remove')}</button>
        </div>
      ))}
      {qs.length < MAX_Q && <button type="button" className="btn btn-outline" style={{ alignSelf: 'flex-start' }} onClick={() => onChange([...qs, { ...NEW_Q }])}>{t('co.q.add')}</button>}
    </fieldset>
  );
}
