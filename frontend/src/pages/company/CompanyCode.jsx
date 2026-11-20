// Vetting Trust T14: a candidate's coding task for the company (in the applicant's profile): "X of Y hidden tests passed"
// and, if the candidate agreed, a replay of the code editor only (how the solution was written). Shown only where
// Vetting Trust is on for the company and Admin allows company replays; the API answers 404 otherwise, and then
// nothing shows. Each view is in Nm7's audit log. English only (like the other company-side Trust cards).
import { Suspense, lazy, useEffect, useState } from 'react';
import { rq } from '../../lib/company';
import { lazyRetry } from '../../lib/chunks';

const CodeReplay = lazy(lazyRetry(() => import('../me/trust/CodeReplay')));
const day = (ms) => (ms ? new Date(ms).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '');

export default function CompanyCode({ c, uid }) {
  const [d, setD] = useState(null);
  const [watch, setWatch] = useState(false);
  useEffect(() => { rq(`/api/company/${c.id}/trust/code/${encodeURIComponent(uid)}`).then(setD, () => setD(null)); }, [c.id, uid]);
  if (!d) return null;
  return (
    <section className="mcard mcard-tight stack g8" aria-label="Coding task" data-testid="co-code">
      <strong className="small">Coding task · {d.skill}</strong>
      <span className="small" data-testid="co-code-line">{d.passed} of {d.total} hidden tests passed · {d.problem} · {d.language} · {day(d.at)}</span>
      {d.replay
        ? (watch
          ? <Suspense fallback={<span className="small muted">Loading the replay…</span>}><CodeReplay replay={d.replay} /></Suspense>
          : <div><button type="button" className="btn btn-outline btn-sm" style={{ minHeight: 44 }} onClick={() => setWatch(true)} data-testid="co-code-watch">Watch how the code was written</button></div>)
        : <span className="xs muted">No replay: the candidate didn’t choose to share one.</span>}
    </section>
  );
}
