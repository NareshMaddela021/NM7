// Admin -> Courses: the free learning links students see after a job match (per missing skill). Free and active only
// are shown; links with tracking or affiliate parts are refused by the server. Owner only.
import { useState } from 'react';
import { useToast } from '../../../components/ui';
import { Chip } from '../../me/kit';
import { Hero } from './SetupKit';
import { Loading, emptyIf, http, useAction, useApi } from './common';
import { IcBook } from '../../../components/icons';

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
    <form className="mcard" onSubmit={save} aria-label={f.id ? 'Edit course' : 'New course'} data-testid="course-form">
      <header className="mcard-h"><span className="mcard-ic violet" aria-hidden="true"><IcBook /></span><span className="mcard-ht"><h2 className="mcard-title">{f.id ? 'Edit course' : 'New course'}</h2><span className="mcard-sub">Only free, active courses are shown to students. No affiliate or sponsored links.</span></span></header>
      <div className="as-bar" style={{ background: '#faf9ff' }}>
        <label className="small">Skill <input required className="input" style={{ ...inputStyle, width: 180 }} value={f.skill} onChange={set('skill')} placeholder="Python" data-testid="course-skill" /></label>
        <label className="small" style={{ flex: '1 1 220px' }}>Title <input required minLength={2} className="input" style={inputStyle} value={f.title} onChange={set('title')} data-testid="course-title" /></label>
        <label className="small">Provider <input required minLength={2} className="input" style={{ ...inputStyle, width: 180 }} value={f.provider} onChange={set('provider')} placeholder="NPTEL" data-testid="course-provider" /></label>
      </div>
      <div className="as-bar" style={{ background: '#faf9ff' }}>
        <label className="small" style={{ flex: '1 1 300px' }}>Link (https://, no tracking) <input required className="input" style={inputStyle} value={f.url} onChange={set('url')} data-testid="course-url" /></label>
        <label className="small">Language <input className="input" style={{ ...inputStyle, width: 120 }} value={f.language} onChange={set('language')} /></label>
        <label className="small">Hours <input type="number" min={0} step="0.5" className="input" style={{ ...inputStyle, width: 90 }} value={f.hours ?? ''} onChange={set('hours')} /></label>
        <label className="small row g4"><input type="checkbox" checked={f.free} onChange={set('free')} /> Free</label>
        <label className="small row g4"><input type="checkbox" checked={f.active} onChange={set('active')} /> Active</label>
      </div>
      <div className="as-actions"><button type="submit" className="btn btn-signal" disabled={busy} data-testid="course-save">Save</button><button type="button" className="btn btn-outline" onClick={onCancel}>Cancel</button></div>
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
      <Hero icon={<IcBook />} title="Courses" sub="Free learning links shown after a job match, for each missing must-have skill (up to 3 per skill)."
        stats={st.data?.length ? [['Courses', st.data.length], ['Shown to students', st.data.filter((c) => c.free && c.active).length, 'ok'], ['Skills covered', new Set(st.data.map((c) => c.skill.toLowerCase())).size, 'accent']] : null}
        right={<button type="button" className="btn btn-signal" onClick={() => setEdit({})} data-testid="course-new">New course</button>} />
      {edit && <Form key={edit.id || 'new'} start={edit.id ? edit : null} onCancel={() => setEdit(null)} onDone={() => { setEdit(null); st.reload(); }} />}
      <div className="as-bar" role="search"><label className="small" style={{ flex: '1 1 260px', maxWidth: 420 }}>Search <input className="input" style={inputStyle} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Skill, title or provider" /></label></div>
      <Loading st={st} empty={emptyIf((d) => !d.length, 'No courses yet.')}>{(rows) => {
        const shown = rows.filter((c) => !q.trim() || `${c.skill} ${c.title} ${c.provider}`.toLowerCase().includes(q.trim().toLowerCase()));
        return (
          <div className="mcard as-tcard">
          <div className="as-tcard-h"><strong>{shown.length} of {rows.length} course(s)</strong></div>
          <div className="table-wrap" tabIndex={0} role="region" aria-label="Table — scroll sideways to see all columns">
            <table className="table mtable" aria-label="Courses"><thead><tr><th>Skill</th><th>Course</th><th>Language</th><th>Hours</th><th>Free</th><th>Active</th><th /></tr></thead>
              <tbody>{shown.map((c) => (
                <tr key={c.id}>
                  <td className="small" data-label="Skill"><Chip tone="accent">{c.skill}</Chip></td>
                  <td className="small"><a href={c.url} target="_blank" rel="noopener noreferrer">{c.title}</a><div className="xs faint">{c.provider}</div></td>
                  <td className="small" data-label="Language">{c.language}</td>
                  <td className="small as-num" data-label="Hours">{c.hours ?? '—'}</td>
                  <td className="small" data-label="Free">{c.free ? 'Yes' : 'No'}</td>
                  <td className="small" data-label="Active">{c.active ? 'Yes' : 'No'}</td>
                  <td><span className="row g8"><button type="button" className="link-btn small" onClick={() => setEdit(c)}>Edit</button><button type="button" className="link-btn small" disabled={busy} onClick={() => del(c)}>Delete</button></span></td>
                </tr>
              ))}</tbody></table>
          </div>
          </div>
        );
      }}</Loading>
    </>
  );
}
