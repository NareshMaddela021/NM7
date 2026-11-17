// Customer dashboard frame: a grouped side menu on desktop, bottom tab bar + a grouped "More" sheet on phones (round P:
// the new design; the links and their order inside each group are unchanged). Round W: the frame is components/AppShell
// (full width, a full-height side menu that folds to icons); phones keep the bottom tabs (phone="none").
import { useEffect, useState } from 'react';
import { Link, Navigate, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import Header from '../../components/Header';
import { useMe, unreadCount, syncFromBuilder, reloadMe } from '../../lib/customerStore';
import { Dialog, Spinner } from '../../components/ui';
import { useExpertOrders } from '../../lib/expertStore';
import { useLang } from '../../lib/i18n';
import { loadSimple, savePrefs } from '../../lib/simple';
import { Still } from '../newhome/ParticleStage';
import AppShell from '../../components/AppShell';
import '../../styles/me-kit.css';

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
/** The side menu in groups (round P). Every link of ME_NAV is in exactly one group. */
export const ME_GROUPS = [
  ['Overview', ['home', 'messages']],
  ['Resume tools', ['resumes', 'profile', 'ats', 'covers', 'share', 'certificates']],
  ['Jobs', ['jobs', 'auto', 'hire']],
  ['Learning', ['roles', 'learn', 'practice', 'skills', 'programs', 'launch', 'guidance']],
  ['Offer and work', ['offercheck', 'feedback', 'progress']],
  ['Account', ['orders', 'payments', 'upgrade', 'settings', 'help', 'groups']],
];
/** Each section's small dotted shape and tint for the page header: job seekers orange, learning (students) magenta. */
const SECTION_ART = {
  'Overview': ['sphere', 'seeker'], 'Resume tools': ['resume', 'seeker'], 'Jobs': ['briefcase', 'seeker'],
  'Learning': ['cap', 'student'], 'Offer and work': ['badge', 'seeker'], 'Account': ['handshake', 'seeker'],
};
const artFor = (pathname) => {
  const hit = ME_NAV.filter(([, to]) => pathname === to || (to !== '/me' && pathname.startsWith(`${to}/`))).sort((x, y) => y[1].length - x[1].length)[0];
  const group = hit && ME_GROUPS.find(([, keys]) => keys.includes(hit[0]));
  return SECTION_ART[group?.[0]] || SECTION_ART.Overview;
};
const TABS = ['home', 'orders', 'resumes', 'jobs'];
const SHORT = { home: 'Home', orders: 'Orders', resumes: 'Resumes', jobs: 'Jobs' };

/** A dashboard page's header: title, line under it, buttons, and the section's small dotted shape (desktop only). */
export function MeHead({ title, sub, right }) {
  const { pathname } = useLocation();
  const [shape, tint] = artFor(pathname);
  return (
    <div className="me-head">
      <div className="stack g4 me-head-text"><h1 className="display me-h1">{title}</h1>{sub && <span className="small muted">{sub}</span>}</div>
      {right && <div className="row g8 me-head-right">{right}</div>}
      <span className="me-head-art" aria-hidden="true" data-tint={tint}><Still shape={shape} tint={tint} className="me-head-still" /></span>
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
    <NavLink key={k} to={to} end={to === '/me'} className={cls} title={l}>
      <span aria-hidden="true" style={{ width: 18, textAlign: 'center', flex: 'none' }}>{ic}</span><span className="app-side-text">{l}</span>
      {k === 'messages' && unread > 0 && <span className="badge b-danger" style={{ marginLeft: 'auto', padding: '1px 7px', fontSize: 11 }} aria-label={`${unread} unread`}>{unread}</span>}
    </NavLink>
  );
  return (
    <>
      <Header variant="me" right={<span className="row g8">{simple?.on && <button type="button" className="btn btn-outline" style={{ minHeight: 40 }} onClick={toSimple} data-testid="to-simple">{t('simple.switch.toSimple')}</button>}<Link to="/builder" state={{ open: 'build' }} className="btn btn-outline hide-sm" style={{ minHeight: 40 }}>Open builder</Link></span>} />
      <AppShell
        label="My dashboard" phone="none" storageKey="nm7-me-side" routeKey={pathname} className="me-shell has-tabs" sideClassName="me-side" mainClassName="stack g20"
        foot={<span className="xs muted">Signed in as <strong>{me.account.name}</strong></span>}
        nav={ME_GROUPS.map(([g, keys]) => (
          <div key={g} className="me-group" role="group" aria-label={g}>
            <span className="me-group-h app-side-h" aria-hidden="true">{g}</span>
            {keys.map((k) => link(ME_NAV.find((n) => n[0] === k)))}
          </div>
        ))}
      >
        {me.loading && !me.error && <div className="row g12 muted" role="status" style={{ padding: '48px 0' }}><Spinner /> Loading your dashboard…</div>}
        {me.loading && me.error && (
          <div className="card stack g12" role="alert">
            <strong>We couldn’t load your dashboard.</strong><span className="small muted">{me.error}</span>
            <button type="button" className="btn btn-outline" style={{ alignSelf: 'flex-start' }} onClick={reloadMe}>Try again</button>
          </div>
        )}
        {!me.loading && <Outlet />}
      </AppShell>
      {/* phones: bottom tabs */}
      <nav aria-label="My dashboard (tabs)" className="me-tabs">
        {ME_NAV.filter(([k]) => TABS.includes(k)).map(([k, to, _l, ic]) => (
          <NavLink key={k} to={to} end={to === '/me'}><span aria-hidden="true">{ic}</span>{SHORT[k]}</NavLink>
        ))}
        <button type="button" aria-expanded={more} onClick={() => setMore(!more)}><span aria-hidden="true">⋯</span>More{unread > 0 && <span className="dot" aria-label={`${unread} unread messages`} />}</button>
      </nav>
      {more && (
        <Dialog title="More" onClose={() => setMore(false)} overlayStyle={{ alignItems: 'flex-end', padding: 0 }} panelStyle={{ borderRadius: '20px 20px 0 0', maxWidth: '100%', margin: 0, paddingBottom: 88, gap: 4 }}>
          {ME_GROUPS.map(([g, keys]) => keys.filter((k) => !TABS.includes(k)).length > 0 && (
            <div key={g} className="me-group" role="group" aria-label={g}>
              <span className="me-group-h" aria-hidden="true">{g}</span>
              {keys.filter((k) => !TABS.includes(k)).map((k) => link(ME_NAV.find((n) => n[0] === k)))}
            </div>
          ))}
        </Dialog>
      )}
    </>
  );
}
