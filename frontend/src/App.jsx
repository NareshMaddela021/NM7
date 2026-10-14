import { useEffect } from 'react';
import { Link, Navigate, Route, Routes, useLocation, useNavigate, useParams } from 'react-router-dom';
import Header from './components/Header';
import Home from './pages/Home';
import Scan from './pages/Scan';
import Checkout from './pages/Checkout';
import Intake from './pages/Intake';
import Refund from './pages/Refund';
import Editor from './pages/Editor';
import Builder from './pages/Builder';
import ExpertHome from './pages/expert/ExpertHome';
import ExpertOrders from './pages/expert/ExpertOrders';
import OrderWorkspace from './pages/expert/OrderWorkspace';
import Snippets from './pages/expert/Snippets';
import Performance from './pages/expert/Performance';
import ExpertHelp from './pages/expert/Help';
import DraftReview from './pages/DraftReview';
import Earnings from './pages/expert/Earnings';
import ExpertProfile from './pages/expert/Profile';
import AdminLayout from './pages/admin/AdminLayout';
import Dashboard from './pages/admin/Dashboard';
import AdminOrders from './pages/admin/Orders';
import ExpertsAdmin from './pages/admin/ExpertsAdmin';
import Refunds from './pages/admin/Refunds';
import Payments from './pages/admin/Payments';
import Customers from './pages/admin/Customers';
import Quality from './pages/admin/Quality';
import Reports from './pages/admin/Reports';
import AdminSettings from './pages/admin/Settings';
import Automation from './pages/admin/Automation';
import Team from './pages/admin/Team';
import MeLayout from './pages/me/MeLayout';
import MeHome from './pages/me/MeHome';
import { OrdersList, OrderDetail } from './pages/me/MeOrders';
import MeMessages from './pages/me/MeMessages';
import MeResumes from './pages/me/MeResumes';
import MeAts from './pages/me/MeAts';
import MeCovers from './pages/me/MeCovers';
import MeJobs from './pages/me/MeJobs';
import MeShare, { PublicResume } from './pages/me/MeShare';
import MeLaunch from './pages/me/MeLaunch';
import { MePayments, MeUpgrade } from './pages/me/MeMoney';
import { MeSettings, MeHelp } from './pages/me/MeSettings';
import { Login, Signup, ForgotPassword, AdminLogin, AdminSetup, RequireAuth } from './pages/auth/Auth';
import { Terms, Privacy, RefundPolicy, DeliveryPolicy, ExpertTerms, Contact } from './pages/legal/Legal';
import TestTask from './pages/expert/TestTask';
import { useAuth, previewSignIn, previewUsers } from './lib/auth';
import { keyFor, BLANK } from './lib/expert';
import { seedPreviewExpert } from './lib/expertTest';

if (import.meta.env.VITE_PREVIEW === '1') seedPreviewExpert(keyFor, BLANK);

/** Old tracking links (/orders/RS-…) now open the order in the dashboard. */
function OrderRedirect() {
  const { id } = useParams();
  const { state } = useLocation();
  return <Navigate to={`/me/orders/${id}`} state={state} replace />;
}
const C = (el) => <RequireAuth role="customer">{el}</RequireAuth>;
const E = (el, approved = true) => <RequireAuth role="expert" approved={approved}>{el}</RequireAuth>;

function ScrollToTop() {
  const { pathname, hash } = useLocation();
  useEffect(() => {
    if (hash) document.getElementById(hash.slice(1))?.scrollIntoView();
    else window.scrollTo(0, 0);
  }, [pathname, hash]);
  return null;
}

const SCREENS = [
  ['/', 'Home · free scan'], ['/scan', 'Scan report'], ['/checkout', 'Checkout'], 
  ['/login', 'Sign in'], ['/signup', 'Sign up'], ['/admin/login', 'Admin login (two-step)'], ['/orders/RS-1117/intake', 'Intake questions'], ['/orders/RS-1117/refund', 'Refund request'], ['/editor', 'Editor'],
  ['/builder', 'Resume builder'], ['/me', 'Customer · dashboard'], ['/me/orders/RS-1117', 'Customer · order'], ['/me/resumes', 'Customer · my resumes'], ['/me/jobs', 'Customer · applications'], ['/me/ats', 'Customer · ATS & job match'], ['/me/launch', 'Customer · Career Launch'], ['/r/sai-varsha', 'Public resume link'], ['/expert', 'Expert home'], ['/expert/orders', 'Expert orders'], ['/expert/orders/RS-1117', 'Expert workspace · builder'], ['/orders/RS-1117/review', 'Customer · review draft'], ['/expert/earnings', 'Expert earnings'], ['/expert/profile', 'Expert profile · join'], ['/admin', 'Admin · dashboard'], ['/admin/orders', 'Admin · orders'], ['/admin/experts?tab=applications', 'Admin · expert applications'], ['/admin/payments?tab=payouts', 'Admin · payouts'], ['/expert/test', 'Expert · test task (sign in as Ravi)'], ['/terms', 'Terms'], ['/privacy', 'Privacy policy'], ['/refund-policy', 'Refund policy'], ['/expert-terms', 'Expert terms'], ['/contact', 'Contact us'],
];

/** Shown only in the shareable preview build: says it's sample data and lets you jump to any screen. */
function PreviewBar() {
  const nav = useNavigate();
  const { pathname } = useLocation();
  const { user } = useAuth();
  if (import.meta.env.VITE_PREVIEW !== '1') return null;
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
  return (
    <>
      <Header />
      <main className="container stack g16" style={{ padding: '96px 24px' }}>
        <h1 className="display h2">This page doesn’t exist.</h1>
        <p className="lead">The link may be old. Start with a free resume scan instead.</p>
        <Link to="/" className="btn btn-ink btn-lg" style={{ alignSelf: 'flex-start' }}>Go to home</Link>
      </main>
    </>
  );
}

export default function App() {
  return (
    <>
      <ScrollToTop />
      <PreviewBar />
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
        <Route path="/admin" element={<RequireAuth role="admin"><AdminLayout /></RequireAuth>}>
          <Route index element={<Dashboard />} />
          <Route path="orders" element={<AdminOrders />} />
          <Route path="experts" element={<ExpertsAdmin />} />
          <Route path="refunds" element={<Refunds />} />
          <Route path="payments" element={<Payments />} />
          <Route path="customers" element={<Customers />} />
          <Route path="quality" element={<Quality />} />
          <Route path="reports" element={<Reports />} />
          <Route path="settings" element={<AdminSettings />} />
          <Route path="automation" element={<Automation />} />
          <Route path="team" element={<Team />} />
        </Route>
        <Route path="/me" element={C(<MeLayout />)}>
          <Route index element={<MeHome />} />
          <Route path="orders" element={<OrdersList />} />
          <Route path="orders/:id" element={<OrderDetail />} />
          <Route path="messages" element={<MeMessages />} />
          <Route path="resumes" element={<MeResumes />} />
          <Route path="ats" element={<MeAts />} />
          <Route path="covers" element={<MeCovers />} />
          <Route path="jobs" element={<MeJobs />} />
          <Route path="share" element={<MeShare />} />
          <Route path="launch" element={<MeLaunch />} />
          <Route path="payments" element={<MePayments />} />
          <Route path="upgrade" element={<MeUpgrade />} />
          <Route path="settings" element={<MeSettings />} />
          <Route path="help" element={<MeHelp />} />
        </Route>
        <Route path="/r/:slug" element={<PublicResume />} />
        <Route path="*" element={<NotFound />} />
      </Routes>
    </>
  );
}
