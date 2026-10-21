// Route guard, kept out of the Auth pages so every page doesn't load the sign-in screens.
import { lazy, Suspense } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { Spinner } from '../../components/ui';
import { useAuth } from '../../lib/auth';
import { lazyRetry } from '../../lib/chunks';

const WrongAccount = lazy(lazyRetry(() => import('./Auth').then((m) => ({ default: m.WrongAccount }))));
const Waiting = () => <main className="container row g8" style={{ padding: 40 }} aria-busy="true"><Spinner /><span className="muted">Loading…</span></main>;

/** role: 'customer' | 'expert' | 'admin'. approved: expert must be approved (orders, earnings…). */
export function RequireAuth({ role, approved, children }) {
  const { user, session, ready } = useAuth();
  const { pathname, search } = useLocation();
  const here = encodeURIComponent(pathname + search);
  if (!ready) return <Waiting />;
  if (role === 'admin') {
    if (!user || user.role !== 'admin' || !session?.twoStep) return <Navigate to={`/admin/login?next=${here}`} replace />;
    return children;
  }
  if (!user) return <Navigate to={`/login?next=${here}`} replace />;
  if (user.role !== role) return <Suspense fallback={<Waiting />}><WrongAccount user={user} need={role} /></Suspense>;
  if (approved && user.expertStatus !== 'approved') return <Navigate to="/expert/profile" replace />;
  return children;
}
