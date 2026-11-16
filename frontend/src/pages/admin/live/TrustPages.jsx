// Admin → Skill checks, the Vetting V5 tabs: Appeals ("I think this is wrong" from candidates: a person replies within
// 72 hours with a free retest, a corrected score or "kept" with a note; the appeal rate per role points at bad
// questions), Fraud scan (the daily scan's findings with the people and the evidence: Clear or Confirm with a note;
// confirming holds badges back and never bans anyone) and Fairness (pass rates by language, city tier and experience
// band; caste, religion and similar are never collected). All from /api/admin/vetting/* (permission "jobs").
import { useId, useState } from 'react';
import { useToast } from '../../../components/ui';
import { Loading, day, http, useAction, useApi, when } from './common';
import { Filter } from './VettingPages';

const WHAT = { skill: 'Skill check', task: 'Practical task', interview: 'Interview' };
const OUTCOMES = [
  ['retest', 'Free retest', 'They can take it again now, free.'],
  ['corrected', 'Corrected score', 'Give the right score (0–100); the badge is re-checked.'],
  ['kept', 'Kept as it is', 'The result stands; say why.'],
];
const OUTCOME_CHIP = { retest: ['Free retest', 'mchip-ok'], corrected: ['Corrected', 'mchip-ok'], kept: ['Kept', 'mchip-neutral'] };
const pct = (v) => (v == null ? '—' : `${v}%`);

function Initial({ name }) {
  return <span className="vq-av" aria-hidden="true">{(name || '?').charAt(0).toUpperCase()}</span>;
}

/* ---------- Appeals ---------- */

export function Appeals() {
  const [status, setStatus] = useState('open');
  const st = useApi(`/api/admin/vetting/appeals?status=${status}`);
  return (
    <section className="stack g12" aria-label="Appeals">
      <div className="vi-explain" role="note">
        <strong>Reply within 72 hours.</strong> A candidate tapped “I think this is wrong”. Read the reason, look at the attempt, then pick
        a <strong>free retest</strong>, a <strong>corrected score</strong>, or <strong>kept as it is</strong>. The candidate sees the outcome and your note.
      </div>
      <div className="ad-toolbar"><Filter status={status} setStatus={setStatus} label="Show appeals" /></div>
      <Loading st={st}>{(d) => (
        <div className="stack g16">
          {d.items.length === 0 ? <div className="well small muted vt-empty">{status === 'open' ? 'No open appeals.' : 'No decided appeals yet.'}</div> : (
            <ul className="vq-list">{d.items.map((x) => <AppealItem key={x.id} x={x} onDone={st.reload} />)}</ul>
          )}
          <PerRole rows={d.perRole || []} />
        </div>
      )}</Loading>
    </section>
  );
}

function AppealItem({ x, onDone }) {
  const id = useId();
  const toast = useToast();
  const [busy, run] = useAction(toast);
  const [outcome, setOutcome] = useState('');
  const [score, setScore] = useState('');
  const [note, setNote] = useState('');
  const [err, setErr] = useState('');
  const open = !x.outcome;
  const submit = (e) => {
    e.preventDefault();
    setErr('');
    if (!outcome) { setErr('Pick an outcome.'); return; }
    const n = Number(score);
    if (outcome === 'corrected' && (score === '' || !Number.isInteger(n) || n < 0 || n > 100)) { setErr('Give the corrected score, a whole number from 0 to 100.'); return; }
    if (note.trim().length < 3) { setErr('Write a short note for the candidate (3 characters or more).'); return; }
    run(async () => {
      await http(`/api/admin/vetting/appeals/${x.id}`, { method: 'POST', body: { outcome, note: note.trim(), ...(outcome === 'corrected' ? { score: n } : {}) } });
      toast('Saved: the candidate can see the outcome');
      onDone();
    });
  };
  const [chip, tone] = OUTCOME_CHIP[x.outcome] || [];
  return (
    <li className={`card stack g12 vq-item ${x.overdue ? 'tr-overdue' : ''}`} data-testid="ap-item" data-overdue={x.overdue ? 'true' : undefined}>
      <div className="vq-who">
        <Initial name={x.person} />
        <span className="stack g2" style={{ minWidth: 0 }}>
          <strong className="vq-name">{x.person || 'Unnamed'}</strong>
          <span className="xs muted">{WHAT[x.what] || x.what} · {x.skill || '—'} · asked {when(x.createdAt)}</span>
        </span>
      </div>
      <div className="vt-chips">
        <span className="mchip mchip-neutral">{WHAT[x.what] || x.what}</span>
        {open && (x.overdue ? <span className="mchip mchip-bad" data-testid="ap-overdue">Overdue · was due {when(x.dueAt)}</span> : <span className="mchip mchip-info">Reply by {when(x.dueAt)}</span>)}
        {chip && <span className={`mchip ${tone}`}>{chip}</span>}
      </div>
      <div className="stack g4">
        <span className="label">Their reason</span>
        <blockquote className="tr-reason">{x.reason}</blockquote>
      </div>
      {!open && x.note && <span className="small">Note: {x.note}</span>}
      {open && (
        <form className="stack g12" onSubmit={submit} noValidate aria-label={`Decide the appeal from ${x.person || 'this candidate'}`}>
          <fieldset className="tr-outcomes">
            <legend className="label">Outcome</legend>
            {OUTCOMES.map(([v, l, help]) => (
              <label key={v} className="vt-check tr-outcome">
                <input type="radio" name={`${id}-o`} value={v} checked={outcome === v} onChange={() => setOutcome(v)} data-testid={`ap-o-${v}`} />
                <span><strong>{l}</strong> <span className="xs muted">{help}</span></span>
              </label>
            ))}
          </fieldset>
          {outcome === 'corrected' && (
            <label className="field tr-score"><span className="label">Corrected score (0–100)</span>
              <input className="input" type="number" inputMode="numeric" min={0} max={100} step={1} value={score} onChange={(e) => setScore(e.target.value)} data-testid="ap-score" />
            </label>
          )}
          <label className="field"><span className="label">Note (the candidate sees it)</span>
            <textarea className="input" rows={2} maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} data-testid="ap-note" />
          </label>
          {err && <p className="error" role="alert" style={{ margin: 0 }}>{err}</p>}
          <button type="submit" className="btn btn-signal vt-btn" style={{ alignSelf: 'flex-start' }} disabled={busy} data-testid="ap-save">Save the outcome</button>
        </form>
      )}
    </li>
  );
}

function PerRole({ rows }) {
  return (
    <div className="card stack g8">
      <h2 className="vr-title">Appeal rate per role (last 90 days)</h2>
      {rows.length === 0 ? <span className="small muted">No appeals in the last 90 days.</span> : (
        <div className="table-wrap mtable-wrap vt-scroll">
          <table className="table mtable vt-table" data-testid="ap-per-role">
            <caption className="sr-only">Appeals per role, last 90 days</caption>
            <thead><tr><th scope="col">Skill check</th><th scope="col">Appeals</th><th scope="col">Upheld</th><th scope="col">Appeal rate</th></tr></thead>
            <tbody>{rows.map((r) => <tr key={r.skill}><th scope="row">{r.skill || '—'}</th><td data-label="Appeals" className="num">{r.appeals}</td><td data-label="Upheld" className="num">{r.upheld}</td><td data-label="Appeal rate" className="num">{pct(r.rate)}</td></tr>)}</tbody>
          </table>
        </div>
      )}
      <span className="xs muted">Appeal rate: appeals for every 100 tests taken. “Upheld” means a free retest or a corrected score. A high rate points at unclear or wrong questions.</span>
    </div>
  );
}

/* ---------- Fraud scan ---------- */

export function FraudScan() {
  const [status, setStatus] = useState('open');
  const st = useApi(`/api/admin/vetting/fraud?status=${status}`);
  return (
    <section className="stack g12" aria-label="Fraud scan">
      <div className="vi-explain" role="note">
        <strong>The daily scan finds signals, not proof:</strong> one phone or device on several accounts, nearly identical resumes, resume dates that can’t be true and copied answers.
        A person decides. <strong>Confirming holds the people’s badges back. It never bans anyone.</strong> Clear it if there is a good reason (family members sharing a phone, for example).
      </div>
      <div className="ad-toolbar"><Filter status={status} setStatus={setStatus} label="Show findings" /></div>
      <Loading st={st}>{(d) => (d.items.length === 0 ? <div className="well small muted vt-empty">{status === 'open' ? 'Nothing found to look at.' : 'No decisions yet.'}</div> : (
        <ul className="vq-list">{d.items.map((x) => <FraudItem key={x.id} x={x} onDone={st.reload} />)}</ul>
      ))}</Loading>
    </section>
  );
}

function FraudItem({ x, onDone }) {
  const toast = useToast();
  const [busy, run] = useAction(toast);
  const [note, setNote] = useState('');
  const [err, setErr] = useState('');
  const open = x.status === 'open';
  const decide = (decision) => {
    setErr('');
    if (note.trim().length < 3) { setErr('Write a short note first (3 characters or more).'); return; }
    run(async () => {
      await http(`/api/admin/vetting/fraud/${x.id}`, { method: 'POST', body: { decision, note: note.trim() } });
      toast(decision === 'confirmed' ? 'Confirmed: their badges are held back (no ban)' : 'Cleared');
      onDone();
    });
  };
  return (
    <li className="card stack g12 vq-item" data-testid="fr-item" data-level={open ? 'watch' : undefined}>
      <div className="row between g8 vt-wrap">
        <strong className="vq-name">{x.what}</strong>
        <span className="xs muted">Last seen {when(x.updatedAt)}</span>
      </div>
      {!open && <div className="vt-chips"><span className={`mchip ${x.decision === 'confirmed' ? 'mchip-warn' : 'mchip-ok'}`}>{x.decision === 'confirmed' ? 'Confirmed · badges held' : 'Cleared'}</span></div>}
      <div className="stack g4">
        <span className="label">People ({x.people.length})</span>
        <ul className="tr-people">
          {x.people.map((p) => (
            <li key={p.id} className="vq-who">
              <Initial name={p.name} />
              <span className="stack g2" style={{ minWidth: 0 }}><strong className="small">{p.name || 'Unnamed'}</strong><span className="xs muted tr-email">{p.email || p.id}</span></span>
            </li>
          ))}
        </ul>
      </div>
      {x.evidence.length > 0 && (
        <div className="stack g4"><span className="label">Evidence</span><ul className="small vi-reasons">{x.evidence.map((e) => <li key={e}>{e}</li>)}</ul></div>
      )}
      {!open && x.note && <span className="small">Note: {x.note}</span>}
      {open && (
        <div className="stack g8">
          <label className="field"><span className="label">Note (kept with the decision)</span><textarea className="input" rows={2} maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} data-testid="fr-note" /></label>
          {err && <p className="error" role="alert" style={{ margin: 0 }}>{err}</p>}
          <div className="row g8 vt-wrap">
            <button type="button" className="btn btn-outline vt-btn" disabled={busy} onClick={() => decide('clear')} data-testid="fr-clear">Clear</button>
            <button type="button" className="btn btn-signal vt-btn" disabled={busy} onClick={() => decide('confirmed')} data-testid="fr-confirm">Confirm (hold badges)</button>
          </div>
        </div>
      )}
    </li>
  );
}

/* ---------- Fairness ---------- */

const FAIR = [['language', 'Language of the test'], ['cityTier', 'City tier'], ['band', 'Experience band']];

export function Fairness() {
  const [days, setDays] = useState(30);
  const st = useApi(`/api/admin/vetting/fairness?days=${days}`);
  return (
    <section className="stack g12" aria-label="Fairness">
      <div className="ad-toolbar">
        <label className="field"><span className="label">Period</span>
          <select className="input" value={days} onChange={(e) => setDays(Number(e.target.value))} data-testid="fa-days">
            {[30, 90, 180, 365].map((n) => <option key={n} value={n}>Last {n} days</option>)}
          </select>
        </label>
      </div>
      <Loading st={st}>{(d) => (
        <div className="stack g16">
          <p className="vi-explain" role="note" data-testid="fa-note">
            <strong>Pass rates by group, to spot a test that is unfair to some people.</strong> {d.note || 'Never collected: caste, religion, gender or anything similar.'} A big gap between groups is a reason to look at the questions, not at the people.
          </p>
          <div className="tr-fair">
            {FAIR.map(([k, title]) => {
              const rows = d[k] || [];
              return (
                <div key={k} className="card stack g8">
                  <h2 className="vr-title">{title}</h2>
                  {rows.length === 0 ? <span className="small muted">No tests in this period.</span> : (
                    <div className="table-wrap mtable-wrap vt-scroll">
                      <table className="table mtable vt-table" data-testid={`fa-${k}`}>
                        <caption className="sr-only">{title}: attempts and pass rate, last {d.days ?? days} days</caption>
                        <thead><tr><th scope="col">Group</th><th scope="col">Attempts</th><th scope="col">Pass rate</th></tr></thead>
                        <tbody>{rows.map((r) => <tr key={r.group}><th scope="row">{r.group}</th><td data-label="Attempts" className="num">{r.attempts}</td><td data-label="Pass rate" className="num">{pct(r.passRate)}</td></tr>)}</tbody>
                      </table>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
          <span className="xs muted">Pass: a test score of 70 or more. Period: {d.days ?? days} days, up to {day(Date.now())}.</span>
        </div>
      )}</Loading>
    </section>
  );
}
