// Cover letters: one per job, each linked to a resume. Drafted from the resume, editable, PDF / Word in the resume's design.
import { useState } from 'react';
import { useToast } from '../../components/ui';
import { useMe, setMe, newId } from '../../lib/customerStore';
import { draftCover, COVER_BLANK } from '../builder/cover';
import { MeHead } from './MeLayout';
import { downloadResume, fmtDay } from './shared';

export default function MeCovers() {
  const me = useMe();
  const toast = useToast();
  const [cur, setCur] = useState(null); // the letter being edited
  const resumeOf = (c) => me.resumes.find((r) => r.id === c.resumeId) || me.resumes[0];
  const save = (c) => setMe((s) => ({ covers: s.covers.some((x) => x.id === c.id) ? s.covers.map((x) => (x.id === c.id ? c : x)) : [c, ...s.covers] }));
  const open = (c) => { const full = { ...COVER_BLANK, ...c }; if (!full.body) full.body = draftCover(resumeOf(full).data, full); setCur(full); };

  return (
    <>
      <MeHead title="Cover letters" sub="Write one per job. It uses the design of the resume you pick."
        right={<button type="button" className="btn btn-ink" onClick={() => open({ id: newId('c'), company: '', role: '', resumeId: me.resumes[0].id, at: Date.now(), jd: '', body: '' })}>New cover letter</button>} />
      <div className="row g16" style={{ alignItems: 'flex-start' }}>
        <div className="stack g8" style={{ flex: '1 1 260px', maxWidth: 360 }}>
          {me.covers.length === 0 && <span className="small muted">No cover letters yet.</span>}
          {me.covers.map((c) => (
            <button key={c.id} type="button" onClick={() => open(c)} aria-pressed={cur?.id === c.id} className="card stack g4" style={{ textAlign: 'left', padding: 14, borderColor: cur?.id === c.id ? 'var(--ink)' : undefined }}>
              <strong className="small">{c.role || 'Untitled'}{c.company ? ` · ${c.company}` : ''}</strong>
              <span className="xs muted">{fmtDay(c.at)} · with “{resumeOf(c).name}”</span>
            </button>
          ))}
        </div>
        {cur && (
          <form className="card stack g12" style={{ flex: '3 1 420px' }} onSubmit={(e) => { e.preventDefault(); save({ ...cur, at: Date.now() }); toast('Saved'); }} aria-label="Cover letter">
            <div className="row g8">
              <div className="field" style={{ flex: 1 }}><label htmlFor="cv-co" className="label">Company</label><input id="cv-co" className="input" style={{ height: 42 }} value={cur.company} onChange={(e) => setCur({ ...cur, company: e.target.value })} /></div>
              <div className="field" style={{ flex: 1 }}><label htmlFor="cv-ro" className="label">Role</label><input id="cv-ro" className="input" style={{ height: 42 }} value={cur.role} onChange={(e) => setCur({ ...cur, role: e.target.value })} /></div>
            </div>
            <div className="row g8">
              <div className="field" style={{ flex: 1 }}><label htmlFor="cv-hm" className="label">Hiring manager · optional</label><input id="cv-hm" className="input" style={{ height: 42 }} value={cur.manager || ''} onChange={(e) => setCur({ ...cur, manager: e.target.value })} /></div>
              <div className="field" style={{ flex: 1 }}><label htmlFor="cv-r" className="label">Resume</label><select id="cv-r" className="input" style={{ height: 42 }} value={cur.resumeId} onChange={(e) => setCur({ ...cur, resumeId: e.target.value })}>{me.resumes.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}</select></div>
            </div>
            <div className="field"><label htmlFor="cv-jd" className="label">Job description · optional (we use its skills)</label><textarea id="cv-jd" className="input" rows={3} value={cur.jd || ''} onChange={(e) => setCur({ ...cur, jd: e.target.value })} /></div>
            <div className="field"><label htmlFor="cv-b" className="label row between"><span>Letter</span><button type="button" className="link-btn xs" onClick={() => setCur({ ...cur, body: draftCover(resumeOf(cur).data, cur) })}>Re-draft from resume</button></label><textarea id="cv-b" className="input" rows={14} value={cur.body} onChange={(e) => setCur({ ...cur, body: e.target.value })} /></div>
            <div className="row g8">
              <button type="submit" className="btn btn-ink">Save</button>
              <button type="button" className="btn btn-outline" onClick={async () => { await downloadResume(resumeOf(cur).data, 'pdf', cur); toast('PDF ready'); }}>PDF</button>
              <button type="button" className="btn btn-outline" onClick={async () => { await downloadResume(resumeOf(cur).data, 'docx', cur); toast('Word file ready'); }}>Word</button>
              {me.covers.some((x) => x.id === cur.id) && <button type="button" className="btn btn-ghost" style={{ color: 'var(--danger)' }} onClick={() => { setMe((s) => ({ covers: s.covers.filter((x) => x.id !== cur.id) })); setCur(null); toast('Deleted'); }}>Delete</button>}
            </div>
          </form>
        )}
      </div>
    </>
  );
}
