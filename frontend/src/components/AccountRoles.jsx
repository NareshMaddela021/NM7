// The account menu's roles (one account for individuals, lib/roles.js): "Switch to: Job seeker / Student / Expert" for
// people with several roles, and "Add another role". Each role opens its own dashboard.
import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { homeFor } from '../lib/auth';
import { ROLE_NAMES, activeRoleOf, rolesOf, switchRole } from '../lib/roles';

export default function AccountRoles({ user, onDone }) {
  const nav = useNavigate();
  const [busy, setBusy] = useState('');
  const [err, setErr] = useState('');
  const mine = rolesOf(user);
  const active = activeRoleOf(user);
  const others = mine.filter((r) => r !== active);
  const go = async (r) => {
    setBusy(r); setErr('');
    try { const u = await switchRole(r); onDone?.(); nav(homeFor(u)); } catch (e) { setErr(e.message || 'Please try again.'); } finally { setBusy(''); }
  };
  return (
    <div className="stack g4" data-testid="account-roles" style={{ borderTop: '1px solid var(--border)', borderBottom: '1px solid var(--border)', padding: '4px 0' }}>
      {active && <span className="xs muted" style={{ padding: '4px 8px' }}>Now: {ROLE_NAMES[active]}</span>}
      {others.length > 0 && <span className="xs muted" style={{ padding: '0 8px' }}>Switch to:</span>}
      {others.map((r) => (
        <button key={r} role="menuitem" type="button" className="admin-link" disabled={!!busy} aria-busy={busy === r || undefined}
          style={{ border: 0, background: 'transparent', width: '100%', textAlign: 'left', cursor: 'pointer', minHeight: 44 }} onClick={() => go(r)}>
          {ROLE_NAMES[r]}
        </button>
      ))}
      {mine.length < 3 && <Link role="menuitem" to="/welcome?add=1" className="admin-link" style={{ minHeight: 44 }} onClick={() => onDone?.()}>Add another role</Link>}
      {err && <span role="alert" className="error xs" style={{ padding: '0 8px' }}>{err}</span>}
    </div>
  );
}
