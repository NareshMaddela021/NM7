// Admin → Skill checks → Overview (Vetting V1): how many people are at each level (L0–L4), how many are ⚡ ready now
// and visible in Hire now; the hot roles (role × city × open jobs); the health of the ready shortlists (a row with
// fewer than 5 ready people is red, with the words saying so); the ready-now reminder reply rate; and the success
// measures against their targets (met / not met / no data yet). From GET /api/admin/vetting/overview; nothing is made up.
import { LevelChip } from '../../../components/LevelBadge';
import { Loading, useApi, when } from './common';

/** [key, what it measures, how to show the value, lower is better]. */
const MEASURES = [
  ['firstInterviewMinutes', 'Time from a job going live to the first interview booked (median, last 30 days)', (v) => `${v} min`, true],
  ['shareL2Plus', 'People visible in Hire now at L2 or higher', (v) => `${v}%`, false],
  ['pairs5Plus', 'Role × city shortlists with 5 or more ready people', (v) => `${v}%`, false],
  ['showUp', 'Interview show-up rate (last 30 days)', (v) => `${v}%`, false],
  ['shortlistRating', 'Companies’ rating of the shortlists', (v) => `${v} / 5`, false],
  ['appealsUpheld', 'Appeals upheld', (v) => `${v}%`, true],
  ['aiPerVetted', 'AI cost per vetted person', (v) => `₹${v}`, true],
];

export const measureState = (v, target, lower) => (v == null ? 'none' : (lower ? v <= target : v >= target) ? 'met' : 'miss');
const STATE = { met: ['mchip-ok', 'Met'], miss: ['mchip-bad', 'Not met'], none: ['mchip-neutral', 'No data yet'] };

export default function VettingOverview() {
  const st = useApi('/api/admin/vetting/overview');
  return (
    <section className="stack g16" aria-label="Overview">
      <Loading st={st}>{(d) => {
        const people = d.levels.reduce((a, l) => a + l.people, 0);
        const low = d.shortlists.filter((s) => s.low).length;
        return (
          <div className="stack g16">
            <div className="vo-tiles" data-testid="vo-levels">
              {d.levels.map((l) => (
                <div key={l.level} className={`mstat vo-tile vo-tile-${l.level}`} data-testid="vo-level">
                  <span className="mstat-l"><LevelChip level={l.level} label={l.label} testid="vo-level-chip" /></span>
                  <span className="mstat-v">{l.people.toLocaleString('en-IN')}</span>
                  <span className="xs muted">{people ? `${Math.round((100 * l.people) / people)}% of people` : 'No one yet'}</span>
                </div>
              ))}
              <div className="mstat vo-tile vo-tile-ready" data-testid="vo-ready">
                <span className="mstat-l"><span aria-hidden="true">⚡ </span>Ready now</span>
                <span className="mstat-v">{d.readyNow.toLocaleString('en-IN')}</span>
                <span className="xs muted">Confirmed in the last 7 days</span>
              </div>
              <div className="mstat vo-tile" data-testid="vo-visible">
                <span className="mstat-l">Visible in Hire now</span>
                <span className="mstat-v">{d.visible.toLocaleString('en-IN')}</span>
                <span className="xs muted">Confirmed in the last 21 days</span>
              </div>
            </div>

            <div className="vo-two">
              <div className="card stack g8">
                <h2 className="vr-title">Hot roles</h2>
                <span className="xs muted">The role × city pairs with the most open jobs.</span>
                {d.hot.length === 0 ? <span className="small muted">No open jobs matched to a role yet.</span> : (
                  <div className="table-wrap mtable-wrap vt-scroll">
                    <table className="table mtable vt-table vo-table" data-testid="vo-hot">
                      <caption className="sr-only">Hot roles: role, city and open jobs</caption>
                      <thead><tr><th scope="col">Role</th><th scope="col">City</th><th scope="col">Open jobs</th></tr></thead>
                      <tbody>{d.hot.map((h) => <tr key={`${h.role}|${h.city}`}><th scope="row">{h.role}</th><td data-label="City">{h.city || '—'}</td><td data-label="Open jobs" className="num">{h.jobs}</td></tr>)}</tbody>
                    </table>
                  </div>
                )}
              </div>
              <div className="card stack g8" data-testid="vo-fresh">
                <h2 className="vr-title">Ready-now reminders</h2>
                <span className="xs muted">Of the people reminded in the last 30 days, how many confirmed they can still join.</span>
                <span className="vo-big">{d.freshness.rate == null ? 'No data yet' : `${d.freshness.rate}%`}</span>
                <span className="small">{d.freshness.replied.toLocaleString('en-IN')} replied of {d.freshness.asked.toLocaleString('en-IN')} reminded</span>
              </div>
            </div>

            <div className="card stack g8">
              <h2 className="vr-title">Shortlist health</h2>
              <span className="xs muted">The cached top 20 per role × city. A shortlist with fewer than 5 ready people is shown in red.{low ? ` ${low} ${low === 1 ? 'needs' : 'need'} more people.` : ''}</span>
              {d.shortlists.length === 0 ? <span className="small muted">No shortlists built yet.</span> : (
                <div className="table-wrap mtable-wrap vt-scroll">
                  <table className="table mtable vt-table vo-table" data-testid="vo-shortlists">
                    <caption className="sr-only">Shortlist health per role and city</caption>
                    <thead><tr><th scope="col">Role</th><th scope="col">City</th><th scope="col">Open jobs</th><th scope="col">Ready people</th><th scope="col">Built</th></tr></thead>
                    <tbody>{d.shortlists.map((s) => (
                      <tr key={`${s.role}|${s.city}`} className={s.low ? 'vo-low' : ''} data-testid={s.low ? 'vo-low' : undefined}>
                        <th scope="row">{s.role}</th>
                        <td data-label="City">{s.city || '—'}</td>
                        <td data-label="Open jobs" className="num">{s.jobs}</td>
                        <td data-label="Ready people" className="num">{s.ready}{s.low && <span className="vo-low-tag">fewer than 5 ready</span>}</td>
                        <td data-label="Built">{when(s.at)}</td>
                      </tr>
                    ))}</tbody>
                  </table>
                </div>
              )}
            </div>

            <div className="card stack g8">
              <h2 className="vr-title">Success measures</h2>
              <div className="table-wrap mtable-wrap">
                <table className="table mtable vt-table vo-table" data-testid="vo-measures">
                  <caption className="sr-only">Success measures with their targets</caption>
                  <thead><tr><th scope="col">Measure</th><th scope="col">Now</th><th scope="col">Target</th><th scope="col">Status</th></tr></thead>
                  <tbody>{MEASURES.map(([k, label, fmt, lower]) => {
                    const v = d.measures?.[k];
                    const target = d.targets?.[k];
                    const s = measureState(v, target, lower);
                    return (
                      <tr key={k} data-testid="vo-measure" data-state={s}>
                        <th scope="row" className="vo-m-l">{label}</th>
                        <td data-label="Now" className="num">{v == null ? '—' : fmt(v)}</td>
                        <td data-label="Target" className="num">{target == null ? '—' : `${lower ? 'at most' : 'at least'} ${fmt(target)}`}</td>
                        <td data-label="Status"><span className={`mchip ${STATE[s][0]}`}>{STATE[s][1]}</span></td>
                      </tr>
                    );
                  })}</tbody>
                </table>
              </div>
              <span className="xs muted">Updated {when(d.at)}.</span>
            </div>
          </div>
        );
      }}</Loading>
    </section>
  );
}
