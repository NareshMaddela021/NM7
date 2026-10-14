// Page <title> and meta description per route (issue: every page had the home page's title).
import { useEffect } from 'react';

const SITE = 'Nm7';
const DEFAULT_DESC = 'Free ATS resume scan in seconds. Fix it in our builder with ATS-safe templates, or get a verified expert rewrite.';

/** [path pattern, title, description] — first match wins. */
export const ROUTE_META = [
  [/^\/$/, 'Free ATS Resume Scan, Builder & Expert Rewrite', DEFAULT_DESC],
  [/^\/scan/, 'Your ATS scan report', 'See how applicant tracking systems read your resume and what to fix first.'],
  [/^\/builder/, 'Resume builder', 'Build an ATS-safe resume with live preview, then download PDF or Word.'],
  [/^\/editor/, 'Resume editor', 'Edit your scanned resume in the builder.'],
  [/^\/checkout/, 'Checkout', 'Pay securely for your resume service.'],
  [/^\/login/, 'Sign in', 'Sign in to track orders, edit resumes and chat with your expert.'],
  [/^\/signup/, 'Create your account', 'Create a free Nm7 account.'],
  [/^\/forgot-password/, 'Reset your password', 'Get a code by email to set a new password.'],
  [/^\/admin\/setup/, 'Admin setup', 'One-time owner setup.'],
  [/^\/admin/, 'Admin console', 'Nm7 admin console.'],
  [/^\/me\/orders/, 'My orders', 'Your orders, their status and invoices.'],
  [/^\/me\/resumes/, 'My resumes', 'All your resumes and their versions.'],
  [/^\/me\/jobs/, 'My applications', 'Track every job you apply to.'],
  [/^\/me\/covers/, 'Cover letters', 'Your cover letters.'],
  [/^\/me\/ats/, 'ATS & job match', 'Check your resume against a job post.'],
  [/^\/me\/share/, 'Share link', 'One link that always shows your latest resume.'],
  [/^\/me\/payments/, 'Payments & refunds', 'Your payments, refunds and GST invoices.'],
  [/^\/me\/settings/, 'Profile & settings', 'Your profile, notifications, password and privacy.'],
  [/^\/me\/help/, 'Help & referral', 'Questions, support and your referral link.'],
  [/^\/me/, 'My dashboard', 'Your resumes, orders and applications in one place.'],
  [/^\/expert/, 'Expert workspace', 'Nm7 expert workspace.'],
  [/^\/orders\/[^/]+\/intake/, 'Tell your expert about your goals', 'Four quick questions for your resume expert.'],
  [/^\/orders\/[^/]+\/refund/, 'Ask for a refund', 'Refund request for your order.'],
  [/^\/orders\/[^/]+\/review/, 'Review your draft', 'Review the draft from your resume expert.'],
  [/^\/r\//, 'Resume', 'A resume shared via Nm7.'],
  [/^\/terms/, 'Terms of service', 'The terms for using Nm7.'],
  [/^\/privacy/, 'Privacy policy', 'How Nm7 collects, uses and protects your data.'],
  [/^\/refund-policy/, 'Refund & cancellation policy', 'When and how Nm7 refunds orders.'],
  [/^\/delivery-policy/, 'Delivery policy', 'How and when Nm7 delivers your resume.'],
  [/^\/expert-terms/, 'Expert terms', 'Terms for resume experts working with Nm7.'],
  [/^\/contact/, 'Contact us', 'How to reach Nm7.'],
];

const PRIVATE = /^\/(me|admin|expert|orders|checkout|login|signup|forgot-password|r\/)/;

function setMeta(name, content) {
  let el = document.head.querySelector(`meta[name="${name}"]`);
  if (!el) { el = document.createElement('meta'); el.setAttribute('name', name); document.head.appendChild(el); }
  el.setAttribute('content', content);
}

export function applyMeta({ title, description = DEFAULT_DESC, noindex = false, path = '/' }) {
  document.title = path === '/' ? `${title} | ${SITE}` : `${title} · ${SITE}`;
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

/** For pages that know better than the route table (e.g. the 404 page). */
export function usePageMeta(meta) {
  useEffect(() => { applyMeta({ path: window.location.pathname, ...meta }); }, [meta.title, meta.description]); // eslint-disable-line react-hooks/exhaustive-deps
}
