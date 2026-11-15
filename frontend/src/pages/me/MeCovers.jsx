// Cover letters: one per job, each linked to a resume. Drafted from the resume, editable, PDF / Word in the resume's design.
import { useState } from 'react';
import { useToast } from '../../components/ui';
import { useMe, setMe, newId } from '../../lib/customerStore';
import { draftCover, COVER_BLANK } from '../builder/cover';
import { useJobProfile } from '../../lib/profileStore';
import { targetRoleOf, withProfileContact } from '../../lib/jobProfile';
import { MeHead } from './MeLayout';
import { downloadResume, fmtDay } from './shared';
import { Chip, Empty, FieldGroup, StickyBar } from './kit';
import '../../styles/me-resume.css';

export default function MeCovers() {
  const me = useMe();
  const toast = useToast();
  const [cur, setCur] = useState(null); // the letter being edited
  const jp = useJobProfile();
  const profile = jp.available ? jp.data : null;
  const found = (c) => me.resumes.find((r) => r.id === c.resumeId) || me.resumes[0];
  // the letter's name and contact come from the resume; empty ones from the Job Profile
  const resumeOf = (c) => { const r = found(c); return { ...r, data: withProfileContact(r.data, profile) }; };
  const save = (c) => setMe((s) => ({ covers: s.covers.some((x) => x.id === c.id) ? s.covers.map((x) => (x.id === c.id ? c : x)) : [c, ...s.covers] }));
  const open = (c) => { const full = { ...COVER_BLANK, ...c }; if (!full.body) full.body = draftCover(resumeOf(full).data, full); setCur(full); };

  const fresh = () => open({ id: newId('c'), company: '', role: targetRoleOf(profile), resumeId: me.resumes[0].id, at: Date.now(), jd: '', body: '' });

  return (
    <>
      <MeHead title="Cover letters" sub="Write one per job. It uses the design of the resume you pick."
        right={<button type="button" className="btn btn-signal" onClick={fresh}>New cover letter</button>} />
      <div className={cur ? 'cv-layout' : ''}>
        {me.covers.length === 0 && !cur ? (
          <Empty shape="resume" title="No cover letters yet" action={<button type="button" className="btn btn-outline" onClick={fresh}>Write your first letter</button>}>
            A short letter for each job helps a recruiter see why you fit. We start it from your resume.
          </Empty>
        ) : (
          <ul className={cur ? 'mlist cv-list' : 'mgrid cv-grid'} aria-label="My cover letters">
            {me.covers.map((c) => (
              <li key={c.id}>
                <button type="button" onClick={() => open(c)} aria-pressed={cur?.id === c.id} className={`mcard mcard-link cv-card ${cur?.id === c.id ? 'on' : ''}`}>
                  <span className="cv-card-top"><span className="mcard-ic" aria-hidden="true">✉</span><Chip tone="neutral">{fmtDay(c.at)}</Chip></span>
                  <strong className="cv-card-title">{c.role || 'Untitled'}{c.company ? ` · ${c.company}` : ''}</strong>
                  <span className="mitem-meta">{fmtDay(c.at)} · with “{resumeOf(c).name}”</span>
                  {!cur && c.body && <span className="cv-card-snip" aria-hidden="true">{c.body.slice(0, 140)}…</span>}
                </button>
              </li>
            ))}
          </ul>
        )}
        {cur && (
          <form className="mcard cv-editor" onSubmit={(e) => { e.preventDefault(); save({ ...cur, at: Date.now() }); toast('Saved'); }} aria-label="Cover letter">
            <FieldGroup title="The job" help="Who is it for? The role and company go into the letter.">
              <div className="field"><label htmlFor="cv-co" className="label">Company</label><input id="cv-co" className="input" value={cur.company} onChange={(e) => setCur({ ...cur, company: e.target.value })} /></div>
              <div className="field"><label htmlFor="cv-ro" className="label">Role</label><input id="cv-ro" className="input" value={cur.role} onChange={(e) => setCur({ ...cur, role: e.target.value })} /></div>
              <div className="field"><label htmlFor="cv-hm" className="label">Hiring manager · optional</label><input id="cv-hm" className="input" value={cur.manager || ''} onChange={(e) => setCur({ ...cur, manager: e.target.value })} /></div>
              <div className="field"><label htmlFor="cv-r" className="label">Resume</label><select id="cv-r" className="input" value={cur.resumeId} onChange={(e) => setCur({ ...cur, resumeId: e.target.value })}>{me.resumes.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}</select></div>
              <div className="field full"><label htmlFor="cv-jd" className="label">Job description · optional (we use its skills)</label><textarea id="cv-jd" className="input" rows={3} value={cur.jd || ''} onChange={(e) => setCur({ ...cur, jd: e.target.value })} /></div>
            </FieldGroup>
            <FieldGroup title="Your letter" help="Read every line and change anything that doesn’t sound like you.">
              <div className="field full"><label htmlFor="cv-b" className="label row between"><span>Letter</span><button type="button" className="link-btn xs" onClick={() => setCur({ ...cur, body: draftCover(resumeOf(cur).data, cur) })}>Re-draft from resume</button></label><textarea id="cv-b" className="input cv-body" rows={14} value={cur.body} onChange={(e) => setCur({ ...cur, body: e.target.value })} /></div>
            </FieldGroup>
            <StickyBar label="Letter actions">
              <button type="submit" className="btn btn-signal">Save</button>
              <button type="button" className="btn btn-outline" onClick={async () => { if (await downloadResume(resumeOf(cur).data, 'pdf', cur)) toast('PDF ready'); }}>PDF</button>
              <button type="button" className="btn btn-outline" onClick={async () => { if (await downloadResume(resumeOf(cur).data, 'docx', cur)) toast('Word file ready'); }}>Word</button>
              {me.covers.some((x) => x.id === cur.id) && <button type="button" className="btn btn-ghost" style={{ color: 'var(--danger)' }} onClick={() => { setMe((s) => ({ covers: s.covers.filter((x) => x.id !== cur.id) })); setCur(null); toast('Deleted'); }}>Delete</button>}
            </StickyBar>
          </form>
        )}
      </div>
    </>
  );
}
