// Admin → Learning paths (Phase 6, S2): one path per role. Its skills bring their free courses in order (Admin →
// Courses), then a small guided project (brief, steps, a link or text to send; it must be free to do), then the role's
// skill check. "Skill verified" needs the check passed (Settings: seek.pass_score) and the project sent.
import { useState } from 'react';
import { useToast } from '../../../components/ui';
import { PageHead } from '../AdminUI';
import { Loading, http, useAction, useApi } from './common';

function PathForm({ p, tests, onSaved, onCancel }) {
  const toast = useToast();
  const [busy, run] = useAction(toast);
  const [f, setF] = useState({ skills: p.skills.join(', '), test: p.test, active: p.active, title: p.project.title || '', brief: p.project.brief || '', steps: (p.project.steps || []).join('\n'), submit: p.project.submit || 'link' });
  const set = (k) => (e) => setF({ ...f, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value });
  const save = (e) => {
    e.preventDefault();
    run(async () => {
      const body = { skills: f.skills.split(',').map((s) => s.trim()).filter(Boolean), test: f.test, active: f.active, project: { title: f.title, brief: f.brief, steps: f.steps.split('\n').map((s) => s.trim()).filter(Boolean), submit: f.submit } };
      await http(`/api/admin/learn-paths/${p.role}`, { method: 'PUT', body });
      onSaved();
    }, 'Saved');
  };
  return (
    <form className="card stack g8" onSubmit={save} aria-label={`Edit ${p.title}`} data-testid="lp-form">
      <strong>{p.title}</strong>
      <label className="field"><span className="label">Skills, in order (their free courses come from Courses)</span><input className="input" maxLength={400} value={f.skills} onChange={set('skills')} data-testid="lp-skills" /></label>
      <label className="field"><span className="label">Project title</span><input className="input" required maxLength={120} value={f.title} onChange={set('title')} /></label>
      <label className="field"><span className="label">Project brief (free to do: no fee, deposit or purchase)</span><textarea className="input" rows={2} required maxLength={600} value={f.brief} onChange={set('brief')} data-testid="lp-brief" /></label>
      <label className="field"><span className="label">Steps (one a line)</span><textarea className="input" rows={3} required value={f.steps} onChange={set('steps')} /></label>
      <div className="row g12" style={{ flexWrap: 'wrap' }}>
        <label className="row g8 small">They send <select className="input" style={{ height: 36, width: 'auto' }} value={f.submit} onChange={set('submit')}><option value="link">a link</option><option value="text">a short text</option></select></label>
        <label className="row g8 small">Skill check <select className="input" style={{ height: 36, width: 'auto' }} value={f.test} onChange={set('test')} data-testid="lp-test"><option value="">None (no badge)</option>{tests.map((t) => <option key={t} value={t}>{t}</option>)}</select></label>
        <label className="row g8 small"><input type="checkbox" checked={f.active} onChange={set('active')} />Shown to students</label>
      </div>
      <div className="row g8"><button type="submit" className="btn btn-ink" disabled={busy} data-testid="lp-save">Save</button><button type="button" className="btn btn-outline" onClick={onCancel}>Cancel</button></div>
    </form>
  );
}

export function LiveLearnPaths() {
  const st = useApi('/api/admin/learn-paths');
  const [edit, setEdit] = useState(null);
  return (
    <>
      <PageHead title="Learning paths" sub="Per role: free courses in order, a small free project, then the skill check. “Skill verified” needs the check passed and the project sent." />
      <Loading st={st}>{(d) => (
        <div className="stack g12">
          <span className="xs muted">Pass mark: {d.passScore}% (Settings → seek.pass_score).</span>
          {edit && <PathForm p={edit} tests={d.tests} onSaved={() => { setEdit(null); st.reload(); }} onCancel={() => setEdit(null)} />}
          <ul className="stack g8" style={{ listStyle: 'none', padding: 0, margin: 0 }}>
            {d.items.map((p) => (
              <li key={p.role} className="card-sm stack g4" data-testid="lp-row" style={{ opacity: p.active ? 1 : 0.6 }}>
                <div className="row between g8" style={{ flexWrap: 'wrap' }}><strong className="small">{p.title}{p.active ? '' : ' · hidden'}</strong><button type="button" className="btn btn-outline btn-sm" onClick={() => setEdit(p)}>Edit</button></div>
                <span className="xs muted">Courses for: {p.skills.join(', ') || '—'} · Project: {p.project.title || '—'} · Check: {p.test || 'none (no badge)'}</span>
              </li>
            ))}
          </ul>
        </div>
      )}</Loading>
    </>
  );
}
