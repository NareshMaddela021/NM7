// The words and links of the new home page (/new-home). Every link goes to a real page; FAQ
// answers are the site's own (the same strings as the current home page, /for-orgs, /for-companies and the terms).
// No testimonials, client logos or invented numbers: the only numbers shown come from the live jobs API.
import { translate } from '../../lib/i18n';
import { PROMISES } from '../../lib/pricing';
import { TEMPLATE_COUNT } from '../home/templateMeta';

/** The small brand line above the hero headline (Naresh's choice). To change it, change it here, in this one place. */
export const TAGLINE = 'Blink-it for hiring';
/** The hero headline (the same for every tab; each tab has its own line under it). */
export const HERO_HEADLINE = 'Hire in 60 minutes. Get hired fast.';
/** The company promise, in minutes: the timeline runs from minute 0 to this. */
export const HIRE_MINUTES = 60;

/** The four audiences, in tab order. `key` is the ?for= value in the address bar. */
export const AUDIENCES = [
  {
    key: 'company', who: 'For companies', tab: 'I’m a company', shape: 'stopwatch',
    headline: `Hire any role in ${HIRE_MINUTES} minutes`,
    sub: 'Post a job, get a ranked shortlist at once, book interviews and send the offer, all in one place.',
    cta: { label: 'Post a job free', to: '/for-companies' },
  },
  {
    key: 'college', who: 'For colleges', tab: 'I’m a college', shape: 'college',
    headline: 'Place every student, track every step',
    sub: 'Run placement and resume drives, see every student’s progress and invite verified companies.',
    cta: { label: 'Partner with Nm7', to: '/for-orgs' },
  },
  {
    key: 'seeker', who: 'For job seekers', tab: 'I’m a job seeker', shape: 'briefcase',
    headline: 'Get hired fast, at any experience level',
    sub: 'Freshers to 15+ years. Real jobs, a resume that gets read, and help from the first search to your first 90 days.',
    cta: { label: 'Find a job', to: '/jobs' },
  },
  {
    key: 'student', who: 'For students', tab: 'I’m a student', shape: 'cap',
    headline: 'From classroom to your first job',
    sub: 'Build your resume, find internships and live projects, and get your skills verified, free.',
    cta: { label: 'Start free', to: '/signup' },
  },
];
export const DEFAULT_AUDIENCE = 'seeker';
export const audienceFor = (key) => AUDIENCES.find((a) => a.key === key) || AUDIENCES.find((a) => a.key === DEFAULT_AUDIENCE);

/**
 * The glass widget for an audience: { big, unit, row, lines } or null while the live numbers are loading.
 * live = { total, today, city } from the jobs API, or { failed: true }. Numbers appear only when they are real.
 * lines: the sentence that types in, as [[text, bright], …] parts per line.
 */
export function widgetFor(key, live) {
  if (key === 'company') {
    return { icon: 'stopwatch', big: String(HIRE_MINUTES), unit: 'min', label: 'from post to hire', row: ['Minute 0: post the role', 'shortlist in minutes', `hired by minute ${HIRE_MINUTES}`],
      lines: [[['Minute 0: ', false], ['post a role', true], [', get a ranked shortlist.', false]], [[`By minute ${HIRE_MINUTES}: `, false], ['interviews', true], [' booked, ', false], ['offer', true], [' sent.', false]]] };
  }
  if (key === 'college') {
    return { icon: 'college', big: 'Drive', unit: 'day', label: 'placements, start to finish', row: ['Run a placement drive', 'resumes ready', 'invite verified companies'],
      lines: [[['Every student’s ', false], ['resume ready', true], [' before drive day.', false]], [['Invite ', false], ['verified companies', true], [' and track each step.', false]]] };
  }
  if (key === 'student') {
    return { icon: 'cap', big: 'Free', unit: '', label: 'resume builder', row: ['Build your resume', 'find internships', 'get skills verified'],
      lines: [[['Build a ', false], ['resume', true], [', find ', false], ['internships', true], ['.', false]], [['Get your ', false], ['skills verified', true], [' with a certificate.', false]]] };
  }
  // job seekers: the live board
  if (!live) return null;
  if (live.failed || !Number.isFinite(live.total)) {
    return { icon: 'briefcase', big: 'Live', unit: '', label: 'jobs from company careers pages and verified companies', row: ['Internships', 'freshers', 'up to 15+ years'],
      lines: [[['Real jobs', true], [' from company careers pages.', false]], [['Applying is ', false], ['free', true], ['.', false]]] };
  }
  const n = live.total.toLocaleString('en-IN');
  const row = [`${live.today.toLocaleString('en-IN')} new today`];
  if (live.city) row.push(`top city ${live.city}`);
  return { icon: 'briefcase', big: n, unit: '', label: live.total === 1 ? 'job live now' : 'jobs live now', row,
    lines: [[[`${n} jobs`, true], [' live right now,', false]], [[`${live.today.toLocaleString('en-IN')} new`, true], [' today', false], ...(live.city ? [[' · most in ', false], [live.city, true]] : [])]] };
}

/** One section per audience: the shape it shows, and its cards (each links to the real feature). */
export const SECTIONS = [
  {
    key: 'company', id: 'companies', kicker: 'For companies', title: `Hire any role in ${HIRE_MINUTES} minutes`, shape: 'stopwatch',
    flow: ['Post', 'Instant shortlist', 'Invite', 'Interviews booked', 'Offer'], // the timeline, minute 0 → HIRE_MINUTES
    cards: [
      { title: `The ${HIRE_MINUTES}-minute flow`, text: 'Post a role and get a ranked shortlist at once. Invite people, they book interview slots, and you send the offer from the same screen.', to: '/for-companies', link: 'Post a job free' },
      { title: 'Bulk hiring and walk-in drives', text: 'Hiring 20 to 500 people for one role? Bigger shortlists, invites up to 100 at a time, batch offers, and a walk-in day with QR check-in.', to: '/for-companies', link: 'Start hiring' },
      { title: 'Verified company badge', text: 'Our team checks each company by hand, usually within 2 working days. Verified companies post more jobs, and candidates see the badge.', to: '/for-companies', link: 'Get verified' },
      { title: 'Plans', text: 'Verified companies post jobs free. Sign up in 5 steps: email check, GSTIN or CIN, your team.', to: '/for-companies', link: 'See how it works' },
    ],
  },
  {
    key: 'college', id: 'colleges', kicker: 'For colleges', title: 'Place every student, track every step', shape: 'college',
    cards: [
      { title: 'Placement and resume drives', text: 'Students build ATS-safe resumes and share them with you, with their consent. Approve, remind, print and export them from one table.', to: '/for-orgs', link: 'Run a drive' },
      { title: 'Student progress tracking', text: 'See who has a ready resume, who applied, who reached an interview and who got an offer.', to: '/for-orgs', link: 'See the dashboard' },
      { title: 'Invite verified companies', text: 'Share shortlists with recruiters through a private link, and collect their feedback in one place.', to: '/for-orgs', link: 'Invite recruiters' },
      { title: 'Drive-day kiosk', text: 'Students build and print their resume at a kiosk on the day of your event.', to: '/for-orgs', link: 'Set up a kiosk' },
      { title: 'Reports', text: 'Placement reports and exports for your management, with every view, print and export logged.', to: '/for-orgs', link: 'See plans' },
    ],
  },
  {
    key: 'seeker', id: 'job-seekers', kicker: 'For job seekers', title: 'Support all the way round, 360°', shape: 'briefcase',
    journey: [
      { step: 'Discover', text: 'Ten simple questions suggest three roles that fit you.', to: '/me/roles', shape: 'magnifier' },
      { step: 'Learn', text: 'Free courses and a small project for each role.', to: '/me/learn', shape: 'magnifier' },
      { step: 'Prove', text: 'A 10-minute skill check. Pass it to get “Skill verified”.', to: '/me/skill-checks', shape: 'badge' },
      { step: 'Resume', text: 'An ATS-safe resume from photos, your own words or an old file.', to: '/builder', shape: 'resume' },
      { step: 'Apply', text: 'Real jobs from 0 to 15+ years, filtered by city and experience.', to: '/jobs', shape: 'briefcase' },
      { step: 'Interview', text: 'Practice questions from your own resume, with feedback.', to: '/me/practice', shape: 'resume' },
      { step: 'Offer', text: 'Check an offer letter for fees, bonds and missing basics.', to: '/me/offer-check', shape: 'badge' },
      { step: 'First 90 days', text: 'Real numbers from your week, and help in your new job.', to: '/me/progress', shape: 'handshake' },
    ],
    cards: [
      { title: 'Auto Apply', text: 'Every morning Nm7 applies for you to new jobs that fit your rules. Manual Apply always works too.', to: '/me/auto-apply', link: 'Turn on Auto Apply' },
      { title: 'Offer checker', text: 'Free. Spot fees, bonds and missing basics, and compare offers side by side.', to: '/me/offer-check', link: 'Check an offer' },
      { title: 'Every experience level', text: 'Internships, freshers, 1–3, 3–5, 5–8 and 8+ years: filter jobs by your level.', to: '/jobs', link: 'Browse jobs' },
    ],
  },
  {
    key: 'student', id: 'students', kicker: 'For students', title: 'From classroom to your first job', shape: 'cap',
    cards: [
      { title: 'Internships and live projects', text: 'Real work from verified companies. Free to apply; you never pay. Finish one to get a certificate anyone can check.', to: '/me/programs', link: 'Find internships' },
      { title: 'Practice tests', text: 'Free and unlimited. See why after every answer.', to: '/me/practice', link: 'Practise now' },
      { title: 'Skill checks and certificates', text: 'Take the official skill check, and keep your certificates in one place.', to: '/me/skill-checks', link: 'Take a skill check' },
      { title: 'Free resume builder', text: `${TEMPLATE_COUNT} ATS-safe templates. Start from photos of your papers, your own words or nothing at all.`, to: '/builder', link: 'Build my resume' },
      { title: 'Career Launch', text: 'LinkedIn makeover, cover letter and a 1:1 mentor call with your expert.', to: '/me/launch', link: 'See Career Launch' },
    ],
  },
];

/** The live-jobs chips: [label, query for /api/jobs and /jobs]. Cities come from the API. */
export const JOB_CHIPS = [
  ['Internship', { experience: 'internship' }],
  ['Fresher', { experience: 'fresher' }],
  ['1–3 years', { experience: '1_3' }],
  ['3–5 years', { experience: '3_5' }],
  ['5–8 years', { experience: '5_8' }],
  ['8+ years', { experience: '8_plus' }],
];

export const EXPERIENCE_TEXT = {
  internship: 'Internship', fresher: 'Fresher', '0_1': '0–1 years', '1_3': '1–3 years', '3_5': '3–5 years', '5_8': '5–8 years',
  '8_12': '8–12 years', '12_15': '12–15 years', '15_plus': '15+ years', '3_plus': '3+ years', not_stated: 'Experience not stated',
};

export const TRUST = [
  { title: 'Real jobs', text: 'Jobs come from companies’ own careers pages and from verified companies. Each one shows where it came from.' },
  { title: 'Never pay to apply', text: 'Applying for jobs and internships on Nm7 is free. If anyone asks you to pay for a job, report the job.' },
  { title: 'Verified companies', text: 'Our team checks each company by hand before it can post more jobs, and shows the verified badge.' },
  { title: 'Fake-offer checker', text: 'Check an offer letter for fees, bonds and missing basics before you sign.', to: '/me/offer-check', link: 'Check an offer' },
  { title: 'Help in the first 90 days', text: 'Support after you join: your weekly progress and help with the new job.', to: '/me/progress', link: 'See My progress' },
];

const en = (key, vars) => translate('en', key, vars);
const JOB_REMOVAL = 'Some jobs on Nm7 come from companies’ own careers pages. A company can ask us to remove a job at nm7.si/contact?topic=job-removal; we remove it, usually within 2 working days.';

/** The FAQ, grouped by audience: [group title, [[question, answer], …]]. */
export const FAQ = [
  ['Companies', [
    ['Is posting a job free?', 'Yes. Verified companies post jobs free. Sign up your company in 5 steps: email check, GSTIN or CIN, your team.'],
    ['How do you verify a company?', `${en('co.sub')} ${en('co.done.sub')}`],
    [`What does “Hired in ${HIRE_MINUTES} minutes” mean?`, en('co.pub.hired30Why')],
    ['A job from our careers page is on Nm7. Can you remove it?', JOB_REMOVAL],
  ]],
  ['Colleges', [1, 2, 6].map((i) => [en(`orgs.faq.${i}.q`), en(`orgs.faq.${i}.a`)])],
  ['Job seekers', [
    ['Which jobs are on Nm7?', 'Internships, fresher jobs and experienced roles (0 to 15+ years) in India, by role, skill, company and city. Filter by experience, salary and remote work. Free on Nm7.'],
    [en('faq.seeker.1.q'), en('faq.seeker.1.a', { n: TEMPLATE_COUNT })],
    [en('faq.seeker.7.q'), en('faq.seeker.7.a', { n: PROMISES.retentionDays })],
  ]],
  ['Students', [
    ['Do students pay for internships or projects?', 'No. Students never pay anything. Some internships and projects are unpaid; they are always shown as Unpaid.'],
    [en('faq.seeker.3.q'), en('faq.seeker.3.a')],
    [en('faq.seeker.2.q'), en('faq.seeker.2.a')],
  ]],
];

export const ORIGIN = 'https://nm7.si';
export const META = {
  title: `Nm7 — ${HERO_HEADLINE}`,
  description: `Companies hire any role in ${HIRE_MINUTES} minutes. Job seekers from freshers to 15+ years and college students get 360° support, and colleges run placements, all on Nm7.`,
};

/** Organization + WebSite (with the jobs search box) + FAQPage structured data. */
export function structuredData(origin = ORIGIN) {
  return [
    { '@context': 'https://schema.org', '@type': 'Organization', name: 'Nm7', url: origin, logo: `${origin}/favicon.svg`, description: META.description },
    { '@context': 'https://schema.org', '@type': 'WebSite', name: 'Nm7', url: origin,
      potentialAction: { '@type': 'SearchAction', target: { '@type': 'EntryPoint', urlTemplate: `${origin}/jobs?q={search_term_string}` }, 'query-input': 'required name=search_term_string' } },
    { '@context': 'https://schema.org', '@type': 'FAQPage',
      mainEntity: FAQ.flatMap(([, qs]) => qs).map(([q, a]) => ({ '@type': 'Question', name: q, acceptedAnswer: { '@type': 'Answer', text: a } })) },
  ];
}
