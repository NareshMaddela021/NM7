// Admin → Skill checks, the Vetting V2 tabs after Banks: Rubrics (each role's practical task and rubric, with an
// editor that saves a new rubric version), the Review queue (grade a practical task 0–5 per rubric line), the Integrity
// queue (Clear or Hold: holding never bans, the person can try again after 30 days) and Stats. All from
// /api/admin/vetting/* (permission "jobs"). Companies never see anything from the integrity side.
import { useState } from 'react';
import { useToast } from '../../../components/ui';
import { Loading, day, http, useAction, useApi, when } from './common';
import { BY_TEST, GROUP_LABEL, TASK_LABEL, VETTING_ROLES } from '../../../lib/vettingRoles';

const LEVEL = { clean: ['Clean', 'mchip-ok'], watch: ['Watch', 'mchip-warn'], retest: ['Needs retest', 'mchip-bad'] };
const WHY = { ai: 'The AI could not grade it', borderline: 'Borderline score or low AI confidence', no_ai: 'AI grading is off', limited: 'AI was busy (rate limited)', capped: 'AI budget reached for the day', unusable: 'The AI answer was unusable' };
const BAND = { fresher: 'Fresher', '1-3': '1–3 years', '3-5': '3–5 years', '5-8': '5–8 years', '8+': '8+ years' };
const mmss = (ms) => { const s = Math.round((ms || 0) / 1000); return s >= 60 ? `${Math.floor(s / 60)} min ${s % 60} s` : `${s} s`; };

/** The signals worth showing, in plain words; zero / false ones are left out. */
export function signalLines(sig = {}) {
  const n = (k, k2) => Number(sig[k] ?? sig[k2] ?? 0);
  const out = [];
  if (n('blurs')) out.push(['Tab switches', String(n('blurs'))]);
  if (n('blurMs', 'blur_ms')) out.push(['Time away from the test', mmss(n('blurMs', 'blur_ms'))]);
  if (n('fastAnswers')) out.push(['Answers faster than reading time', String(n('fastAnswers'))]);
  if (n('copies')) out.push(['Copies', String(n('copies'))]);
  if (n('pastes')) out.push(['Pastes', String(n('pastes'))]);
  if (n('pastedChars')) out.push(['Pasted into the task', `${n('pastedChars')} characters`]);
  if (n('contextMenus', 'context_menus')) out.push(['Right-click menus', String(n('contextMenus', 'context_menus'))]);
  if (n('devtools')) out.push(['Developer tools opened', String(n('devtools'))]);
  if (n('pauses')) out.push(['Pauses', String(n('pauses'))]);
  for (const [k, l] of [['samePosition', 'Same answer position almost every time'], ['patternMatch', 'Same answer pattern as another account'], ['textMatch', 'Task text matches another account'], ['sharedDevice', 'Same device as another account'], ['resumeMismatch', 'Experience claimed doesn’t match easy-question results']]) {
    if (sig[k] === true) out.push([l, 'Yes']);
  }
  return out;
}

export function Filter({ status, setStatus, label }) {
  return (
    <div className="segmented vt-seg" role="group" aria-label={label}>
      {[['open', 'Open'], ['done', 'Done']].map(([v, l]) => <button key={v} type="button" aria-pressed={status === v} onClick={() => setStatus(v)} data-testid={`vq-${v}`}>{l}</button>)}
    </div>
  );
}

function Who({ x }) {
  const r = BY_TEST[x.skill];
  return (
    <div className="vq-who">
      <span className="vq-av" aria-hidden="true">{(x.person.name || '?').charAt(0).toUpperCase()}</span>
      <span className="stack g2" style={{ minWidth: 0 }}>
        <strong className="vq-name">{x.person.name || 'Unnamed'}</strong>
        <span className="xs muted">{x.skill}{x.role || r?.role ? ` · ${x.role || r.role}` : ''} · {BAND[x.attempt.band] || x.attempt.band || 'no band'} · in the queue since {when(x.createdAt)}</span>
      </span>
    </div>
  );
}

/* ---------- Rubrics ---------- */

export function Rubrics() {
  const st = useApi('/api/admin/vetting/rubrics');
  const [slug, setSlug] = useState(VETTING_ROLES[0].slug);
  const [editing, setEditing] = useState(false);
  return (
    <section className="stack g12" aria-label="Rubrics">
      <div className="ad-toolbar">
        <label className="field vt-role"><span className="label">Role</span>
          <select className="input" value={slug} onChange={(e) => { setSlug(e.target.value); setEditing(false); }} data-testid="vr-role">
            {Object.entries(GROUP_LABEL).map(([g, gl]) => (
              <optgroup key={g} label={gl}>{VETTING_ROLES.filter((r) => r.group === g).map((r) => <option key={r.slug} value={r.slug}>{r.test} · {r.role}</option>)}</optgroup>
            ))}
          </select>
        </label>
      </div>
      <Loading st={st}>{(d) => {
        const r = d.roles.find((x) => x.slug === slug);
        if (!r) return <div className="well small muted vt-empty">This role is not in the list.</div>;
        if (!r.loaded) return <div className="well small muted vt-empty">No bank is loaded for {r.test} yet.</div>;
        return (
          <div className="vr-grid">
            <article className="card stack g12 vr-task" aria-labelledby="vr-task-h">
              <div className="row between g8 vt-wrap">
                <span className="mkicker">Practical task · {TASK_LABEL[r.taskType] || r.taskType}</span>
                <span className="xs muted">Bank v{r.bankVersion ?? '—'} · {r.task?.minutes ?? '—'} minutes</span>
              </div>
              <h2 id="vr-task-h" className="vr-title">{r.task?.title || 'No task title'}</h2>
              <p className="small vr-brief">{r.task?.brief}</p>
              {r.task?.material && (
                <div className="stack g4"><span className="label">Material the candidate gets</span><pre className="vr-material" tabIndex={0} aria-label="Material preview">{r.task.material}</pre></div>
              )}
              {r.task?.key_points?.length > 0 && (
                <div className="stack g4"><span className="label">Key points the grader looks for</span><ul className="small vr-points">{r.task.key_points.map((p) => <li key={p}>{p}</li>)}</ul></div>
              )}
              {r.topics?.length > 0 && <div className="vt-chips" aria-label="Topics">{r.topics.map((t) => <span key={typeof t === 'string' ? t : t.name} className="mchip mchip-neutral">{typeof t === 'string' ? t : t.name}</span>)}</div>}
            </article>
            <article className="card stack g12 vr-rubric" aria-labelledby="vr-rubric-h" data-testid="vr-rubric">
              <div className="row between g8 vt-wrap">
                <h2 id="vr-rubric-h" className="vr-title">Rubric <span className="mchip mchip-accent">Version {r.rubricVersion ?? 1}</span></h2>
                {!editing && <button type="button" className="btn btn-outline btn-sm vt-btn" onClick={() => setEditing(true)} data-testid="vr-edit">Edit rubric</button>}
              </div>
              {editing ? <RubricEditor key={slug} r={r} onDone={() => { setEditing(false); st.reload(); }} onCancel={() => setEditing(false)} /> : (
                <div className="table-wrap mtable-wrap">
                  <table className="table mtable vt-table">
                    <caption className="sr-only">Rubric criteria for {r.test}</caption>
                    <thead><tr><th scope="col">Key</th><th scope="col">Label</th><th scope="col">How to score 0–5</th></tr></thead>
                    <tbody>{r.rubric.map((c) => <tr key={c.key}><td data-label="Key"><code>{c.key}</code></td><td data-label="Label"><strong>{c.label}</strong></td><td data-label="Guide" className="vr-guide">{c.guide}</td></tr>)}</tbody>
                  </table>
                </div>
              )}
              {r.history?.length > 0 && (
                <details className="vt-tr"><summary>History ({r.history.length})</summary>
                  <ol className="small vr-history" reversed>{[...r.history].reverse().map((h) => <li key={h.version}>Version {h.version} · {day(h.at)} · {h.by === 'bank' ? 'from the bank file' : `by ${h.by}`}</li>)}</ol>
                </details>
              )}
              <p className="xs muted" style={{ margin: 0 }}>Tasks already graded keep the version they were graded with.</p>
            </article>
          </div>
        );
      }}</Loading>
    </section>
  );
}

function RubricEditor({ r, onDone, onCancel }) {
  const toast = useToast();
  const [busy, run] = useAction(toast);
  const [rows, setRows] = useState(r.rubric.map((c) => ({ ...c })));
  const [err, setErr] = useState('');
  const set = (i, k, v) => setRows(rows.map((x, j) => (j === i ? { ...x, [k]: v } : x)));
  const save = (e) => {
    e.preventDefault();
    setErr('');
    const keys = rows.map((x) => x.key.trim());
    if (rows.length < 3 || rows.length > 5) { setErr('A rubric has 3 to 5 criteria.'); return; }
    if (keys.some((k) => !/^[a-z_]{2,30}$/.test(k))) { setErr('Each key is 2–30 lowercase letters or _ (like clarity or next_steps).'); return; }
    if (new Set(keys).size !== keys.length) { setErr('Each criterion needs its own key.'); return; }
    if (rows.some((x) => x.label.trim().length < 2 || x.guide.trim().length < 20)) { setErr('Each criterion needs a label and a guide of at least 20 characters.'); return; }
    run(async () => {
      await http(`/api/admin/vetting/rubrics/${r.slug}`, { method: 'PUT', body: { rubric: rows.map((x) => ({ key: x.key.trim(), label: x.label.trim(), guide: x.guide.trim() })) } });
      onDone();
    }, 'Rubric saved as a new version');
  };
  return (
    <form className="stack g12" onSubmit={save} aria-label={`Edit the rubric for ${r.test}`} data-testid="vr-form">
      {rows.map((c, i) => (
        <fieldset key={i} className="vr-crit">
          <legend className="label">Criterion {i + 1}</legend>
          <div className="vt-grid">
            <label className="field"><span className="label">Key</span><input className="input" required pattern="[a-z_]{2,30}" maxLength={30} value={c.key} onChange={(e) => set(i, 'key', e.target.value)} /></label>
            <label className="field"><span className="label">Label</span><input className="input" required maxLength={60} value={c.label} onChange={(e) => set(i, 'label', e.target.value)} /></label>
          </div>
          <label className="field"><span className="label">Guide (what 0, 3 and 5 look like)</span><textarea className="input" rows={2} required minLength={20} maxLength={500} value={c.guide} onChange={(e) => set(i, 'guide', e.target.value)} /></label>
          {rows.length > 3 && <button type="button" className="btn btn-outline btn-sm vt-btn" onClick={() => setRows(rows.filter((_, j) => j !== i))}>Remove criterion {i + 1}</button>}
        </fieldset>
      ))}
      {rows.length < 5 && <button type="button" className="btn btn-outline btn-sm vt-btn" style={{ alignSelf: 'flex-start' }} onClick={() => setRows([...rows, { key: '', label: '', guide: '' }])}>Add a criterion</button>}
      {err && <p className="error" role="alert" style={{ margin: 0 }}>{err}</p>}
      <div className="row g8 vt-form-btns">
        <button type="submit" className="btn btn-signal" disabled={busy} data-testid="vr-save">Save as version {(r.rubricVersion || 1) + 1}</button>
        <button type="button" className="btn btn-outline" onClick={onCancel}>Cancel</button>
      </div>
    </form>
  );
}

/* ---------- Review queue ---------- */

export function ReviewQueue({ onDone }) {
  const [status, setStatus] = useState('open');
  const st = useApi(`/api/admin/vetting/queue?kind=review&status=${status}`);
  const done = () => { st.reload(); onDone?.(); };
  return (
    <section className="stack g12" aria-label="Review queue">
      <div className="ad-toolbar vt-wrap">
        <Filter status={status} setStatus={setStatus} label="Show" />
        <span className="small muted">Practical tasks the AI could not grade with confidence. Score each rubric line from 0 to 5; the badge is issued if the test and task pass.</span>
      </div>
      <Loading st={st}>{(d) => (d.items.length === 0 ? <div className="well small muted vt-empty">{status === 'open' ? 'Nothing to review. Well done.' : 'Nothing reviewed yet.'}</div> : (
        <ul className="vq-list">{d.items.map((x) => <ReviewItem key={x.id} x={x} onDone={done} />)}</ul>
      ))}</Loading>
    </section>
  );
}

function ReviewItem({ x, onDone }) {
  const toast = useToast();
  const [busy, run] = useAction(toast);
  const [photo, setPhoto] = useState(null);
  const [g, setG] = useState(() => Object.fromEntries(x.rubric.map((c) => [c.key, { score: '', reason: '' }])));
  const [note, setNote] = useState('');
  const [err, setErr] = useState('');
  const tk = x.task || {};
  const open = x.status === 'open';
  const showPhoto = () => run(async () => { const p = await http(`/api/admin/vetting/queue/${x.id}/photo`); setPhoto(`data:${p.type};base64,${p.data}`); });
  const submit = (e) => {
    e.preventDefault();
    setErr('');
    if (x.rubric.some((c) => g[c.key].score === '')) { setErr('Give a score for every rubric line.'); return; }
    run(async () => {
      const r = await http(`/api/admin/vetting/queue/${x.id}/grade`, { method: 'POST', body: { scores: x.rubric.map((c) => ({ key: c.key, score: Number(g[c.key].score), reason: g[c.key].reason.trim() })), note: note.trim() } });
      toast(`Graded: task ${r.score}/100${r.verified ? ' · badge issued' : ''}`);
      onDone();
    });
  };
  return (
    <li className="card stack g12 vq-item" data-testid="vq-item">
      <Who x={x} />
      <div className="vt-chips">
        <span className="mchip mchip-info">Test {x.attempt.score ?? '—'}/100</span>
        <span className="mchip mchip-neutral">{TASK_LABEL[tk.type] || tk.type || 'Task'}</span>
        {x.data?.why && <span className="mchip mchip-warn">{WHY[x.data.why] || x.data.why}</span>}
        {tk.confidence && <span className="mchip mchip-neutral">AI confidence: {tk.confidence}</span>}
        {!open && <span className="mchip mchip-ok">Graded{tk.score != null ? ` · task ${tk.score}/100` : ''}</span>}
      </div>
      {tk.answer ? (
        <div className="stack g4">
          <span className="label">{tk.type === 'voice' ? 'What they said (speech turned into text)' : 'Their answer'}</span>
          <div className="vq-answer" tabIndex={0} aria-label="Candidate's answer">{tk.answer}</div>
          {tk.speech && <span className="xs muted">Speech: {tk.speech.wpm != null ? `${tk.speech.wpm} words a minute` : 'pace unknown'} · {tk.speech.fillers} fillers (um, like, basically …) · {tk.speech.words} words</span>}
        </div>
      ) : <span className="small muted">No written answer{tk.type === 'proof' ? ' (a proof task: situations and an optional photo).' : '.'}</span>}
      {tk.photo && (
        <div className="stack g4">
          <span className="small">Photo check: <strong>{tk.photo.genuine === 'yes' ? 'looks genuine' : tk.photo.genuine === 'no' ? 'does not look genuine' : tk.photo.genuine === 'pending' ? 'not checked yet' : 'unsure'}</strong>{tk.photo.why || tk.photo.reason ? ` · ${tk.photo.why || tk.photo.reason}` : ''}{tk.photo.faces ? ' · faces visible' : ''}</span>
          {tk.hasPhoto && !photo && <button type="button" className="btn btn-outline btn-sm vt-btn" style={{ alignSelf: 'flex-start' }} disabled={busy} onClick={showPhoto} data-testid="vq-photo">Show the photo</button>}
          {photo && <img src={photo} alt={`Work photo sent by ${x.person.name || 'the candidate'}`} className="vq-photo" />}
        </div>
      )}
      {tk.feedback?.length > 0 && (
        <details className="vt-tr" open={!open}>
          <summary>{open ? 'AI feedback' : 'Scores given'}</summary>
          <ul className="small vq-fb">{tk.feedback.map((f) => <li key={f.key || f.label}><strong>{f.label}: {f.score}/5</strong> · {f.reason}</li>)}</ul>
        </details>
      )}
      {!open && x.note && <span className="small">Note: {x.note}</span>}
      {open && (x.rubric.length === 0 ? <span className="small muted">This role has no rubric yet; add one in the Rubrics tab.</span> : (
        <form className="stack g12 vq-grade" onSubmit={submit} aria-label={`Grade ${x.person.name || 'this task'}`}>
          {x.rubric.map((c) => (
            <fieldset key={c.key} className="vq-crit">
              <legend><strong>{c.label}</strong></legend>
              <span className="xs muted">{c.guide}</span>
              <div className="vq-crit-row">
                <label className="field vq-score"><span className="label">Score</span>
                  <select className="input" required value={g[c.key].score} onChange={(e) => setG({ ...g, [c.key]: { ...g[c.key], score: e.target.value } })} data-testid={`vq-score-${c.key}`}>
                    <option value="">Pick 0–5</option>{[0, 1, 2, 3, 4, 5].map((n) => <option key={n} value={n}>{n}</option>)}
                  </select>
                </label>
                <label className="field vq-reason"><span className="label">Reason (the candidate sees it)</span>
                  <input className="input" maxLength={300} value={g[c.key].reason} onChange={(e) => setG({ ...g, [c.key]: { ...g[c.key], reason: e.target.value } })} />
                </label>
              </div>
            </fieldset>
          ))}
          <label className="field"><span className="label">Note for the team (optional)</span><textarea className="input" rows={2} maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} /></label>
          {err && <p className="error" role="alert" style={{ margin: 0 }}>{err}</p>}
          <button type="submit" className="btn btn-signal vt-btn" style={{ alignSelf: 'flex-start' }} disabled={busy} data-testid="vq-grade">Save the grade</button>
        </form>
      ))}
    </li>
  );
}

/* ---------- Integrity queue ---------- */

export function IntegrityQueue({ onDone }) {
  const [status, setStatus] = useState('open');
  const st = useApi(`/api/admin/vetting/queue?kind=integrity&status=${status}`);
  const done = () => { st.reload(); onDone?.(); };
  return (
    <section className="stack g12" aria-label="Integrity queue">
      <div className="vi-explain" role="note">
        <strong>Signals, not proof.</strong> These attempts collected enough points (5 or more) to keep the badge back until a person looks.
        <strong> Clear</strong> if nothing is wrong: the badge is issued when the scores pass. <strong>Hold</strong> keeps the badge back. Holding never bans anyone: they can take the check again after 30 days. Companies never see any of this.
      </div>
      <div className="ad-toolbar"><Filter status={status} setStatus={setStatus} label="Show" /></div>
      <Loading st={st}>{(d) => (d.items.length === 0 ? <div className="well small muted vt-empty">{status === 'open' ? 'Nothing waiting.' : 'No decisions yet.'}</div> : (
        <ul className="vq-list">{d.items.map((x) => <IntegrityItem key={x.id} x={x} onDone={done} />)}</ul>
      ))}</Loading>
    </section>
  );
}

function IntegrityItem({ x, onDone }) {
  const toast = useToast();
  const [busy, run] = useAction(toast);
  const [note, setNote] = useState('');
  const integ = x.attempt.integrity || {};
  const [lvl, tone] = LEVEL[integ.level] || [integ.level || 'Unknown', 'mchip-neutral'];
  const sig = signalLines(x.attempt.signals);
  const open = x.status === 'open';
  const decide = (decision) => run(async () => {
    const r = await http(`/api/admin/vetting/queue/${x.id}/decide`, { method: 'POST', body: { decision, note: note.trim() } });
    toast(decision === 'hold' ? 'Held: no badge for this attempt. They can try again after 30 days.' : r.verified ? 'Cleared: badge issued' : 'Cleared: no badge yet (the scores or the task are not enough)');
    onDone();
  });
  return (
    <li className="card stack g12 vq-item" data-testid="vi-item" data-level={integ.level}>
      <Who x={x} />
      <div className="vt-chips">
        <span className={`mchip ${tone}`}>{lvl}</span>
        <span className="mchip mchip-neutral">{integ.points ?? x.data?.points ?? 0} points</span>
        <span className="mchip mchip-info">Test {x.attempt.score ?? '—'}/100</span>
        {x.data?.stage && <span className="mchip mchip-neutral">Flagged at the {x.data.stage === 'task' ? 'practical task' : 'test'}</span>}
        {x.attempt.strict && <span className="mchip mchip-bad">Strict retest</span>}
        {!open && <span className={`mchip ${x.decision === 'clear' ? 'mchip-ok' : 'mchip-warn'}`}>{x.decision === 'clear' ? 'Cleared' : 'Held'}</span>}
      </div>
      {integ.reasons?.length > 0 && (
        <div className="stack g4"><span className="label">Why</span><ul className="small vi-reasons">{integ.reasons.map((r) => <li key={r}>{r}</li>)}</ul></div>
      )}
      {sig.length > 0 && (
        <div className="stack g4"><span className="label">Key signals</span>
          <dl className="vi-signals">{sig.map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}</dl>
        </div>
      )}
      {!open && x.note && <span className="small">Note: {x.note}</span>}
      {open && (
        <div className="stack g8">
          <label className="field"><span className="label">Note (kept with the decision)</span><textarea className="input" rows={2} maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} data-testid="vi-note" /></label>
          <div className="row g8 vt-wrap">
            <button type="button" className="btn btn-signal vt-btn" disabled={busy} onClick={() => decide('clear')} data-testid="vi-clear">Clear (issue the badge)</button>
            <button type="button" className="btn btn-outline vt-btn" disabled={busy} onClick={() => decide('hold')} data-testid="vi-hold">Hold</button>
          </div>
        </div>
      )}
    </li>
  );
}

/* ---------- Stats ---------- */

export function Stats() {
  const [days, setDays] = useState(14);
  const st = useApi(`/api/admin/vetting/stats?days=${days}`);
  return (
    <section className="stack g12" aria-label="Stats">
      <div className="ad-toolbar">
        <label className="field"><span className="label">Period</span>
          <select className="input" value={days} onChange={(e) => setDays(Number(e.target.value))} data-testid="vs-days">
            {[7, 14, 30, 90].map((n) => <option key={n} value={n}>Last {n} days</option>)}
          </select>
        </label>
      </div>
      <Loading st={st}>{(d) => {
        const attempts = d.roles.reduce((a, r) => a + r.attempts, 0);
        const verified = d.roles.reduce((a, r) => a + r.verified, 0);
        const passed = d.roles.reduce((a, r) => a + (r.passRate * r.attempts) / 100, 0);
        const rupees = d.daily.reduce((a, r) => a + r.aiRupees, 0);
        const flagged = d.daily.reduce((a, r) => a + r.watch + r.retest, 0);
        return (
          <div className="stack g16">
            <div className="vs-kpis">
              {[['Attempts', attempts], ['Pass rate', attempts ? `${Math.round((100 * passed) / attempts)}%` : '—'], ['Skill verified', verified], ['Watch or retest', flagged], ['AI spend (approx.)', `₹${rupees.toFixed(2)}`]].map(([l, v]) => (
                <div key={l} className="mstat"><span className="mstat-l">{l}</span><span className="mstat-v">{v}</span></div>
              ))}
            </div>
            <div className="card stack g8">
              <h2 className="vr-title">Per role</h2>
              {d.roles.length === 0 ? <span className="small muted">No attempts in this period.</span> : (
                <div className="table-wrap mtable-wrap vt-scroll">
                  <table className="table mtable vt-table" data-testid="vs-roles">
                    <caption className="sr-only">Attempts per role, last {d.days} days</caption>
                    <thead><tr><th scope="col">Skill check</th><th scope="col">Role</th><th scope="col">Attempts</th><th scope="col">Pass rate</th><th scope="col">Average score</th><th scope="col">Verified</th></tr></thead>
                    <tbody>{d.roles.map((r) => <tr key={r.skill}><th scope="row">{r.skill}</th><td data-label="Role">{r.role || '—'}</td><td data-label="Attempts" className="num">{r.attempts}</td><td data-label="Pass rate" className="num">{r.passRate}%</td><td data-label="Average score" className="num">{r.avgScore}</td><td data-label="Verified" className="num">{r.verified}</td></tr>)}</tbody>
                  </table>
                </div>
              )}
            </div>
            <div className="card stack g8">
              <h2 className="vr-title">Per day</h2>
              {d.daily.length === 0 ? <span className="small muted">No attempts in this period.</span> : (
                <div className="table-wrap mtable-wrap vt-scroll">
                  <table className="table mtable vt-table" data-testid="vs-daily">
                    <caption className="sr-only">Attempts and AI spend per day</caption>
                    <thead><tr><th scope="col">Day</th><th scope="col">Attempts</th><th scope="col">Watch</th><th scope="col">Needs retest</th><th scope="col">AI calls</th><th scope="col">Approx. ₹</th></tr></thead>
                    <tbody>{[...d.daily].reverse().map((r) => <tr key={r.day}><th scope="row">{day(`${r.day}T00:00:00`)}</th><td data-label="Attempts" className="num">{r.attempts}</td><td data-label="Watch" className="num">{r.watch}</td><td data-label="Needs retest" className="num">{r.retest}</td><td data-label="AI calls" className="num">{r.aiCalls}</td><td data-label="Approx. ₹" className="num">₹{r.aiRupees.toFixed(2)}</td></tr>)}</tbody>
                  </table>
                </div>
              )}
              <span className="xs muted">AI cost is an estimate: about ₹{d.rupeesPerCall} a grading call.</span>
            </div>
          </div>
        );
      }}</Loading>
    </section>
  );
}
