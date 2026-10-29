// Live admin console: frame, data hooks and small parts. Every number comes from /api/admin/*; every change is a
// request the server checks (role + two-step login) and writes to the audit log.
import { useCallback, useEffect, useState } from 'react';
import ErrorBoundary from '../../../components/ErrorBoundary';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import Header from '../../../components/Header';
import { Spinner } from '../../../components/ui';
import { useAuth } from '../../../lib/auth';
import { http } from '../../../services/http';
import { ROLES } from '../roles';

export { http };
export const NAV = [
  ['dashboard', '/admin', 'Dashboard', '▦'],
  ['orders', '/admin/orders', 'Orders', '☰'],
  ['payments', '/admin/whatsapp-payments', 'WhatsApp payments', '✆'],
  ['experts', '/admin/experts', 'Experts', '✦'],
  ['refunds', '/admin/refunds', 'Refunds & disputes', '↺'],
  ['payments', '/admin/payments', 'Payments & invoices', '₹'],
  ['customers', '/admin/customers', 'Customers & support', '☺'],
  ['customers', '/admin/stories', 'Stories', '❝'],
  ['quality', '/admin/quality', 'Quality', '✓'],
  ['reports', '/admin/reports', 'Reports', '⇩'],
  ['settings', '/admin/settings', 'Settings & prices', '⚙'],
  ['settings', '/admin/codes', 'Codes', '%'],
  ['settings', '/admin/courses', 'Courses', '✎'],
  ['automation', '/admin/automation', 'Automation', '⚡'],
  ['team', '/admin/team', 'Team & audit log', '⚿'],
  ['organizations', '/admin/orgs', 'Organizations', '⌂'],
  ['organizations', '/admin/college-groups', 'College groups', '⌂'],
  ['organizations', '/admin/shared-resumes', 'Shared resumes', '▤'],
  ['organizations', '/admin/plans', 'Organization plans', '◇'],
  ['payments', '/admin/org-invoices', 'Organization invoices', '№'],
  ['payments', '/admin/partners', 'Partners', '⇄'],
  ['settings', '/admin/billing-settings', 'Billing settings', '§'],
];

/** GET a path; { data, error, loading, reload }. `path` null = don't load. */
export function useApi(path) {
  // state remembers which path its data belongs to: after a tab switch the new tab never sees the old tab's data
  // (or a not-yet-loading null) — it reads as loading until its own response arrives
  const [st, setSt] = useState({ for: null, data: null, error: null, loading: false });
  const [n, setN] = useState(0);
  useEffect(() => {
    if (!path) return undefined;
    let off = false;
    setSt((s) => (s.for === path ? { ...s, loading: true, error: null } : { for: path, data: null, error: null, loading: true }));
    http(path).then((data) => !off && setSt({ for: path, data, error: null, loading: false }), (error) => !off && setSt({ for: path, data: null, error, loading: false }));
    return () => { off = true; };
  }, [path, n]);
  const reload = useCallback(() => setN((x) => x + 1), []);
  const mine = !!path && st.for === path;
  return { data: mine ? st.data : null, error: mine ? st.error : null, loading: !!path && (!mine || st.loading), reload };
}

/** Runs an admin action once at a time; returns [busy, run(fn, okText)]; shows errors via `onError`. */
export function useAction(toast) {
  const [busy, setBusy] = useState(false);
  const run = async (fn, ok) => {
    if (busy) return undefined;
    setBusy(true);
    try { const r = await fn(); if (ok) toast(ok); return r; } catch (e) { toast(e.message || 'That didn’t work. Please try again.'); return undefined; } finally { setBusy(false); }
  };
  return [busy, run];
}

/** failText: shown instead of the error message (e.g. a search the hosting edge refused); not for "No access". */
export function Loading({ st, children, empty, failText }) {
  if (!st.error && (st.loading || st.data == null)) return <div className="row g12 muted" role="status" style={{ padding: 24 }}><Spinner /> Loading…</div>;
  if (st.error) {
    return (
      <div className="card stack g8" role="alert">
        <strong>{st.error.status === 403 ? 'No access' : 'Couldn’t load this'}</strong>
        <span className="small muted">{st.error.status !== 403 && failText ? failText : st.error.message}</span>
        {st.error.status !== 403 && <button type="button" className="btn btn-outline" style={{ alignSelf: 'flex-start' }} onClick={st.reload}>Try again</button>}
      </div>
    );
  }
  if (empty && empty(st.data)) return <div className="well small muted" style={{ textAlign: 'center', padding: 24 }}>{typeof empty.text === 'string' ? empty.text : 'Nothing here yet.'}</div>;
  return children(st.data);
}
/** An empty-state rule with its message: <Loading st={x} empty={emptyIf((d) => !d.length, 'No orders yet.')}> */
export const emptyIf = (fn, text) => Object.assign(fn, { text });

export const rupees = (paise) => `₹${(Math.round((paise || 0) / 100) || 0).toLocaleString('en-IN')}`;
export const when = (v) => (v ? new Date(typeof v === 'number' ? v : Date.parse(v)).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }) : '—');
export const day = (v) => (v ? new Date(typeof v === 'number' ? v : Date.parse(v)).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '—');

export const STATUS_LABEL = {
  pending_payment: 'Awaiting payment', awaiting_payment: 'Waiting for payment (WhatsApp)', offer: 'Finding expert', in_progress: 'Expert writing', waiting: 'Draft with customer', revision: 'Changes',
  delivered: 'Delivered', approved: 'Approved', done: 'Done (DIY)', expired: 'Expired', cancelled: 'Cancelled', refunded: 'Refunded',
};
export const tone = (s) => ({ refunded: 'neutral', expired: 'neutral', cancelled: 'neutral', approved: 'success', done: 'success', delivered: 'success', offer: 'warning', revision: 'warning' }[s] || 'neutral');

export function LiveAdminLayout() {
  const { user } = useAuth();
  const { pathname, search } = useLocation();
  const can = ROLES[user?.adminRole]?.can || [];
  const current = NAV.find(([, to]) => (to === '/admin' ? pathname === '/admin' || pathname === '/admin/' : pathname.startsWith(to)));
  const allowed = !current || can.includes(current[0]);
  return (
    <>
      <Header variant="admin" />
      <div className="container-wide row g24" style={{ padding: '20px 24px 64px', alignItems: 'flex-start' }}>
        <nav aria-label="Admin sections" className="stack sticky admin-side" style={{ flex: '0 0 220px', top: 88, gap: 2 }}>
          {NAV.filter(([k]) => can.includes(k)).map(([_k, to, l, ic]) => (
            <NavLink key={to} to={to} end={to === '/admin'} className="admin-link"><span aria-hidden="true" style={{ width: 18, textAlign: 'center' }}>{ic}</span>{l}</NavLink>
          ))}
          <hr className="divider" />
          <span className="xs faint" style={{ padding: '0 10px' }}>Signed in as {user?.name} · {ROLES[user?.adminRole]?.label || 'Admin'}</span>
        </nav>
        <main id="main" className="stack g20" style={{ flex: '1 1 600px', minWidth: 0 }}>
          {allowed ? <ErrorBoundary resetKey={`${pathname}${search}`}><Outlet /></ErrorBoundary> : <div className="card stack g8"><strong>No access</strong><span className="small muted">Your role ({ROLES[user?.adminRole]?.label}) can’t open {current[2]}. Ask the owner.</span></div>}
        </main>
      </div>
    </>
  );
}
