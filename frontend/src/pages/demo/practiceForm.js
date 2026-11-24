// The practice apply pages for the Chrome Web Store review of the Nm7 Apply helper (/demo/apply/:slug,
// PracticeApply.jsx): a made-up company's form. The labels are the plain words the helper's field map knows
// (extension/src/fieldmap.js); frontend/scripts/extension-helper.test.mjs checks the helper fills every one.
// The same two jobs (slug and title) are in backend/app/core/reviewer.py PRACTICE.

export const COMPANY = 'Demo Tech Solutions';

export const JOBS = {
  'junior-data-analyst': { title: 'Junior Data Analyst', place: 'Pune · Full time · Freshers welcome' },
  'customer-support-executive': { title: 'Customer Support Executive', place: 'Pune · Full time · Freshers welcome' },
};

// [name, label, type, autocomplete, required]
export const FIELDS = [
  ['full_name', 'Full name', 'text', 'name', true],
  ['email', 'Email', 'email', 'email', true],
  ['phone', 'Phone number', 'tel', 'tel', true],
  ['city', 'City', 'text', 'address-level2', false],
  ['linkedin', 'LinkedIn profile', 'url', 'url', false],
  ['notice_period', 'Notice period', 'text', 'off', false],
  ['degree', 'Degree', 'text', 'off', false],
  ['resume', 'Resume (PDF)', 'file', '', true],
  ['cover_note', 'Cover note', 'textarea', 'off', false],
];

export const SENT_TEXT = 'Practice form: nothing was sent.';

/** The form's submit: it stays on this page and sends nothing (no request of any kind). */
export function practiceSubmit(e, done) {
  e.preventDefault();
  done(true);
}
