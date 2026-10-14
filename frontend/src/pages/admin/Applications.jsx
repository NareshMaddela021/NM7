// Admin: expert applications — review the profile, send a test task, score the test, approve or reject.
import { useState } from 'react';
import { useToast } from '../../components/ui';
import { STATUS, expertStrength, allProfiles, patchProfile } from '../../lib/expert';
import { TASKS, RUBRIC, PASS, newTest, taskById, scoreOf, atsDelta } from '../../lib/expertTest';
import { jobMatch } from '../../lib/atsScore';
import Compare from '../builder/Compare';
import ResumePreview from '../builder/ResumePreview';
import { DEFAULT_DESIGN, TEMPLATE_PRESETS } from '../builder/design';

const H = 3600 * 1000;
const fmt = (t) => new Date(t).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });

// a sample test answer, so the scoring screen has something to review in the preview
const sampleAnswer = (() => {
  const d = structuredClone(TASKS.data.original);
  d.personal.headline = 'Data Analyst · Excel · SQL · Power BI';
  d.summary = 'Commerce graduate who turned a full-day weekly sales report into a 2-hour job during a retail internship. Comfortable with Excel (pivot tables, VLOOKUP) and learning SQL and Power BI. Looking for a fresher Data Analyst role.';
  d.exp = d.exp.map((e) => ({ ...e, role: 'Sales Reporting Intern', description: 'Rebuilt the weekly sales report in Excel with pivot tables, cutting preparation time from about 8 hours to 2\nCleaned and merged store sales sheets for [N] stores every week\nPresented weekly trends to the store manager and flagged [N] low-stock items' }));
  d.skillGroups = d.skillGroups.map((g) => (g.id === 'core' ? { ...g, value: 'Excel, SQL (basic), Power BI (learning), Tally' } : g));
  return d;
})();

// sample applications so the screen isn't empty in the preview
const SAMPLES = [
  { id: 'EX-201', status: 'review', source: 'document', photo: null, ai: null, submittedAt: '2026-10-12', about: { name: '[Applicant 1]', headline: 'HR Business Partner · 8 yrs hiring', bio: 'Hired 400+ freshers across BFSI and IT services. I know what recruiters skim for in the first 10 seconds and help candidates show it.', city: 'Pune', languages: ['English', 'Hindi', 'Marathi'] }, expertise: { domains: ['Marketing & HR', 'Finance'], roles: 'HR Executive, Banking Associate', levels: ['fresher', 'early'] }, proof: { experience: [{ role: 'HR Business Partner', company: '[Company]', period: '2018–now' }], certs: [], linkedin: 'linkedin.com/in/applicant-1', recruiterYears: '8', resumesWritten: '150+' }, samples: [{ name: 'before-after-hr.pdf', size: 182000, anonymised: true }], services: { plans: ['expert'], perWeek: 8, rush: true, paused: false }, payout: { method: 'upi', upi: 'applicant1@okicici', pan: 'ABCDE1234F' } },
  { id: 'EX-198', status: 'review', source: 'asuraa.ai', photo: null, ai: { url: 'asuraa.ai/[creator-2]', verified: true, rating: 4.8, reviews: 22 }, submittedAt: '2026-10-11', about: { name: '[Applicant 2]', headline: 'SDE-2 · Interview coach', bio: 'Backend engineer, 5 years. On asuraa.ai I run mock interviews for SDE-1 roles; now helping freshers with resumes that pass the first screen.', city: 'Hyderabad', languages: ['English', 'Telugu'] }, expertise: { domains: ['Software engineering'], roles: 'SDE-1, Backend Developer', levels: ['fresher', 'early'] }, proof: { experience: [{ role: 'SDE-2', company: '[Company]', period: '2020–now' }], certs: [{ name: 'AWS Solutions Architect – Associate', issuer: 'AWS' }], linkedin: 'linkedin.com/in/applicant-2', recruiterYears: '', resumesWritten: '60' }, samples: [], services: { plans: ['expert', 'launch'], perWeek: 5, rush: false, paused: false }, payout: { reuseAi: true, pan: 'PQRSX6789K' } },
  { id: 'EX-195', status: 'testReview', source: 'manual', photo: null, ai: null, submittedAt: '2026-10-09', about: { name: '[Applicant 3]', headline: 'MIS Lead · 6 yrs in retail analytics', bio: 'I build reporting for retail teams and have reviewed resumes for our analyst hiring for 3 years.', city: 'Chennai', languages: ['English', 'Tamil'] }, expertise: { domains: ['Data & analytics'], roles: 'Data Analyst, MIS Executive', levels: ['fresher'] }, proof: { experience: [{ role: 'MIS Lead', company: '[Company]', period: '2019–now' }], certs: [], linkedin: 'linkedin.com/in/applicant-3', recruiterYears: '3', resumesWritten: '40' }, samples: [], services: { plans: ['expert'], perWeek: 4, rush: false, paused: false }, payout: { method: 'upi', upi: 'applicant3@oksbi', pan: 'LMNOP4321Q' },
    test: { taskId: 'T-DATA', sentAt: Date.now() - 40 * H, due: Date.now() + 8 * H, submitted: { data: sampleAnswer, at: Date.now() - 6 * H, note: 'Left [N] where I would ask the candidate for numbers.', late: false } } },
];
const fromBrowser = () => allProfiles().filter(({ p }) => p.status && p.status !== 'draft' && p.about?.name).map(({ key, p }, i) => ({ ...p, id: `EX-${300 + i}`, key, mine: true }));

function TestReview({ x, onDecide }) {
  const t = taskById(x.test.taskId);
  const ans = x.test.submitted.data;
  const { before, after } = atsDelta(t, ans);
  const m = jobMatch(ans, t.jd);
  const [view, setView] = useState('compare');
  const [scores, setScores] = useState(x.test.scores || {});
  const [note, setNote] = useState('');
  const r = scoreOf(scores);
  const ds = { ...DEFAULT_DESIGN, ...(ans.design || TEMPLATE_PRESETS.fresher.design) };
  return (
    <div className="stack g16">
      <div className="row g8">
        <span className="badge b-neutral">Task {t.id} · {t.title}</span>
        <span className="badge b-success">ATS {before} → {after}</span>
        <span className="badge b-neutral">Job keywords {m.found.length}/{m.keywords.length}</span>
        <span className={`badge ${x.test.submitted.late ? 'b-danger' : 'b-neutral'}`}>Submitted {fmt(x.test.submitted.at)}{x.test.submitted.late ? ' · late' : ''}</span>
      </div>
      {x.test.submitted.note && <p className="well small" style={{ margin: 0 }}><strong>Expert’s note:</strong> {x.test.submitted.note}</p>}
      <div className="segmented" role="tablist" aria-label="Test view" style={{ alignSelf: 'flex-start' }}>
        {[['compare', 'Changes'], ['preview', 'Their resume']].map(([k, l]) => <button key={k} type="button" role="tab" aria-selected={view === k} onClick={() => setView(k)}>{l}</button>)}
      </div>
      <div style={{ maxHeight: 520, overflow: 'auto' }}>
        {view === 'compare' ? <Compare a={t.original} b={ans} aLabel="the original" bLabel="their rewrite" /> : <ResumePreview data={ans} design={ds} />}
      </div>
      <fieldset className="stack g8" style={{ border: 0, padding: 0, margin: 0 }}>
        <legend className="strong" style={{ marginBottom: 6 }}>Score (1 = poor, 5 = excellent)</legend>
        {RUBRIC.map(([k, l, h]) => (
          <div key={k} className="row between g8" style={{ borderBottom: '1px solid var(--border)', paddingBottom: 8 }}>
            <span className="stack" style={{ flex: '1 1 220px' }}><strong className="small">{l}</strong><span className="xs muted">{h}</span></span>
            <span className="row g4" role="radiogroup" aria-label={l}>
              {[1, 2, 3, 4, 5].map((n) => <button key={n} type="button" role="radio" aria-checked={scores[k] === n} className="chip" style={{ minHeight: 34, minWidth: 34, padding: 0, justifyContent: 'center', ...(scores[k] === n ? { background: 'var(--ink)', color: 'var(--onink)', borderColor: 'var(--ink)' } : {}) }} onClick={() => setScores({ ...scores, [k]: n })}>{n}</button>)}
            </span>
          </div>
        ))}
      </fieldset>
      <div className="well row between g8 small">
        <span>Average <strong>{r.complete ? r.avg.toFixed(1) : '—'}</strong> / 5 · pass needs {PASS.avg}+ and no score below {PASS.min}</span>
        {r.complete && <span className={`badge ${r.pass ? 'b-success' : 'b-danger'}`}>{r.pass ? 'Pass' : 'Below the bar'}</span>}
      </div>
      <label htmlFor="tr-note" className="label">Feedback to the expert {r.complete && !r.pass ? '(needed)' : '· optional'}</label>
      <textarea id="tr-note" className="input" rows={3} value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Strong summary. Next time, keep bullets to one line each." />
      <div className="row g8">
        <button type="button" className="btn btn-ink" disabled={!r.complete} onClick={() => onDecide('approved', note, scores)}>{r.complete && !r.pass ? 'Approve anyway' : 'Approve · Verified expert'}</button>
        <button type="button" className="btn btn-outline" disabled={!r.complete || !note.trim()} onClick={() => onDecide('test', note, scores)}>Ask for a second try</button>
        <button type="button" className="btn btn-ghost" style={{ color: 'var(--danger)' }} disabled={!note.trim()} onClick={() => onDecide('rejected', note, scores)}>Reject</button>
      </div>
    </div>
  );
}

export function ApplicationsPanel() {
  const toast = useToast();
  const [list, setList] = useState(() => [...fromBrowser(), ...SAMPLES]);
  const [sel, setSel] = useState(list[0]?.id);
  const [note, setNote] = useState('');
  const cur = list.find((x) => x.id === sel);
  const apply = (patch) => {
    setList((l) => l.map((x) => (x.id === sel ? { ...x, ...patch } : x)));
    if (cur.key) patchProfile(cur.key, patch);
  };
  const decide = (status, n = note, scores) => {
    if (['changes', 'rejected'].includes(status) && !n.trim()) { toast('Add a note so the expert knows why'); return; }
    const patch = { status, note: n.trim() };
    if (status === 'test') patch.test = { ...newTest(cur.expertise.domains), ...(scores ? { previous: { ...cur.test, scores } } : {}) };
    if (scores && status !== 'test') patch.test = { ...cur.test, scores, reviewedAt: Date.now() };
    apply(patch);
    toast({ approved: `${cur.about.name} approved — they can now receive orders`, test: 'Test task sent — due in 48 hours', changes: 'Sent back with your note', rejected: 'Application closed — feedback emailed' }[status]);
    setNote('');
  };

  return (
    <div className="stack g20">
      <span className="small muted">Review the profile, send a short test task, score it, then approve. Experts linked to asuraa.ai have already confirmed their account with a code.</span>
      <div className="row g20" style={{ alignItems: 'flex-start' }}>
        <div className="card stack" style={{ flex: '1 1 300px', maxWidth: 380, padding: 8 }}>
          {list.length === 0 && <span className="small muted" style={{ padding: 12 }}>No applications yet.</span>}
          {list.map((x) => (
            <button key={x.id} type="button" onClick={() => setSel(x.id)} className="stack g4" aria-current={sel === x.id} style={{ textAlign: 'left', border: 0, borderRadius: 10, padding: 12, background: sel === x.id ? 'var(--sunken)' : 'transparent' }}>
              <span className="row between g8"><strong>{x.about.name}{x.mine ? ' (this browser)' : ''}</strong><span className={`badge ${STATUS[x.status]?.[1]}`}>{STATUS[x.status]?.[0]}</span></span>
              <span className="xs muted">{x.about.headline}</span>
              <span className="xs faint">{x.id} · {x.source === 'asuraa.ai' ? 'From asuraa.ai' : x.source === 'document' ? 'From document' : 'Filled manually'} · strength {expertStrength({ ...x, payout: { ...x.payout } })}%</span>
            </button>
          ))}
        </div>
        {cur && (
          <div className="card stack g16" style={{ flex: '3 1 480px', padding: 24, minWidth: 0 }}>
            <div className="row between g12">
              <div className="stack g4"><h2 style={{ fontSize: 24 }}>{cur.about.name}</h2><span className="muted">{cur.about.headline} · {cur.about.city}</span></div>
              {cur.ai && <span className="badge b-signal">asuraa.ai ✓ {cur.ai.url} · ★ {cur.ai.rating}</span>}
            </div>
            <ol className="tl" aria-label="Application steps">
              {[['Profile', true], ['Test sent', !!cur.test], ['Test submitted', !!cur.test?.submitted], ['Decision', ['approved', 'rejected'].includes(cur.status)]].map(([l, done], i, arr) => {
                const now = !done && arr.slice(0, i).every((a) => a[1]);
                return <li key={l} data-state={done ? 'done' : now ? 'now' : 'next'}><span className="dot2">{done ? '✓' : ''}</span><span className="xs">{l}</span></li>;
              })}
            </ol>

            {cur.status === 'testReview' && cur.test?.submitted ? <TestReview key={cur.id} x={cur} onDecide={decide} /> : (
              <>
                <p className="small" style={{ margin: 0 }}>{cur.about.bio}</p>
                <div className="grid-auto g12 small" style={{ '--min': '220px' }}>
                  <span><strong>Domains:</strong> {cur.expertise.domains.join(', ') || '—'}</span>
                  <span><strong>Levels:</strong> {cur.expertise.levels.join(', ') || '—'}</span>
                  <span><strong>Languages:</strong> {cur.about.languages.join(', ')}</span>
                  <span><strong>Capacity:</strong> {cur.services.perWeek}/week{cur.services.rush ? ' · takes rush' : ''}</span>
                  <span><strong>Recruiter years:</strong> {cur.proof.recruiterYears || '—'}</span>
                  <span><strong>Resumes before:</strong> {cur.proof.resumesWritten || '—'}</span>
                </div>
                <div className="stack g4 small"><strong>Experience</strong>{cur.proof.experience.map((e, i) => <span key={i} className="muted">{[e.role, e.company, e.period].filter(Boolean).join(' · ')}</span>)}</div>
                {cur.proof.certs?.length > 0 && <span className="small"><strong>Certifications:</strong> {cur.proof.certs.map((c) => c.name).join(', ')}</span>}
                <span className="small"><strong>LinkedIn:</strong> {cur.proof.linkedin || '—'}</span>
                <div className="stack g4 small"><strong>Samples</strong>{cur.samples.length ? cur.samples.map((s) => <span key={s.name} className="muted">{s.name} · {s.anonymised ? 'anonymised ✓' : 'NOT anonymised'}</span>) : <span className="muted">None — the test task matters more here.</span>}</div>
                <span className="small"><strong>Payout:</strong> {cur.payout.reuseAi ? 'Same as asuraa.ai account' : cur.payout.method === 'bank' ? 'Bank account' : `UPI ${cur.payout.upi || ''}`} · PAN {cur.payout.pan ? `${'•'.repeat(6)}${cur.payout.pan.slice(-4)}` : '—'}</span>

                {cur.status === 'review' && (
                  <div className="stack g8">
                    <span className="well small">Test task for this profile: <strong>{taskById(newTest(cur.expertise.domains).taskId).title}</strong> — a weak sample resume + job post, rewritten in the real workspace within 48 hours.</span>
                    <label htmlFor="rv-note" className="label">Note to the expert (needed for “Needs changes” or “Reject”)</label>
                    <textarea id="rv-note" className="input" rows={3} value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Please add one anonymised before/after sample." />
                    <div className="row g8">
                      <button type="button" className="btn btn-ink" onClick={() => decide('test')}>Send test task</button>
                      <button type="button" className="btn btn-outline" onClick={() => decide('changes')}>Needs changes</button>
                      <button type="button" className="btn btn-ghost" onClick={() => decide('approved')}>Approve without test</button>
                      <button type="button" className="btn btn-ghost" style={{ color: 'var(--danger)' }} onClick={() => decide('rejected')}>Reject</button>
                    </div>
                  </div>
                )}
                {cur.status === 'test' && (
                  <div className="well stack g8 small">
                    <span>Test <strong>{taskById(cur.test.taskId).title}</strong> sent {fmt(cur.test.sentAt)} · due {fmt(cur.test.due)}{cur.test.due < Date.now() ? ' · overdue' : ''}.</span>
                    {cur.test.previous && <span className="muted">Second try — first attempt averaged {scoreOf(cur.test.previous.scores).avg.toFixed(1)}.</span>}
                    <div className="row g8"><button type="button" className="btn btn-outline" style={{ minHeight: 36 }} onClick={() => toast('Reminder sent on WhatsApp and email')}>Send reminder</button><button type="button" className="btn btn-ghost" style={{ minHeight: 36 }} onClick={() => apply({ test: { ...cur.test, due: Date.now() + 24 * H } })}>Extend 24 h</button></div>
                  </div>
                )}
                {['approved', 'rejected', 'changes'].includes(cur.status) && <span className={`badge ${STATUS[cur.status]?.[1]}`} style={{ alignSelf: 'flex-start' }}>{STATUS[cur.status]?.[0]}{cur.note ? ` — “${cur.note}”` : ''}{cur.test?.scores ? ` · test ${scoreOf(cur.test.scores).avg.toFixed(1)}/5` : ''}</span>}
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
