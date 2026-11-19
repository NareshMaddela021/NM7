// Admin → Skill checks → Vetting Trust → Fairness (T12; changes need the "settings" permission and are audited).
//   Blind grading   every AI call that grades or evaluates a person and since when it is anonymised (no name, photo,
//                   gender, college, age, address, contact, religion / caste words).
//   Re-grades       about 5% of AI-graded practical tasks, interviews and "Explained own work" labels get a second,
//                   independent AI pass each week (capped); a material disagreement goes to a person (never changed by
//                   itself); an alert per role when too many disagree. Settings, Run now, the latest disagreements
//                   (T9 labels are decided here; V2 / V3 in their own queues).
//   Pass-rate gaps  the weekly snapshot: rates by interview language, region (accent proxy) and city tier for skill
//                   checks, interviews, spoken-English bands, Auto Apply replies and Hire now invites; the four-fifths
//                   rule with a minimum group size; never a person. Run now.
//   Unfair filters  warnings shown / kept / refused for companies, by where and topic.
// /api/admin/trust/fairness
import { useEffect, useState } from 'react';
import { useToast } from '../../../components/ui';
import { Loading, http, useAction, useApi, when } from './common';

const R_FIELDS = [['sample', 'Sample (% of AI grades)'], ['cap', 'Second passes a week (most)'], ['gap', 'Material change (task points of 100)'],
  ['alert_share', 'Alert when this % disagree'], ['alert_min', '… after at least this many re-grades']];
const P_FIELDS = [['min_n', 'Smallest group compared (people)'], ['days', 'Period (days)']];
const WHERE = { job: 'Job posts', question: 'Screening questions', criteria: 'Requirements', hire_filter: 'Hire now filters' };
const camel = (k) => k.replace(/_(\w)/g, (_, c) => c.toUpperCase());

function Num({ id, label, value, onChange, lo, hi }) {
  return (
    <div className="field" style={{ flex: '1 1 180px', minWidth: 0 }}>
      <label className="label" htmlFor={id}>{label} <span className="xs faint">({lo}–{hi})</span></label>
      <input id={id} className="input" inputMode="numeric" value={value} onChange={(e) => onChange(e.target.value)} data-testid={id} />
    </div>
  );
}

export default function TrustFairnessAdmin() {
  const st = useApi('/api/admin/trust/fairness');
  const toast = useToast();
  const [busy, run] = useAction(toast);
  const [f, setF] = useState(null);
  useEffect(() => { if (st.data) setF({ regrade: { ...st.data.regrade.settings }, report: { ...st.data.report.settings } }); }, [st.data]);
  const body = () => ({ regrade: Object.fromEntries(Object.entries(f.regrade).map(([k, v]) => [camel(k), Number(v)])),
    report: Object.fromEntries(Object.entries(f.report).map(([k, v]) => [camel(k), Number(v)])) });
  const save = () => run(async () => { await http('/api/admin/trust/fairness', { method: 'PUT', body: body() }); st.reload(); }, 'Saved');
  const post = (path, ok) => run(async () => { await http(`/api/admin/trust/fairness/${path}`, { method: 'POST' }); st.reload(); }, ok);
  const decide = (id, decision) => run(async () => { await http(`/api/admin/trust/fairness/regrades/${id}/decide`, { method: 'POST', body: { decision } }); st.reload(); }, 'Decided');
  return (
    <section className="card stack g12" aria-labelledby="tfa-h" data-testid="tfa-card">
      <h2 id="tfa-h" className="h3" style={{ margin: 0 }}>Fairness</h2>
      <Loading st={st}>{(d) => {
        if (!f) return null;
        const rg = d.regrade;
        const snap = d.report.snapshot;
        return (
          <>
            <details className="small" data-testid="tfa-blind">
              <summary style={{ minHeight: 44, display: 'flex', alignItems: 'center', cursor: 'pointer' }}><strong>Blind AI grading</strong>&nbsp;· {d.blind.length} places</summary>
              <p className="xs muted" style={{ margin: '4px 0' }}>Before any AI call that grades or evaluates a person, names, photos, gender, college names, age / date of birth, address, email, phone, religion and caste words are removed. {d.public ? '' : 'While the switch is hidden, the practical task, interview and Auto Apply prompts are anonymised only for admins, demo accounts and testers (real users’ grades don’t change).'}</p>
              <ul style={{ margin: 0, paddingLeft: 18 }}>{d.blind.map((b) => <li key={b.site}>{b.what} <span className="xs faint">· since {b.since}</span></li>)}</ul>
            </details>

            <h3 className="h4" style={{ margin: 0 }}>Second-opinion re-grades</h3>
            <p className="small" style={{ margin: 0 }}>Every week about {rg.settings.sample}% of AI-graded answers are graded again by a second, independent AI reviewer (at most {rg.settings.cap} a week). If the two disagree a lot, a person decides; the grade is never changed by itself. Last run: {when(rg.lastAt)} · this week: {rg.usedThisWeek} · in all: practical tasks {rg.counts.v2}, interviews {rg.counts.v3}, explained own work {rg.counts.t9}.</p>
            <div className="row g8" style={{ flexWrap: 'wrap' }}>
              {R_FIELDS.map(([k, l]) => <Num key={k} id={`tfa-r-${k}`} label={l} value={f.regrade[k]} lo={rg.bounds[k][0]} hi={rg.bounds[k][1]} onChange={(v) => setF({ ...f, regrade: { ...f.regrade, [k]: v } })} />)}
            </div>
            {rg.alerts.some((a) => a.alert) && (
              <div className="mcard mcard-tight mcard-warn stack g4" role="alert" data-testid="tfa-alerts">
                {rg.alerts.filter((a) => a.alert).map((a) => <span key={`${a.kind}-${a.key}`} className="small">⚠ {a.kindLabel} · {a.key}: {a.material} of {a.n} re-grades disagreed ({a.share}%). Look at this role’s rubric, questions and AI grading.</span>)}
              </div>
            )}
            {rg.review.length > 0 && (
              <div className="table-wrap mtable-wrap vt-scroll">
                <table className="table mtable vt-table" data-testid="tfa-review">
                  <thead><tr><th>What</th><th>Role</th><th>First → second</th><th>Waiting in</th><th /></tr></thead>
                  <tbody>{rg.review.map((r) => (
                    <tr key={r.id} data-testid={`tfa-rv-${r.kind}`}>
                      <td>{r.kindLabel}<div className="xs faint">{when(r.at)}</div></td>
                      <td>{r.key}</td>
                      <td>{String(r.first)} → {String(r.second)}</td>
                      <td>{r.open ? r.where : r.status === 'changed' ? 'Changed by a person' : r.status === 'kept' ? 'Kept by a person' : 'Done'}</td>
                      <td>{r.kind === 't9' && r.open && (
                        <span className="row g4" style={{ flexWrap: 'wrap' }}>
                          <button type="button" className="btn btn-outline btn-sm" disabled={busy} onClick={() => decide(r.id, 'keep')} data-testid="tfa-keep">Keep first</button>
                          <button type="button" className="btn btn-outline btn-sm" disabled={busy} onClick={() => decide(r.id, 'second')} data-testid="tfa-second">Use second</button>
                        </span>
                      )}</td>
                    </tr>
                  ))}</tbody>
                </table>
              </div>
            )}

            <h3 className="h4" style={{ margin: 0 }}>Pass-rate gaps</h3>
            <p className="small" style={{ margin: 0 }}>Rates by interview language, region (a rough stand-in for accent) and city tier, over the last {d.report.settings.days} days. A group is flagged when its rate is under 80% of the best group’s (the “four-fifths rule”). Groups under {d.report.settings.min_n} people show no numbers, so nobody can be picked out. No one’s gender, religion, caste or age is ever used.</p>
            <div className="row g8" style={{ flexWrap: 'wrap' }}>
              {P_FIELDS.map(([k, l]) => <Num key={k} id={`tfa-p-${k}`} label={l} value={f.report[k]} lo={d.report.bounds[k][0]} hi={d.report.bounds[k][1]} onChange={(v) => setF({ ...f, report: { ...f.report, [k]: v } })} />)}
            </div>
            {!snap ? <p className="small muted" data-testid="tfa-nosnap">No snapshot yet (made once a week, or Run now).</p> : (
              <div className="stack g8" data-testid="tfa-snap">
                <p className="xs muted" style={{ margin: 0 }}>Snapshot {snap.week} · {when(snap.at)}</p>
                {snap.flags.length ? snap.flags.map((x, i) => <p key={i} className="small cj-warn" style={{ margin: 0 }} data-testid="tfa-flag">⚠ {x.why}</p>) : <p className="small" style={{ margin: 0 }} data-testid="tfa-noflags">No gaps beyond the four-fifths rule.</p>}
                {snap.metrics.map((m) => (
                  <details key={m.key} className="small">
                    <summary style={{ minHeight: 44, display: 'flex', alignItems: 'center', cursor: 'pointer' }}>{m.label}{m.total != null ? ` · ${m.total}` : ' · too few to compare'}</summary>
                    <div className="table-wrap mtable-wrap vt-scroll">
                      <table className="table mtable vt-table">
                        <thead><tr><th>Group</th><th className="num">People</th><th className="num">Rate</th><th /></tr></thead>
                        <tbody>{Object.entries(m.dimensions).map(([dim, groups]) => groups.map((g) => (
                          <tr key={`${dim}-${g.group}`}>
                            <td>{d.report.dimensions[dim]}: {g.group}</td>
                            <td className="num">{g.small ? `under ${snap.minN}` : g.n}</td>
                            <td className="num">{g.small ? '—' : `${g.rate}%`}</td>
                            <td>{g.flag ? <span className="mchip mchip-warn">gap</span> : null}</td>
                          </tr>
                        )))}</tbody>
                      </table>
                    </div>
                  </details>
                ))}
              </div>
            )}

            <h3 className="h4" style={{ margin: 0 }}>Unfair filters (last {d.filters.days} days)</h3>
            <p className="small" style={{ margin: 0 }} data-testid="tfa-filters">
              {Object.keys(d.filters.byWhere).length ? Object.entries(d.filters.byWhere).map(([w, c]) => `${WHERE[w] || w}: shown ${c.shown}, kept ${c.override}, refused ${c.refused}`).join(' · ') : 'None yet.'}
              {Object.keys(d.filters.byTopic).length > 0 && <><br /><span className="xs muted">Most common: {Object.entries(d.filters.byTopic).slice(0, 6).map(([k, n]) => `${k} ${n}`).join(' · ')}</span></>}
            </p>
            <div className="row g8" style={{ flexWrap: 'wrap' }}>
              <button type="button" className="btn btn-outline" style={{ minHeight: 44 }} disabled={busy} onClick={save} data-testid="tfa-save">Save</button>
              <button type="button" className="btn btn-outline" style={{ minHeight: 44 }} disabled={busy} onClick={() => post('regrade/run', 'Re-grade pass ran')} data-testid="tfa-run-regrade">Run re-grades now</button>
              <button type="button" className="btn btn-outline" style={{ minHeight: 44 }} disabled={busy} onClick={() => post('report/run', 'Snapshot made')} data-testid="tfa-run-report">Make a snapshot now</button>
            </div>
            <p className="xs muted" style={{ margin: 0 }}>Re-grades are kept {d.regradeDays} days (Retention above).</p>
          </>
        );
      }}</Loading>
    </section>
  );
}
