import { Component, Suspense, lazy as reactLazy, useEffect, useRef, useState } from 'react';
import { Link, Navigate, Route, Routes, useLocation, useNavigate, useParams } from 'react-router-dom';
import Header from './components/Header';
import DownloadGateHost from './components/DownloadGate';
import Home from './pages/Home';
import { BlogList, BlogPost } from './pages/blog/Blog'; // small, and the home page already uses it
import { Spinner } from './components/ui';
import { useAuth, previewSignIn, previewUsers, LIVE } from './lib/auth';
import { RequireAuth } from './pages/auth/Auth';
import { applyMeta, currentMeta, usePageMeta } from './lib/meta';
import { StaleBuildPage, isChunkError, lazyRetry, reloadOnce } from './lib/chunks';
import { onSlow } from './services/http';
import { reportError } from './lib/monitoring';

// a page file missing after a deploy (tab opened on the old build) reloads onto the new build
const lazy = (load) => reactLazy(lazyRetry(load));

// Every page except Home is its own chunk, loaded when first opened.
const named = (load, name) => lazy(() => load().then((m) => ({ default: m[name] })));
const Scan = lazy(() => import('./pages/Scan'));
const Checkout = lazy(() => import('./pages/Checkout'));
const Intake = lazy(() => import('./pages/Intake'));
const Refund = lazy(() => import('./pages/Refund'));
const Editor = lazy(() => import('./pages/Editor'));
const Builder = lazy(() => import('./pages/Builder'));
const DraftReview = lazy(() => import('./pages/DraftReview'));
const ExpertHome = lazy(() => import('./pages/expert/ExpertHome'));
const ExpertOrders = lazy(() => import('./pages/expert/ExpertOrders'));
const OrderWorkspace = lazy(() => import('./pages/expert/OrderWorkspace'));
const Snippets = lazy(() => import('./pages/expert/Snippets'));
const Performance = lazy(() => import('./pages/expert/Performance'));
const ExpertHelp = lazy(() => import('./pages/expert/Help'));
const Earnings = lazy(() => import('./pages/expert/Earnings'));
const ExpertProfile = lazy(() => import('./pages/expert/Profile'));
const TestTask = lazy(() => import('./pages/expert/TestTask'));
const auth = () => import('./pages/auth/Auth');
const Login = named(auth, 'Login');
const Signup = named(auth, 'Signup');
const ForgotPassword = named(auth, 'ForgotPassword');
const AdminLogin = named(auth, 'AdminLogin');
const AdminSetup = named(auth, 'AdminSetup');
const legal = () => import('./pages/legal/Legal');
const Terms = named(legal, 'Terms');
const Privacy = named(legal, 'Privacy');
const RefundPolicy = named(legal, 'RefundPolicy');
const DeliveryPolicy = named(legal, 'DeliveryPolicy');
const ExpertTerms = named(legal, 'ExpertTerms');
const Contact = named(legal, 'Contact');
const MeLayout = lazy(() => import('./pages/me/MeLayout'));
const MeHome = lazy(() => import('./pages/me/MeHome'));
const meOrders = () => import('./pages/me/MeOrders');
const OrdersList = named(meOrders, 'OrdersList');
const OrderDetail = named(meOrders, 'OrderDetail');
const MeMessages = lazy(() => import('./pages/me/MeMessages'));
const MeResumes = lazy(() => import('./pages/me/MeResumes'));
const MeProfile = lazy(() => import('./pages/me/MeProfile'));
const MeAts = lazy(() => import('./pages/me/MeAts'));
const MeCovers = lazy(() => import('./pages/me/MeCovers'));
const MeJobs = lazy(() => import('./pages/me/MeJobs'));
const meShare = () => import('./pages/me/MeShare');
const MeShare = named(meShare, 'default');
const ShareRoute = lazy(() => import('./pages/recruit/Recruiter')); // /r/<name> resume links and /r/<token> recruiter links
const MeLaunch = lazy(() => import('./pages/me/MeLaunch'));
const meMoney = () => import('./pages/me/MeMoney');
const MePayments = named(meMoney, 'MePayments');
const MeUpgrade = named(meMoney, 'MeUpgrade');
const groups = () => import('./pages/org/Groups');
const Join = named(groups, 'Join');
const MeGroups = named(groups, 'MeGroups');
const portal = () => import('./pages/org/Portal');
const OrgHome = named(portal, 'OrgHome');
const PortalLayout = named(portal, 'PortalLayout');
const PortalGroups = named(portal, 'PortalGroups');
const PortalResumes = named(portal, 'PortalResumes');
const PortalDashboard = named(portal, 'PortalDashboard');
const PortalActivity = named(portal, 'PortalActivity');
const PortalKiosks = named(portal, 'PortalKiosks');
const PortalBranding = named(portal, 'PortalBranding');
const PortalRecruiters = named(portal, 'PortalRecruiters');
const PortalBilling = named(portal, 'PortalBilling');
const PortalTeam = named(portal, 'PortalTeam');
const ForOrgs = lazy(() => import('./pages/org/ForOrgs'));
const kioskPages = () => import('./pages/kiosk/Kiosk');
const KioskScreen = named(kioskPages, 'default');
const ContinueHere = named(kioskPages, 'ContinueHere');
const OrgInvite = named(portal, 'OrgInvite');
const StopReminders = named(portal, 'StopReminders');
const meSettings = () => import('./pages/me/MeSettings');
const MeSettings = named(meSettings, 'MeSettings');
const MeHelp = named(meSettings, 'MeHelp');

// Admin console: real data on the live site; the sample console only in the preview build.
const liveAdmin = { billing: () => import('./pages/admin/live/BillingPages'), orgs: () => import('./pages/admin/live/OrgPages'), common: () => import('./pages/admin/live/common'), ops: () => import('./pages/admin/live/OpsPages'), people: () => import('./pages/admin/live/PeoplePages'), setup: () => import('./pages/admin/live/SetupPages') };
const ADMIN = LIVE ? {
  Layout: named(liveAdmin.common, 'LiveAdminLayout'), Dashboard: named(liveAdmin.ops, 'LiveDashboard'), Orders: named(liveAdmin.ops, 'LiveOrders'),
  Experts: named(liveAdmin.people, 'LiveExperts'), Refunds: named(liveAdmin.ops, 'LiveRefunds'), Payments: named(liveAdmin.ops, 'LivePayments'),
  Customers: named(liveAdmin.people, 'LiveCustomers'), Quality: named(liveAdmin.people, 'LiveQuality'), Reports: named(liveAdmin.people, 'LiveReports'),
  Settings: named(liveAdmin.setup, 'LiveSettings'), Automation: named(liveAdmin.setup, 'LiveAutomation'), Team: named(liveAdmin.setup, 'LiveTeam'),
  Orgs: named(liveAdmin.orgs, 'LiveOrgs'), Shared: named(liveAdmin.orgs, 'LiveShared'),
  Plans: named(liveAdmin.billing, 'LivePlans'), BillingSettings: named(liveAdmin.billing, 'LiveBillingSettings'), OrgInvoices: named(liveAdmin.billing, 'LiveOrgInvoices'),
} : {
  Layout: lazy(() => import('./pages/admin/AdminLayout')), Dashboard: lazy(() => import('./pages/admin/Dashboard')), Orders: lazy(() => import('./pages/admin/Orders')),
  Experts: lazy(() => import('./pages/admin/ExpertsAdmin')), Refunds: lazy(() => import('./pages/admin/Refunds')), Payments: lazy(() => import('./pages/admin/Payments')),
  Customers: lazy(() => import('./pages/admin/Customers')), Quality: lazy(() => import('./pages/admin/Quality')), Reports: lazy(() => import('./pages/admin/Reports')),
  Settings: lazy(() => import('./pages/admin/Settings')), Automation: lazy(() => import('./pages/admin/Automation')), Team: lazy(() => import('./pages/admin/Team')),
  Orgs: named(liveAdmin.orgs, 'LiveOrgs'), Shared: named(liveAdmin.orgs, 'LiveShared'), // live API only
  Plans: named(liveAdmin.billing, 'LivePlans'), BillingSettings: named(liveAdmin.billing, 'LiveBillingSettings'), OrgInvoices: named(liveAdmin.billing, 'LiveOrgInvoices'),
};

if (!LIVE && import.meta.env.VITE_PREVIEW === '1') {
  Promise.all([import('./lib/expert'), import('./lib/expertTest')]).then(([e, t]) => t.seedPreviewExpert(e.keyFor, e.BLANK));
}

/** Old tracking links (/orders/RS-…) now open the order in the dashboard. */
function OrderRedirect() {
  const { id } = useParams();
  const { state } = useLocation();
  return <Navigate to={`/me/orders/${id}`} state={state} replace />;
}
const C = (el) => <RequireAuth role="customer">{el}</RequireAuth>;
const E = (el, approved = true) => <RequireAuth role="expert" approved={approved}>{el}</RequireAuth>;

/** After a route change, keyboard and screen-reader users land on the new page's main content instead of staying
 * on the link they pressed somewhere in the old page. The first render is left alone. */
function RouteFocus() {
  const { pathname } = useLocation();
  // Compare with the last path rather than a "first render" flag: StrictMode runs effects twice on load.
  const last = useRef(pathname);
  useEffect(() => {
    if (last.current === pathname) return;
    last.current = pathname;
    const id = requestAnimationFrame(() => focusMain());
    return () => cancelAnimationFrame(id);
  }, [pathname]);
  return null;
}
/** Moves focus to the page's main content (the skip link and route changes). */
export function focusMain() {
  const main = document.getElementById('main') || document.querySelector('main');
  if (!main) return false;
  if (!main.hasAttribute('tabindex')) main.setAttribute('tabindex', '-1');
  main.focus({ preventScroll: true });
  return true;
}

function ScrollToTop() {
  const { pathname, hash } = useLocation();
  useEffect(() => { applyMeta(currentMeta(pathname)); }, [pathname]);
  useEffect(() => {
    if (hash) document.getElementById(hash.slice(1))?.scrollIntoView();
    else window.scrollTo(0, 0);
  }, [pathname, hash]);
  return null;
}

const SCREENS = [
  ['/', 'Home · free scan'], ['/scan', 'Scan report'], ['/checkout', 'Checkout'], 
  ['/login', 'Sign in'], ['/signup', 'Sign up'], ['/admin/login', 'Admin login (two-step)'], ['/orders/RS-1117/intake', 'Intake questions'], ['/orders/RS-1117/refund', 'Refund request'], ['/editor', 'Editor'],
  ['/builder', 'Resume builder'], ['/me', 'Customer · dashboard'], ['/me/orders/RS-1117', 'Customer · order'], ['/me/resumes', 'Customer · my resumes'], ['/me/profile', 'Customer · Job Profile'], ['/me/jobs', 'Customer · applications'], ['/me/ats', 'Customer · ATS & job match'], ['/me/launch', 'Customer · Career Launch'], ['/r/sai-varsha', 'Public resume link'], ['/expert', 'Expert home'], ['/expert/orders', 'Expert orders'], ['/expert/orders/RS-1117', 'Expert workspace · builder'], ['/orders/RS-1117/review', 'Customer · review draft'], ['/expert/earnings', 'Expert earnings'], ['/expert/profile', 'Expert profile · join'], ['/admin', 'Admin · dashboard'], ['/admin/orders', 'Admin · orders'], ['/admin/experts?tab=applications', 'Admin · expert applications'], ['/admin/payments?tab=payouts', 'Admin · payouts'], ['/expert/test', 'Expert · test task (sign in as Ravi)'], ['/terms', 'Terms'], ['/privacy', 'Privacy policy'], ['/refund-policy', 'Refund policy'], ['/expert-terms', 'Expert terms'], ['/contact', 'Contact us'],
];

/** Shown only in the shareable preview build: says it's sample data and lets you jump to any screen. */
function PreviewBar() {
  if (LIVE || import.meta.env.VITE_PREVIEW !== '1') return null;
  return <PreviewBarInner />;
}
function PreviewBarInner() {
  const nav = useNavigate();
  const { pathname } = useLocation();
  const { user } = useAuth();
  const current = SCREENS.find(([p]) => p === pathname)?.[0] ?? '';
  return (
    <div role="note" style={{ background: 'var(--signal)', color: 'var(--signalink)', fontSize: 13 }}>
      <div className="container-wide row between g8" style={{ paddingBlock: 6 }}>
        <span><strong>Preview</strong> · sample data, no real payments or AI yet</span>
        <label className="row g8" style={{ fontWeight: 600 }}>
          Signed in as
          <select value={user?.id || ''} onChange={(e) => previewSignIn(e.target.value)} style={{ minHeight: 32, borderRadius: 8, border: '1px solid currentColor', background: 'transparent', color: 'inherit', padding: '0 8px', fontWeight: 600, maxWidth: 200 }}>
            <option value="">Nobody (guest)</option>
            {previewUsers().map((u) => <option key={u.id} value={u.id}>{u.name} · {u.role}{u.role === 'expert' && u.expertStatus !== 'approved' ? ` (${u.expertStatus})` : ''}</option>)}
          </select>
        </label>
        <label className="row g8" style={{ fontWeight: 600 }}>
          Jump to screen
          <select value={current} onChange={(e) => nav(e.target.value)} style={{ minHeight: 32, borderRadius: 8, border: '1px solid currentColor', background: 'transparent', color: 'inherit', padding: '0 8px', fontWeight: 600 }}>
            {!current && <option value="">Choose…</option>}
            {SCREENS.map(([p, l]) => <option key={p} value={p}>{l}</option>)}
          </select>
        </label>
      </div>
    </div>
  );
}

function NotFound() {
  usePageMeta({ title: 'Page not found', description: 'This page doesn’t exist.', noindex: true });
  return (
    <>
      <Header />
      <main id="main" className="container stack g16" style={{ padding: '96px 24px' }}>
        <h1 className="display h2">This page doesn’t exist.</h1>
        <p className="lead">The link may be old. Start with a free resume scan instead.</p>
        <Link to="/" className="btn btn-ink btn-lg" style={{ alignSelf: 'flex-start' }}>Go to home</Link>
      </main>
    </>
  );
}

const Fallback = () => <div className="row g12 muted" role="status" style={{ padding: '96px 24px', justifyContent: 'center' }}><Spinner /> Loading…</div>;

/** "Waking up the server": shown while any API request has been running for more than 3 s (the free plan sleeps
 * when idle and the first request takes up to a minute). */
function ServerWaking() {
  const [slow, setSlow] = useState(false);
  useEffect(() => onSlow(setSlow), []);
  if (!slow) return null;
  return <div role="status" className="small" data-testid="server-waking" style={{ position: 'fixed', left: 12, right: 12, bottom: 12, zIndex: 60, padding: '10px 14px', borderRadius: 12, background: 'var(--ink)', color: 'var(--onink)', textAlign: 'center' }}>Waking up the server — the first request after a quiet spell can take up to a minute. Please keep this page open.</div>;
}

/**
 * Catches anything a page throws while rendering, so the app never goes blank: an old build's missing file shows
 * "Nm7 was just updated" (and reloads once), anything else a short message with a Reload button. Clears itself
 * when the URL changes.
 */
class RouteBoundary extends Component {
  constructor(props) { super(props); this.state = { error: null, key: props.resetKey }; }

  static getDerivedStateFromError(error) { return { error }; }

  static getDerivedStateFromProps(props, state) { return props.resetKey !== state.key ? { error: null, key: props.resetKey } : null; }

  componentDidCatch(error, info) {
    console.error('Page crashed:', error, info?.componentStack);
    if (isChunkError(error)) reloadOnce();
    else reportError(error, { componentStack: info?.componentStack });
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    if (isChunkError(error)) return <StaleBuildPage reloading={false} />;
    return (
      <main className="container stack g12" role="alert" style={{ padding: '96px 24px', maxWidth: 520 }}>
        <h1 className="h3" style={{ margin: 0 }}>Something went wrong on this page.</h1>
        <p className="muted" style={{ margin: 0 }}>Your work is saved as you type. Reloading usually fixes it; if not, write to us from the contact page.</p>
        <div className="row g8">
          <button type="button" className="btn btn-ink" onClick={() => window.location.reload()}>Reload</button>
          <Link to="/" className="btn btn-outline">Go to home</Link>
        </div>
      </main>
    );
  }
}
function Pages({ children }) {
  const { pathname } = useLocation();
  return <RouteBoundary resetKey={pathname}>{children}</RouteBoundary>;
}

export default function App() {
  return (
    <>
      <a href="#main" className="skip-link" onClick={(e) => { if (focusMain()) e.preventDefault(); }}>Skip to content</a>
      <ScrollToTop />
      <RouteFocus />
      <PreviewBar />
      <DownloadGateHost />
      <ServerWaking />
      <Pages>
      <Suspense fallback={<Fallback />}>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/scan" element={<Scan />} />
        <Route path="/checkout" element={<Checkout />} />
        <Route path="/orders/:id" element={<OrderRedirect />} />
        <Route path="/orders/:id/intake" element={C(<Intake />)} />
        <Route path="/orders/:id/refund" element={C(<Refund />)} />
        <Route path="/editor" element={<Editor />} />
        <Route path="/builder" element={<Builder />} />
        <Route path="/expert" element={E(<ExpertHome />)} />
        <Route path="/expert/orders" element={E(<ExpertOrders />)} />
        <Route path="/expert/orders/:id" element={E(<OrderWorkspace />)} />
        <Route path="/expert/snippets" element={E(<Snippets />)} />
        <Route path="/expert/performance" element={E(<Performance />)} />
        <Route path="/expert/help" element={E(<ExpertHelp />, false)} />
        <Route path="/orders/:id/review" element={C(<DraftReview />)} />
        <Route path="/expert/earnings" element={E(<Earnings />)} />
        <Route path="/expert/profile" element={E(<ExpertProfile />, false)} />
        <Route path="/expert/test" element={E(<TestTask />, false)} />
        <Route path="/login" element={<Login />} />
        <Route path="/signup" element={<Signup />} />
        <Route path="/forgot-password" element={<ForgotPassword />} />
        <Route path="/admin/login" element={<AdminLogin />} />
        <Route path="/admin/setup" element={<AdminSetup />} />
        <Route path="/terms" element={<Terms />} />
        <Route path="/privacy" element={<Privacy />} />
        <Route path="/refund-policy" element={<RefundPolicy />} />
        <Route path="/delivery-policy" element={<DeliveryPolicy />} />
        <Route path="/expert-terms" element={<ExpertTerms />} />
        <Route path="/contact" element={<Contact />} />
        <Route path="/blog" element={<BlogList />} />
        <Route path="/blog/category/:slug" element={<BlogList />} />
        <Route path="/blog/:slug" element={<BlogPost />} />
        <Route path="/admin" element={<RequireAuth role="admin"><ADMIN.Layout /></RequireAuth>}>
          <Route index element={<ADMIN.Dashboard />} />
          <Route path="orders" element={<ADMIN.Orders />} />
          <Route path="experts" element={<ADMIN.Experts />} />
          <Route path="refunds" element={<ADMIN.Refunds />} />
          <Route path="payments" element={<ADMIN.Payments />} />
          <Route path="customers" element={<ADMIN.Customers />} />
          <Route path="quality" element={<ADMIN.Quality />} />
          <Route path="reports" element={<ADMIN.Reports />} />
          <Route path="settings" element={<ADMIN.Settings />} />
          <Route path="automation" element={<ADMIN.Automation />} />
          <Route path="team" element={<ADMIN.Team />} />
          <Route path="orgs" element={<ADMIN.Orgs />} />
          <Route path="shared-resumes" element={<ADMIN.Shared />} />
          <Route path="plans" element={<ADMIN.Plans />} />
          <Route path="billing-settings" element={<ADMIN.BillingSettings />} />
          <Route path="org-invoices" element={<ADMIN.OrgInvoices />} />
        </Route>
        <Route path="/me" element={C(<MeLayout />)}>
          <Route index element={<MeHome />} />
          <Route path="orders" element={<OrdersList />} />
          <Route path="orders/:id" element={<OrderDetail />} />
          <Route path="messages" element={<MeMessages />} />
          <Route path="profile" element={<MeProfile />} />
          <Route path="resumes" element={<MeResumes />} />
          <Route path="ats" element={<MeAts />} />
          <Route path="covers" element={<MeCovers />} />
          <Route path="jobs" element={<MeJobs />} />
          <Route path="share" element={<MeShare />} />
          <Route path="groups" element={<MeGroups />} />
          <Route path="launch" element={<MeLaunch />} />
          <Route path="payments" element={<MePayments />} />
          <Route path="upgrade" element={<MeUpgrade />} />
          <Route path="settings" element={<MeSettings />} />
          <Route path="help" element={<MeHelp />} />
        </Route>
        <Route path="/r/:slug" element={<ShareRoute />} />
        <Route path="/join/:code" element={<Join />} />
        <Route path="/groups/stop" element={<StopReminders />} />
        <Route path="/org/invite/:token" element={<OrgInvite />} />
        <Route path="/for-orgs" element={<ForOrgs />} />
        <Route path="/org" element={C(<OrgHome />)} />
        <Route path="/org/:orgId" element={C(<PortalLayout />)}>
          <Route index element={<PortalGroups />} />
          <Route path="resumes" element={<PortalResumes />} />
          <Route path="groups/:groupId" element={<PortalDashboard />} />
          <Route path="kiosks" element={<PortalKiosks />} />
          <Route path="branding" element={<PortalBranding />} />
          <Route path="recruiters" element={<PortalRecruiters />} />
          <Route path="billing" element={<PortalBilling />} />
          <Route path="team" element={<PortalTeam />} />
          <Route path="activity" element={<PortalActivity />} />
        </Route>
        <Route path="/kiosk/:token" element={<KioskScreen />} />
        <Route path="/continue" element={<ContinueHere />} />
        <Route path="*" element={<NotFound />} />
      </Routes>
      </Suspense>
      </Pages>
    </>
  );
}
