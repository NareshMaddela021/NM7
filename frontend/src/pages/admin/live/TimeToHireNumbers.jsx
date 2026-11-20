// Vetting Trust T13: the "Time to hire" section of Admin -> Daily report (from the snapshot): per step the median and p75
// minutes from a job being posted (7 / 30 / 90 days, up slower / down faster than the period before), a small funnel, the
// slowest companies by time to first contact, live jobs nobody contacted, every company's medians and the "Needs
// attention" thresholds (Admin). Backend: app/trust/tth/service.py. Its own stylesheet and no shared imports (`http` comes
// from the report), so the main bundle's import map stays the same.
import { useState } from 'react';
import '../../../styles/admin-tth.css';

const num = (v) => (v == null ? '—' : Number(v).toLocaleString('en-IN'));
const TONE = { up: 'tth-up', down: 'tth-down', same: '', none: '' };

function Thresholds({ http, toast }) {
  const [f, setF] = useState(null);
  const [busy, setBusy] = useState(false);
  const open = (e) => {
    if (e.currentTarget.open && !f) http('/api/admin/trust/tth').then(setF, (x) => toast(x.message || 'Couldn’t load the thresholds.'));
  };
  const save = async () => {
    setBusy(true);
    try {
      setF(await http('/api/admin/trust/tth', { method: 'PUT', body: { contactHours: Number(f.contactHours), staleHours: Number(f.staleHours), minJobs: Number(f.minJobs) } }));
      toast('Saved. The median rule applies now; press Refresh now for the rest.');
    } catch (x) {
      toast(x.message || 'That didn’t work. Please try again.');
    } finally {
      setBusy(false);
    }
  };
  const field = (k, label, [lo, hi]) => (
    <label className="tth-field small">
      <span>{label}</span>
      <input type="number" className="input" min={lo} max={hi} value={f[k]} onChange={(e) => setF({ ...f, [k]: e.target.value })} data-testid={`tth-set-${k}`} />
    </label>
  );
  return (
    <details className="tth-details" onToggle={open} data-testid="tth-thresholds">
      <summary className="small">“Needs attention” thresholds</summary>
      {!f ? <span className="small muted">Loading…</span> : (
        <div className="tth-form">
          {field('contactHours', 'Median time to first contact over (hours)', f.bounds.contactHours)}
          {field('staleHours', 'Live jobs with no contact after (hours)', f.bounds.staleHours)}
          {field('minJobs', 'Slowest companies: at least this many contacted jobs', f.bounds.minJobs)}
          <button type="button" className="btn btn-outline btn-sm" onClick={save} disabled={busy} aria-busy={busy} data-testid="tth-save">{busy ? 'Saving…' : 'Save'}</button>
        </div>
      )}
    </details>
  );
}

export default function TimeToHireNumbers({ tth, http, toast }) {
  const [days, setDays] = useState('30');
  if (!tth) return <span className="small muted" data-testid="tth-none">No time-to-hire numbers in this snapshot yet. Press Refresh now.</span>;
  const p = tth.periods[days];
  const main = tth.steps.filter((s) => !s.extra);
  const extra = tth.steps.filter((s) => s.extra);
  const max = Math.max(1, ...p.funnel.map((x) => x.n));
  return (
    <div className="stack g12" data-testid="tth">
      <div className="tth-tabs" role="group" aria-label="Jobs posted in the last">
        {['7', '30', '90'].map((d) => (
          <button key={d} type="button" className={`btn btn-sm ${d === days ? 'btn-primary' : 'btn-outline'}`} aria-pressed={d === days} onClick={() => setDays(d)} data-testid={`tth-days-${d}`}>{d} days</button>
        ))}
        <span className="xs muted">{num(p.jobs)} jobs posted · {num(p.prevJobs)} in the {days} days before</span>
      </div>
      <ul className="tth-steps" data-testid="tth-steps">
        {[...main, ...extra].map((s) => {
          const x = p.steps[s.key];
          return (
            <li key={s.key} className={`tth-step ${s.extra ? 'tth-step-extra' : ''}`} data-testid="tth-step" data-key={s.key}>
              <span className="tth-step-l">{s.label}</span>
              <strong className="tth-step-v" data-testid="tth-median">{x.n ? x.medianText : 'No data yet'}</strong>
              <span className="xs muted">{x.n ? `median · p75 ${x.p75Text} · ${num(x.n)} ${x.n === 1 ? 'job' : 'jobs'}` : 'no job reached this step'}</span>
              {x.n > 0 && <span className={`xs ${TONE[x.change.dir]}`} data-dir={x.change.dir}>{x.change.text}</span>}
            </li>
          );
        })}
      </ul>
      <div className="tth-grid">
        <div className="stack g6">
          <h3 className="tth-h3">Funnel</h3>
          <ul className="tth-funnel" data-testid="tth-funnel">
            {p.funnel.map((x) => (
              <li key={x.key} className="tth-bar-row" data-key={x.key}>
                <span className="tth-bar-name">{x.label}</span>
                <span className="tth-bar-track" aria-hidden="true"><span className="tth-bar-fill" style={{ width: `${Math.round((100 * x.n) / max)}%` }} /></span>
                <span className="tth-bar-n">{num(x.n)}</span>
              </li>
            ))}
          </ul>
        </div>
        <div className="stack g6">
          <h3 className="tth-h3">Slowest to first contact (30 days)</h3>
          {tth.slowest.length === 0 ? <span className="small muted" data-testid="tth-slowest-none">No company has {tth.settings.min_jobs} contacted jobs in the last 30 days yet.</span> : (
            <ol className="tth-slow" data-testid="tth-slowest">
              {tth.slowest.map((c) => (
                <li key={c.companyId} data-testid="tth-slow">
                  <span className="tth-slow-name">{c.name}</span>
                  <strong>{c.medianText}</strong>
                  <span className="xs muted">{num(c.contacted)} of {num(c.jobs)} jobs contacted</span>
                </li>
              ))}
            </ol>
          )}
          <span className="xs muted" data-testid="tth-stale">{tth.stale.n ? `${num(tth.stale.n)} live ${tth.stale.n === 1 ? 'job' : 'jobs'} with no contact after ${tth.stale.hours} h: ${tth.stale.jobs.map((j) => `${j.title} (${j.company}, ${j.hours} h)`).join('; ')}${tth.stale.n > tth.stale.jobs.length ? ' …' : ''}` : `Every live job older than ${tth.stale.hours} h has had a contact.`}</span>
        </div>
      </div>
      {tth.companies.length > 0 && (
        <details className="tth-details" data-testid="tth-companies">
          <summary className="small">Medians per company, last 30 days ({tth.companies.length})</summary>
          <div className="tth-table-wrap">
            <table className="tth-table">
              <thead><tr><th scope="col">Company</th><th scope="col">Jobs</th>{main.map((s) => <th key={s.key} scope="col">{s.label}</th>)}</tr></thead>
              <tbody>
                {tth.companies.map((c) => (
                  <tr key={c.companyId}><th scope="row">{c.name}</th><td>{num(c.jobs)}</td>{main.map((s) => <td key={s.key}>{c.steps[s.key].n ? c.steps[s.key].medianText : '—'}</td>)}</tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      )}
      <span className="xs muted">Minutes from a job being posted to each first step, for jobs posted in the period (only jobs that reached the step). Demo companies, demo jobs and test accounts are never counted.{tth.capped ? ' Only the newest 5,000 jobs are measured.' : ''}</span>
      <Thresholds http={http} toast={toast} />
    </div>
  );
}
