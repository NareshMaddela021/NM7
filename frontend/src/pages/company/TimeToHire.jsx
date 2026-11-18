// Vetting Trust T13, in the Hire now tab: this company's own time to hire, in minutes, per job and overall (median and
// p75 for jobs posted in the last 7 / 30 / 90 days), next to the Nm7 median (shown only when enough jobs from enough
// companies are behind it; never another company's numbers). Renders nothing unless the Trust switch lets this company
// in (GET /api/company/{id}/trust/tth answers 404 otherwise). English (as the other company-side Trust cards).
import { useEffect, useState } from 'react';
import { rq } from '../../lib/company';

export default function TimeToHire({ c }) {
  const [d, setD] = useState(null);
  const [days, setDays] = useState('30');
  useEffect(() => { rq(`/api/company/${c.id}/trust/tth`).then(setD, () => setD(null)); }, [c.id]);
  if (!d) return null;
  const p = d.periods[days];
  const nm7 = d.nm7.periods[days] || {};
  const main = d.steps.filter((s) => !s.extra);
  const jobs = d.jobs.filter((j) => main.some((s) => j.minutes[s.key] != null) || j.status === 'active');
  return (
    <section className="mcard stack g12 tth-co" aria-labelledby="tth-co-h" data-testid="tth-co">
      <header className="stack g4">
        <strong id="tth-co-h" className="mcard-title">Time to hire</strong>
        <span className="xs muted">How long each step took from posting the job, for jobs you posted in the last {days} days (only jobs that reached the step). The Nm7 median is across many companies.</span>
      </header>
      <div className="tth-co-tabs" role="group" aria-label="Jobs posted in the last">
        {['7', '30', '90'].map((x) => (
          <button key={x} type="button" className={`btn btn-sm ${x === days ? 'btn-primary' : 'btn-outline'}`} aria-pressed={x === days} onClick={() => setDays(x)} data-testid={`tth-co-days-${x}`}>{x} days</button>
        ))}
      </div>
      <ul className="tth-co-steps" data-testid="tth-co-steps">
        {d.steps.map((s) => {
          const x = p.steps[s.key];
          const n = nm7[s.key];
          return (
            <li key={s.key} className="tth-co-step" data-testid="tth-co-step" data-key={s.key}>
              <span className="xs muted">{s.label}</span>
              <strong data-testid="tth-co-median">{x.n ? x.medianText : 'Not yet'}</strong>
              {x.n > 0 && <span className="xs muted">p75 {x.p75Text} · {x.n} {x.n === 1 ? 'job' : 'jobs'}</span>}
              <span className="xs" data-testid="tth-co-nm7">Nm7 median: {n ? n.medianText : 'not enough data yet'}</span>
            </li>
          );
        })}
      </ul>
      {jobs.length > 0 && (
        <ul className="tth-co-jobs" data-testid="tth-co-jobs">
          {jobs.slice(0, 30).map((j) => (
            <li key={j.id} className="tth-co-job" data-testid="tth-co-job">
              <strong className="small">{j.title}</strong>
              <span className="xs muted">{main.map((s) => `${s.label}: ${j.text[s.key]}`).join(' · ')}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
