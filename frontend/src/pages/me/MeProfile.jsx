// Job Profile: the customer's master career record. Every resume can start from it, and each builder section
// can be filled from it. Autosaved to the server.
import { useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Dialog, Meter, Spinner, useToast } from '../../components/ui';
import PhotoImport from '../builder/PhotoImport';
import { reviewToResume } from '../../lib/photoImport';
import { useMe, activeResume, getMe, setResumeData, blankResume } from '../../lib/customerStore';
import { useJobProfile, setJobProfile, setPrivacy, reloadJobProfile } from '../../lib/profileStore';
import { EXTRA_TITLE, mergeIntoProfile, newPid, profileCompleteness, profileToResume, resumeToProfileParts } from '../../lib/jobProfile';
import SummaryWriter from '../builder/SummaryWriter';
import { DECL_FIELDS, EXP_LEVELS, LINK_SLOTS, LINK_WORDS, LINK_WORD_MAX, LISTS, PINFO_FIELDS, fieldError } from '../builder/schema';
import { FieldGrid, LinkFields, SchemaField } from '../builder/Fields';
import { EntryHeader, focusMoved } from '../builder/EntryControls';
import LineEntries from '../builder/LineEntries';
import { moveItem, removeItem, toggleItem } from '../builder/entries';
import { HOBBY_IDEAS, STRENGTH_IDEAS } from '../builder/schema';
import { MeHead } from './MeLayout';

const f = (key, label, type = 'text', extra = {}) => ({ key, label, type, ...extra });
const BASICS = [
  f('name', 'Full name', 'text', { full: true }), f('headline', 'Headline / target role', 'text', { full: true, ph: 'e.g. Data Analyst · SQL · Power BI' }),
  f('email', 'Email', 'email'), f('phone', 'Phone', 'tel'), f('location', 'City'), f('level', 'Experience level', 'select', { options: EXP_LEVELS }),
];
const LINKS = [f('linkedin', 'LinkedIn', 'url', { ph: 'linkedin.com/in/you' }), f('github', 'GitHub', 'url', { ph: 'github.com/you' }), f('portfolio', 'Portfolio / website', 'url', { ph: 'yourname.dev' })];
const SECTIONS = [
  ['basics', 'Basics'], ['summary', 'Summary'], ['exp', 'Experience'], ['intern', 'Internships'], ['proj', 'Projects'], ['edu', 'Education'],
  ['certs', 'Certifications'], ['skills', 'Skills'], ['ach', 'Achievements'], ['langs', 'Languages'], ['extra', 'Extracurricular'],
  ['hobbies', 'Hobbies'], ['strengths', 'Strengths'], ['pinfo', 'Personal information'], ['decl', 'Declaration'], ['privacy', 'Privacy'],
];
const LIST_DEF = {
  exp: { schema: LISTS.exp, item: 'Experience', kind: 'exp' },
  intern: { schema: { ...LISTS.exp, blank: { ...LISTS.exp.blank, employmentType: 'Internship' } }, item: 'Internship', kind: 'exp' },
  proj: { schema: LISTS.proj, item: 'Project', kind: 'proj' },
  edu: { schema: LISTS.edu, item: 'Education', kind: 'edu' },
  certs: { schema: LISTS.certs, item: 'Certification', kind: 'certs' },
  ach: { schema: LISTS.ach, item: 'Achievement', kind: 'ach' },
  langs: { schema: LISTS.langs, item: 'Language', kind: 'langs' },
  extra: { schema: LISTS.custom, item: 'Activity', kind: 'custom' },
};

const touch = (x) => ({ ...x, pu: Date.now() });

function Section({ id, title, sub, children, badge }) {
  return (
    <section id={`pf-${id}`} className="card stack g12" style={{ padding: 20, scrollMarginTop: 90 }} aria-labelledby={`pf-${id}-h`}>
      <div className="stack g4"><h2 id={`pf-${id}-h`} style={{ fontSize: 20 }}>{title}{badge && <span className="badge b-neutral" style={{ marginLeft: 8, fontSize: 11, verticalAlign: 'middle' }}>{badge}</span>}</h2>{sub && <span className="xs muted">{sub}</span>}</div>
      {children}
    </section>
  );
}

function EntryList({ p, k }) {
  const { schema, item, kind } = LIST_DEF[k];
  const list = p[k];
  const setList = (fn) => setJobProfile((x) => ({ ...x, [k]: fn(x[k]) }));
  const setItem = (i, key, v) => setList((l) => l.map((x, j) => (j === i ? touch({ ...x, [key]: v }) : x)));
  return (
    <div className="stack g12">
      {list.length === 0 && <span className="small muted">Nothing here yet.</span>}
      {list.map((obj, i) => {
        const label = `${item} ${i + 1}`;
        return (
          <div key={obj.pid || i} className="well stack g12 entry-card" data-off={!!obj.off} style={{ padding: 16 }}>
            <EntryHeader list={`pf-${k}`} index={i} count={list.length} label={label} off={!!obj.off}
              onMove={(dir) => { setList((l) => moveItem(l, i, dir)); focusMoved(`pf-${k}`, i + dir, dir); }}
              onToggle={() => setList((l) => toggleItem(l, i).map((x, j) => (j === i ? touch(x) : x)))}
              onRemove={() => setList((l) => removeItem(l, i))} />
            <div className="entry-body">
              <FieldGrid>
                {schema.fields.map((fd, fi) => {
                  const field = <SchemaField key={fd.key} field={fd} idBase={`pf-${k}-${i}`} value={obj[fd.key]} entry={obj} disabled={fd.disabledBy ? !!obj[fd.disabledBy] : false} onChange={(v) => setItem(i, fd.key, v)} />;
                  const titleIdx = kind === 'exp' ? 1 : 0;
                  if (!LINK_SLOTS[kind] || fi !== titleIdx) return field;
                  return [field, <LinkFields key="links" idBase={`pf-${k}-${i}`} links={obj.links} slots={LINK_SLOTS[kind]} words={LINK_WORDS[kind]} max={LINK_WORD_MAX} error={(u) => fieldError('url', u)} onChange={(v) => setItem(i, 'links', v)} />];
                })}
              </FieldGrid>
            </div>
          </div>
        );
      })}
      <button type="button" className="btn btn-outline" style={{ borderStyle: 'dashed', alignSelf: 'flex-start' }} onClick={() => setList((l) => [...l, { ...structuredClone(schema.blank), pid: newPid(), pu: Date.now() }])}>+ Add {item.toLowerCase()}</button>
    </div>
  );
}

const ObjFields = ({ k, fields, p }) => (
  <FieldGrid>{fields.map((fd) => <SchemaField key={fd.key} field={fd} idBase={`pf-${k}`} value={p[k][fd.key]} onChange={(v) => setJobProfile((x) => ({ ...x, [k]: { ...x[k], [fd.key]: v } }))} />)}</FieldGrid>
);

/** Import: an old resume, a LinkedIn PDF, or one of my resumes. Only adds what's missing. */
function Importer({ p }) {
  const me = useMe();
  const toast = useToast();
  const [busy, setBusy] = useState('');
  const [pick, setPick] = useState('');
  const files = { resume: useRef(), linkedin: useRef() };
  const [snap, setSnap] = useState(false); // "Import from photos" open
  const merge = (data, what) => {
    const { profile, added } = mergeIntoProfile(p, resumeToProfileParts(data));
    setJobProfile(profile);
    toast(added ? `Added ${added} item${added === 1 ? '' : 's'} from ${what} — check each section` : `Nothing new in ${what}`);
  };
  const fromFile = async (file, mode) => {
    if (!file) return;
    setBusy(mode);
    try {
      const { importResume } = await import('../../lib/import/index');
      const R = await importResume(file, mode, () => {});
      merge(R.data, file.name);
    } catch (e) { toast(e?.message || 'We couldn’t read that file. Try another copy.'); } finally { setBusy(''); }
  };
  return (
    <section className="card stack g12" style={{ padding: 20 }} aria-labelledby="pf-import-h">
      <h2 id="pf-import-h" style={{ fontSize: 20 }}>Fill your profile faster</h2>
      <span className="xs muted">We only add what your profile doesn’t have yet — nothing you typed is overwritten.</span>
      <div className="row g8">
        {[['resume', 'Upload my old resume (PDF or Word)'], ['linkedin', 'Upload my LinkedIn PDF']].map(([mode, label]) => (
          <label key={mode} className="btn btn-outline" style={{ cursor: 'pointer' }}>
            {busy === mode ? <Spinner /> : null}{label}
            <input ref={files[mode]} type="file" accept=".pdf,.docx,application/pdf" className="sr-only" aria-label={label} disabled={!!busy} onChange={(e) => { const fl = e.target.files?.[0]; e.target.value = ''; fromFile(fl, mode); }} />
          </label>
        ))}
        <button type="button" className="btn btn-outline" onClick={() => setSnap(true)}>Import from photos</button>
      </div>
      {snap && (
        <Dialog wide showTitle title="Import from photos" onClose={() => setSnap(false)}>
          <PhotoImport embedded title="Import from photos" doneLabel="Add to my Job Profile" onBack={() => setSnap(false)}
            onDone={(review) => { merge(reviewToResume(review, blankResume()), 'your photos'); setSnap(false); }} />
        </Dialog>
      )}
      {me.resumes?.length > 0 && (
        <form className="row g8" style={{ alignItems: 'flex-end' }} onSubmit={(e) => { e.preventDefault(); const r = me.resumes.find((x) => x.id === pick); if (r) merge(r.data, `“${r.name}”`); }}>
          <div className="field" style={{ flex: '1 1 220px' }}>
            <label htmlFor="pf-copy" className="label">Copy from one of my resumes</label>
            <select id="pf-copy" className="input" style={{ height: 42 }} value={pick} onChange={(e) => setPick(e.target.value)}>
              <option value="">Choose a resume…</option>
              {me.resumes.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
            </select>
          </div>
          <button type="submit" className="btn btn-outline" disabled={!pick}>Copy into profile</button>
        </form>
      )}
    </section>
  );
}

export default function MeProfile() {
  const pr = useJobProfile();
  const toast = useToast();
  if (pr.loading || (!pr.data && pr.available && !pr.error)) return <><MeHead title="Job Profile" /><div className="row g12 muted" role="status"><Spinner /> Loading your Job Profile…</div></>;
  if (!pr.available) {
    return (
      <>
        <MeHead title="Job Profile" />
        <div className="card stack g8" role="status"><strong>Your Job Profile is being switched on.</strong><span className="small muted">Our server is being updated — please try again a little later. Your resumes and orders work as usual.</span>
          <button type="button" className="btn btn-outline" style={{ alignSelf: 'flex-start' }} onClick={reloadJobProfile}>Try again</button></div>
      </>
    );
  }
  if (pr.error) return <><MeHead title="Job Profile" /><div className="card stack g8" role="alert"><strong>We couldn’t load your Job Profile.</strong><span className="small muted">{pr.error}</span><button type="button" className="btn btn-outline" style={{ alignSelf: 'flex-start' }} onClick={reloadJobProfile}>Try again</button></div></>;
  const p = pr.data;
  const { pct, missing } = profileCompleteness(p);
  const fillResume = () => {
    const r = activeResume(getMe());
    if (!r) return;
    const d = r.data;
    const next = { ...d, personal: { ...d.personal, name: p.personal.name || d.personal.name, email: p.personal.email || d.personal.email, phone: p.personal.phone || d.personal.phone, location: p.personal.location || d.personal.location, headline: d.personal.headline || p.personal.headline, level: p.personal.level || d.personal.level }, links: { ...d.links, ...Object.fromEntries(Object.entries(p.links).filter(([, v]) => v)) }, prefs: { ...d.prefs, locations: p.prefs.cities || d.prefs?.locations } };
    setResumeData(r.id, next);
    toast(`Filled your contact details into “${r.name}”`);
  };
  const setSummary = (i, patch) => setJobProfile((x) => ({ ...x, summaries: x.summaries.map((s, j) => (j === i ? { ...s, ...patch } : s)) }));
  return (
    <>
      <MeHead title="Job Profile" sub="Your master career record. Start any resume from it, or fill a section of a resume with one click." right={<span className="xs muted" aria-live="polite">{pr.saving ? 'Saving…' : 'All changes saved'}</span>} />
      <section className="card stack g8" aria-label="Profile completeness">
        <div className="row between"><strong>Profile complete: {pct}%</strong><Link to="/builder" state={{ open: 'start' }} className="btn btn-ink" style={{ minHeight: 38 }}>Start a resume from it</Link></div>
        <Meter value={pct} color={pct >= 80 ? 'var(--success)' : pct >= 40 ? 'var(--warning)' : 'var(--text3)'} label="Profile complete" />
        {missing.length > 0 && <span className="small muted">Missing: {missing.join(' · ')}</span>}
        <div className="row g8"><button type="button" className="btn btn-outline" onClick={fillResume}>Fill these into my resume</button><span className="xs faint">Copies your name, contact details and links into the resume you’re editing.</span></div>
      </section>
      <nav aria-label="Profile sections" className="row g8" style={{ flexWrap: 'wrap' }}>
        {SECTIONS.map(([id, l]) => <a key={id} href={`#pf-${id}`} className="chip" style={{ minHeight: 32, fontSize: 13 }} onClick={(e) => { e.preventDefault(); document.getElementById(`pf-${id}`)?.scrollIntoView({ behavior: 'smooth' }); }}>{l}</a>)}
      </nav>
      <Importer p={p} />

      <Section id="basics" title="Basics"><ObjFields k="personal" fields={BASICS} p={p} /><ObjFields k="links" fields={LINKS} p={p} /></Section>

      <Section id="summary" title="Summary" sub="Keep 2–3 versions for different roles. The first one that’s on is used for new resumes.">
        <div className="well stack g8" style={{ padding: 16 }} aria-label="About me">
          <strong>About me</strong>
          <SummaryWriter resume={profileToResume(p)} note={p.about || ''} onNote={(v) => setJobProfile((x) => ({ ...x, about: v }))}
            value={(p.summaries.find((s) => !s.off) || p.summaries[0])?.text || ''}
            onUse={(t) => setJobProfile((x) => { const i = Math.max(0, x.summaries.findIndex((s) => !s.off)); return { ...x, summaries: x.summaries.map((s, j) => (j === i ? { ...s, text: t } : s)) }; })} />
        </div>
        {p.summaries.map((s, i) => (
          <div key={s.id} className="well stack g8 entry-card" data-off={!!s.off} style={{ padding: 16 }}>
            <EntryHeader list="pf-summary" index={i} count={p.summaries.length} label={`Summary ${i + 1}`} title={s.name || `Summary ${i + 1}`} off={!!s.off}
              onMove={(dir) => { setJobProfile((x) => ({ ...x, summaries: moveItem(x.summaries, i, dir) })); focusMoved('pf-summary', i + dir, dir); }}
              onToggle={() => setJobProfile((x) => ({ ...x, summaries: toggleItem(x.summaries, i) }))}
              onRemove={p.summaries.length > 1 ? () => setJobProfile((x) => ({ ...x, summaries: removeItem(x.summaries, i) })) : null} />
            <div className="entry-body stack g8">
              <div className="field"><label htmlFor={`pf-sum-n-${i}`} className="label">Name of this version</label><input id={`pf-sum-n-${i}`} className="input" maxLength={40} value={s.name} placeholder="e.g. Data roles" onChange={(e) => setSummary(i, { name: e.target.value })} /></div>
              <div className="field"><label htmlFor={`pf-sum-${i}`} className="label">Summary</label><textarea id={`pf-sum-${i}`} className="input" rows={4} value={s.text} onChange={(e) => setSummary(i, { text: e.target.value })} /></div>
            </div>
          </div>
        ))}
        {p.summaries.length < 3 && <button type="button" className="btn btn-outline" style={{ borderStyle: 'dashed', alignSelf: 'flex-start' }} onClick={() => setJobProfile((x) => ({ ...x, summaries: [...x.summaries, { id: newPid(), name: `Version ${x.summaries.length + 1}`, text: '' }] }))}>+ Add a summary version</button>}
      </Section>

      <Section id="exp" title="Experience" sub="Jobs, most recent first."><EntryList p={p} k="exp" /></Section>
      <Section id="intern" title="Internships" sub="They go into a resume’s Experience section."><EntryList p={p} k="intern" /></Section>
      <Section id="proj" title="Projects"><EntryList p={p} k="proj" /></Section>
      <Section id="edu" title="Education"><EntryList p={p} k="edu" /></Section>
      <Section id="certs" title="Certifications"><EntryList p={p} k="certs" /></Section>
      <Section id="skills" title="Skills" sub="Grouped like on your resume. Separate items with commas.">
        {p.skillGroups.map((g, gi) => (
          <div key={g.pid || g.id} className="well stack g8 entry-card" data-off={!!g.off} style={{ padding: 12 }}>
            <EntryHeader list="pf-skills" index={gi} count={p.skillGroups.length} label={`Skills category ${gi + 1}`} title={g.label || `Category ${gi + 1}`} off={!!g.off}
              onMove={(dir) => { setJobProfile((x) => ({ ...x, skillGroups: moveItem(x.skillGroups, gi, dir) })); focusMoved('pf-skills', gi + dir, dir); }}
              onToggle={() => setJobProfile((x) => ({ ...x, skillGroups: toggleItem(x.skillGroups, gi) }))}
              onRemove={() => setJobProfile((x) => ({ ...x, skillGroups: removeItem(x.skillGroups, gi) }))} />
            <div className="entry-body row g8">
              <div className="field" style={{ flex: '1 1 160px' }}><label htmlFor={`pf-sg-l-${gi}`} className="label">Category</label><input id={`pf-sg-l-${gi}`} className="input" value={g.label} onChange={(e) => setJobProfile((x) => ({ ...x, skillGroups: x.skillGroups.map((y, j) => (j === gi ? touch({ ...y, label: e.target.value }) : y)) }))} /></div>
              <div className="field" style={{ flex: '3 1 260px' }}><label htmlFor={`pf-sg-${gi}`} className="label">Skills</label><input id={`pf-sg-${gi}`} className="input" value={g.value} placeholder="Python, SQL, Excel" onChange={(e) => setJobProfile((x) => ({ ...x, skillGroups: x.skillGroups.map((y, j) => (j === gi ? touch({ ...y, value: e.target.value }) : y)) }))} /></div>
            </div>
          </div>
        ))}
        <button type="button" className="btn btn-outline" style={{ borderStyle: 'dashed', alignSelf: 'flex-start' }} onClick={() => setJobProfile((x) => ({ ...x, skillGroups: [...x.skillGroups, { id: `g_${Date.now()}`, label: '', value: '', pid: newPid(), pu: Date.now() }] }))}>+ Add a category</button>
      </Section>
      <Section id="ach" title="Achievements"><EntryList p={p} k="ach" /></Section>
      <Section id="langs" title="Languages"><EntryList p={p} k="langs" /></Section>
      <Section id="extra" title="Extracurricular" sub={`Clubs, volunteering, positions of responsibility. Goes into a resume’s “${EXTRA_TITLE}” section.`}><EntryList p={p} k="extra" /></Section>
      <Section id="hobbies" title="Hobbies"><LineEntries d={p} setD={setJobProfile} k="hobbies" item="Hobby" ideas={HOBBY_IDEAS} placeholder="e.g. Playing cricket" /></Section>
      <Section id="strengths" title="Strengths"><LineEntries d={p} setD={setJobProfile} k="strengths" item="Strength" ideas={STRENGTH_IDEAS} placeholder="e.g. Team player" /></Section>
      <Section id="pinfo" title="Personal information" badge="Private" sub="Only used on resumes where you switch on “Personal Information”. Never sent to experts unless you allow it below."><ObjFields k="pinfo" fields={PINFO_FIELDS} p={p} /></Section>
      <Section id="decl" title="Declaration"><ObjFields k="decl" fields={DECL_FIELDS} p={p} /></Section>
      <Section id="privacy" title="Privacy" sub="Experts only see what you allow here.">
        <label className="row g8 small"><input type="checkbox" role="switch" checked={pr.privacy.experts} onChange={(e) => setPrivacy({ experts: e.target.checked, ...(e.target.checked ? {} : { personal: false }) })} />Let my expert see my Job Profile while they work on my order</label>
        <label className="row g8 small" style={{ paddingLeft: 24, opacity: pr.privacy.experts ? 1 : 0.5 }}><input type="checkbox" role="switch" disabled={!pr.privacy.experts} checked={pr.privacy.personal} onChange={(e) => setPrivacy({ personal: e.target.checked })} />…including my personal information</label>
      </Section>
    </>
  );
}
