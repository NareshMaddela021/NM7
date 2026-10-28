// Admin → Courses: the free learning links students see after a job match (per missing skill). Free and active only
// are shown; links with tracking or affiliate parts are refused by the server. Owner only.
import { useState } from 'react';
import { useToast } from '../../../components/ui';
import { PageHead } from '../AdminUI';
import { Loading, emptyIf, http, useAction, useApi } from './common';

const blank = { skill: '', title: '', provider: '', url: '', language: 'English', hours: '', free: true, active: true };
const inputStyle = { height: 40 };

function Form({ start, onDone, onCancel }) {
  const toast = useToast();
  const [busy, run] = useAction(toast);
  const [f, setF] = useState(start || blank);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value });
  const save = (e) => {
    e.preventDefault();
    const body = { ...f, hours: f.hours === '' || f.hours == null ? null : Number(f.hours) };
    run(async () => { await (f.id ? http(`/api/admin/courses/${f.id}`, { method: 'PUT', body }) : http('/api/admin/courses', { method: 'POST', body })); onDone(); }, f.id ? 'Saved' : 'Course added');
  };
  return (
    <form className="card stack g12" onSubmit={save} aria-label={f.id ? 'Edit course' : 'New course'} data-testid="course-form">
      <div className="row g12" style={{ flexWrap: 'wrap', alignItems: 'flex-end' }}>
        <label className="small">Skill <input required className="input" style={{ ...inputStyle, width: 180 }} value={f.skill} onChange={set('skill')} placeholder="Python" data-testid="course-skill" /></label>
        <label className="small" style={{ flex: '1 1 220px' }}>Title <input required minLength={2} className="input" style={inputStyle} value={f.title} onChange={set('title')} data-testid="course-title" /></label>
        <label className="small">Provider <input required minLength={2} className="input" style={{ ...inputStyle, width: 180 }} value={f.provider} onChange={set('provider')} placeholder="NPTEL" data-testid="course-provider" /></label>
      </div>
      <div className="row g12" style={{ flexWrap: 'wrap', alignItems: 'flex-end' }}>
        <label className="small" style={{ flex: '1 1 300px' }}>Link (https://, no tracking) <input required className="input" style={inputStyle} value={f.url} onChange={set('url')} data-testid="course-url" /></label>
        <label className="small">Language <input className="input" style={{ ...inputStyle, width: 120 }} value={f.language} onChange={set('language')} /></label>
        <label className="small">Hours <input type="number" min={0} step="0.5" className="input" style={{ ...inputStyle, width: 90 }} value={f.hours ?? ''} onChange={set('hours')} /></label>
        <label className="small row g4"><input type="checkbox" checked={f.free} onChange={set('free')} /> Free</label>
        <label className="small row g4"><input type="checkbox" checked={f.active} onChange={set('active')} /> Active</label>
      </div>
      <span className="xs muted">Only free, active courses are shown to students. No affiliate or sponsored links.</span>
      <div className="row g8"><button type="submit" className="btn btn-ink" disabled={busy} data-testid="course-save">Save</button><button type="button" className="btn btn-outline" onClick={onCancel}>Cancel</button></div>
    </form>
  );
}

/** /admin/courses */
export function LiveCourses() {
  const toast = useToast();
  const st = useApi('/api/admin/courses');
  const [busy, run] = useAction(toast);
  const [edit, setEdit] = useState(null);
  const [q, setQ] = useState('');
  const del = (c) => { if (!window.confirm(`Delete “${c.title}”?`)) return; run(async () => { await http(`/api/admin/courses/${c.id}`, { method: 'DELETE' }); st.reload(); }, 'Deleted'); };
  return (
    <>
      <PageHead title="Courses" sub="Free learning links shown after a job match, for each missing must-have skill (up to 3 per skill)."
        right={<button type="button" className="btn btn-ink" onClick={() => setEdit({})} data-testid="course-new">New course</button>} />
      {edit && <Form key={edit.id || 'new'} start={edit.id ? edit : null} onCancel={() => setEdit(null)} onDone={() => { setEdit(null); st.reload(); }} />}
      <label className="small" style={{ maxWidth: 320 }}>Search <input className="input" style={inputStyle} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Skill, title or provider" /></label>
      <Loading st={st} empty={emptyIf((d) => !d.length, 'No courses yet.')}>{(rows) => {
        const shown = rows.filter((c) => !q.trim() || `${c.skill} ${c.title} ${c.provider}`.toLowerCase().includes(q.trim().toLowerCase()));
        return (
          <div className="card table-wrap" style={{ padding: 0 }}>
            <table className="table" aria-label="Courses"><thead><tr><th>Skill</th><th>Course</th><th>Language</th><th>Hours</th><th>Free</th><th>Active</th><th /></tr></thead>
              <tbody>{shown.map((c) => (
                <tr key={c.id}>
                  <td className="small">{c.skill}</td>
                  <td className="small"><a href={c.url} target="_blank" rel="noopener noreferrer">{c.title}</a><div className="xs faint">{c.provider}</div></td>
                  <td className="small">{c.language}</td>
                  <td className="small">{c.hours ?? '—'}</td>
                  <td className="small">{c.free ? 'Yes' : 'No'}</td>
                  <td className="small">{c.active ? 'Yes' : 'No'}</td>
                  <td><span className="row g8"><button type="button" className="link-btn small" onClick={() => setEdit(c)}>Edit</button><button type="button" className="link-btn small" disabled={busy} onClick={() => del(c)}>Delete</button></span></td>
                </tr>
              ))}</tbody></table>
          </div>
        );
      }}</Loading>
    </>
  );
}
