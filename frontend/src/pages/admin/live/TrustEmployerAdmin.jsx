// Admin → Skill checks → Vetting Trust → Employer checks and Fraud reports (T4; every change audited).
//   Employer checks: the registry-lookup provider (test provider or Surepass), whether its key is set (never the value:
//   docs/trust/T4-vendors.md), the re-check interval, the name-match mark, after how many independent reports a job is
//   paused, lookup counts, and the review queue (cancelled registrations, other names, look-alike domains): a person
//   decides; nobody is rejected automatically. /api/admin/trust/employer
//   Fraud reports: candidates' reports (and "Report this job"), grouped by job or company, "asked for money" first; who
//   reported is shown here only (never to the company). Dismiss, warn the company, pause the job, suspend the company.
//   /api/admin/trust/fraud
import { useEffect, useState } from 'react';
import { useToast } from '../../../components/ui';
import { Loading, http, useAction, useApi, when } from './common';

function Review({ r, reload }) {
  const toast = useToast();
  const [busy, run] = useAction(toast);
  const [note, setNote] = useState('');
  const decide = (decision) => run(async () => { await http(`/api/admin/trust/employer/${r.companyId}/review`, { method: 'POST', body: { decision, note } }); reload(); }, decision === 'recheck' ? 'Looked up again' : 'Saved: the company sees it');
  return (
    <li className="card stack g8" data-testid="te-review-item">
      <strong style={{ overflowWrap: 'anywhere' }}>{r.company} · {r.kindText} {r.numberMasked}{r.test ? ' · test provider' : ''}</strong>
      <span className="small" style={{ overflowWrap: 'anywhere' }}>{r.website} · {r.emails.join(', ')} · Nm7 review: {r.nm7Review || '—'} · {when(r.updatedAt)}</span>
      {r.facts?.found && <span className="small" style={{ overflowWrap: 'anywhere' }}>Registry ({r.registry}): {r.facts.legalName}{r.facts.tradeName && r.facts.tradeName !== r.facts.legalName ? ` (trade name ${r.facts.tradeName})` : ''} · {r.facts.status} · since {r.facts.registeredOn || '?'} · {[r.facts.city, r.facts.state].filter(Boolean).join(', ')}</span>}
      <ul className="small" style={{ margin: 0, paddingLeft: 18 }} data-testid="te-why">{r.reasons.map((x) => <li key={x}>{x}</li>)}</ul>
      <div className="field"><label className="label" htmlFor={`te-n-${r.companyId}`}>Note to the company (needed for “Not verified”)</label><input id={`te-n-${r.companyId}`} className="input" value={note} onChange={(e) => setNote(e.target.value)} data-testid="te-note" /></div>
      <div className="row g8" style={{ flexWrap: 'wrap' }}>
        <button type="button" className="btn btn-signal" style={{ minHeight: 44 }} disabled={busy} onClick={() => decide('verified')} data-testid="te-verified">Verified employer</button>
        <button type="button" className="btn btn-outline" style={{ minHeight: 44 }} disabled={busy} onClick={() => decide('not_verified')} data-testid="te-not">Not verified</button>
        <button type="button" className="btn btn-ghost" style={{ minHeight: 44 }} disabled={busy} onClick={() => decide('recheck')} data-testid="te-recheck">Look up again</button>
      </div>
    </li>
  );
}

const NUMS = [['recheckDays', 'Re-check every (days)', 30, 365], ['nameMin', 'Name match mark (70–100)', 70, 100], ['pauseAt', 'Pause a job after N independent reports', 2, 10]];

export function EmployerChecks() {
  const st = useApi('/api/admin/trust/employer');
  const toast = useToast();
  const [busy, run] = useAction(toast);
  const [f, setF] = useState(null);
  useEffect(() => { if (st.data) setF({ provider: st.data.provider, recheckDays: st.data.recheckDays, nameMin: st.data.nameMin, pauseAt: st.data.pauseAt }); }, [st.data]);
  return (
    <section className="card stack g12" aria-labelledby="te-h" data-testid="te-card">
      <h2 id="te-h" className="h3" style={{ margin: 0 }}>Employer checks</h2>
      <Loading st={st}>{(d) => {
        if (!f) return null;
        const chosen = d.providers.find((p) => p.key === d.provider);
        const save = () => run(async () => { await http('/api/admin/trust/employer', { method: 'PUT', body: { provider: f.provider, recheckDays: Number(f.recheckDays), nameMin: Number(f.nameMin), pauseAt: Number(f.pauseAt) } }); st.reload(); }, 'Saved');
        const recheck = () => run(async () => { const r = await http('/api/admin/trust/employer/recheck', { method: 'POST' }); toast(`Re-checked ${r.checked}: ${r.dropped} badge(s) dropped`); st.reload(); });
        return (
          <>
            <p className="small" style={{ margin: 0 }}>Companies enter their GSTIN, Udyam (MSME) number or CIN in their account settings. Active in the registry, the same name and a website that belongs to it → “✓ Verified employer” on their jobs and page. Anything else comes here. Only companies and candidates Vetting Trust is on for see any of it.</p>
            <div className="row g8" style={{ flexWrap: 'wrap', alignItems: 'flex-end' }}>
              <div className="field" style={{ flex: '1 1 240px' }}><label className="label" htmlFor="te-p">Provider</label>
                <select id="te-p" className="input" value={f.provider} onChange={(e) => setF({ ...f, provider: e.target.value })} data-testid="te-provider">{d.providers.map((p) => <option key={p.key} value={p.key}>{p.label}{p.test || p.ready ? '' : ' (key not set)'}</option>)}</select></div>
              <span className={`mchip ${chosen?.test ? 'mchip-warn' : chosen?.ready ? 'mchip-ok' : 'mchip-bad'}`} role="status" data-testid="te-state">{chosen?.test ? 'Test mode: only testers and the demo company on the live site' : chosen?.ready ? 'Connected' : 'Key not set: no lookups'}</span>
            </div>
            <div className="row g8" style={{ flexWrap: 'wrap' }}>
              {NUMS.map(([k, l, lo, hi]) => (
                <div key={k} className="field" style={{ flex: '1 1 170px' }}><label className="label" htmlFor={`te-${k}`}>{l}</label>
                  <input id={`te-${k}`} className="input" type="number" min={lo} max={hi} value={f[k]} onChange={(e) => setF({ ...f, [k]: e.target.value })} data-testid={`te-${k}`} /></div>
              ))}
            </div>
            <div className="row g8" style={{ flexWrap: 'wrap' }}>
              <button type="button" className="btn btn-outline" style={{ minHeight: 44 }} disabled={busy} onClick={save} data-testid="te-save">Save</button>
              <button type="button" className="btn btn-ghost" style={{ minHeight: 44 }} disabled={busy} onClick={recheck} data-testid="te-recheck-run">Run the re-check now</button>
            </div>
            {d.providers.filter((p) => !p.test).map((p) => (
              <div key={p.key} className="stack g4" data-testid={`te-keys-${p.key}`}>
                <span className="label">{p.label}: keys (Render → Environment)</span>
                <ul className="small" style={{ margin: 0, paddingLeft: 18 }}>{Object.entries(p.keys).map(([k, v]) => <li key={k}><code>{k}</code>: {v ? 'set' : 'not set'}</li>)}</ul>
              </div>
            ))}
            <dl className="row g16" style={{ flexWrap: 'wrap', margin: 0 }} data-testid="te-counts">
              {[['lookupsToday', 'Lookups today'], ['lookups30d', 'Lookups, 30 days'], ['paidLookups30d', 'Paid lookups, 30 days'], ['errors30d', 'Vendor errors, 30 days'], ['verified', 'Verified employers'], ['review', 'With a person'], ['notVerified', 'Not verified']].map(([k, l]) => (
                <div key={k} className="stack g4"><dt className="xs faint">{l}</dt><dd style={{ margin: 0 }} className="h3">{d.counts[k]}</dd></div>
              ))}
            </dl>
            <h3 className="h4" style={{ margin: 0 }}>Review queue</h3>
            {d.review.length ? <ul className="stack g8" style={{ listStyle: 'none', padding: 0, margin: 0 }}>{d.review.map((r) => <Review key={r.companyId} r={r} reload={st.reload} />)}</ul>
              : <p className="small muted" style={{ margin: 0 }}>Nothing to check.</p>}
          </>
        );
      }}</Loading>
    </section>
  );
}

const ACTIONS = [['dismiss', 'Dismiss', 'btn-ghost'], ['warn', 'Warn the company', 'btn-outline'], ['pause_job', 'Pause the job', 'btn-outline'], ['suspend_company', 'Suspend the company', 'btn-danger']];

function Case({ c, reload }) {
  const toast = useToast();
  const [busy, run] = useAction(toast);
  const [note, setNote] = useState('');
  const act = (action) => run(async () => { await http('/api/admin/trust/fraud/action', { method: 'POST', body: { key: c.key, action, note } }); reload(); }, 'Done');
  return (
    <li className="card stack g8" data-testid="tfr-case">
      <strong style={{ overflowWrap: 'anywhere' }}>{c.job ? `${c.job.title} · ` : ''}{c.company?.name || 'No company account'}</strong>
      <span className="small">{c.count} report{c.count === 1 ? '' : 's'} · {c.independent} independent (a job pauses at {c.pauseAt}){c.job ? ` · job ${c.job.status}${c.job.held ? ' (paused by reports)' : ''}` : ''}{c.company?.state === 'blocked' ? ' · company suspended' : ''}</span>
      <ul className="stack g4 small" style={{ margin: 0, paddingLeft: 18 }}>
        {c.reports.map((r) => <li key={r.id} style={{ overflowWrap: 'anywhere' }}><strong>{r.reasonText}</strong> · {r.context} · {when(r.at)} · {r.reporter.name} ({r.reporter.email}){r.note ? `: “${r.note}”` : ''}</li>)}
      </ul>
      <div className="field"><label className="label" htmlFor={`tfr-n-${c.key}`}>Note (sent to the company with a warning or a suspension; never who reported)</label><input id={`tfr-n-${c.key}`} className="input" value={note} onChange={(e) => setNote(e.target.value)} data-testid="tfr-note" /></div>
      <div className="row g8" style={{ flexWrap: 'wrap' }}>
        {ACTIONS.filter(([k]) => (k === 'pause_job' ? c.job : k === 'dismiss' || c.company?.id)).map(([k, l, cls]) => <button key={k} type="button" className={`btn ${cls}`} style={{ minHeight: 44 }} disabled={busy} onClick={() => act(k)} data-testid={`tfr-${k}`}>{l}</button>)}
      </div>
    </li>
  );
}

export function FraudReports() {
  const st = useApi('/api/admin/trust/fraud');
  return (
    <section className="card stack g12" aria-labelledby="tfr-h" data-testid="tfr-card">
      <h2 id="tfr-h" className="h3" style={{ margin: 0 }}>Fraud reports</h2>
      <p className="small" style={{ margin: 0 }}>From “Report fraud” on jobs, company pages, interview invites and offers, and “Report this job”. A job pauses by itself only after enough independent reports (different people on different networks); a company is never suspended by itself. Who reported is shown only here.</p>
      <Loading st={st}>{(d) => (d.items.length
        ? <ul className="stack g8" style={{ listStyle: 'none', padding: 0, margin: 0 }}>{d.items.map((c) => <Case key={c.key} c={c} reload={st.reload} />)}</ul>
        : <p className="small muted" style={{ margin: 0 }} data-testid="tfr-empty">No open reports.</p>)}</Loading>
    </section>
  );
}

export default function TrustEmployerAdmin() {
  return <><EmployerChecks /><FraudReports /></>;
}
