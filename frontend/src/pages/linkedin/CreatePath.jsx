// Path 2, "I don't have one yet": from one of the person's Nm7 resumes (one tap), from details they type or speak,
// or both. Free: 5 headline options and the step-by-step guide (English, Telugu, Hindi). The full profile text
// and the banner are locked "Coming soon". Only the person's own facts are used; the output is always English.
import { useState } from 'react';
import { useAuth } from '../../lib/auth';
import { activeResume, useMe } from '../../lib/customerStore';
import { canSave, saveLinkedIn, writeHeadlines } from '../../lib/linkedin/api';
import { LANGS, REVIEW_NOTE, guideSteps } from '../../lib/linkedin/guide';
import { packRequest } from '../../lib/linkedin/pack';
import { headlineFacts } from '../../lib/linkedin/headlines';
import { fromResumeData } from '../../lib/linkedin/profile';
import Pack from './Pack';
import { CopyButton, NoteBox } from './parts';

const EMPTY = { name: '', city: '', role: '', education: [{ degree: '', school: '', year: '' }], work: [], skills: '', projects: '', certs: '' };
const NEED = 'Add the job you want, a few skills or your degree, or pick one of your resumes.';

function Input({ id, label, value, onChange, ...rest }) {
  return (
    <div className="field" style={{ flex: '1 1 200px', minWidth: 0 }}>
      <label className="label" htmlFor={id}>{label}</label>
      <input id={id} className="input" value={value} onChange={(e) => onChange(e.target.value)} {...rest} />
    </div>
  );
}

export default function CreatePath({ saved }) {
  const auth = useAuth();
  const me = useMe();
  const resumes = auth.user?.role === 'customer' && !me.loading ? (me.resumes || []) : [];
  const [picked, setPicked] = useState(null);
  const [d, setD] = useState({ ...EMPTY, ...(saved?.path === 'create' ? saved.details : {}) });
  const [note, setNote] = useState(saved?.path === 'create' ? saved.details?.note || '' : '');
  const [out, setOut] = useState(null); // { headlines, notice, facts, sections }
  const [busy, setBusy] = useState(false);
  const [choice, setChoice] = useState(0);
  const [lang, setLang] = useState('en');
  const [msg, setMsg] = useState('');
  const set = (k) => (v) => setD({ ...d, [k]: v });
  const accent = (activeResume(me)?.data?.design?.accent && resumes.length ? activeResume(me).data.design.accent : null) || '#111827';
  /** What the LinkedIn pack is written from: the picked resume and / or the details, and the note. */
  const packBody = () => {
    const resume = resumes.find((r) => r.id === picked);
    const details = { ...d, education: d.education.filter((e) => e.degree || e.school), work: d.work.filter((w) => w.title), name: d.name || auth.user?.name || '' };
    const profile = resume ? fromResumeData(resume.data) : {};
    const role = d.role || roleOf(resume);
    if (!role && !d.skills && !details.education.length && !resume) return null;
    return packRequest({ path: 'create', role, profile, details, note });
  };
  const setEdu = (i, k, v) => setD({ ...d, education: d.education.map((e, j) => (j === i ? { ...e, [k]: v } : e)) });
  const setWork = (i, k, v) => setD({ ...d, work: d.work.map((e, j) => (j === i ? { ...e, [k]: v } : e)) });

  const make = async () => {
    setMsg('');
    const resume = resumes.find((r) => r.id === picked);
    const sections = resume ? fromResumeData(resume.data) : null;
    const details = { ...d, education: d.education.filter((e) => e.degree || e.school), work: d.work.filter((w) => w.title) };
    const facts = headlineFacts({ sections, details, role: d.role || roleOf(resume), note });
    if (!facts.target && !facts.skills.length && !facts.degree) { setOut(null); setMsg(NEED); return; }
    setBusy(true);
    const res = await writeHeadlines(facts, { note, count: 5 }).catch(() => ({ headlines: [], notice: '' }));
    setBusy(false);
    setChoice(0);
    const experience = [...(sections?.experience || []), ...details.work.map((w) => ({ title: w.title, company: w.company }))];
    setOut({ headlines: res.headlines, notice: res.notice, facts, experience });
    if (canSave()) {
      const source = resume && Object.values(details).some((v) => (Array.isArray(v) ? v.length : v)) ? 'both' : resume ? 'resume' : 'details';
      saveLinkedIn({ path: 'create', targetRole: facts.target, source, details: { ...details, note, resumeId: resume?.id || '' }, result: { headlines: res.headlines, createdAt: Date.now() } }).catch(() => {});
    }
  };

  const steps = out ? guideSteps(lang, { headline: out.headlines[choice] || '', skills: out.facts.skills, experience: out.experience, role: out.facts.target }) : [];
  const review = LANGS.find((l) => l.id === lang)?.review;

  return (
    <div className="stack g20">
      {!!resumes.length && (
        <section className="card stack g12" aria-labelledby="li-res-pick-h">
          <h2 id="li-res-pick-h" className="h3" style={{ margin: 0 }}>Start from your resume</h2>
          <div className="row g8" role="group" aria-label="Your resumes" style={{ flexWrap: 'wrap' }}>
            {resumes.map((r) => (
              <button key={r.id} type="button" className="chip" aria-pressed={picked === r.id} data-testid="li-resume" onClick={() => setPicked(picked === r.id ? null : r.id)} style={{ minHeight: 44 }}>
                {r.name || 'My resume'}
              </button>
            ))}
          </div>
          <span className="xs muted">One tap. You can add details below too.</span>
        </section>
      )}

      <section className="card stack g12" aria-labelledby="li-details-h">
        <h2 id="li-details-h" className="h3" style={{ margin: 0 }}>{resumes.length ? 'Or add details' : 'Your details'}</h2>
        <div className="row g12" style={{ flexWrap: 'wrap' }}>
          <Input id="li-d-name" label="Name" value={d.name} onChange={set('name')} autoComplete="name" />
          <Input id="li-d-city" label="City" value={d.city} onChange={set('city')} autoComplete="address-level2" />
        </div>
        <Input id="li-d-role" label="The job you want" value={d.role} onChange={set('role')} placeholder="e.g. Data Analyst" maxLength={100} />
        {d.education.map((e, i) => (
          <div key={i} className="row g12" style={{ flexWrap: 'wrap' }}>
            <Input id={`li-d-deg-${i}`} label="Degree or course" value={e.degree} onChange={(v) => setEdu(i, 'degree', v)} placeholder="e.g. B.Tech Computer Science" />
            <Input id={`li-d-sch-${i}`} label="College or school" value={e.school} onChange={(v) => setEdu(i, 'school', v)} />
            <Input id={`li-d-yr-${i}`} label="Year" value={e.year} onChange={(v) => setEdu(i, 'year', v.replace(/\D/g, '').slice(0, 4))} inputMode="numeric" style={{ maxWidth: 120 }} />
          </div>
        ))}
        <button type="button" className="link-btn small" style={{ alignSelf: 'flex-start' }} onClick={() => setD({ ...d, education: [...d.education, { degree: '', school: '', year: '' }] })}>+ Add education</button>
        <div className="stack g8">
          <span className="label">Work or internships <span className="xs muted" style={{ fontWeight: 400 }}>· optional</span></span>
          {d.work.map((w, i) => (
            <div key={i} className="row g12" style={{ flexWrap: 'wrap', alignItems: 'flex-end' }}>
              <Input id={`li-d-wt-${i}`} label="Title" value={w.title} onChange={(v) => setWork(i, 'title', v)} />
              <Input id={`li-d-wc-${i}`} label="Company" value={w.company} onChange={(v) => setWork(i, 'company', v)} />
              <label className="row g8 small" style={{ minHeight: 44, alignItems: 'center' }}><input type="checkbox" checked={!!w.current} onChange={(e) => setWork(i, 'current', e.target.checked)} />I work here now</label>
            </div>
          ))}
          <button type="button" className="link-btn small" style={{ alignSelf: 'flex-start' }} onClick={() => setD({ ...d, work: [...d.work, { title: '', company: '', current: false }] })}>+ Add work or internship</button>
        </div>
        <div className="field">
          <label className="label" htmlFor="li-d-skills">Skills</label>
          <textarea id="li-d-skills" className="input" rows={2} value={d.skills} onChange={(e) => set('skills')(e.target.value)} placeholder="e.g. Excel, SQL, Power BI" />
        </div>
        <div className="row g12" style={{ flexWrap: 'wrap' }}>
          <div className="field" style={{ flex: '1 1 240px' }}>
            <label className="label" htmlFor="li-d-proj">Projects <span className="xs muted" style={{ fontWeight: 400 }}>· one per line</span></label>
            <textarea id="li-d-proj" className="input" rows={2} value={d.projects} onChange={(e) => set('projects')(e.target.value)} />
          </div>
          <div className="field" style={{ flex: '1 1 240px' }}>
            <label className="label" htmlFor="li-d-certs">Certificates <span className="xs muted" style={{ fontWeight: 400 }}>· one per line</span></label>
            <textarea id="li-d-certs" className="input" rows={2} value={d.certs} onChange={(e) => set('certs')(e.target.value)} />
          </div>
        </div>
        <NoteBox note={note} onNote={setNote} />
        <button type="button" className="btn btn-ink btn-lg" data-testid="li-make" onClick={make} disabled={busy} style={{ alignSelf: 'flex-start' }}>{busy ? 'Writing…' : 'Make my LinkedIn plan'}</button>
        {msg && <p className="small" role="alert" data-testid="li-need" style={{ margin: 0 }}>{msg}</p>}
      </section>

      {out && (
        <>
          <section className="card stack g12" aria-labelledby="li-h-h" data-testid="li-headlines">
            <h2 id="li-h-h" className="h3" style={{ margin: 0 }}>5 headline options</h2>
            <p className="xs muted" style={{ margin: 0 }}>Pick one for your guide. Each is under LinkedIn’s 220 characters and uses only what you told us.</p>
            {out.notice && <span className="xs muted" data-testid="li-ai-notice">{out.notice}</span>}
            <ul className="stack g8" style={{ listStyle: 'none', margin: 0, padding: 0 }}>
              {out.headlines.map((h, i) => (
                <li key={h} className="well row between g8" style={{ alignItems: 'center', flexWrap: 'wrap' }}>
                  <label className="row g8" style={{ flex: '1 1 220px', alignItems: 'flex-start', minWidth: 0 }}>
                    <input type="radio" name="li-pick" checked={choice === i} onChange={() => setChoice(i)} style={{ marginTop: 4 }} />
                    <span data-testid="li-option" style={{ overflowWrap: 'anywhere' }}>{h}</span>
                  </label>
                  <CopyButton text={h} />
                </li>
              ))}
            </ul>
          </section>

          <section className="card stack g12" aria-labelledby="li-g-h" data-testid="li-guide">
            <div className="row between g8" style={{ flexWrap: 'wrap', alignItems: 'center' }}>
              <h2 id="li-g-h" className="h3" style={{ margin: 0 }}>Create your LinkedIn</h2>
              <div className="segmented" role="group" aria-label="Guide language">
                {LANGS.map((l) => <button key={l.id} type="button" aria-pressed={lang === l.id} lang={l.id} onClick={() => setLang(l.id)}>{l.label}</button>)}
              </div>
            </div>
            {review && <span className="xs" data-testid="li-review" style={{ color: 'var(--warning)', fontWeight: 700 }}>{REVIEW_NOTE} · the text to paste stays in English</span>}
            <ol className="stack g12" style={{ listStyle: 'none', margin: 0, padding: 0 }} lang={lang}>
              {steps.map((s) => (
                <li key={s.id} className="well stack g8" data-testid={`li-step-${s.id}`}>
                  <strong>{s.n}. {s.title}</strong>
                  <span className="small">{s.body}</span>
                  {s.copy && (
                    <div className="stack g8" lang="en">
                      <span className="small mono" style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{s.copy}</span>
                      <CopyButton text={s.copy} testid={`li-copy-${s.id}`} />
                    </div>
                  )}
                  {s.locked && <span className="xs muted" lang="en">🔒 {s.locked.title}: in the LinkedIn pack below</span>}
                </li>
              ))}
            </ol>
          </section>
        </>
      )}

      <Pack request={packBody} accent={accent} />
    </div>
  );
}

const roleOf = (resume) => {
  const h = resume?.data?.personal?.headline || '';
  return h.split(/\s*[|·•,]\s*/)[0] || '';
};
