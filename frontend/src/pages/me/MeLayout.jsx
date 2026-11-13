// Customer dashboard frame: sidebar on desktop, bottom tab bar + "More" sheet on phones.
import { useEffect, useState } from 'react';
import { Link, Navigate, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import Header from '../../components/Header';
import { useMe, unreadCount, syncFromBuilder, reloadMe } from '../../lib/customerStore';
import { Dialog, Spinner } from '../../components/ui';
import { useExpertOrders } from '../../lib/expertStore';
import { useLang } from '../../lib/i18n';
import { loadSimple, savePrefs } from '../../lib/simple';

export const ME_NAV = [
  ['home', '/me', 'Home', '⌂'],
  ['orders', '/me/orders', 'My orders', '☰'],
  ['messages', '/me/messages', 'Messages', '✉'],
  ['resumes', '/me/resumes', 'My resumes', '▤'],
  ['profile', '/me/profile', 'Job Profile', '◉'],
  ['roles', '/me/roles', 'Find my role', '◇'],
  ['learn', '/me/learn', 'Learning paths', '↗'],
  ['practice', '/me/practice', 'Practice tests', '✎'],
  ['offercheck', '/me/offer-check', 'Offer checker', '⚖'],
  ['feedback', '/me/feedback', 'Interview feedback', '❝'],
  ['programs', '/me/programs', 'Internships & projects', '▣'],
  ['guidance', '/me/guidance', 'Guidance', '☼'],
  ['progress', '/me/progress', 'My progress', '↑'],
  ['ats', '/me/ats', 'ATS & job match', '◎'],
  ['covers', '/me/covers', 'Cover letters', '✎'],
  ['certificates', '/me/certificates', 'Certificates', '✪'],
  ['jobs', '/me/jobs', 'Applications', '▥'],
  ['auto', '/me/auto-apply', 'Auto Apply', '⟳'],
  ['hire', '/me/hire', 'Ready to join', '⚡'],
  ['skills', '/me/skill-checks', 'Skill checks', '✓'],
  ['share', '/me/share', 'Share link', '↗'],
  ['groups', '/me/groups', 'My groups', '⚑'],
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
  // the Easy dashboard (Phase 4): people whose dashboard is Simple land there; everyone can switch at the top
  const [t] = useLang();
  const go = useNavigate();
  const [simple, setSimple] = useState(null);
  useEffect(() => { loadSimple().then(setSimple, () => {}); }, []);
  if (simple?.on && simple.mode === 'simple' && pathname === '/me') return <Navigate to="/me/simple" replace />;
  const toSimple = async () => { try { await savePrefs({ mode: 'simple' }); } catch { /* open it anyway */ } go('/me/simple'); };
  const link = ([k, to, l, ic], cls = 'admin-link') => (
    <NavLink key={k} to={to} end={to === '/me'} className={cls}>
      <span aria-hidden="true" style={{ width: 18, textAlign: 'center' }}>{ic}</span>{l}
      {k === 'messages' && unread > 0 && <span className="badge b-danger" style={{ marginLeft: 'auto', padding: '1px 7px', fontSize: 11 }} aria-label={`${unread} unread`}>{unread}</span>}
    </NavLink>
  );
  return (
    <>
      <Header variant="me" right={<span className="row g8">{simple?.on && <button type="button" className="btn btn-outline" style={{ minHeight: 40 }} onClick={toSimple} data-testid="to-simple">{t('simple.switch.toSimple')}</button>}<Link to="/builder" state={{ open: 'build' }} className="btn btn-outline hide-sm" style={{ minHeight: 40 }}>Open builder</Link></span>} />
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
        {ME_NAV.filter(([k]) => TABS.includes(k)).map(([k, to, _l, ic]) => (
          <NavLink key={k} to={to} end={to === '/me'}><span aria-hidden="true">{ic}</span>{SHORT[k]}</NavLink>
        ))}
        <button type="button" aria-expanded={more} onClick={() => setMore(!more)}><span aria-hidden="true">⋯</span>More{unread > 0 && <span className="dot" aria-label={`${unread} unread messages`} />}</button>
      </nav>
      {more && (
        <Dialog title="More" onClose={() => setMore(false)} overlayStyle={{ alignItems: 'flex-end', padding: 0 }} panelStyle={{ borderRadius: '20px 20px 0 0', maxWidth: '100%', margin: 0, paddingBottom: 88, gap: 4 }}>
          {ME_NAV.filter(([k]) => !TABS.includes(k)).map((n) => link(n))}
        </Dialog>
      )}
    </>
  );
}
