// Auto Apply 2.0, phase A2, on the company dashboard (only for companies the 2.0 switch lets in: GET
// /api/company/{id}/auto-apply says so). Per-job controls (accept auto applications on / off, the most this job takes,
// the lowest vetting level, shown only where vetting levels show to the company) in the posting form and on each job
// (saving them doesn't use one of the job's edits), and on an applicant card the "Sent by Auto Apply" label with the
// match score, 3 plain reasons, vetting badges, notice period, expected salary and the cover note. English only while
// it is tested. No pop-up dialogs; everything wraps at 390 px.
import { useEffect, useState } from 'react';
import { rq } from '../../lib/company';
import { Chip } from '../me/kit';

export const AUTO_LABEL = 'Sent by Auto Apply';
const LEVELS = [[0, 'Any level'], [1, 'L1 · Profile ready'], [2, 'L2 · Skill verified'], [3, 'L3 · Interview-ready'], [4, 'L4 · Nm7 verified']];

/** {on, vetting, defaults, maxCap} for this company, or null while loading / when 2.0 is hidden from it. */
export function useAutoInfo(cid) {
  const [info, setInfo] = useState(null);
  useEffect(() => { rq(`/api/company/${cid}/auto-apply`).then((x) => setInfo(x.on ? x : null), () => setInfo(null)); }, [cid]);
  return info;
}

/** The three controls as form fields (the posting form and each job's settings). */
function Fields({ id, v, set, info }) {
  return (
    <div className="aa-co-fields">
      <label className="aa-co-switch"><input type="checkbox" checked={v.accept} onChange={(e) => set({ ...v, accept: e.target.checked })} data-testid="aa-co-accept" /> Accept applications sent by Auto Apply</label>
      <div className="cj-grid">
        <div className="field"><label className="label" htmlFor={`${id}-max`}>Most auto applications for this job</label>
          <input id={`${id}-max`} className="input" inputMode="numeric" disabled={!v.accept} value={v.max} onChange={(e) => set({ ...v, max: e.target.value.replace(/[^\d]/g, '').slice(0, 3) })} data-testid="aa-co-max" /></div>
        {info.vetting && (
          <div className="field"><label className="label" htmlFor={`${id}-lvl`}>Lowest vetting level</label>
            <select id={`${id}-lvl`} className="input" disabled={!v.accept} value={v.minLevel} onChange={(e) => set({ ...v, minLevel: Number(e.target.value) })} data-testid="aa-co-level">
              {LEVELS.map(([n, l]) => <option key={n} value={n}>{l}</option>)}
            </select></div>
        )}
      </div>
    </div>
  );
}

const body = (v) => ({ accept: v.accept, max: Number(v.max) || 1, minLevel: Number(v.minLevel) || 0 });

/** In the posting form (new jobs on Nm7): starts at the defaults; sent with the post. */
export function NewJobAuto({ info, value, onChange }) {
  const v = value || { ...info.defaults };
  return (
    <fieldset className="aa-co stack g8" data-testid="aa-co-new">
      <legend className="cj-q-legend">Auto Apply</legend>
      <span className="xs muted">People who turned on Auto Apply and match this job well can apply as soon as it is live. Each one is labelled “{AUTO_LABEL}”, with the match score and a cover note.</span>
      <Fields id="aa-new" v={v} set={onChange} info={info} />
    </fieldset>
  );
}
export const newJobBody = (v) => (v ? { autoApply: body(v) } : {});

/** On a job: a one-line summary, and the controls to change (not counted as an edit). */
export function JobAuto({ c, j, info, can, onSaved }) {
  const [open, setOpen] = useState(false);
  const [v, setV] = useState(() => ({ ...j.autoApply }));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const a = j.autoApply;
  if (!a) return null;
  const level = LEVELS.find(([n]) => n === a.minLevel)?.[1] || 'Any level';
  const save = async (e) => {
    e.preventDefault();
    setBusy(true); setErr('');
    try { await rq(`/api/company/${c.id}/jobs/${j.id}/auto-apply`, { method: 'PUT', body: body(v) }); setOpen(false); onSaved(); } catch (x) { setErr(x.message); } finally { setBusy(false); }
  };
  return (
    <div className="aa-co-job" data-testid="aa-co-job">
      <span className="xs" data-testid="aa-co-summary">
        Auto Apply: {a.accept ? `on · ${a.received} of ${a.max} received${info.vetting ? ` · ${level}` : ''}` : 'off'}
      </span>
      {can && j.status !== 'closed' && !open && <button type="button" className="link-btn small" onClick={() => { setV({ ...a }); setOpen(true); }} data-testid="aa-co-edit">Auto Apply settings</button>}
      {open && (
        <form className="stack g8 aa-co-form" onSubmit={save} aria-label="Auto Apply settings">
          <Fields id={`aa-${j.id}`} v={v} set={setV} info={info} />
          <span className="xs muted">Saving these doesn’t use one of the job’s edits.</span>
          {err && <p className="error" role="alert" style={{ margin: 0 }}>{err}</p>}
          <div className="row g8"><button type="submit" className="btn btn-signal btn-sm" disabled={busy} data-testid="aa-co-save">Save</button>
            <button type="button" className="link-btn small" onClick={() => setOpen(false)}>Cancel</button></div>
        </form>
      )}
    </div>
  );
}

/** The chip on an applicant card. */
export function AutoChip({ a }) {
  if (!a.auto) return null;
  return <Chip tone="accent" testid="co-ap-auto2" title="This person turned on Auto Apply; Nm7 applied for them within their rules and with their consent.">{AUTO_LABEL}</Chip>;
}

/** What came with an auto application: score, 3 reasons, badges, notice, salary, cover note. */
export function AutoBlock({ a, open: startOpen = false }) {
  const x = a.auto;
  if (!x) return null;
  return (
    <details className="aa-co-block" open={startOpen} data-testid="co-ap-auto">
      <summary className="small"><strong>{AUTO_LABEL}</strong>{x.score != null ? ` · match ${x.score}/100` : ''}</summary>
      <div className="stack g8" style={{ marginTop: 8 }}>
        {x.reasons.length > 0 && <ul className="ca-reasons" data-testid="co-ap-auto-reasons">{x.reasons.map((r) => <li key={r}>{r}</li>)}</ul>}
        {x.badges.length > 0 && <span className="ca-skills" data-testid="co-ap-auto-badges">{x.badges.map((b) => <span key={b} className="ca-skill ok">{b}</span>)}</span>}
        <dl className="aa-co-facts">
          <div><dt>Notice period</dt><dd data-testid="co-ap-auto-notice">{x.notice || 'Not given'}</dd></div>
          <div><dt>Expected salary</dt><dd data-testid="co-ap-auto-salary">{x.salary || 'Not given'}</dd></div>
        </dl>
        {x.coverNote.length > 0 && (
          <div className="stack g4"><span className="mkicker">Cover note</span>
            <div className="ca-note" data-testid="co-ap-auto-cover">{x.coverNote.map((l, i) => <p key={i} style={{ margin: '0 0 4px' }}>{l}</p>)}</div></div>
        )}
        {x.tailored && <span className="xs muted">Their resume (the Resume button) is the version tailored for this job: their own resume, reordered and rephrased, never anything added.</span>}
      </div>
    </details>
  );
}
