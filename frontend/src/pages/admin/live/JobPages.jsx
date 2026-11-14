// Admin → Jobs (job board J1): every job on nm7.si/jobs. Search and filter, add or edit one, pause, close, reopen,
// delete (confirmed here on the page), bulk import (JSON array or CSV, preview with per-row errors first), the jobs
// whose apply link failed its check, who applied, and jobs students reported (3 reports pause a job). Every change is in
// the audit log.
import { useState } from 'react';
import { useToast } from '../../../components/ui';
import { Kpi, PageHead, Panel, Tabs } from '../AdminUI';
import { Loading, day, emptyIf, http, useAction, useApi, when } from './common';

const WORK = { onsite: 'On-site', hybrid: 'Hybrid', remote: 'Remote' };
const TYPE = { full_time: 'Full-time', internship: 'Internship', contract: 'Contract', part_time: 'Part-time' };
const EXP = { internship: 'Internship', fresher: 'Fresher', '0_1': '0–1 years', '1_3': '1–3 years', '3_5': '3–5 years', '5_8': '5–8 years', '8_12': '8–12 years', '12_15': '12–15 years', '15_plus': '15+ years', not_stated: 'Experience not stated' };
const EXP_OLD = { '3_plus': '3+ years (older jobs)' }; // shown and filterable, never offered for a new job (round J2)
const APPLY = { link: 'Company website', email: 'By email', nm7: 'Apply on Nm7' };
const SOURCE = { collector: 'Job collector', admin: 'Added here', bulk: 'Bulk import', company: 'Company' };
const STATUS = { active: ['Active', 'b-success'], paused: ['Paused', 'b-neutral'], closed: ['Closed', 'b-warning'], review: ['Waiting for review', 'b-danger'] };
const inr = (n) => `₹${Number(n).toLocaleString('en-IN')}`;
export const salaryText = (s) => (!s ? '' : `${s.min ? inr(s.min) : ''}${s.min && s.max ? ' – ' : ''}${s.max ? inr(s.max) : ''} ${s.period === 'monthly' ? 'a month' : 'a year'}`.trim());

const BLANK = { title: '', company: { name: '', website: '', logo: '' }, locations: '', workType: 'onsite', jobType: 'full_time', experience: 'fresher', salaryMin: '', salaryMax: '', salaryPeriod: 'yearly', skills: '', description: '', applyMethod: 'link', applyUrl: '', applyEmail: '', status: 'active', closesAt: '' };

function toForm(j) {
  return {
    title: j.title, company: { name: j.company.name, website: j.company.website || '', logo: j.company.logo || '' },
    locations: (j.locations || []).join(', '), workType: j.workType, jobType: j.jobType, experience: j.experience,
    salaryMin: j.salary?.min ?? '', salaryMax: j.salary?.max ?? '', salaryPeriod: j.salary?.period || 'yearly',
    skills: (j.skills || []).join(', '), description: j.description || '', applyMethod: j.apply.method,
    applyUrl: j.apply.url || '', applyEmail: j.apply.email || '', status: j.status,
    closesAt: j.closesAt ? new Date(j.closesAt).toISOString().slice(0, 10) : '',
  };
}
function toBody(f) {
  const list = (s) => s.split(',').map((x) => x.trim()).filter(Boolean);
  const num = (v) => (v === '' || v == null ? null : Number(v));
  return {
    title: f.title, company: f.company, locations: f.workType === 'remote' && !f.locations.trim() ? [] : list(f.locations),
    workType: f.workType, jobType: f.jobType, experience: f.experience,
    salary: num(f.salaryMin) || num(f.salaryMax) ? { min: num(f.salaryMin), max: num(f.salaryMax), period: f.salaryPeriod } : null,
    skills: list(f.skills), description: f.description, applyMethod: f.applyMethod,
    applyUrl: f.applyMethod === 'link' ? f.applyUrl.trim() : '', applyEmail: f.applyMethod === 'email' ? f.applyEmail.trim() : '',
    status: f.status, closesAt: f.closesAt ? `${f.closesAt}T23:59:59+05:30` : null,
  };
}

export function LiveJobs() {
  const [tab, setTab] = useState('jobs');
  return (
    <>
      <PageHead title="Jobs" sub="Every job on nm7.si/jobs: from the morning job collector, added here, or bulk imported. Changes are in the audit log." />
      <Tabs label="Show" tabs={[['jobs', 'Jobs'], ['collector', 'Collector review'], ['reports', 'Reports'], ['removals', 'Removal requests'], ['import', 'Bulk import'], ['expired', 'Expired links']]} value={tab} onChange={setTab} />
      {tab === 'jobs' && <JobList />}
      {tab === 'import' && <BulkImport onDone={() => setTab('jobs')} />}
      {tab === 'expired' && <Expired />}
      {tab === 'reports' && <Reports />}
      {tab === 'removals' && <Removals />}
      {tab === 'collector' && <CollectorReview />}
    </>
  );
}

function JobList() {
  const toast = useToast();
  const [f, setF] = useState({ q: '', status: '', source: '', experience: '' });
  const [applied, setApplied] = useState(f);
  const [page, setPage] = useState(1);
  const qs = new URLSearchParams({ ...Object.fromEntries(Object.entries(applied).filter(([, v]) => v)), page: String(page) });
  const st = useApi(`/api/admin/jobs?${qs}`);
  const [busy, run] = useAction(toast);
  const [editing, setEditing] = useState(null); // 'new' | job id
  const [confirm, setConfirm] = useState(null); // job id to delete
  const [apps, setApps] = useState(null); // job
  const setStatus = (j, status) => run(async () => { await http(`/api/admin/jobs/${j.id}/status`, { method: 'POST', body: { status } }); st.reload(); }, { active: 'Job is live again', paused: 'Job paused', closed: 'Job closed' }[status]);
  const remove = (j) => run(async () => { await http(`/api/admin/jobs/${j.id}`, { method: 'DELETE' }); setConfirm(null); st.reload(); }, 'Job deleted');
  return (
    <div className="row g16" style={{ alignItems: 'flex-start', flexWrap: 'wrap' }}>
      <div className="stack g12" style={{ flex: '3 1 520px', minWidth: 0 }}>
        <form className="row g8" style={{ flexWrap: 'wrap', alignItems: 'flex-end' }} onSubmit={(e) => { e.preventDefault(); setPage(1); setApplied(f); }} aria-label="Find jobs">
          <div className="field" style={{ flex: '2 1 200px' }}><label className="label" htmlFor="aj-q">Search</label><input id="aj-q" className="input" placeholder="Title, company, city or skill" value={f.q} onChange={(e) => setF({ ...f, q: e.target.value })} /></div>
          <div className="field" style={{ flex: '1 1 120px' }}><label className="label" htmlFor="aj-st">Status</label><select id="aj-st" className="input" value={f.status} onChange={(e) => setF({ ...f, status: e.target.value })}><option value="">All</option>{Object.entries(STATUS).map(([k, [l]]) => <option key={k} value={k}>{l}</option>)}</select></div>
          <div className="field" style={{ flex: '1 1 130px' }}><label className="label" htmlFor="aj-src">Source</label><select id="aj-src" className="input" value={f.source} onChange={(e) => setF({ ...f, source: e.target.value })}><option value="">All</option>{Object.entries(SOURCE).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></div>
          <div className="field" style={{ flex: '1 1 130px' }}><label className="label" htmlFor="aj-exp">Experience</label><select id="aj-exp" className="input" value={f.experience} onChange={(e) => setF({ ...f, experience: e.target.value })}><option value="">All</option>{Object.entries({ ...EXP, ...EXP_OLD }).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></div>
          <button type="submit" className="btn btn-outline">Search</button>
          <button type="button" className="btn btn-ink" onClick={() => setEditing('new')}>Add job</button>
        </form>
        <Loading st={st} empty={emptyIf((d) => !d.items.length, 'No jobs match. Add one, or import a file.')}>{(d) => (
          <>
            <div className="row g12" style={{ flexWrap: 'wrap' }}>
              <Kpi label="Jobs" value={d.total} sub={Object.entries(d.counts.status).map(([k, n]) => `${STATUS[k]?.[0] || k} ${n}`).join(' · ')} />
              <Kpi label="By source" value={Object.values(d.counts.source).reduce((a, b) => a + b, 0)} sub={Object.entries(d.counts.source).map(([k, n]) => `${SOURCE[k] || k} ${n}`).join(' · ')} />
              <Kpi label="By experience" value={d.counts.experience.fresher || 0} sub={Object.entries(d.counts.experience).map(([k, n]) => `${EXP[k] || EXP_OLD[k] || k} ${n}`).join(' · ')} />
              <Kpi label="Job collector: waiting for review" value={d.counts.collectorReview ?? 0} sub={`${d.counts.removalRequests ?? 0} removal request${d.counts.removalRequests === 1 ? '' : 's'} open`} />
            </div>
            <ul className="stack g8" style={{ listStyle: 'none', margin: 0, padding: 0 }}>
              {d.items.map((j) => (
                <li key={j.id} className="card stack g6" data-testid="admin-job">
                  <div className="row between g8" style={{ flexWrap: 'wrap', alignItems: 'flex-start' }}>
                    <span className="stack g2" style={{ minWidth: 0 }}>
                      <strong className="small" style={{ overflowWrap: 'anywhere' }}>{j.title}</strong>
                      <span className="xs muted">{j.company.name} · {j.remote && !j.locations.length ? 'Remote' : j.locations.join(', ')} · {EXP[j.experience] || EXP_OLD[j.experience]} · {TYPE[j.jobType]}{j.salary ? ` · ${salaryText(j.salary)}` : ''}</span>
                      <span className="xs faint">{SOURCE[j.source]} · posted {day(j.postedAt)} · {APPLY[j.apply.method]}{j.linkCheck.at ? ` · link checked ${when(j.linkCheck.at)}${j.linkCheck.ok === false ? ' (failed)' : ''}` : ''}</span>
                    </span>
                    <span className="row g6" style={{ flexWrap: 'wrap' }}>{j.demo && <span className="badge b-neutral">Demo — never public</span>}<span className={`badge ${STATUS[j.status][1]}`}>{STATUS[j.status][0]}</span></span>
                  </div>
                  {j.closedReason && <span className="xs" style={{ color: 'var(--warning)' }}>{j.closedReason}</span>}
                  {confirm === j.id ? (
                    <div className="row g8 well" role="alert" style={{ flexWrap: 'wrap', alignItems: 'center' }}>
                      <span className="small">Delete “{j.title}” for good? Closing keeps it for the record.</span>
                      <button type="button" className="btn btn-ink" style={{ background: 'var(--danger)' }} disabled={busy} onClick={() => remove(j)}>Delete</button>
                      <button type="button" className="btn btn-outline" onClick={() => setConfirm(null)}>Cancel</button>
                    </div>
                  ) : (
                    j.status === 'review' ? <ReviewBox j={j} onDone={() => st.reload()} /> : <div className="row g8" style={{ flexWrap: 'wrap' }}>
                      <button type="button" className="link-btn small" onClick={() => setEditing(j.id)}>Edit</button>
                      {j.status !== 'active' && <button type="button" className="link-btn small" disabled={busy} onClick={() => setStatus(j, 'active')}>{j.status === 'closed' ? 'Reopen' : 'Make live'}</button>}
                      {j.status === 'active' && <button type="button" className="link-btn small" disabled={busy} onClick={() => setStatus(j, 'paused')}>Pause</button>}
                      {j.status !== 'closed' && <button type="button" className="link-btn small" disabled={busy} onClick={() => setStatus(j, 'closed')}>Close</button>}
                      <button type="button" className="link-btn small" onClick={() => setApps(j)}>Applications</button>
                      <button type="button" className="link-btn small" style={{ color: 'var(--danger)' }} onClick={() => setConfirm(j.id)}>Delete</button>
                    </div>
                  )}
                </li>
              ))}
            </ul>
            {d.pages > 1 && (
              <div className="row g8" style={{ alignItems: 'center' }}>
                <button type="button" className="btn btn-outline" disabled={page <= 1} onClick={() => setPage(page - 1)}>Previous</button>
                <span className="small">Page {d.page} of {d.pages}</span>
                <button type="button" className="btn btn-outline" disabled={page >= d.pages} onClick={() => setPage(page + 1)}>Next</button>
              </div>
            )}
          </>
        )}</Loading>
      </div>
      {editing && <JobForm id={editing === 'new' ? null : editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); st.reload(); }} />}
      {apps && <Applications job={apps} onClose={() => setApps(null)} />}
    </div>
  );
}

function JobForm({ id, onClose, onSaved }) {
  const toast = useToast();
  const st = useApi(id ? `/api/admin/jobs/${id}` : null);
  const [f, setF] = useState(id ? null : BLANK);
  const [busy, run] = useAction(toast);
  const [error, setError] = useState('');
  const form = f || (st.data ? toForm(st.data) : null);
  const set = (k, v) => setF({ ...form, [k]: v });
  const save = (e) => {
    e.preventDefault(); setError('');
    run(async () => {
      try {
        await http(id ? `/api/admin/jobs/${id}` : '/api/admin/jobs', { method: id ? 'PUT' : 'POST', body: toBody(form) });
        onSaved();
      } catch (err) { setError(err.message); throw err; }
    }, id ? 'Job saved' : 'Job added');
  };
  return (
    <Panel title={id ? 'Edit job' : 'Add a job'} onClose={onClose}>
      {!form ? <span className="small muted">Loading…</span> : (
        <form className="stack g12" onSubmit={save} aria-label={id ? 'Edit job' : 'Add a job'}>
          <div className="field"><label className="label" htmlFor="jf-t">Job title *</label><input id="jf-t" className="input" required maxLength={120} value={form.title} onChange={(e) => set('title', e.target.value)} /></div>
          <div className="field"><label className="label" htmlFor="jf-c">Company *</label><input id="jf-c" className="input" required maxLength={100} value={form.company.name} onChange={(e) => set('company', { ...form.company, name: e.target.value })} /></div>
          <div className="row g8" style={{ flexWrap: 'wrap' }}>
            <div className="field" style={{ flex: '1 1 160px' }}><label className="label" htmlFor="jf-w">Company website</label><input id="jf-w" className="input" value={form.company.website} onChange={(e) => set('company', { ...form.company, website: e.target.value })} /></div>
            <div className="field" style={{ flex: '1 1 160px' }}><label className="label" htmlFor="jf-l">Logo link</label><input id="jf-l" className="input" value={form.company.logo} onChange={(e) => set('company', { ...form.company, logo: e.target.value })} /></div>
          </div>
          <div className="field"><label className="label" htmlFor="jf-loc">Cities (comma between)</label><input id="jf-loc" className="input" placeholder="Hyderabad, Pune" value={form.locations} onChange={(e) => set('locations', e.target.value)} /></div>
          <div className="row g8" style={{ flexWrap: 'wrap' }}>
            <div className="field" style={{ flex: '1 1 120px' }}><label className="label" htmlFor="jf-wt">Work type</label><select id="jf-wt" className="input" value={form.workType} onChange={(e) => set('workType', e.target.value)}>{Object.entries(WORK).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></div>
            <div className="field" style={{ flex: '1 1 120px' }}><label className="label" htmlFor="jf-jt">Job type</label><select id="jf-jt" className="input" value={form.jobType} onChange={(e) => set('jobType', e.target.value)}>{Object.entries(TYPE).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></div>
            <div className="field" style={{ flex: '1 1 120px' }}><label className="label" htmlFor="jf-ex">Experience</label><select id="jf-ex" className="input" value={form.experience} onChange={(e) => set('experience', e.target.value)}>{Object.entries({ ...EXP, ...(EXP_OLD[form.experience] ? { [form.experience]: EXP_OLD[form.experience] } : {}) }).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></div>
          </div>
          <div className="row g8" style={{ flexWrap: 'wrap' }}>
            <div className="field" style={{ flex: '1 1 100px' }}><label className="label" htmlFor="jf-smin">Salary from (₹)</label><input id="jf-smin" className="input" inputMode="numeric" value={form.salaryMin} onChange={(e) => set('salaryMin', e.target.value.replace(/\D/g, ''))} /></div>
            <div className="field" style={{ flex: '1 1 100px' }}><label className="label" htmlFor="jf-smax">Salary to (₹)</label><input id="jf-smax" className="input" inputMode="numeric" value={form.salaryMax} onChange={(e) => set('salaryMax', e.target.value.replace(/\D/g, ''))} /></div>
            <div className="field" style={{ flex: '1 1 100px' }}><label className="label" htmlFor="jf-sp">Per</label><select id="jf-sp" className="input" value={form.salaryPeriod} onChange={(e) => set('salaryPeriod', e.target.value)}><option value="yearly">Year</option><option value="monthly">Month</option></select></div>
          </div>
          <div className="field"><label className="label" htmlFor="jf-sk">Skills (comma between)</label><input id="jf-sk" className="input" placeholder="SQL, Python, Power BI" value={form.skills} onChange={(e) => set('skills', e.target.value)} /></div>
          <div className="field"><label className="label" htmlFor="jf-d">Description *</label><textarea id="jf-d" className="input" rows={6} required minLength={30} value={form.description} onChange={(e) => set('description', e.target.value)} /></div>
          <div className="row g8" style={{ flexWrap: 'wrap' }}>
            <div className="field" style={{ flex: '1 1 140px' }}><label className="label" htmlFor="jf-am">How to apply</label><select id="jf-am" className="input" value={form.applyMethod} onChange={(e) => set('applyMethod', e.target.value)}>{Object.entries(APPLY).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></div>
            {form.applyMethod === 'link' && <div className="field" style={{ flex: '2 1 200px' }}><label className="label" htmlFor="jf-au">Apply link *</label><input id="jf-au" className="input" type="url" required value={form.applyUrl} onChange={(e) => set('applyUrl', e.target.value)} /></div>}
            {form.applyMethod === 'email' && <div className="field" style={{ flex: '2 1 200px' }}><label className="label" htmlFor="jf-ae">Apply email *</label><input id="jf-ae" className="input" type="email" required value={form.applyEmail} onChange={(e) => set('applyEmail', e.target.value)} /></div>}
          </div>
          <div className="row g8" style={{ flexWrap: 'wrap' }}>
            <div className="field" style={{ flex: '1 1 120px' }}><label className="label" htmlFor="jf-s">Status</label><select id="jf-s" className="input" value={form.status} onChange={(e) => set('status', e.target.value)}>{Object.entries(STATUS).map(([k, [l]]) => <option key={k} value={k}>{l}</option>)}</select></div>
            <div className="field" style={{ flex: '1 1 140px' }}><label className="label" htmlFor="jf-cl">Closes on (optional)</label><input id="jf-cl" className="input" type="date" value={form.closesAt} onChange={(e) => set('closesAt', e.target.value)} /></div>
          </div>
          {error && <p className="error" role="alert">{error}</p>}
          <div className="row g8"><button type="submit" className="btn btn-ink" disabled={busy}>{id ? 'Save' : 'Add job'}</button><button type="button" className="btn btn-outline" onClick={onClose}>Cancel</button></div>
        </form>
      )}
    </Panel>
  );
}

const CHANNEL = { nm7: 'Applied on Nm7', link: 'Company link', email: 'By email' };
const APP_STEPS = [['viewed', 'Viewed'], ['shortlisted', 'Shortlisted'], ['interview', 'Interview'], ['offer', 'Offer'], ['rejected', 'Rejected']];

function AppRow({ job, a }) {
  const toast = useToast();
  const [status, setStatus] = useState(a.status);
  const [busy, setBusy] = useState(false);
  const move = async (v) => {
    setBusy(true);
    try { await http(`/api/admin/jobs/${job.id}/applications/${encodeURIComponent(a.user)}/status`, { method: 'POST', body: { status: v } }); setStatus(v); toast('Updated: the applicant sees it in My applications'); } catch (e) { toast(e.message); } finally { setBusy(false); }
  };
  return (
    <li className="row g8 small" data-testid="admin-application" style={{ justifyContent: 'space-between' }}>
      <span style={{ minWidth: 0, overflowWrap: 'anywhere' }}><strong>{a.name}</strong> · {a.email} · {CHANNEL[a.channel] || a.channel}{a.origin === 'auto' ? ' · Auto' : ' · Manual'}{a.resume ? ` · resume “${a.resume}”` : ''} · {day(a.at)}</span>
      {a.channel === 'nm7' ? (
        <label className="row g4">
          <span className="sr-only">Status for {a.name}</span>
          <select className="input" style={{ height: 36 }} value={status} disabled={busy} onChange={(e) => move(e.target.value)}>
            {APP_STEPS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </select>
        </label>
      ) : <span className="badge b-neutral">{status}</span>}
    </li>
  );
}

function Applications({ job, onClose }) {
  const st = useApi(`/api/admin/jobs/${job.id}/applications`);
  return (
    <Panel title={`Applications · ${job.title}`} onClose={onClose}>
      <p className="small muted" style={{ margin: 0 }}>Opening this list marks new Nm7 applications as Viewed. Move each one along; the applicant sees every step.</p>
      <Loading st={st} empty={emptyIf((d) => !d.length, 'Nobody has applied yet.')}>{(rows) => (
        <ul className="stack g8" style={{ listStyle: 'none', margin: 0, padding: 0 }}>
          {rows.map((a) => <AppRow key={a.user} job={job} a={a} />)}
        </ul>
      )}</Loading>
    </Panel>
  );
}

const SAMPLE_JSON = `[
  {
    "title": "Junior Data Analyst",
    "company": { "name": "Acme Analytics", "website": "https://acme.example" },
    "locations": ["Hyderabad"],
    "workType": "hybrid", "jobType": "full_time", "experience": "fresher",
    "salary": { "min": 300000, "max": 450000, "period": "yearly" },
    "skills": ["SQL", "Power BI"],
    "description": "At least 30 characters about the job…",
    "applyMethod": "link", "applyUrl": "https://acme.example/careers/123"
  }
]`;

function BulkImport({ onDone }) {
  const toast = useToast();
  const [format, setFormat] = useState('json');
  const [text, setText] = useState('');
  const [preview, setPreview] = useState(null);
  const [busy, run] = useAction(toast);
  const [error, setError] = useState('');
  const send = (commit) => run(async () => {
    setError('');
    try {
      const r = await http('/api/admin/jobs/import', { method: 'POST', body: { format, text, commit } });
      if (commit) { toast(`${r.created} added · ${r.updated} updated · ${r.skipped} unchanged · ${r.rejected} with errors`); setPreview(null); setText(''); onDone(); } else setPreview(r);
    } catch (e) { setError(e.message); throw e; }
  });
  const file = async (e) => { const fl = e.target.files?.[0]; if (!fl) return; setFormat(fl.name.toLowerCase().endsWith('.csv') ? 'csv' : 'json'); setText(await fl.text()); setPreview(null); };
  return (
    <div className="stack g12" style={{ maxWidth: 900 }}>
      <span className="small muted">Paste a JSON array of jobs, or a CSV with a header row (title, company, company_website, company_logo, locations, work_type, job_type, experience, salary_min, salary_max, salary_period, skills, description, apply_method, apply_url, apply_email, posted_at, closes_at, status; use ; between cities or skills; experience is one of internship, fresher, 0_1, 1_3, 3_5, 5_8, 8_12, 12_15, 15_plus or not_stated). Preview first: nothing is saved until you press Import. The same job sent again updates it instead of adding a copy.</span>
      <div className="row g12" role="radiogroup" aria-label="Format">
        {['json', 'csv'].map((k) => <label key={k} className="row g6 small"><input type="radio" name="bi-f" value={k} aria-label={k === 'json' ? 'JSON' : 'CSV'} checked={format === k} onChange={() => { setFormat(k); setPreview(null); }} /> {k.toUpperCase()}</label>)}
        <label className="small">Or choose a file <input type="file" accept=".json,.csv,application/json,text/csv" onChange={file} /></label>
      </div>
      <label className="sr-only" htmlFor="bi-text">Jobs to import</label>
      <textarea id="bi-text" className="input mono xs" rows={12} placeholder={format === 'json' ? SAMPLE_JSON : 'title,company,locations,experience,description,apply_method,apply_url'} value={text} onChange={(e) => { setText(e.target.value); setPreview(null); }} />
      {error && <p className="error" role="alert">{error}</p>}
      <div className="row g8"><button type="button" className="btn btn-outline" disabled={busy || text.trim().length < 2} onClick={() => send(false)}>Preview</button>
        {preview && <button type="button" className="btn btn-ink" disabled={busy || !(preview.created + preview.updated)} onClick={() => send(true)}>Import {preview.created + preview.updated} job{preview.created + preview.updated === 1 ? '' : 's'}</button>}</div>
      {preview && (
        <div className="stack g8" data-testid="import-preview">
          <span className="small"><strong>{preview.created}</strong> new · <strong>{preview.updated}</strong> updated · <strong>{preview.skipped}</strong> already here, unchanged · <strong>{preview.rejected}</strong> with errors (skipped)</span>
          <div className="table-wrap" tabIndex={0} role="region" aria-label="Table — scroll sideways to see all columns"><table className="table"><thead><tr><th>Row</th><th>Job</th><th>Result</th><th>Problems</th></tr></thead>
            <tbody>{preview.rows.map((r) => (
              <tr key={r.row} data-testid="import-row"><td className="small">{r.row}</td><td className="small">{r.title || '—'}{r.company ? <div className="xs faint">{r.company}</div> : null}</td>
                <td className="small"><span className={`badge ${r.result === 'rejected' ? 'b-warning' : r.result === 'created' ? 'b-success' : 'b-neutral'}`}>{{ created: 'New', updated: 'Update', skipped: 'Unchanged', rejected: 'Error' }[r.result]}</span></td>
                <td className="xs">{r.errors.join(' · ')}</td></tr>
            ))}</tbody></table></div>
        </div>
      )}
    </div>
  );
}

function Expired() {
  const toast = useToast();
  const st = useApi('/api/admin/jobs/expired');
  const [busy, run] = useAction(toast);
  const reopen = (j) => run(async () => { await http(`/api/admin/jobs/${j.id}/status`, { method: 'POST', body: { status: 'active' } }); st.reload(); }, 'Reopened; the link is checked again tonight');
  return (
    <Loading st={st} empty={emptyIf((d) => !d.length, 'No failed apply links. The daily check closes a job after its link fails twice in a row.')}>{(rows) => (
      <ul className="stack g8" style={{ listStyle: 'none', margin: 0, padding: 0 }}>
        {rows.map((j) => (
          <li key={j.id} className="card stack g4" data-testid="expired-job">
            <span className="row between g8" style={{ flexWrap: 'wrap' }}><strong className="small">{j.title} · {j.company.name}</strong><span className={`badge ${STATUS[j.status][1]}`}>{STATUS[j.status][0]}</span></span>
            <span className="xs muted">Failed {j.linkCheck.fails} time{j.linkCheck.fails === 1 ? '' : 's'} · last check {when(j.linkCheck.at)}{j.linkCheck.status ? ` · HTTP ${j.linkCheck.status}` : ''}{j.linkCheck.error ? ` · ${j.linkCheck.error}` : ''}</span>
            {j.closedReason && <span className="xs">{j.closedReason}</span>}
            <span className="xs faint" style={{ overflowWrap: 'anywhere' }}>{j.apply.url || j.apply.email}</span>
            {j.status === 'closed' && <button type="button" className="btn btn-outline" style={{ alignSelf: 'flex-start' }} disabled={busy} onClick={() => reopen(j)}>Reopen</button>}
          </li>
        ))}
      </ul>
    )}</Loading>
  );
}

/** A company job waiting for review (scam signs / the AI check): why, then approve or reject with a reason typed here. */
// round J: why a collector job waits for review
const COLLECTOR_WHY = { no_page_text: 'No page text to summarise (the official page was empty or too short)', summary_failed: 'The summary failed a check (too long, copied the page, or had contact details)', summary_unavailable: 'AI summaries are off (no API key)', ai_daily_limit: "Today's AI summaries for the collector are used up", experience_not_stated: 'Experience not stated', city_not_stated: 'City not stated' };

function ReviewBox({ j, onDone }) {
  const toast = useToast();
  const [busy, run] = useAction(toast);
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState('');
  const decide = (approve) => run(async () => { await http(`/api/admin/jobs/${j.id}/review`, { method: 'POST', body: { approve, reason } }); onDone(); }, approve ? 'Approved: the job is live' : 'Rejected: the company was emailed');
  return (
    <div className="stack g8 well" data-testid="job-review">
      <strong className="small">Why it is waiting</strong>
      <ul className="stack g4" style={{ margin: 0, paddingLeft: 18 }}>{j.review.reasons.map((r, i) => <li key={i} className="small" style={{ color: 'var(--warning)' }}>{COLLECTOR_WHY[r] || r}</li>)}</ul>
      {j.source === 'collector' && <span className="xs muted" data-testid="collector-review-note">From the job collector. Write a short summary in your own words (Edit) before approving: the description is a placeholder until then. Never paste the company&apos;s text.</span>}
      {rejecting ? (
        <form className="stack g8" role="alert" onSubmit={(e) => { e.preventDefault(); decide(false); }}>
          <label className="label" htmlFor={`rv-${j.id}`}>Why can’t it go live?</label>
          <textarea id={`rv-${j.id}`} className="input" rows={2} maxLength={300} value={reason} onChange={(e) => setReason(e.target.value)} />
          <div className="row g8"><button type="submit" className="btn btn-ink" disabled={busy || reason.trim().length < 5}>Reject</button>
            <button type="button" className="link-btn small" onClick={() => setRejecting(false)}>Cancel</button></div>
        </form>
      ) : (
        <div className="row g8"><button type="button" className="btn btn-ink" disabled={busy} onClick={() => decide(true)}>Approve</button>
          <button type="button" className="btn btn-outline" disabled={busy} onClick={() => setRejecting(true)}>Reject</button></div>
      )}
    </div>
  );
}

const REASON = { scam: 'Asks for money / scam', fake: 'Fake or misleading', unfair: 'Unfair or discriminatory', wrong_info: 'Wrong details', expired: 'Already filled or closed', other: 'Something else' };

/** Jobs students reported. Dismiss (the reports were wrong; a job they paused goes live again) or close with a note. */
function Reports() {
  const toast = useToast();
  const [state, setState] = useState('open');
  const st = useApi(`/api/admin/job-reports?state=${state}`);
  return (
    <>
      <Tabs label="Reports" tabs={[['open', 'To check'], ['done', 'Done']]} value={state} onChange={setState} />
      <Loading st={st} empty={emptyIf((d) => !d.length, state === 'open' ? 'No reported jobs to check. Reports from 3 different students pause a job until you check it here.' : 'No checked reports yet.')}>{(rows) => (
        <ul className="stack g8" style={{ listStyle: 'none', margin: 0, padding: 0 }}>
          {rows.map((r) => <ReportRow key={r.jobId} r={r} open={state === 'open'} toast={toast} onDone={() => st.reload()} />)}
        </ul>
      )}</Loading>
    </>
  );
}

function ReportRow({ r, open, toast, onDone }) {
  const [busy, run] = useAction(toast);
  const [closing, setClosing] = useState(false);
  const [note, setNote] = useState('');
  const resolve = (action) => run(async () => { await http(`/api/admin/job-reports/${r.jobId}/resolve`, { method: 'POST', body: { action, note } }); onDone(); }, action === 'close' ? 'Job closed' : 'Reports dismissed');
  return (
    <li className="card stack g8" data-testid="job-report">
      <span className="row between g8" style={{ flexWrap: 'wrap' }}>
        <strong className="small"><a href={`/jobs/${r.slug}`} target="_blank" rel="noopener noreferrer">{r.title}</a> · {r.company}</strong>
        <span className="row g8"><span className={`badge ${STATUS[r.status]?.[1] || 'b-neutral'}`}>{STATUS[r.status]?.[0] || r.status}</span>{r.held && <span className="badge b-danger">Paused by reports</span>}</span>
      </span>
      <span className="xs muted">{r.count} report{r.count === 1 ? '' : 's'}</span>
      <ul className="stack g4" style={{ margin: 0, paddingLeft: 18 }}>
        {r.reports.map((x, i) => <li key={i} className="small"><strong>{REASON[x.reason] || x.reason}</strong> · {day(x.at)}{x.note ? <>: <span style={{ whiteSpace: 'pre-line' }}>{x.note}</span></> : null}</li>)}
      </ul>
      {open && (closing ? (
        <form className="stack g8" onSubmit={(e) => { e.preventDefault(); resolve('close'); }}>
          <label className="label" htmlFor={`rc-${r.jobId}`}>Why is the job closed?</label>
          <textarea id={`rc-${r.jobId}`} className="input" rows={2} maxLength={300} value={note} onChange={(e) => setNote(e.target.value)} />
          <div className="row g8"><button type="submit" className="btn btn-ink" disabled={busy || note.trim().length < 5}>Close the job</button>
            <button type="button" className="link-btn small" onClick={() => setClosing(false)}>Cancel</button></div>
        </form>
      ) : (
        <div className="row g8">
          <button type="button" className="btn btn-outline" disabled={busy} onClick={() => resolve('dismiss')}>{r.held ? 'Dismiss and make live again' : 'Dismiss'}</button>
          <button type="button" className="btn btn-ink" disabled={busy} onClick={() => setClosing(true)}>Close the job</button>
        </div>
      ))}
    </li>
  );
}

/** Round J: requests to remove a job (usually a company about a job from its careers page). One click closes the job. */
// round M: the collector's jobs waiting for review, by reason; the ones held only for something a new try can fix go
// back to the collector in one click (its next run sends them again), and the ones abroad are closed
function CollectorReview() {
  const toast = useToast();
  const st = useApi('/api/admin/jobs/collector/review');
  const [busy, run] = useAction(toast);
  const [sure, setSure] = useState(false);
  const sendBack = (reason, n) => run(async () => { await http('/api/admin/jobs/collector/resend', { method: 'POST', body: { reason } }); st.reload(); }, `${n} sent back: the collector sends them again on its next run`);
  const closeAbroad = () => run(async () => { const r = await http('/api/admin/jobs/collector/close-outside-india', { method: 'POST' }); setSure(false); st.reload(); return r; }, 'Closed: outside India');
  return (
    <Loading st={st}>{(d) => (
      <div className="stack g12" data-testid="collector-review">
        <div className="row g12" style={{ flexWrap: 'wrap' }}>
          <Kpi label="Waiting for review" value={d.total} sub={`${d.sentBack} sent back to the collector`} />
        </div>
        <section className="card stack g8" aria-label="Why they wait">
          <strong>Why they wait</strong>
          <span className="small muted">A job can wait for more than one reason. Only the ones held just for page text, the AI allowance or a failed summary can be sent back: the collector sends them again on its next run and they go live once a summary is written. The rest need you (Edit, then Approve).</span>
          {Object.keys(d.byReason).length === 0 ? <span className="small">Nothing is waiting.</span> : (
            <ul className="stack g8" style={{ listStyle: 'none', margin: 0, padding: 0 }}>
              {Object.entries(d.byReason).map(([why, n]) => (
                <li key={why} className="row between g8" style={{ flexWrap: 'wrap', alignItems: 'center' }} data-testid={`cr-${why}`}>
                  <span className="small"><strong>{n}</strong> · {COLLECTOR_WHY[why] || why}</span>
                  {d.retryable[why] > 0 && <button type="button" className="btn btn-outline btn-sm" disabled={busy} onClick={() => sendBack(why, d.retryable[why])} data-testid={`cr-send-${why}`}>Send back to the collector ({d.retryable[why]})</button>}
                </li>
              ))}
            </ul>
          )}
        </section>
        <section className="card stack g8" aria-label="Outside India">
          <strong>Outside India</strong>
          <span className="small muted">New jobs abroad are refused and ones already here are closed when the collector sends them again. Jobs stored before 14 Nov have no raw location, so they close when they are sent back.</span>
          {d.outsideIndia > 0 ? (sure
            ? <div className="row g8" style={{ flexWrap: 'wrap' }}><button type="button" className="btn btn-ink btn-sm" disabled={busy} onClick={closeAbroad} data-testid="cr-abroad-yes">Yes, close {d.outsideIndia}</button><button type="button" className="btn btn-outline btn-sm" onClick={() => setSure(false)}>Keep them</button></div>
            : <button type="button" className="btn btn-outline btn-sm" style={{ alignSelf: 'flex-start' }} onClick={() => setSure(true)} data-testid="cr-abroad">Close jobs outside India ({d.outsideIndia})</button>)
            : <span className="small">None waiting.</span>}
        </section>
      </div>
    )}</Loading>
  );
}

function Removals() {
  const toast = useToast();
  const [status, setStatus] = useState('open');
  const st = useApi(`/api/admin/jobs/removals?status=${status}`);
  const [busy, run] = useAction(toast);
  const closeJob = (r) => run(async () => { await http(`/api/admin/jobs/removals/${r.id}/close-job`, { method: 'POST' }); st.reload(); }, 'Job closed: removed on request');
  const dismiss = (r) => run(async () => { await http(`/api/admin/jobs/removals/${r.id}/dismiss`, { method: 'POST', body: { note: '' } }); st.reload(); }, 'Request dismissed');
  return (
    <div className="stack g12">
      <span className="small muted">Requests to remove a job from Nm7 (from the form at /contact?topic=job-removal and the link on job pages).</span>
      <Tabs label="Removal requests" tabs={[['open', 'To do'], ['done', 'Removed'], ['dismissed', 'Dismissed']]} value={status} onChange={setStatus} />
      <Loading st={st} empty={emptyIf((d) => !d.length, status === 'open' ? 'No removal requests to handle.' : 'Nothing here yet.')}>{(rows) => (
        <ul className="stack g8" style={{ listStyle: 'none', margin: 0, padding: 0 }}>
          {rows.map((r) => (
            <li key={r.id} className="card stack g4" data-testid="removal-row">
              <strong className="small">{r.company}{r.jobTitle ? ` · ${r.jobTitle}` : ''}</strong>
              <a className="xs" href={r.jobLink} target="_blank" rel="noopener noreferrer nofollow" style={{ overflowWrap: 'anywhere' }}>{r.jobLink}</a>
              <span className="xs muted">{r.email} · {day(r.at)}{r.jobId ? '' : ' · job not found on Nm7'}</span>
              {r.reason && <span className="small" style={{ whiteSpace: 'pre-line' }}>{r.reason}</span>}
              {r.status === 'open' && (
                <div className="row g8" style={{ flexWrap: 'wrap' }}>
                  <button type="button" className="btn btn-ink btn-sm" disabled={busy || !r.jobId} onClick={() => closeJob(r)} data-testid="removal-close">Close the job</button>
                  <button type="button" className="btn btn-outline btn-sm" disabled={busy} onClick={() => dismiss(r)}>Dismiss</button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}</Loading>
    </div>
  );
}
