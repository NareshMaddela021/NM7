// Team: members, roles, two-step login, permissions matrix; audit log of every change.
import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useToast } from '../../components/ui';
import { useAdmin, ROLES } from './AdminContext';
import { PageHead, Tabs, ago, fmtDT, downloadCsv } from './AdminUI';
import { NAV } from './AdminLayout';

function Members() {
  const { team, actions } = useAdmin();
  const toast = useToast();
  const [inv, setInv] = useState({ email: '', role: 'support' });
  const ok = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(inv.email) && !team.some((t) => t.email === inv.email);
  return (
    <>
      <div className="card table-wrap" style={{ padding: 0 }}>
        <table className="table"><thead><tr><th>Member</th><th>Role</th><th>Two-step login</th><th>Last login</th></tr></thead>
          <tbody>{team.map((t) => (
            <tr key={t.id}><td><strong>{t.name}</strong><div className="xs faint">{t.email}</div></td>
              <td>{t.role === 'owner' ? <span className="badge b-signal">Owner</span> : (
                <select aria-label={`Role for ${t.name}`} className="input" style={{ height: 38, width: 'auto', fontSize: 13 }} value={t.role} onChange={(e) => { actions.team(team.map((x) => (x.id === t.id ? { ...x, role: e.target.value } : x)), `Changed role for ${t.name}`, ROLES[t.role].label, ROLES[e.target.value].label); toast('Role changed'); }}>
                  {Object.entries(ROLES).filter(([k]) => k !== 'owner').map(([k, r]) => <option key={k} value={k}>{r.label}</option>)}
                </select>)}</td>
              <td>{t.twoStep ? <span className="badge b-success">On</span> : <span className="row g8"><span className="badge b-danger">Off</span><button type="button" className="link-btn xs" onClick={() => { actions.team(team.map((x) => (x.id === t.id ? { ...x, invitedTwoStep: true } : x)), `Asked ${t.name} to turn on two-step login`); toast('Reminder sent'); }}>Remind</button></span>}</td>
              <td className="small">{ago(t.lastLogin)}{t.pending ? ' · invite sent' : ''}</td></tr>))}</tbody></table>
      </div>
      <form className="card row g8" style={{ alignItems: 'flex-end' }} onSubmit={(e) => { e.preventDefault(); actions.team([...team, { id: `u${Date.now()}`, name: inv.email.split('@')[0], email: inv.email, role: inv.role, twoStep: false, lastLogin: Date.now(), pending: true }], `Invited ${inv.email}`, '—', ROLES[inv.role].label); setInv({ email: '', role: 'support' }); toast('Invite sent'); }}>
        <div className="field" style={{ flex: '2 1 240px' }}><label htmlFor="ie" className="label">Invite by email</label><input id="ie" className="input" style={{ height: 42 }} value={inv.email} onChange={(e) => setInv({ ...inv, email: e.target.value.trim() })} placeholder="name@nm7.si" /></div>
        <div className="field" style={{ flex: '1 1 160px' }}><label htmlFor="ir" className="label">Role</label><select id="ir" className="input" style={{ height: 42 }} value={inv.role} onChange={(e) => setInv({ ...inv, role: e.target.value })}>{Object.entries(ROLES).filter(([k]) => k !== 'owner').map(([k, r]) => <option key={k} value={k}>{r.label}</option>)}</select></div>
        <button type="submit" className="btn btn-ink" disabled={!ok}>Send invite</button>
      </form>
      <div className="card table-wrap" style={{ padding: 0 }}>
        <table className="table"><thead><tr><th>Section</th>{Object.values(ROLES).map((r) => <th key={r.label}>{r.label}</th>)}</tr></thead>
          <tbody>{NAV.map(([k, , l]) => <tr key={k}><td className="small">{l}</td>{Object.entries(ROLES).map(([rk, r]) => <td key={rk} aria-label={r.can.includes(k) ? 'Allowed' : 'No access'}>{r.can.includes(k) ? '✓' : <span className="faint">—</span>}</td>)}</tr>)}</tbody></table>
      </div>
    </>
  );
}

function AuditLog() {
  const { log } = useAdmin();
  const [area, setArea] = useState('');
  const [who, setWho] = useState('');
  const areas = [...new Set(log.map((l) => l.area))];
  const people = [...new Set(log.map((l) => l.who))];
  const list = log.filter((l) => (!area || l.area === area) && (!who || l.who === who));
  return (
    <>
      <div className="row g8">
        <select aria-label="Area" className="input" style={{ height: 40, width: 'auto' }} value={area} onChange={(e) => setArea(e.target.value)}><option value="">All areas</option>{areas.map((a) => <option key={a}>{a}</option>)}</select>
        <select aria-label="Person" className="input" style={{ height: 40, width: 'auto' }} value={who} onChange={(e) => setWho(e.target.value)}><option value="">Everyone</option>{people.map((a) => <option key={a}>{a}</option>)}</select>
        <button type="button" className="btn btn-outline" onClick={() => downloadCsv('audit-log.csv', [['Time', 'Who', 'Area', 'What', 'Before', 'After'], ...list.map((l) => [fmtDT(l.at), l.who, l.area, l.what, l.from, l.to])])}>Export CSV</button>
      </div>
      <div className="card table-wrap" style={{ padding: 0 }}>
        <table className="table"><thead><tr><th>When</th><th>Who</th><th>Area</th><th>What</th><th>Before → after</th></tr></thead>
          <tbody>{list.map((l, i) => <tr key={i}><td className="small">{fmtDT(l.at)}</td><td className="small">{l.who}</td><td><span className="badge b-neutral">{l.area}</span></td><td className="small">{l.what}</td><td className="xs muted" style={{ maxWidth: 260, overflowWrap: 'anywhere' }}>{l.from} → <strong>{l.to}</strong></td></tr>)}</tbody></table>
      </div>
      <span className="xs faint">The log can’t be edited or deleted — not even by the owner.</span>
    </>
  );
}

export default function Team() {
  const [params, setParams] = useSearchParams();
  const tab = params.get('tab') || 'members';
  return (
    <>
      <PageHead title="Team & audit log" sub="Who can do what, and a record of every change." />
      <Tabs label="Team" value={tab} onChange={(v) => setParams(v === 'members' ? {} : { tab: v })} tabs={[['members', 'Members & roles'], ['log', 'Audit log']]} />
      {tab === 'members' ? <Members /> : <AuditLog />}
    </>
  );
}
