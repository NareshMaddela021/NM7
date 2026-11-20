// Profile setup P4: the "Profile setup" section of Admin > Daily report (from the snapshot). For each role (job seekers,
// freshers, students, experts, companies, colleges): how many reached each checklist step, and how many dropped off
// between one step and the next. Counts only, no names. Backend: app/setup/funnel.py (worked out in the daily snapshot,
// the newest 200 per role, demo / test / persona accounts left out). Its own chunk and stylesheet.
import { useState } from 'react';
import '../../../styles/admin-funnel.css';

const num = (v) => (v == null ? '-' : Number(v).toLocaleString('en-IN'));
const plural = (n, one, many = `${one}s`) => `${num(n)} ${n === 1 ? one : many}`;
const pct = (n, of) => (of ? `${Math.round((100 * n) / of)}%` : '-');

/** The words under a role's title: how many have the role, and how many were looked at. */
export function lookedText(r) {
  const who = r.role === 'company' ? ['company', 'companies'] : r.role === 'college' ? ['college', 'colleges'] : ['person', 'people'];
  let s = `${plural(r.total, ...who)} in all`;
  if (r.capped) s += `; the steps are worked out for the newest ${num(r.looked)}`;
  if (r.partial) s += ' (stopped early to keep the server fast: press Refresh now later)';
  return `${s}.`;
}

function Role({ r }) {
  const rows = [{ id: 'start', title: r.start, reached: r.looked, start: true }, ...r.steps];
  return (
    <div className="sf-role stack g8" data-testid="sf-role" data-role={r.role}>
      <span className="small muted" data-testid="sf-looked">{lookedText(r)}</span>
      <span className="small">
        <strong data-testid="sf-complete">{plural(r.complete, 'profile')} complete</strong> ({pct(r.complete, r.looked)})
        {r.quickStart != null && <> · {num(r.quickStart)} finished the quick start</>}
      </span>
      {r.looked === 0 ? <span className="small muted" data-testid="sf-empty">Nobody with this role yet.</span> : (
        <ol className="sf-steps" data-testid="sf-steps">
          {rows.map((s, i) => (
            <li key={s.id} className={`sf-step${s.required === false ? ' sf-opt' : ''}`} data-testid="sf-step" data-step={s.id}>
              <span className="sf-name"><span className="sf-n" aria-hidden="true">{s.start ? '' : `${i}.`}</span>{s.title}{s.required === false && <span className="xs muted"> (optional)</span>}</span>
              <span className="sf-track" aria-hidden="true"><span className="sf-fill" style={{ width: pct(s.required === false ? s.done : s.reached, r.looked) }} /></span>
              <span className="sf-v">
                {s.start ? <strong>{num(s.reached)}</strong> : s.required === false
                  ? <><strong>{num(s.done)}</strong> <span className="xs muted">did it</span></>
                  : <><strong data-testid="sf-reached">{num(s.reached)}</strong> <span className="xs muted">got this far</span></>}
              </span>
              {!s.start && (
                <span className="xs muted sf-more">
                  {s.required !== false && s.dropOff > 0 && <span className="sf-drop" data-testid="sf-drop">{num(s.dropOff)} dropped off ({s.dropPct}%)</span>}
                  {s.required !== false && s.dropOff === 0 && <span>No drop-off</span>}
                  {s.required !== false && s.done !== s.reached && <span>{num(s.done)} did it in any order</span>}
                  {s.waiting > 0 && <span>{num(s.waiting)} waiting for review</span>}
                  {s.skipped > 0 && <span>{num(s.skipped)} skipped for now</span>}
                  {s.shown < r.looked && <span>shown to {num(s.shown)}</span>}
                </span>
              )}
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

export default function SetupFunnel({ f }) {
  const [role, setRole] = useState('jobseeker');
  if (!f) return <span className="small muted" data-testid="sf-none">No profile setup numbers in this snapshot yet. Press Refresh now.</span>;
  const r = f.roles.find((x) => x.role === role) || f.roles[0];
  return (
    <div className="stack g12" data-testid="sf">
      <div className="sf-tabs" role="group" aria-label="Role">
        {f.roles.map((x) => (
          <button key={x.role} type="button" className={`btn btn-sm ${x.role === r.role ? 'btn-primary' : 'btn-outline'}`} aria-pressed={x.role === r.role} onClick={() => setRole(x.role)} data-testid={`sf-tab-${x.role}`}>{x.label} ({num(x.total)})</button>
        ))}
      </div>
      <Role r={r} />
      <span className="xs muted">
        Got this far: did this step and every required step above it. Dropped off: got to the step above but not this one.
        Counts only, never names. Demo people, test users and admins&apos; personas are never counted.
        {f.hidden?.length > 0 && ` Left out because the switch is off for everyone: ${f.hidden.join('; ')}.`}
      </span>
    </div>
  );
}
