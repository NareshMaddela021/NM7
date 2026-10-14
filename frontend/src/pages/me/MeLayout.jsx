// Customer dashboard frame: sidebar on desktop, bottom tab bar + "More" sheet on phones.
import { useEffect, useState } from 'react';
import { Link, NavLink, Outlet, useLocation } from 'react-router-dom';
import Header from '../../components/Header';
import { useMe, unreadCount, syncFromBuilder, reloadMe } from '../../lib/customerStore';
import { Spinner } from '../../components/ui';
import { useExpertOrders } from '../../lib/expertStore';

export const ME_NAV = [
  ['home', '/me', 'Home', '⌂'],
  ['orders', '/me/orders', 'My orders', '☰'],
  ['messages', '/me/messages', 'Messages', '✉'],
  ['resumes', '/me/resumes', 'My resumes', '▤'],
  ['profile', '/me/profile', 'Job Profile', '◉'],
  ['ats', '/me/ats', 'ATS & job match', '◎'],
  ['covers', '/me/covers', 'Cover letters', '✎'],
  ['jobs', '/me/jobs', 'Applications', '▥'],
  ['share', '/me/share', 'Share link', '↗'],
  ['launch', '/me/launch', 'Career Launch', '★'],
  ['payments', '/me/payments', 'Payments & refunds', '₹'],
  ['upgrade', '/me/upgrade', 'Upgrade & add-ons', '⇧'],
  ['settings', '/me/settings', 'Profile & settings', '⚙'],
  ['help', '/me/help', 'Help & referral', '?'],
];
const TABS = ['home', 'orders', 'resumes', 'jobs'];
const SHORT = { home: 'Home', orders: 'Orders', resumes: 'Resumes', jobs: 'Jobs' };

export function MeHead({ title, sub, right }) {
  return (
    <div className="row between g16" style={{ alignItems: 'flex-end' }}>
      <div className="stack g4"><h1 className="display" style={{ fontSize: 30 }}>{title}</h1>{sub && <span className="small muted">{sub}</span>}</div>
      {right && <div className="row g8">{right}</div>}
    </div>
  );
}

export default function MeLayout() {
  const me = useMe();
  useExpertOrders(); // re-render when the expert sends something
  const unread = unreadCount(me);
  const [more, setMore] = useState(false);
  const { pathname } = useLocation();
  useEffect(() => { syncFromBuilder(); }, []);
  useEffect(() => { setMore(false); }, [pathname]);
  const link = ([k, to, l, ic], cls = 'admin-link') => (
    <NavLink key={k} to={to} end={to === '/me'} className={cls}>
      <span aria-hidden="true" style={{ width: 18, textAlign: 'center' }}>{ic}</span>{l}
      {k === 'messages' && unread > 0 && <span className="badge b-danger" style={{ marginLeft: 'auto', padding: '1px 7px', fontSize: 11 }} aria-label={`${unread} unread`}>{unread}</span>}
    </NavLink>
  );
  return (
    <>
      <Header variant="me" right={<Link to="/builder" state={{ open: 'build' }} className="btn btn-outline hide-sm" style={{ minHeight: 40 }}>Open builder</Link>} />
      <div className="container-wide row g24 me-wrap has-tabs" style={{ padding: '20px 24px 64px', alignItems: 'flex-start' }}>
        <nav aria-label="My dashboard" className="stack sticky me-side" style={{ flex: '0 0 220px', top: 88, gap: 2 }}>
          <span className="xs muted" style={{ padding: '0 10px 6px' }}>Signed in as <strong>{me.account.name}</strong></span>
          {ME_NAV.map((n) => link(n))}
        </nav>
        <main className="stack g20" style={{ flex: '1 1 600px', minWidth: 0 }}>
          {me.loading && !me.error && <div className="row g12 muted" role="status" style={{ padding: '48px 0' }}><Spinner /> Loading your dashboard…</div>}
          {me.loading && me.error && (
            <div className="card stack g12" role="alert">
              <strong>We couldn’t load your dashboard.</strong><span className="small muted">{me.error}</span>
              <button type="button" className="btn btn-outline" style={{ alignSelf: 'flex-start' }} onClick={reloadMe}>Try again</button>
            </div>
          )}
          {!me.loading && <Outlet />}
        </main>
      </div>
      {/* phones: bottom tabs */}
      <nav aria-label="My dashboard (tabs)" className="me-tabs">
        {ME_NAV.filter(([k]) => TABS.includes(k)).map(([k, to, l, ic]) => (
          <NavLink key={k} to={to} end={to === '/me'}><span aria-hidden="true">{ic}</span>{SHORT[k]}</NavLink>
        ))}
        <button type="button" aria-expanded={more} onClick={() => setMore(!more)}><span aria-hidden="true">⋯</span>More{unread > 0 && <span className="dot" aria-label={`${unread} unread messages`} />}</button>
      </nav>
      {more && (
        <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && setMore(false)} style={{ alignItems: 'flex-end', padding: 0 }}>
          <div role="dialog" aria-modal="true" aria-label="More" className="dialog stack g4" style={{ borderRadius: '20px 20px 0 0', maxWidth: '100%', margin: 0, paddingBottom: 88 }}>
            {ME_NAV.filter(([k]) => !TABS.includes(k)).map((n) => link(n))}
          </div>
        </div>
      )}
    </>
  );
}
