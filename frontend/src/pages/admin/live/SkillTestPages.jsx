// Admin → Skill checks (Vetting V2). One page, five tabs:
//   Banks       the question bank per role (50 roles): filters, a dense table with % right, average time and bad-question
//               flags, and an edit dialog (wording, options, the right answer, topic, difficulty, kind, active, the
//               Telugu / Hindi versions and "needs native review"). Nothing is deleted: turn a question off instead.
//   Rubrics     each role's practical task and the rubric it is graded with (edit → a new rubric version).
//   Review      practical tasks the AI could not grade with confidence: read the answer, score each rubric line 0–5.
//   Integrity   attempts with strong integrity signals: Clear (the badge can be issued) or Hold (never a ban).
//   Stats       attempts, pass rate and average score per role; flags and AI spend per day.
// The tab is in the address (?tab=rubrics) so a link opens the right one.
import { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Dialog, useToast } from '../../../components/ui';
import { PageHead } from '../AdminUI';
import { Loading, http, useAction, useApi } from './common';
import { TEST_NAMES, VETTING_ROLES } from '../../../lib/vettingRoles';
import { IntegrityQueue, ReviewQueue, Rubrics, Stats } from './VettingPages';
import '../../../styles/me-kit.css';
import '../../../styles/admin-jobs.css';
import '../../../styles/admin-vetting.css';

const TABS = [['banks', 'Banks'], ['rubrics', 'Rubrics'], ['review', 'Review queue'], ['integrity', 'Integrity queue'], ['stats', 'Stats']];
const FLAG_LABEL = { too_easy: 'Too easy', too_hard: 'Too hard', top_scorers_fail: 'Top scorers fail it' };
const FLAG_TONE = { too_easy: 'mchip-warn', too_hard: 'mchip-bad', top_scorers_fail: 'mchip-bad' };
const DIFF = [['easy', 'Easy'], ['medium', 'Medium'], ['hard', 'Hard']];
const KINDS = [['mcq', 'Multiple choice'], ['scenario', 'Scenario']];
const LANGS = [['te', 'Telugu'], ['hi', 'Hindi']];
const PAGE = 100;

/** Tabs with the ARIA tab pattern: arrow keys, Home and End move between them. */
function TabBar({ tab, setTab, counts }) {
  const refs = useRef({});
  useEffect(() => { refs.current[tab]?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' }); }, [tab]); // the picked tab is visible on a phone
  const onKey = (e) => {
    const i = TABS.findIndex(([v]) => v === tab);
    const n = { ArrowRight: i + 1, ArrowLeft: i - 1, Home: 0, End: TABS.length - 1 }[e.key];
    if (n == null) return;
    e.preventDefault();
    const next = TABS[(n + TABS.length) % TABS.length][0];
    setTab(next);
    refs.current[next]?.focus();
  };
  return (
    <div className="segmented vt-tabs" role="tablist" aria-label="Skill checks" onKeyDown={onKey}>
      {TABS.map(([v, l]) => (
        <button key={v} ref={(el) => { refs.current[v] = el; }} type="button" role="tab" id={`vt-tab-${v}`} aria-controls={`vt-panel-${v}`}
          aria-selected={tab === v} tabIndex={tab === v ? 0 : -1} onClick={() => setTab(v)} data-testid={`vt-tab-${v}`}>
          {l}{counts?.[v] ? <span className="vt-count"><span className="sr-only">, </span>{counts[v]}<span className="sr-only"> open</span></span> : null}
        </button>
      ))}
    </div>
  );
}

export function LiveSkillTests() {
  const [sp, setSp] = useSearchParams();
  const tab = TABS.some(([v]) => v === sp.get('tab')) ? sp.get('tab') : 'banks';
  const setTab = (v) => setSp(v === 'banks' ? {} : { tab: v }, { replace: true });
  const counts = useApi('/api/admin/vetting/queue?kind=review&limit=1');
  return (
    <div className="adx vt stack g16">
      <PageHead title="Skill checks" sub="Question banks, practical-task rubrics, the review and integrity queues, and how the checks are doing. Companies only ever see the badge and scores." />
      <TabBar tab={tab} setTab={setTab} counts={counts.data?.open} />
      <div role="tabpanel" id={`vt-panel-${tab}`} aria-labelledby={`vt-tab-${tab}`} className="stack g16">
        {tab === 'banks' && <Banks />}
        {tab === 'rubrics' && <Rubrics />}
        {tab === 'review' && <ReviewQueue onDone={counts.reload} />}
        {tab === 'integrity' && <IntegrityQueue onDone={counts.reload} />}
        {tab === 'stats' && <Stats />}
      </div>
    </div>
  );
}

/* ---------- Banks ---------- */

function bankPath(skill, f) {
  const q = new URLSearchParams();
  if (skill) q.set('skill', skill);
  if (f.active) q.set('active', f.active);
  if (f.flagged) q.set('flagged', 'true');
  if (f.review) q.set('review', 'true');
  const s = q.toString();
  return `/api/admin/skill-tests${s ? `?${s}` : ''}`;
}

const pct = (v) => (v == null ? '—' : `${v}%`);
const secs = (v) => (v == null ? '—' : `${v} s`);

function Banks() {
  const [skill, setSkill] = useState(VETTING_ROLES[0].test);
  const [f, setF] = useState({ topic: '', difficulty: '', active: '', flagged: false, review: false });
  const [shown, setShown] = useState(PAGE);
  const [edit, setEdit] = useState(null); // 'new' | question
  const [skills, setSkills] = useState([]); // counts per skill, kept while a new filter loads
  const st = useApi(bankPath(skill, f));
  useEffect(() => { if (st.data?.skills) setSkills(st.data.skills); }, [st.data]);
  useEffect(() => { setShown(PAGE); }, [skill, f]);
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value }));
  const by = Object.fromEntries(skills.map((s) => [s.skill, s]));
  const extra = skills.map((s) => s.skill).filter((s) => !TEST_NAMES.includes(s)); // older or hand-made skills
  const label = (name) => { const c = by[name]; return c ? `${name} · ${c.all} questions · ${c.active} active${c.review ? ` · ${c.review} to review` : ''}` : `${name} · no questions yet`; };
  const items = st.data?.items || [];
  const topics = [...new Set(items.map((q) => q.topic).filter(Boolean))].sort();
  const rows = items.filter((q) => (!f.topic || q.topic === f.topic) && (!f.difficulty || q.difficulty === f.difficulty));
  const cur = by[skill];
  const saved = (q) => { setEdit(null); if (q?.skill && q.skill !== skill) setSkill(q.skill); else st.reload(); };
  return (
    <section className="stack g12" aria-label="Question banks">
      <div className="ad-toolbar vt-toolbar">
        <label className="field vt-role"><span className="label">Role</span>
          <select className="input" value={skill} onChange={(e) => { setSkill(e.target.value); setF((x) => ({ ...x, topic: '' })); }} data-testid="st-skills">
            <option value="">All roles</option>
            <optgroup label="The 50 roles">{TEST_NAMES.map((n) => <option key={n} value={n}>{label(n)}</option>)}</optgroup>
            {extra.length > 0 && <optgroup label="Other skills">{extra.map((n) => <option key={n} value={n}>{label(n)}</option>)}</optgroup>}
          </select>
        </label>
        <label className="field"><span className="label">Topic</span>
          <select className="input" value={f.topic} onChange={set('topic')} data-testid="st-f-topic"><option value="">All topics</option>{topics.map((x) => <option key={x}>{x}</option>)}</select>
        </label>
        <label className="field"><span className="label">Difficulty</span>
          <select className="input" value={f.difficulty} onChange={set('difficulty')}><option value="">Any</option>{DIFF.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
        </label>
        <label className="field"><span className="label">Active</span>
          <select className="input" value={f.active} onChange={set('active')}><option value="">On and off</option><option value="yes">On only</option><option value="no">Off only</option></select>
        </label>
        <label className="vt-check"><input type="checkbox" checked={f.flagged} onChange={set('flagged')} data-testid="st-f-flagged" />Flagged</label>
        <label className="vt-check"><input type="checkbox" checked={f.review} onChange={set('review')} data-testid="st-f-review" />Needs native review</label>
        <button type="button" className="btn btn-signal vt-add" onClick={() => setEdit('new')} data-testid="st-new">Add a question</button>
      </div>
      {skill && cur && (
        <p className="vt-summary small" data-testid="st-summary">
          <strong>{skill}</strong><span>{cur.all} questions</span><span>{cur.active} active</span><span>{cur.review} need native review</span>
          {cur.hasTest ? <span className="mchip mchip-ok">Has a test</span> : <span className="mchip mchip-warn">Needs {st.data?.minQuestions ?? 5} active questions for a test</span>}
        </p>
      )}
      <Loading st={st}>{() => (rows.length === 0 ? <div className="well small muted vt-empty">No questions match these filters.</div> : (
        <div className="table-wrap mtable-wrap vt-scroll">
          <table className="table mtable vt-table" data-testid="st-table">
            <caption className="sr-only">Questions{skill ? ` for ${skill}` : ''}: {rows.length}</caption>
            <thead><tr><th scope="col">Question</th><th scope="col">Topic</th><th scope="col">Difficulty</th><th scope="col">Kind</th><th scope="col">% right</th><th scope="col">Avg time</th><th scope="col">Flags</th><th scope="col">Active</th><th scope="col"><span className="sr-only">Edit</span></th></tr></thead>
            <tbody>
              {rows.slice(0, shown).map((q) => (
                <tr key={q.id} data-testid="st-row" className={q.active ? '' : 'vt-off'}>
                  <td className="vt-q">
                    <span className="vt-q-text">{q.question}</span>
                    <span className="xs muted vt-q-answer">✔ {q.options[q.answer]}</span>
                    <span className="vt-q-tags">
                      {!skill && <span className="mchip mchip-neutral">{q.skill}</span>}
                      {q.needsReview && <span className="mchip mchip-warn">Needs native review</span>}
                      {q.edited && <span className="mchip mchip-accent">Edited</span>}
                      {Object.keys(q.tr || {}).length > 0 && <span className="mchip mchip-info">{Object.keys(q.tr).map((l) => (l === 'te' ? 'Telugu' : 'Hindi')).join(' + ')}</span>}
                    </span>
                  </td>
                  <td data-label="Topic">{q.topic || '—'}</td>
                  <td data-label="Difficulty">{q.difficulty}</td>
                  <td data-label="Kind">{q.kind === 'scenario' ? 'Scenario' : 'MCQ'}</td>
                  <td data-label="% right" className="num" title={`Shown ${q.stats.shown} times`}>{pct(q.stats.right)}</td>
                  <td data-label="Avg time" className="num">{secs(q.stats.avgSeconds)}</td>
                  <td data-label="Flags">{q.flags.length ? <span className="vt-chips">{q.flags.map((x) => <span key={x} className={`mchip ${FLAG_TONE[x] || 'mchip-neutral'}`}>{FLAG_LABEL[x] || x}</span>)}</span> : '—'}</td>
                  <td data-label="Active">{q.active ? <span className="mchip mchip-ok">On</span> : <span className="mchip mchip-neutral">Off</span>}</td>
                  <td className="vt-edit-cell"><button type="button" className="btn btn-outline btn-sm vt-edit" onClick={() => setEdit(q)} aria-label={`Edit question: ${q.question.slice(0, 60)}`} data-testid="st-edit">Edit</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}</Loading>
      {rows.length > shown && <button type="button" className="btn btn-outline vt-more" onClick={() => setShown((n) => n + PAGE)}>Show {Math.min(PAGE, rows.length - shown)} more (of {rows.length - shown})</button>}
      {edit && <QuestionDialog q={edit === 'new' ? null : edit} skill={skill} topics={topics} onSaved={saved} onClose={() => setEdit(null)} />}
    </section>
  );
}

const blankTr = (n) => ({ q: '', options: Array(n).fill('') });

function QuestionDialog({ q, skill, topics, onSaved, onClose }) {
  const toast = useToast();
  const [busy, run] = useAction(toast);
  const [err, setErr] = useState('');
  const [f, setF] = useState(() => (q
    ? { ...q, tr: { te: q.tr?.te || blankTr(q.options.length), hi: q.tr?.hi || blankTr(q.options.length) } }
    : { role: '', skill: skill || '', question: '', options: ['', '', '', ''], answer: 0, difficulty: 'medium', topic: '', kind: 'mcq', active: true, needsReview: false, tr: { te: blankTr(4), hi: blankTr(4) } }));
  const set = (k) => (e) => setF({ ...f, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value });
  const setOpt = (i, v) => setF({ ...f, options: f.options.map((x, j) => (j === i ? v : x)) });
  const setTr = (lang, k, v, i) => setF({ ...f, tr: { ...f.tr, [lang]: { ...f.tr[lang], [k]: k === 'q' ? v : f.tr[lang].options.map((x, j) => (j === i ? v : x)) } } });
  const addOpt = () => setF({ ...f, options: [...f.options, ''], tr: Object.fromEntries(LANGS.map(([l]) => [l, { ...f.tr[l], options: [...f.tr[l].options, ''] }])) });
  const dropOpt = (i) => setF({
    ...f, options: f.options.filter((_, j) => j !== i), answer: f.answer === i ? 0 : f.answer > i ? f.answer - 1 : f.answer,
    tr: Object.fromEntries(LANGS.map(([l]) => [l, { ...f.tr[l], options: f.tr[l].options.filter((_, j) => j !== i) }])),
  });
  const trOn = (l) => f.tr[l].q.trim() || f.tr[l].options.some((o) => o.trim());
  const save = (e) => {
    e.preventDefault();
    setErr('');
    const keep = f.options.map((o, i) => (o.trim() ? i : -1)).filter((i) => i >= 0); // blank options are dropped
    if (keep.length < 2) { setErr('Give at least two options.'); return; }
    if (!keep.includes(Number(f.answer))) { setErr('The right answer must be one of the filled options.'); return; }
    const tr = {};
    for (const [l, name] of LANGS) {
      if (!trOn(l)) continue;
      const opts = keep.map((i) => (f.tr[l].options[i] || '').trim());
      if (!f.tr[l].q.trim() || opts.some((o) => !o)) { setErr(`The ${name} version needs the question and every option (or leave it all empty).`); return; }
      tr[l] = { q: f.tr[l].q.trim(), options: opts };
    }
    const body = {
      role: f.role || '', skill: f.skill.trim(), question: f.question.trim(), options: keep.map((i) => f.options[i].trim()), answer: keep.indexOf(Number(f.answer)),
      difficulty: f.difficulty, topic: (f.topic || '').trim(), kind: f.kind || 'mcq', tr, needsReview: !!f.needsReview, active: !!f.active,
    };
    run(async () => {
      const r = await (q ? http(`/api/admin/skill-tests/${q.id}`, { method: 'PUT', body }) : http('/api/admin/skill-tests', { method: 'POST', body }));
      onSaved(r);
    }, 'Saved');
  };
  const title = q ? 'Edit question' : 'New question';
  return (
    <Dialog title={title} onClose={onClose} showTitle wide panelStyle={{ minWidth: 0 }}>
      <form className="stack g16 vt-form" onSubmit={save} aria-label={title} data-testid="st-form">
        <div className="vt-grid">
          <label className="field"><span className="label">Skill check (test name)</span>
            <input className="input" required maxLength={80} list="vt-tests" value={f.skill} onChange={set('skill')} data-testid="st-skill" />
            <datalist id="vt-tests">{TEST_NAMES.map((n) => <option key={n} value={n} />)}</datalist>
          </label>
          <label className="field"><span className="label">Topic</span>
            <input className="input" maxLength={80} list="vt-topics" value={f.topic || ''} onChange={set('topic')} data-testid="st-topic" />
            <datalist id="vt-topics">{topics.map((n) => <option key={n} value={n} />)}</datalist>
          </label>
          <label className="field"><span className="label">Difficulty</span>
            <select className="input" value={f.difficulty} onChange={set('difficulty')} data-testid="st-difficulty">{DIFF.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
          </label>
          <label className="field"><span className="label">Kind</span>
            <select className="input" value={f.kind || 'mcq'} onChange={set('kind')} data-testid="st-kind">{KINDS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
          </label>
        </div>
        <label className="field"><span className="label">Question (English)</span>
          <textarea className="input" rows={3} required minLength={5} maxLength={500} value={f.question} onChange={set('question')} data-testid="st-question" />
        </label>
        <fieldset className="vt-opts">
          <legend className="label">Options: pick the right one</legend>
          {f.options.map((o, i) => (
            <div key={i} className="vt-opt">
              <label className="vt-radio"><input type="radio" name="st-right" checked={Number(f.answer) === i} onChange={() => setF({ ...f, answer: i })} /><span className="sr-only">Option {i + 1} is the right answer</span></label>
              <input className="input" maxLength={200} value={o} onChange={(e) => setOpt(i, e.target.value)} aria-label={`Option ${i + 1}`} data-testid={`st-opt-${i}`} />
              {f.options.length > 2 && <button type="button" className="btn btn-icon vt-drop" onClick={() => dropOpt(i)} aria-label={`Remove option ${i + 1}`}>✕</button>}
            </div>
          ))}
          {f.options.length < 6 && <button type="button" className="btn btn-outline btn-sm vt-addopt" onClick={addOpt}>Add an option</button>}
        </fieldset>
        {LANGS.map(([l, name]) => (
          <details key={l} className="vt-tr" open={!!q?.tr?.[l]}>
            <summary>{name} version{q?.tr?.[l] ? '' : ' (none yet)'}</summary>
            <div className="stack g8">
              <label className="field"><span className="label">Question ({name})</span>
                <textarea className="input" rows={2} maxLength={600} lang={l} value={f.tr[l].q} onChange={(e) => setTr(l, 'q', e.target.value)} data-testid={`st-tr-${l}`} />
              </label>
              {f.options.map((o, i) => (
                <label key={i} className="field"><span className="label">Option {i + 1}{o ? ` (${o.slice(0, 40)})` : ''}{Number(f.answer) === i ? ' ✔' : ''}</span>
                  <input className="input" maxLength={200} lang={l} value={f.tr[l].options[i] || ''} onChange={(e) => setTr(l, 'options', e.target.value, i)} />
                </label>
              ))}
            </div>
          </details>
        ))}
        <div className="vt-checks">
          <label className="vt-check"><input type="checkbox" checked={!!f.needsReview} onChange={set('needsReview')} data-testid="st-review" />Needs native review (Telugu / Hindi)</label>
          <label className="vt-check"><input type="checkbox" checked={!!f.active} onChange={set('active')} data-testid="st-active" />Active (used in tests)</label>
        </div>
        {q && <p className="xs muted" style={{ margin: 0 }}>Shown {q.stats.shown} times · {pct(q.stats.right)} right · {q.bankId ? `bank id ${q.bankId}` : 'added by hand'}. A newer bank file never overwrites an edited question.</p>}
        {err && <p className="error" role="alert" style={{ margin: 0 }}>{err}</p>}
        <div className="row g8 vt-form-btns">
          <button type="submit" className="btn btn-signal" disabled={busy} data-testid="st-save">Save</button>
          <button type="button" className="btn btn-outline" onClick={onClose}>Cancel</button>
        </div>
      </form>
    </Dialog>
  );
}
