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
import { useAuth } from '../../lib/auth';
import { loadSimple, savePrefs } from '../../lib/simple';
import { Still } from '../newhome/ParticleStage';
import AppShell from '../../components/AppShell';
import { IcArrowUp, IcBolt, IcBook, IcBriefcase, IcCap, IcChart, IcCheckCircle, IcClock, IcEdit, IcFile, IcFlag, IcGrid, IcHelp, IcHome, IcInfo, IcMenu, IcLink, IcMail, IcMessage, IcRefresh, IcScale, IcSettings, IcTarget, IcThumb, IcTrend, IcUser, IcUsers, IcWallet } from '../../components/icons';
import { useSiteFlags } from '../../lib/siteFlags';
import { phoneTabs, TAB_LABELS } from '../../lib/meTabs';
import { usePageMeta } from '../../lib/meta';
import { navMeta } from '../../lib/navTitle';
import '../../styles/me-kit.css';

export const ME_NAV = [
  ['home', '/me', 'Home', IcHome],
  ['orders', '/me/orders', 'My orders', IcClock],
  ['messages', '/me/messages', 'Messages', IcMessage],
  ['resumes', '/me/resumes', 'My resumes', IcFile],
  ['profile', '/me/profile', 'Job Profile', IcUser],
  ['roles', '/me/roles', 'Find my role', IcTarget],
  ['learn', '/me/learn', 'Learning paths', IcBook],
  ['practice', '/me/practice', 'Practice tests', IcEdit],
  ['offercheck', '/me/offer-check', 'Offer checker', IcScale],
  ['feedback', '/me/feedback', 'Interview feedback', IcThumb],
  ['programs', '/me/programs', 'Internships & projects', IcGrid],
  ['guidance', '/me/guidance', 'Guidance', IcInfo],
  ['progress', '/me/progress', 'My progress', IcTrend],
  ['ats', '/me/ats', 'ATS & job match', IcChart],
  ['covers', '/me/covers', 'Cover letters', IcMail],
  ['certificates', '/me/certificates', 'Certificates', IcCap],
  ['jobs', '/me/jobs', 'Applications', IcBriefcase],
  ['auto', '/me/auto-apply', 'Auto Apply', IcRefresh],
  ['hire', '/me/hire', 'Ready to join', IcBolt],
  ['skills', '/me/skill-checks', 'Skill checks', IcCheckCircle],
  ['share', '/me/share', 'Share link', IcLink],
  ['groups', '/me/groups', 'My groups', IcUsers],
  ['launch', '/me/launch', 'Career Launch', IcFlag],
  ['payments', '/me/payments', 'Payments & refunds', IcWallet],
  ['upgrade', '/me/upgrade', 'Upgrade & add-ons', IcArrowUp],
  ['settings', '/me/settings', 'Profile & settings', IcSettings],
  ['help', '/me/help', 'Help & referral', IcHelp],
];
/** The side menu in a few groups and a folded "More" (Batch C items 23, 24; round P before). Every link of ME_NAV is
 * in exactly one group; the last group is "More". Students get their own order: learning, internships and skill checks
 * first, then the resume, then jobs. */
const MORE_KEYS = ['covers', 'share', 'certificates', 'launch', 'guidance', 'offercheck', 'feedback', 'progress', 'payments', 'upgrade', 'settings', 'help', 'groups'];
export const MORE_GROUP = 'More';
export function meGroups(student = false) {
  return student ? [
    ['Overview', ['home', 'orders', 'messages']],
    ['Learning', ['learn', 'programs', 'skills', 'practice', 'roles']],
    ['Resume tools', ['resumes', 'profile', 'ats']],
    ['Jobs', ['jobs', 'hire', 'auto']],
    [MORE_GROUP, MORE_KEYS],
  ] : [
    ['Overview', ['home', 'orders', 'messages']],
    ['Jobs', ['jobs', 'auto', 'hire']],
    ['Resume tools', ['resumes', 'profile', 'ats']],
    ['Learning', ['skills', 'practice', 'learn', 'roles', 'programs']],
    [MORE_GROUP, MORE_KEYS],
  ];
}
export const ME_GROUPS = meGroups(false);
/** Each section's small dotted shape and tint for the page header: job seekers orange, learning (students) magenta. */
const SECTION_ART = {
  'Overview': ['sphere', 'seeker'], 'Resume tools': ['resume', 'seeker'], 'Jobs': ['briefcase', 'seeker'],
  'Learning': ['cap', 'student'], [MORE_GROUP]: ['handshake', 'seeker'],
};
const artFor = (pathname) => {
  const hit = ME_NAV.filter(([, to]) => pathname === to || (to !== '/me' && pathname.startsWith(`${to}/`))).sort((x, y) => y[1].length - x[1].length)[0];
  const group = hit && ME_GROUPS.find(([, keys]) => keys.includes(hit[0]));
  return SECTION_ART[group?.[0]] || SECTION_ART.Overview;
};

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
  const TABS = phoneTabs(useSiteFlags().autoApply); // phones: Auto Apply in the bar while it is on, else My orders
  const groups = meGroups(useAuth().user?.activeRole === 'student');
  const here = (k) => { const to = ME_NAV.find((n) => n[0] === k)[1]; return pathname === to || pathname.startsWith(`${to}/`); };
  const moreKeys = groups.find(([g]) => g === MORE_GROUP)[1];
  const [moreOpen, setMoreOpen] = useState(() => moreKeys.some(here));
  useEffect(() => { if (moreKeys.some(here)) setMoreOpen(true); }, [pathname]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { syncFromBuilder(); }, []);
  useEffect(() => { setMore(false); }, [pathname]);
  // the Easy dashboard (Phase 4): people whose dashboard is Simple land there; everyone can switch at the top
  const [t] = useLang();
  const go = useNavigate();
  const [simple, setSimple] = useState(null);
  usePageMeta(navMeta(pathname, ME_NAV, { home: '/me', generic: 'My dashboard' })); // the tab title: this page's name (Batch E item 46)
  useEffect(() => { loadSimple().then(setSimple, () => {}); }, []);
  if (simple?.on && simple.mode === 'simple' && pathname === '/me') return <Navigate to="/me/simple" replace />;
  const toSimple = async () => { try { await savePrefs({ mode: 'simple' }); } catch { /* open it anyway */ } go('/me/simple'); };
  const link = ([k, to, l, Ic], cls = 'admin-link') => (
    <NavLink key={k} to={to} end={to === '/me'} className={cls} title={l}>
      <Ic style={{ flex: 'none' }} /><span className="app-side-text">{l}</span>
      {k === 'messages' && unread > 0 && <span className="badge b-danger" style={{ marginLeft: 'auto', padding: '1px 7px', fontSize: 11 }} aria-label={`${unread} unread`}>{unread}</span>}
    </NavLink>
  );
  return (
    <>
      <Header variant="me" right={<span className="row g8">{simple?.on && <button type="button" className="btn btn-outline" style={{ minHeight: 40 }} onClick={toSimple} data-testid="to-simple">{t('simple.switch.toSimple')}</button>}<Link to="/builder" state={{ open: 'build' }} className="btn btn-outline hide-sm" style={{ minHeight: 40 }}>Open builder</Link></span>} />
      <AppShell
        label="My dashboard" phone="none" storageKey="nm7-me-side" routeKey={pathname} className="me-shell has-tabs" sideClassName="me-side" mainClassName="stack g20"
        foot={<span className="xs muted">Signed in as <strong>{me.account.name}</strong></span>}
        nav={groups.map(([g, keys]) => (g === MORE_GROUP ? (
          <details key={g} className="me-group me-more" open={moreOpen} onToggle={(e) => setMoreOpen(e.currentTarget.open)} data-testid="me-more">
            <summary className="admin-link" title="More"><IcGrid style={{ flex: 'none' }} /><span className="app-side-text">More</span></summary>
            <div role="group" aria-label={g} className="me-group">{keys.map((k) => link(ME_NAV.find((n) => n[0] === k)))}</div>
          </details>
        ) : (
          <div key={g} className="me-group" role="group" aria-label={g}>
            <span className="me-group-h app-side-h" aria-hidden="true">{g}</span>
            {keys.map((k) => link(ME_NAV.find((n) => n[0] === k)))}
          </div>
        )))}
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
        {TABS.map((k) => ME_NAV.find((n) => n[0] === k)).map(([k, to, _l, Ic]) => (
          <NavLink key={k} to={to} end={to === '/me'} data-tab={k}><Ic size={20} />{TAB_LABELS[k]}</NavLink>
        ))}
        <button type="button" aria-expanded={more} onClick={() => setMore(!more)}><IcMenu size={20} />More{unread > 0 && <span className="dot" aria-label={`${unread} unread messages`} />}</button>
      </nav>
      {more && (
        <Dialog title="More" onClose={() => setMore(false)} overlayStyle={{ alignItems: 'flex-end', padding: 0 }} panelStyle={{ borderRadius: '20px 20px 0 0', maxWidth: '100%', margin: 0, paddingBottom: 88, gap: 4 }}>
          {groups.map(([g, keys]) => keys.filter((k) => !TABS.includes(k)).length > 0 && (
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
