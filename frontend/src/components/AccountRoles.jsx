// The open account menu (loaded when it opens): home, settings, the roles of one account for individuals
// (lib/roles.js) — "Switch to: Job seeker / Student / Expert" for people with several roles and "Add another role";
// each role opens its own dashboard — and sign out. An admin also gets "Switch to: Job seeker / Student / Expert /
// Company / College view" (components/AdminViews.jsx); inside such a view "Back to Admin" replaces Sign out.
import { Suspense, lazy, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { LIVE, homeFor, signOut } from '../lib/auth';
import { ROLE_NAMES, activeRoleOf, rolesOf, switchRole } from '../lib/roles';

const AdminViewItems = lazy(() => import('./AdminViews').then((m) => ({ default: m.AccountItems })));
const ITEM = { border: 0, background: 'transparent', width: '100%', textAlign: 'left', cursor: 'pointer' };

export function AccountRoles({ user, onDone }) {
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
        <button key={r} role="menuitem" type="button" className="admin-link" disabled={!!busy} aria-busy={busy === r || undefined} style={{ ...ITEM, minHeight: 44 }} onClick={() => go(r)}>
          {ROLE_NAMES[r]}
        </button>
      ))}
      {mine.length < 3 && <Link role="menuitem" to="/welcome?add=1" className="admin-link" style={{ minHeight: 44 }} onClick={() => onDone?.()}>Add another role</Link>}
      {err && <span role="alert" className="error xs" style={{ padding: '0 8px' }}>{err}</span>}
    </div>
  );
}

export default function AccountPanel({ user, onClose }) {
  const nav = useNavigate();
  const homeLabel = { customer: 'My dashboard', expert: 'Expert home', admin: 'Admin console' }[user.role];
  return (
    <div role="menu" className="card stack g4" style={{ position: 'absolute', right: 0, top: 48, width: 230, zIndex: 30, padding: 8, boxShadow: 'var(--shadow)' }}>
      <span className="xs muted" style={{ padding: '4px 8px' }}>{user.email}</span>
      <Link role="menuitem" to={homeFor(user)} className="admin-link">{homeLabel}</Link>
      {user.role === 'customer' && <Link role="menuitem" to="/me/settings" className="admin-link">Profile & settings</Link>}
      {user.role === 'expert' && <Link role="menuitem" to="/expert/profile" className="admin-link">Expert profile</Link>}
      {LIVE && (user.view || user.role === 'admin') && <Suspense fallback={null}><AdminViewItems view={user.view} /></Suspense>}
      {user.role !== 'admin' && !user.view && <AccountRoles user={user} onDone={onClose} />}
      {!user.view && <button role="menuitem" type="button" className="admin-link" style={ITEM} onClick={async () => { const to = user.role === 'admin' ? '/admin/login' : '/'; await signOut(); nav(to); }}>Sign out</button>}
    </div>
  );
}
