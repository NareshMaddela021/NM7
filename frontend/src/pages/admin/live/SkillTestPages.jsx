// Admin → Skill tests (Phase 5, H3): the question bank for the 10-minute skill checks. Each question: role, skill,
// question, 2–6 options, the right one, difficulty, active. A skill gets a test once it has 5 active questions
// (10 are picked at random per test). Nothing is deleted: turn a question off instead.
import { useState } from 'react';
import { useToast } from '../../../components/ui';
import { PageHead } from '../AdminUI';
import { Loading, http, useAction, useApi } from './common';

const BLANK = { role: '', skill: '', question: '', options: ['', '', '', ''], answer: 0, difficulty: 'medium', active: true };

function QuestionForm({ q, onSaved, onCancel }) {
  const toast = useToast();
  const [busy, run] = useAction(toast);
  const [f, setF] = useState(q || BLANK);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value });
  const save = (e) => {
    e.preventDefault();
    run(async () => {
      const body = { ...f, answer: Number(f.answer), options: f.options.map((o) => o.trim()).filter(Boolean) };
      await (q ? http(`/api/admin/skill-tests/${q.id}`, { method: 'PUT', body }) : http('/api/admin/skill-tests', { method: 'POST', body }));
      onSaved();
    }, 'Saved');
  };
  return (
    <form className="card stack g8" onSubmit={save} aria-label={q ? 'Edit question' : 'New question'} data-testid="st-form">
      <div className="co-grid">
        <label className="field"><span className="label">Skill</span><input className="input" required maxLength={60} value={f.skill} onChange={set('skill')} data-testid="st-skill" /></label>
        <label className="field"><span className="label">Role</span><input className="input" maxLength={80} value={f.role} onChange={set('role')} /></label>
      </div>
      <label className="field"><span className="label">Question</span><textarea className="input" rows={2} required maxLength={500} value={f.question} onChange={set('question')} data-testid="st-question" /></label>
      <fieldset className="stack g4" style={{ border: 0, padding: 0, margin: 0 }}>
        <legend className="label">Options (tick the right one)</legend>
        {f.options.map((o, i) => (
          <label key={i} className="row g8 small">
            <input type="radio" name="st-right" checked={Number(f.answer) === i} onChange={() => setF({ ...f, answer: i })} aria-label={`Option ${i + 1} is right`} />
            <input className="input" style={{ height: 36 }} maxLength={200} value={o} onChange={(e) => setF({ ...f, options: f.options.map((x, j) => (j === i ? e.target.value : x)) })} aria-label={`Option ${i + 1}`} data-testid={`st-opt-${i}`} />
          </label>
        ))}
      </fieldset>
      <div className="row g12" style={{ flexWrap: 'wrap' }}>
        <label className="row g8 small">Difficulty <select className="input" style={{ height: 36, width: 'auto' }} value={f.difficulty} onChange={set('difficulty')}><option value="easy">Easy</option><option value="medium">Medium</option><option value="hard">Hard</option></select></label>
        <label className="row g8 small"><input type="checkbox" checked={f.active} onChange={set('active')} data-testid="st-active" />Active</label>
      </div>
      <div className="row g8"><button type="submit" className="btn btn-ink" disabled={busy} data-testid="st-save">Save</button><button type="button" className="btn btn-outline" onClick={onCancel}>Cancel</button></div>
    </form>
  );
}

export function LiveSkillTests() {
  const [skill, setSkill] = useState('');
  const st = useApi(`/api/admin/skill-tests${skill ? `?skill=${encodeURIComponent(skill)}` : ''}`);
  const [edit, setEdit] = useState(null); // 'new' | question
  const done = () => { setEdit(null); st.reload(); };
  return (
    <>
      <PageHead title="Skill tests" sub="The question bank for the 10-minute skill checks. A skill has a test once it has 5 active questions; each test picks 10 at random. Turn a question off instead of deleting it." right={<button type="button" className="btn btn-ink" onClick={() => setEdit('new')} data-testid="st-new">Add a question</button>} />
      {edit && <QuestionForm q={edit === 'new' ? null : edit} onSaved={done} onCancel={() => setEdit(null)} />}
      <Loading st={st}>{(d) => (
        <div className="stack g12">
          <div className="row g8" style={{ flexWrap: 'wrap' }} role="group" aria-label="Skills" data-testid="st-skills">
            <button type="button" className={`btn btn-sm ${skill ? 'btn-outline' : 'btn-ink'}`} onClick={() => setSkill('')}>All</button>
            {d.skills.map((s) => <button key={s.skill} type="button" className={`btn btn-sm ${skill === s.skill ? 'btn-ink' : 'btn-outline'}`} onClick={() => setSkill(s.skill)}>{s.skill} · {s.active}/{s.all}{s.hasTest ? '' : ' (no test yet)'}</button>)}
          </div>
          <ul className="stack g8" style={{ listStyle: 'none', padding: 0, margin: 0 }}>
            {d.items.map((q) => (
              <li key={q.id} className="card-sm stack g4" data-testid="st-row" style={{ opacity: q.active ? 1 : 0.6 }}>
                <div className="row between g8" style={{ flexWrap: 'wrap' }}><strong className="small">{q.skill} · {q.difficulty}{q.active ? '' : ' · off'}</strong><button type="button" className="btn btn-outline btn-sm" onClick={() => setEdit(q)}>Edit</button></div>
                <span className="small">{q.question}</span>
                <span className="xs muted">{q.options.map((o, i) => (i === q.answer ? `✔ ${o}` : o)).join(' · ')}</span>
              </li>
            ))}
          </ul>
        </div>
      )}</Loading>
    </>
  );
}
