// Page <title> and meta description per route (issue: every page had the home page's title).
import { useEffect } from 'react';

const SITE = 'Nm7';
const DEFAULT_DESC = 'Free ATS resume scan in seconds. Fix it in our builder with ATS-safe templates, or get a verified expert rewrite.';

/** [path pattern, title, description] — first match wins. */
export const ROUTE_META = [
  [/^\/$/, 'Nm7 — Resume builder for every job seeker, resume drives for every campus', 'Build a job-ready resume free — from photos, your own words or an old file, in 8 Indian languages. Colleges and job fairs run whole resume drives on Nm7: approvals, kiosks, printing and GST invoices.'],
  [/^\/scan/, 'Your ATS scan report', 'See how applicant tracking systems read your resume and what to fix first.'],
  [/^\/for-orgs/, 'Nm7 for Organizations — plans for colleges, institutes and job fairs', 'Collect consent-based, ATS-safe resumes from your students or candidates, approve, print and share them with recruiters. Free plan, Drive and Campus plans.'],
  [/^\/partners/, 'Nm7 partner programme — earn by bringing colleges and job fairs', 'Refer colleges, training institutes and job fairs to Nm7 for Organizations and earn commission on their plans. Apply in a minute.'],
  [/^\/partner(\/|$)/, 'Your partner page', 'Your Nm7 partner code, link, referred organizations and commission.'],
  [/^\/builder/, 'Resume builder', 'Build an ATS-safe resume with live preview, then download PDF or Word.'],
  [/^\/editor/, 'Resume editor', 'Edit your scanned resume in the builder.'],
  [/^\/checkout/, 'Checkout', 'Pay securely for your resume service.'],
  [/^\/login/, 'Sign in', 'Sign in to track orders, edit resumes and chat with your expert.'],
  [/^\/signup/, 'Create your account', 'Create a free Nm7 account.'],
  [/^\/forgot-password/, 'Reset your password', 'Get a code by email to set a new password.'],
  [/^\/admin\/setup/, 'Admin setup', 'One-time owner setup.'],
  [/^\/admin\/login/, 'Admin sign in', 'Nm7 admin console.'],
  [/^\/admin\/orders/, 'Orders · Admin', 'Nm7 admin console.'],
  [/^\/admin\/experts/, 'Experts · Admin', 'Nm7 admin console.'],
  [/^\/admin\/refunds/, 'Refunds & disputes · Admin', 'Nm7 admin console.'],
  [/^\/admin\/payments/, 'Payments & invoices · Admin', 'Nm7 admin console.'],
  [/^\/admin\/customers/, 'Customers & support · Admin', 'Nm7 admin console.'],
  [/^\/admin\/quality/, 'Quality · Admin', 'Nm7 admin console.'],
  [/^\/admin\/reports/, 'Reports · Admin', 'Nm7 admin console.'],
  [/^\/admin\/settings/, 'Settings & prices · Admin', 'Nm7 admin console.'],
  [/^\/admin\/automation/, 'Automation · Admin', 'Nm7 admin console.'],
  [/^\/admin\/team/, 'Team & audit log · Admin', 'Nm7 admin console.'],
  [/^\/admin\/orgs/, 'Organizations · Admin', 'Nm7 admin console.'],
  [/^\/admin\/shared-resumes/, 'Shared resumes · Admin', 'Nm7 admin console.'],
  [/^\/admin\/plans/, 'Organization plans · Admin', 'Nm7 admin console.'],
  [/^\/admin\/billing-settings/, 'Billing settings · Admin', 'Nm7 admin console.'],
  [/^\/admin\/org-invoices/, 'Organization invoices · Admin', 'Nm7 admin console.'],
  [/^\/admin\/partners/, 'Partners · Admin', 'Nm7 admin console.'],
  [/^\/admin\/?$/, 'Dashboard · Admin', 'Nm7 admin console.'],
  [/^\/admin/, 'Admin console', 'Nm7 admin console.'],
  [/^\/me\/orders/, 'My orders', 'Your orders, their status and invoices.'],
  [/^\/me\/resumes/, 'My resumes', 'All your resumes and their versions.'],
  [/^\/me\/profile/, 'Job Profile', 'Your master career record: fill it once, reuse it in every resume.'],
  [/^\/me\/jobs/, 'My applications', 'Track every job you apply to.'],
  [/^\/me\/covers/, 'Cover letters', 'Your cover letters.'],
  [/^\/me\/ats/, 'ATS & job match', 'Check your resume against a job post.'],
  [/^\/me\/share/, 'Share link', 'One link that always shows your latest resume.'],
  [/^\/me\/payments/, 'Payments & refunds', 'Your payments, refunds and GST invoices.'],
  [/^\/me\/settings/, 'Profile & settings', 'Your account, notifications, password and privacy.'],
  [/^\/me\/messages/, 'Messages', 'Messages with your resume expert.'],
  [/^\/me\/launch/, 'Career Launch', 'Your Career Launch extras.'],
  [/^\/me\/upgrade/, 'Upgrade & add-ons', 'Upgrade your plan or add extras.'],
  [/^\/me\/help/, 'Help & referral', 'Questions, support and your referral link.'],
  [/^\/me/, 'My dashboard', 'Your resumes, orders and applications in one place.'],
  [/^\/expert(\/|$)/, 'Expert workspace', 'Nm7 expert workspace.'],
  [/^\/orders\/[^/]+\/intake/, 'Tell your expert about your goals', 'Four quick questions for your resume expert.'],
  [/^\/orders\/[^/]+\/refund/, 'Ask for a refund', 'Refund request for your order.'],
  [/^\/orders\/[^/]+\/review/, 'Review your draft', 'Review the draft from your resume expert.'],
  [/^\/r\//, 'Resume', 'A resume shared via Nm7.'],
  [/^\/org\/invite\//, 'Organization invite', 'Accept your invite to run resume drives on Nm7.'],
  [/^\/org(\/|$)/, 'My organization', 'Run your organization’s resume drive on Nm7.'],
  [/^\/join\//, 'Join a group', 'Share your resume with your organization for printing and placement support.'],
  [/^\/groups\/stop/, 'Reminders stopped', 'Stop reminder emails from a group.'],
  [/^\/kiosk\//, 'Kiosk', 'Build and print your resume at this event.'],
  [/^\/continue/, 'Continue your resume', 'Keep working on the resume you started at an event kiosk.'],
  [/^\/terms/, 'Terms of service', 'The terms for using Nm7.'],
  [/^\/privacy/, 'Privacy policy', 'How Nm7 collects, uses and protects your data.'],
  [/^\/refund-policy/, 'Refund & cancellation policy', 'When and how Nm7 refunds orders.'],
  [/^\/delivery-policy/, 'Delivery policy', 'How and when Nm7 delivers your resume.'],
  [/^\/expert-terms/, 'Expert terms', 'Terms for resume experts working with Nm7.'],
  [/^\/contact/, 'Contact us', 'How to reach Nm7.'],
  [/^\/blog(\/|$)/, 'Resume & job-search blog', 'Practical resume, ATS and interview advice for India from the Nm7 team.'],
];

// whole path segments only: /expert-terms is a public page, /expert/orders is not
const PRIVATE = /^\/(me|admin|expert|orders|checkout|login|signup|forgot-password|r|org|join|groups|kiosk|continue|partner)(\/|$)/;

function setMeta(name, content) {
  let el = document.head.querySelector(`meta[name="${name}"]`);
  if (!el) { el = document.createElement('meta'); el.setAttribute('name', name); document.head.appendChild(el); }
  el.setAttribute('content', content);
}

export function applyMeta({ title, description = DEFAULT_DESC, noindex = false, path = '/' }) {
  document.title = path === '/' ? title : `${title} · ${SITE}`; // the home title already starts with the name
  setMeta('description', description);
  setMeta('robots', noindex ? 'noindex, nofollow' : 'index, follow');
  const canonical = document.head.querySelector('link[rel="canonical"]');
  if (canonical) canonical.setAttribute('href', `https://nm7.si${path}`);
}

/** The title and description for a path (unknown paths: "Page not found", not indexed). */
export function metaFor(path) {
  const m = ROUTE_META.find(([re]) => re.test(path));
  return m ? { title: m[1], description: m[2], noindex: PRIVATE.test(path), path } : { title: 'Page not found', description: 'This page doesn’t exist.', noindex: true, path };
}

// A page that knows better than the route table (the 404 page, a page in a special state) sets its own meta;
// it wins over the route table for as long as that page is shown, whichever effect runs last.
let override = null;
/** The meta for a path: a page's own override when it is showing, else the route table. */
export const currentMeta = (path) => (override && override.path === path ? override.meta : metaFor(path));
export function usePageMeta(meta) {
  useEffect(() => {
    const path = window.location.pathname;
    const mine = { path, meta: { ...meta, path } };
    override = mine;
    applyMeta(mine.meta);
    return () => { if (override === mine) { override = null; applyMeta(metaFor(window.location.pathname)); } };
  }, [meta.title, meta.description]); // eslint-disable-line react-hooks/exhaustive-deps
}
