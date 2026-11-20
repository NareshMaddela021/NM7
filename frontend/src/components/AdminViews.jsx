// The admin's views (lib/adminViews.js): the coloured banner on every page while a view is open, and the "Switch to"
// list in the admin's account menu. Loaded only for an admin (or while a view is open), never for anyone else.
import { useState } from 'react';
import { VIEW_LABELS, backToAdmin, bannerText, switchTo } from '../lib/adminViews';
import { useAuth } from '../lib/auth';
import { ROLES } from '../pages/admin/roles';
import '../styles/admin-views.css';

/** "You are viewing as Student (admin preview) · Back to Admin": in the page flow at the very top, so it never covers
 *  anything, on every page while the view is open. */
export default function ViewBanner({ view }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const back = async () => {
    setBusy(true); setErr('');
    try { await backToAdmin(view); } catch (e) { setErr(e?.message || 'Couldn’t go back. Try again.'); setBusy(false); }
  };
  return (
    <div className={`av-banner${view.readOnly ? ' is-ro' : ''}`} role="region" aria-label="Admin view" data-testid="view-banner" data-role={view.role}>
      <span className="av-text"><strong>{bannerText(view)}</strong>{view.readOnly && <span className="av-sub"> Nothing can be changed or sent; private details are hidden.</span>}</span>
      <button type="button" className="av-back" onClick={back} disabled={busy} data-testid="back-to-admin">Back to Admin</button>
      {err && <span className="av-err" role="alert">{err}</span>}
    </div>
  );
}

// which admin sections each view needs (the server checks the same: app/admin/views.py)
const NEEDS = { company: 'companies', college: 'organizations' };
export const ROLES_IN_MENU = ['jobseeker', 'student', 'expert', 'company', 'college'];

/** The admin's "Switch to" list: Job seeker / Student / Expert / Company / College view. Each opens in this tab,
 *  and the banner brings you back. onError shows a message where the list is. */
export function SwitchToItems({ onError }) {
  const { user } = useAuth();
  const [busy, setBusy] = useState('');
  const roles = ROLES_IN_MENU.filter((r) => !NEEDS[r] || (ROLES[user?.adminRole]?.can || []).includes(NEEDS[r]));
  const open = async (r) => {
    setBusy(r);
    try { await switchTo(r); } catch (e) { setBusy(''); onError?.(e?.message || 'Couldn’t open that view.'); }
  };
  return (
    <div className="av-menu" role="group" aria-label="Switch to">
      <span className="av-menu-h">Switch to</span>
      {roles.map((r) => (
        <button key={r} role="menuitem" type="button" className="admin-link av-item" disabled={!!busy} onClick={() => open(r)} data-testid={`switch-${r}`}>
          {busy === r ? 'Opening…' : `${VIEW_LABELS[r]} view`}
        </button>
      ))}
    </div>
  );
}

/** In the account menu: "Switch to …" for an admin, "Back to Admin" (instead of Sign out) while a view is open. */
export function AccountItems({ view }) {
  const [err, setErr] = useState('');
  if (view) return <button role="menuitem" type="button" className="admin-link av-item" onClick={() => backToAdmin(view).catch((e) => setErr(e?.message || 'Try again.'))}>Back to Admin{err && <span className="av-err" role="alert"> {err}</span>}</button>;
  return <>{err && <span className="av-err" role="alert">{err}</span>}<SwitchToItems onError={setErr} /></>;
}
