// Admin → Jobs (job board J1): every job on nm7.si/jobs. Search and filter, add or edit one, pause, close, reopen,
// delete (confirmed here on the page), bulk import (JSON array or CSV, preview with per-row errors first), the jobs
// whose apply link failed its check, and who applied. Every change is in the audit log.
import { useState } from 'react';
import { useToast } from '../../../components/ui';
import { Kpi, PageHead, Panel, Tabs } from '../AdminUI';
import { Loading, day, emptyIf, http, useAction, useApi, when } from './common';

const WORK = { onsite: 'On-site', hybrid: 'Hybrid', remote: 'Remote' };
const TYPE = { full_time: 'Full-time', internship: 'Internship', contract: 'Contract', part_time: 'Part-time' };
const EXP = { internship: 'Internship', fresher: 'Fresher', '0_1': '0–1 years', '1_3': '1–3 years', '3_plus': '3+ years' };
const APPLY = { link: 'Company website', email: 'By email', nm7: 'Apply on Nm7' };
const SOURCE = { collector: 'Job collector', admin: 'Added here', bulk: 'Bulk import', company: 'Company' };
const STATUS = { active: ['Active', 'b-success'], paused: ['Paused', 'b-neutral'], closed: ['Closed', 'b-warning'] };
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
      <Tabs label="Show" tabs={[['jobs', 'Jobs'], ['import', 'Bulk import'], ['expired', 'Expired links']]} value={tab} onChange={setTab} />
      {tab === 'jobs' && <JobList />}
      {tab === 'import' && <BulkImport onDone={() => setTab('jobs')} />}
      {tab === 'expired' && <Expired />}
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
          <div className="field" style={{ flex: '1 1 130px' }}><label className="label" htmlFor="aj-exp">Experience</label><select id="aj-exp" className="input" value={f.experience} onChange={(e) => setF({ ...f, experience: e.target.value })}><option value="">All</option>{Object.entries(EXP).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></div>
          <button type="submit" className="btn btn-outline">Search</button>
          <button type="button" className="btn btn-ink" onClick={() => setEditing('new')}>Add job</button>
        </form>
        <Loading st={st} empty={emptyIf((d) => !d.items.length, 'No jobs match. Add one, or import a file.')}>{(d) => (
          <>
            <div className="row g12" style={{ flexWrap: 'wrap' }}>
              <Kpi label="Jobs" value={d.total} sub={Object.entries(d.counts.status).map(([k, n]) => `${STATUS[k]?.[0] || k} ${n}`).join(' · ')} />
              <Kpi label="By source" value={Object.values(d.counts.source).reduce((a, b) => a + b, 0)} sub={Object.entries(d.counts.source).map(([k, n]) => `${SOURCE[k] || k} ${n}`).join(' · ')} />
              <Kpi label="By experience" value={d.counts.experience.fresher || 0} sub={Object.entries(d.counts.experience).map(([k, n]) => `${EXP[k] || k} ${n}`).join(' · ')} />
            </div>
            <ul className="stack g8" style={{ listStyle: 'none', margin: 0, padding: 0 }}>
              {d.items.map((j) => (
                <li key={j.id} className="card stack g6" data-testid="admin-job">
                  <div className="row between g8" style={{ flexWrap: 'wrap', alignItems: 'flex-start' }}>
                    <span className="stack g2" style={{ minWidth: 0 }}>
                      <strong className="small" style={{ overflowWrap: 'anywhere' }}>{j.title}</strong>
                      <span className="xs muted">{j.company.name} · {j.remote && !j.locations.length ? 'Remote' : j.locations.join(', ')} · {EXP[j.experience]} · {TYPE[j.jobType]}{j.salary ? ` · ${salaryText(j.salary)}` : ''}</span>
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
                    <div className="row g8" style={{ flexWrap: 'wrap' }}>
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
            <div className="field" style={{ flex: '1 1 120px' }}><label className="label" htmlFor="jf-ex">Experience</label><select id="jf-ex" className="input" value={form.experience} onChange={(e) => set('experience', e.target.value)}>{Object.entries(EXP).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></div>
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
      <span style={{ minWidth: 0, overflowWrap: 'anywhere' }}><strong>{a.name}</strong> · {a.email} · {CHANNEL[a.channel] || a.channel}{a.resume ? ` · resume “${a.resume}”` : ''} · {day(a.at)}</span>
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
      <span className="small muted">Paste a JSON array of jobs, or a CSV with a header row (title, company, company_website, company_logo, locations, work_type, job_type, experience, salary_min, salary_max, salary_period, skills, description, apply_method, apply_url, apply_email, posted_at, closes_at, status; use ; between cities or skills). Preview first: nothing is saved until you press Import. The same job sent again updates it instead of adding a copy.</span>
      <div className="row g12" role="radiogroup" aria-label="Format">
        {['json', 'csv'].map((k) => <label key={k} className="row g6 small"><input type="radio" name="bi-f" checked={format === k} onChange={() => { setFormat(k); setPreview(null); }} /> {k.toUpperCase()}</label>)}
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
