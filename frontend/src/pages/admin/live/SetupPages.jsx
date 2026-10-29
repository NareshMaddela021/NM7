// Live admin: settings (prices, delivery promise), automation rules, team + audit log.
import { useEffect, useState } from 'react';
import { useToast } from '../../../components/ui';
import { passwordIssue, useAuth } from '../../../lib/auth';
import { PageHead } from '../AdminUI';
import { ROLES } from '../roles';
import { Loading, emptyIf, http, useAction, useApi, when } from './common';
import { auditText } from './auditText';
import { PaymentSettings } from './WaPages';

/* ---------- settings & prices ---------- */
// same limits as the server (app/admin/console.py), which checks them again
export const PRICE_MIN = 1;
export const PRICE_MAX = 100000;
/** { 'plans.expert': 'Enter a whole number of rupees', hours: 'Delivery must be 24–168 hours' } */
export function settingsErrors(f) {
  const out = {};
  ['plans', 'addons'].forEach((g) => Object.entries(f[g] || {}).forEach(([k, v]) => {
    const t = String(v.text ?? '').trim();
    if (!/^\d+$/.test(t)) out[`${g}.${k}`] = 'Enter a whole number of rupees';
    else if (Number(t) < PRICE_MIN || Number(t) > PRICE_MAX) out[`${g}.${k}`] = 'Price must be ₹1–₹1,00,000';
  }));
  const h = String(f.hoursText ?? '').trim();
  if (!/^\d+$/.test(h)) out.hours = 'Enter a whole number of hours';
  else if (Number(h) < 24 || Number(h) > 168) out.hours = 'Delivery must be 24–168 hours';
  if (f.referral) {
    const n = String(f.referral.text ?? '').trim();
    if (!/^\d+$/.test(n) || Number(n) < 1 || Number(n) > 20) out.referral = 'Enter 1–20 friends';
  }
  return out;
}
export function LiveSettings() {
  const toast = useToast();
  const st = useApi('/api/admin/settings');
  const owner = useAuth().user?.adminRole === 'owner';
  const [busy, run] = useAction(toast);
  const [f, setF] = useState(null);
  // the form keeps what was typed (text), so a bad value can be explained instead of silently becoming 0
  const toForm = (d) => {
    const g = (o) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, { ...v, text: String(Math.round(v.amount / 100)) }]));
    return { ...d, plans: g(d.plans), addons: g(d.addons), hoursText: String(d.deliveryHours), referral: { ...(d.referral || { on: true, needed: 3 }), text: String(d.referral?.needed ?? 3) }, dailySummary: d.dailySummary || { on: true } };
  };
  useEffect(() => { if (st.data) setF(toForm(st.data)); }, [st.data]);
  const errs = f ? settingsErrors(f) : {};
  const row = (group, k) => {
    const v = f[group][k];
    const set = (patch) => setF({ ...f, [group]: { ...f[group], [k]: { ...v, ...patch } } });
    const err = errs[`${group}.${k}`];
    return (
      <tr key={k}>
        <td className="small">{v.name}</td>
        <td>
          <label className="sr-only" htmlFor={`pr-${k}`}>{v.name} price in rupees</label>
          <input id={`pr-${k}`} className="input" type="number" inputMode="numeric" min={PRICE_MIN} max={PRICE_MAX} step={1} style={{ height: 38, width: 130 }} value={v.text}
            aria-invalid={err ? 'true' : undefined} aria-describedby={err ? `pr-${k}-err` : undefined} onChange={(e) => set({ text: e.target.value })} />
          {err && <div id={`pr-${k}-err`} className="error">{err}</div>}
        </td>
        <td><label className="row g4 small"><input type="checkbox" checked={v.active} onChange={(e) => set({ active: e.target.checked })} />On sale</label></td>
      </tr>
    );
  };
  const save = () => run(async () => {
    const pick = (g) => Object.fromEntries(Object.entries(f[g]).map(([k, v]) => [k, { amount: Number(v.text) * 100, active: v.active }]));
    const r = await http('/api/admin/settings', { method: 'PUT', body: { plans: pick('plans'), addons: pick('addons'), deliveryHours: Number(f.hoursText), referral: { on: f.referral.on, needed: Number(f.referral.text) }, dailySummary: f.dailySummary } });
    setF(toForm(r)); st.reload();
  }, 'Saved — new orders use these prices');
  return (
    <>
      <PageHead title="Settings & prices" sub="Prices include GST. Changes apply to new checkouts at once and are written to the audit log." />
      <PaymentSettings />
      <Loading st={st}>{() => f && (
        <>
          <section className="card stack g12" aria-label="Plans">
            <strong>Plans</strong>
            <table className="table"><thead><tr><th>Plan</th><th>Price (₹)</th><th /></tr></thead><tbody>{Object.keys(f.plans).map((k) => row('plans', k))}</tbody></table>
          </section>
          <section className="card stack g12" aria-label="Add-ons">
            <strong>Add-ons</strong>
            <table className="table"><thead><tr><th>Add-on</th><th>Price (₹)</th><th /></tr></thead><tbody>{Object.keys(f.addons).map((k) => row('addons', k))}</tbody></table>
          </section>
          <section className="card stack g12" aria-label="Delivery promise">
            <strong>Delivery promise</strong>
            <label className="row g8 small">First draft within <input className="input" type="number" inputMode="numeric" min={24} max={168} step={1} aria-label="Delivery hours" style={{ height: 38, width: 90 }} value={f.hoursText}
              aria-invalid={errs.hours ? 'true' : undefined} aria-describedby={errs.hours ? 'dh-err' : undefined} onChange={(e) => setF({ ...f, hoursText: e.target.value })} /> hours (24–168). Express add-on is always 24 hours.</label>
            {errs.hours && <span id="dh-err" className="error">{errs.hours}</span>}
          </section>
          <section className="card stack g12" aria-label="Daily summary" data-testid="daily-settings">
            <strong>Daily summary</strong>
            <label className="row g8 small"><input type="checkbox" checked={f.dailySummary.on} onChange={(e) => setF({ ...f, dailySummary: { on: e.target.checked } })} data-testid="daily-on" />Email the Owner admins yesterday’s numbers every day at 8:00 IST (new users, resumes, orders, revenue, codes used, new organizations, server errors)</label>
            <span className="xs muted">The Dashboard’s “Today so far” card has a Share to WhatsApp button for sending the numbers from your phone.</span>
          </section>
          <section className="card stack g12" aria-label="Referral rewards" data-testid="ref-settings">
            <strong>Referral rewards</strong>
            <span className="small muted">When enough invited friends sign up, confirm their email and build a resume with their name, the inviter’s downloads unlock free (the same unlock as paying for the resume plan). One reward per account; the inviter’s own device or network and throwaway emails don’t count.</span>
            <label className="row g8 small"><input type="checkbox" checked={f.referral.on} onChange={(e) => setF({ ...f, referral: { ...f.referral, on: e.target.checked } })} data-testid="ref-on" />Give referral rewards</label>
            <label className="row g8 small">Friends needed <input className="input" type="number" inputMode="numeric" min={1} max={20} step={1} style={{ height: 38, width: 80 }} value={f.referral.text} data-testid="ref-needed"
              aria-invalid={errs.referral ? 'true' : undefined} aria-describedby={errs.referral ? 'rf-err' : undefined} onChange={(e) => setF({ ...f, referral: { ...f.referral, text: e.target.value } })} /></label>
            {errs.referral && <span id="rf-err" className="error">{errs.referral}</span>}
          </section>
          <button type="button" className="btn btn-ink" style={{ alignSelf: 'flex-start' }} disabled={busy || Object.keys(errs).length > 0} onClick={save}>Save settings</button>
          {Object.keys(errs).length > 0 && <span className="small" role="status" style={{ color: 'var(--danger)' }}>Fix the {Object.keys(errs).length === 1 ? 'value' : `${Object.keys(errs).length} values`} marked above to save.</span>}
          <ReferralRewards />
          {owner && <SampleCleanup />}
        </>
      )}</Loading>
    </>
  );
}

/* ---------- referral rewards given (see, revoke) ---------- */
export function ReferralRewards() {
  const toast = useToast();
  const st = useApi('/api/admin/referral-rewards');
  const [busy, run] = useAction(toast);
  const revoke = (r) => run(async () => {
    const note = window.prompt(`Revoke ${r.name}’s referral reward? Their downloads lock again. Note (optional):`, '');
    if (note === null) return;
    await http(`/api/admin/referral-rewards/${r.userId}/revoke`, { method: 'POST', body: { note } });
    st.reload();
  }, 'Reward revoked');
  return (
    <section className="card stack g12" aria-label="Referral rewards given" data-testid="ref-rewards">
      <strong>Referral rewards given</strong>
      <Loading st={st}>{(rows) => (rows.length === 0 ? <span className="small muted">No rewards yet.</span> : (
        <div style={{ overflowX: 'auto' }}>
          <table className="table"><thead><tr><th>Customer</th><th>Given</th><th>Friends</th><th /></tr></thead>
            <tbody>{rows.map((r) => (
              <tr key={r.userId} data-testid="ref-row">
                <td className="small">{r.name}<div className="xs muted" style={{ overflowWrap: 'anywhere' }}>{r.email}</div></td>
                <td className="small">{new Date(r.at).toLocaleDateString('en-IN')}</td>
                <td className="small">{r.friends}</td>
                <td>{r.revokedAt ? <span className="badge b-neutral" title={r.note}>Revoked</span> : <button type="button" className="btn btn-outline" style={{ minHeight: 32 }} disabled={busy} onClick={() => revoke(r)} data-testid="ref-revoke">Revoke</button>}</td>
              </tr>
            ))}</tbody></table>
        </div>
      ))}</Loading>
    </section>
  );
}

/* ---------- one-time sample-data cleanup (owner only) ---------- */
// Older builder versions saved the example person's details (Sai Varsha) into real resumes. "Check" is a dry run:
// it lists the resumes and the fields it would clear. "Remove sample values" clears exactly those values, nothing else.
export function SampleCleanup() {
  const toast = useToast();
  const [busy, run] = useAction(toast);
  const [found, setFound] = useState(null);
  const [done, setDone] = useState(null);
  const call = (dryRun) => http('/api/admin/maintenance/sample-cleanup', { method: 'POST', body: { dryRun, ids: dryRun ? undefined : found.resumes.map((r) => r.id) } });
  return (
    <section className="card stack g12" aria-label="Sample data cleanup" data-testid="sample-cleanup">
      <strong>Sample data cleanup</strong>
      <span className="small muted">Finds resumes that still hold the example person’s details (Sai Varsha) from an older version of the builder. Check first; removing clears only those exact values.</span>
      <div className="row g8">
        <button type="button" className="btn btn-outline" disabled={busy} onClick={() => run(async () => { setDone(null); setFound(await call(true)); })}>Check (dry run)</button>
        {found?.count > 0 && !done && <button type="button" className="btn btn-ink" disabled={busy} onClick={() => run(async () => { setDone(await call(false)); setFound(null); }, 'Sample values removed')}>Remove sample values from {found.count} resume{found.count === 1 ? '' : 's'}</button>}
      </div>
      {found && <div role="status" className="small" data-testid="sample-scan">{found.count === 0 ? 'No resumes hold sample data.' : `${found.count} resume${found.count === 1 ? '' : 's'} hold sample data:`}
        {found.count > 0 && <ul className="xs mono">{found.resumes.map((r) => <li key={r.id}>{r.id} · {r.fields.join(', ')}</li>)}</ul>}</div>}
      {done && <div role="status" className="small" data-testid="sample-done">Cleaned {done.count} resume{done.count === 1 ? '' : 's'}.</div>}
    </section>
  );
}

/* ---------- automation ---------- */
export function LiveAutomation() {
  const toast = useToast();
  const st = useApi('/api/admin/automation');
  const [busy, run] = useAction(toast);
  const [vals, setVals] = useState({});
  return (
    <>
      <PageHead title="Automation" sub="Rules the server runs every 10 minutes while it’s awake (the free server sleeps when nobody uses the site)." right={
        <button type="button" className="btn btn-outline" disabled={busy} onClick={() => run(async () => { const r = await http('/api/admin/automation/run', { method: 'POST' }); st.reload(); return r; }, 'Rules ran now')}>Run now</button>} />
      <Loading st={st}>{(rules) => (
        <div className="stack g12">{rules.map((r) => (
          <section key={r.id} className="card row between g12" aria-label={r.label}>
            <span className="stack g4" style={{ flex: '1 1 320px' }}>
              <strong className="small">{r.label} <input className="input" inputMode="numeric" aria-label={`${r.label} (${r.unit})`} style={{ height: 34, width: 70, display: 'inline-block' }} value={vals[r.id] ?? r.value} onChange={(e) => setVals({ ...vals, [r.id]: e.target.value.replace(/\D/g, '') })} /> {r.unit}</strong>
              <span className="xs faint">Last run {when(r.lastRun)} · acted on {r.acted} item(s) so far</span>
            </span>
            <label className="row g8 small"><input type="checkbox" role="switch" checked={r.on} disabled={busy} onChange={(e) => run(async () => { await http(`/api/admin/automation/${r.id}`, { method: 'PUT', body: { on: e.target.checked, value: Number(vals[r.id] ?? r.value) || 1 } }); st.reload(); }, e.target.checked ? 'Rule on' : 'Rule off')} />{r.on ? 'On' : 'Off'}</label>
            <button type="button" className="btn btn-outline" style={{ minHeight: 36 }} disabled={busy || vals[r.id] == null || Number(vals[r.id]) === r.value || !Number(vals[r.id])} onClick={() => run(async () => { await http(`/api/admin/automation/${r.id}`, { method: 'PUT', body: { on: r.on, value: Number(vals[r.id]) } }); setVals({ ...vals, [r.id]: undefined }); st.reload(); }, 'Saved')}>Save</button>
          </section>
        ))}</div>
      )}</Loading>
    </>
  );
}

/* ---------- team & audit log ---------- */
export function LiveTeam() {
  const toast = useToast();
  const { user } = useAuth();
  const st = useApi('/api/admin/team');
  const [busy, run] = useAction(toast);
  const [f, setF] = useState({ name: '', email: '', role: 'support', password: '' });
  const [created, setCreated] = useState(null);
  const [action, setAction] = useState(''); // what's typed
  const [filter, setFilter] = useState(''); // what's asked for: 300 ms after typing stops, not on every key
  useEffect(() => { const t = setTimeout(() => setFilter(action.trim()), 300); return () => clearTimeout(t); }, [action]);
  const log = useApi(`/api/admin/audit-log?limit=100${filter ? `&action=${encodeURIComponent(filter)}` : ''}`);
  const patch = (id, body, ok) => run(async () => { await http(`/api/admin/team/${id}`, { method: 'PATCH', body }); st.reload(); log.reload(); }, ok);
  return (
    <>
      <PageHead title="Team & audit log" sub="Every admin uses two-step login. Role changes sign that person out." />
      <Loading st={st}>{(team) => (
        <div className="card table-wrap" tabIndex={0} role="region" aria-label="Table — scroll sideways to see all columns" style={{ padding: 0 }}>
          <table className="table"><thead><tr><th>Name</th><th>Role</th><th>Two-step</th><th>Last sign-in</th><th /></tr></thead>
            <tbody>{team.map((t) => (
              <tr key={t.id}>
                <td className="small">{t.name}<div className="xs faint">{t.email}</div></td>
                <td>{t.id === user?.id ? <span className="small">{ROLES[t.role]?.label} (you)</span> : (
                  <select aria-label={`Role for ${t.name}`} className="input" style={{ height: 36, width: 'auto' }} value={t.role} disabled={busy} onChange={(e) => patch(t.id, { role: e.target.value }, 'Role changed')}>
                    {Object.entries(ROLES).map(([k, r]) => <option key={k} value={k}>{r.label}</option>)}
                  </select>)}</td>
                <td className="small">{t.twoStep ? 'Set up' : 'Not set up'}</td>
                <td className="small">{when(t.lastLogin)}</td>
                <td>{t.id !== user?.id && <button type="button" className="link-btn small" disabled={busy} onClick={() => patch(t.id, { disabled: !t.disabled }, t.disabled ? 'Switched on' : 'Switched off and signed out')}>{t.disabled ? 'Switch on' : 'Switch off'}</button>}</td>
              </tr>
            ))}</tbody></table>
        </div>
      )}</Loading>

      <form className="card stack g12" aria-label="Add a team member" onSubmit={(e) => { e.preventDefault(); run(async () => { const r = await http('/api/admin/team', { method: 'POST', body: f }); setCreated({ ...r, email: f.email }); setF({ name: '', email: '', role: 'support', password: '' }); st.reload(); log.reload(); }, 'Team member added'); }}>
        <strong>Add a team member</strong>
        <div className="row g12">
          <div className="field" style={{ flex: '1 1 180px' }}><label className="label" htmlFor="tm-n">Name</label><input id="tm-n" className="input" style={{ height: 40 }} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></div>
          <div className="field" style={{ flex: '1 1 220px' }}><label className="label" htmlFor="tm-e">Work email</label><input id="tm-e" type="email" className="input" style={{ height: 40 }} value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} /></div>
          <div className="field" style={{ flex: '1 1 160px' }}><label className="label" htmlFor="tm-r">Role</label><select id="tm-r" className="input" style={{ height: 40 }} value={f.role} onChange={(e) => setF({ ...f, role: e.target.value })}>{Object.entries(ROLES).map(([k, r]) => <option key={k} value={k}>{r.label}</option>)}</select></div>
          <div className="field" style={{ flex: '1 1 200px' }}><label className="label" htmlFor="tm-p">First password</label><input id="tm-p" type="password" autoComplete="new-password" className="input" style={{ height: 40 }} value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} /><span className="xs faint">{f.password && passwordIssue(f.password) ? passwordIssue(f.password) : 'Hand it over in person.'}</span></div>
        </div>
        <button type="submit" className="btn btn-ink" style={{ alignSelf: 'flex-start' }} disabled={busy || !f.name.trim() || !f.email.trim() || !!passwordIssue(f.password)}>Add</button>
        {created && (
          <div className="well stack g4 small" role="status">
            <strong>Shown once — give these to {created.email} in person</strong>
            <span>Authenticator key: <code style={{ userSelect: 'all' }}>{created.secret}</code></span>
            <span className="xs">Or the setup link: <code style={{ userSelect: 'all', overflowWrap: 'anywhere' }}>{created.otpauthUri}</code></span>
            <span>Recovery codes: <code style={{ userSelect: 'all' }}>{created.recoveryCodes.join('  ')}</code></span>
            <button type="button" className="link-btn xs" style={{ alignSelf: 'flex-start' }} onClick={() => setCreated(null)}>I’ve handed them over — hide</button>
          </div>
        )}
      </form>

      <section className="card stack g12" aria-label="Audit log">
        <div className="row between g8"><strong>Audit log</strong>
          <label className="row g8 small">Action <input className="input" style={{ height: 36, width: 200 }} placeholder="e.g. settings.changed" value={action} onChange={(e) => setAction(e.target.value)} /></label></div>
        {filter && log.data?.length === 0 ? (
          <div className="well row between g8 small" role="status" style={{ padding: 16 }}>
            <span>No entries match “{filter}”.</span>
            <button type="button" className="btn btn-outline" style={{ minHeight: 34 }} onClick={() => { setAction(''); setFilter(''); }}>Clear</button>
          </div>
        ) : <Loading st={log} empty={emptyIf((d) => !d.length, 'Nothing logged yet.')}>{(rows) => (
          <div className="table-wrap" tabIndex={0} role="region" aria-label="Table — scroll sideways to see all columns"><table className="table"><thead><tr><th>#</th><th>When</th><th>Who</th><th>Action</th><th>Target</th><th>Details</th></tr></thead>
            <tbody>{rows.map((a) => <tr key={a.id}><td className="xs mono">{a.id}</td><td className="small">{when(a.at)}</td><td className="small">{a.actorName || 'System / customer'}</td><td className="small mono">{a.action}</td><td className="small mono">{a.target || '—'}</td><td className="xs" style={{ maxWidth: 320, overflowWrap: 'anywhere' }}>{auditText(a.data)}</td></tr>)}</tbody></table></div>
        )}</Loading>}
      </section>
    </>
  );
}
