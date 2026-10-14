// Live admin: settings (prices, delivery promise), automation rules, team + audit log.
import { useEffect, useState } from 'react';
import { useToast } from '../../../components/ui';
import { passwordIssue, useAuth } from '../../../lib/auth';
import { PageHead } from '../AdminUI';
import { ROLES } from '../roles';
import { Loading, emptyIf, http, useAction, useApi, when } from './common';

/* ---------- settings & prices ---------- */
export function LiveSettings() {
  const toast = useToast();
  const st = useApi('/api/admin/settings');
  const [busy, run] = useAction(toast);
  const [f, setF] = useState(null);
  useEffect(() => { if (st.data) setF(structuredClone(st.data)); }, [st.data]);
  const row = (group, k) => {
    const v = f[group][k];
    const set = (patch) => setF({ ...f, [group]: { ...f[group], [k]: { ...v, ...patch } } });
    return (
      <tr key={k}>
        <td className="small">{v.name}</td>
        <td><label className="sr-only" htmlFor={`pr-${k}`}>{v.name} price in rupees</label><input id={`pr-${k}`} className="input" inputMode="numeric" style={{ height: 38, width: 120 }} value={Math.round(v.amount / 100)} onChange={(e) => set({ amount: (Number(e.target.value.replace(/\D/g, '')) || 0) * 100 })} /></td>
        <td><label className="row g4 small"><input type="checkbox" checked={v.active} onChange={(e) => set({ active: e.target.checked })} />On sale</label></td>
      </tr>
    );
  };
  const save = () => run(async () => {
    const pick = (g) => Object.fromEntries(Object.entries(f[g]).map(([k, v]) => [k, { amount: v.amount, active: v.active }]));
    const r = await http('/api/admin/settings', { method: 'PUT', body: { plans: pick('plans'), addons: pick('addons'), deliveryHours: f.deliveryHours } });
    setF(structuredClone(r)); st.reload();
  }, 'Saved — new orders use these prices');
  return (
    <>
      <PageHead title="Settings & prices" sub="Prices include GST. Changes apply to new checkouts at once and are written to the audit log." />
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
            <label className="row g8 small">First draft within <input className="input" inputMode="numeric" aria-label="Delivery hours" style={{ height: 38, width: 80 }} value={f.deliveryHours} onChange={(e) => setF({ ...f, deliveryHours: Number(e.target.value.replace(/\D/g, '')) || 0 })} /> hours (24–168). Express add-on is always 24 hours.</label>
          </section>
          <button type="button" className="btn btn-ink" style={{ alignSelf: 'flex-start' }} disabled={busy || f.deliveryHours < 24 || f.deliveryHours > 168} onClick={save}>Save settings</button>
        </>
      )}</Loading>
    </>
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
  const [action, setAction] = useState('');
  const log = useApi(`/api/admin/audit-log?limit=100${action ? `&action=${encodeURIComponent(action)}` : ''}`);
  const patch = (id, body, ok) => run(async () => { await http(`/api/admin/team/${id}`, { method: 'PATCH', body }); st.reload(); log.reload(); }, ok);
  return (
    <>
      <PageHead title="Team & audit log" sub="Every admin uses two-step login. Role changes sign that person out." />
      <Loading st={st}>{(team) => (
        <div className="card table-wrap" style={{ padding: 0 }}>
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
          <label className="row g8 small">Action <input className="input" style={{ height: 36, width: 200 }} placeholder="e.g. settings.changed" value={action} onChange={(e) => setAction(e.target.value.trim())} /></label></div>
        <Loading st={log} empty={emptyIf((d) => !d.length, 'Nothing logged yet.')}>{(rows) => (
          <div className="table-wrap"><table className="table"><thead><tr><th>#</th><th>When</th><th>Who</th><th>Action</th><th>Target</th><th>Details</th></tr></thead>
            <tbody>{rows.map((a) => <tr key={a.id}><td className="xs mono">{a.id}</td><td className="small">{when(a.at)}</td><td className="small">{a.actorName || 'System / customer'}</td><td className="small mono">{a.action}</td><td className="small mono">{a.target || '—'}</td><td className="xs mono" style={{ maxWidth: 320, overflowWrap: 'anywhere' }}>{Object.keys(a.data || {}).length ? JSON.stringify(a.data) : ''}</td></tr>)}</tbody></table></div>
        )}</Loading>
      </section>
    </>
  );
}
