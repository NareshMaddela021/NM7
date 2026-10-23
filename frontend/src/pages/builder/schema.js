// Builder sections, field definitions and starting data.
import { ALL_SKILLS } from './skillNames';
// Fields: [key, label, type, options]; types: text | email | tel | url | month | date | select | area | check | chips
import { migrateEntries } from './entries';

export const EXP_LEVELS = ['Fresher (0–1 yr)', 'Junior (1–3 yrs)', 'Mid (3–6 yrs)', 'Senior (6–10 yrs)', 'Lead/Principal (10+ yrs)'];
const EMP = ['Full-time', 'Part-time', 'Contract', 'Internship', 'Freelance'];
const CERT_ISSUERS = ['AWS', 'Google', 'Microsoft', 'Meta', 'Coursera', 'Udemy', 'NPTEL', 'IIT', 'LinkedIn Learning', 'HackerRank', 'Other'];
const ACH = ['Hackathon', 'Award / Recognition', 'Publication / Paper', 'Patent', 'Open Source Contribution', 'Rank / Leaderboard', 'Scholarship', 'Other'];
const LANG = ['Native', 'Fluent', 'Professional', 'Basic'];
export { ALL_SKILLS }; // in skillNames.js, so the home page's line fixer can use it without the whole schema
// Skills are grouped like a real resume. Each group is a comma-separated list the user types.
export const DEFAULT_SKILL_GROUPS = [
  { id: 'core', label: 'Core Technologies / Languages', ph: 'e.g. Python, SQL, Java, Statistics' },
  { id: 'frameworks', label: 'Frameworks & Libraries', ph: 'e.g. React, Node.js, Pandas, PyTorch' },
  { id: 'tools', label: 'Tools & Platforms', ph: 'e.g. AWS, Git, Docker, Power BI' },
  { id: 'soft', label: 'Soft Skills / Domains', ph: 'e.g. Leadership, Project Management, Agile' },
];
// Which group a suggestion chip goes into.
export const SKILL_GROUP_OF = {
  JavaScript: 'core', TypeScript: 'core', Python: 'core', Java: 'core', 'C++': 'core', Go: 'core', SQL: 'core', 'Machine Learning': 'core', 'Data Analysis': 'core', Statistics: 'core',
  React: 'frameworks', 'Next.js': 'frameworks', 'Node.js': 'frameworks', FastAPI: 'frameworks', Django: 'frameworks', GraphQL: 'frameworks', 'REST API': 'frameworks', Pandas: 'frameworks', PyTorch: 'frameworks', 'Scikit-learn': 'frameworks',
  PostgreSQL: 'tools', MongoDB: 'tools', Redis: 'tools', Docker: 'tools', Kubernetes: 'tools', AWS: 'tools', GCP: 'tools', Azure: 'tools', Git: 'tools', Figma: 'tools', Tableau: 'tools', Excel: 'tools', 'Power BI': 'tools',
  'Product Management': 'soft', 'Agile/Scrum': 'soft', Communication: 'soft', Leadership: 'soft', 'Problem Solving': 'soft',
};
export const splitSkills = (v) => (v || '').split(',').map((s) => s.trim()).filter(Boolean);
export const allSkills = (groups) => groups.flatMap((g) => splitSkills(g.value));

export const PRESET_SECTIONS = ['Volunteering', 'Positions of Responsibility', 'Publications', 'Workshops & Trainings', 'Extracurricular Activities', 'Hobbies & Interests', 'Courses', 'References'];

const f = (key, label, type = 'text', extra = {}) => ({ key, label, type, ...extra });

export const LISTS = {
  exp: { item: 'Experience', blank: { company: '', role: '', employmentType: '', from: '', to: '', current: false, description: '', links: [] }, fields: [
    f('company', 'Company *', 'text', { ph: 'Google India' }), f('role', 'Job title *', 'text', { ph: 'Data Analyst Intern' }),
    f('employmentType', 'Employment type', 'select', { options: EMP }), f('location', 'Location (optional)', 'text', { ph: 'Hybrid - Hyderabad' }), f('from', 'From', 'month'), f('to', 'To', 'month', { disabledBy: 'current' }),
    f('current', 'I currently work here', 'check', { full: true }),
    f('description', 'Responsibilities & achievements', 'area', { full: true, rich: true, ai: 'exp', ph: '• What you did — and what changed because of it' }),
  ] },
  edu: { item: 'Education', blank: { institution: '', degree: '', field: '', from: '', to: '', current: false, grade: '' }, fields: [
    f('institution', 'Institution *', 'text', { full: true, ph: 'IIT Madras / Anna University / school name' }), f('degree', 'Degree *', 'text', { ph: 'B.Tech / MBA / Class 12' }), f('field', 'Field of study / board', 'text', { ph: 'Computer Science / CBSE' }),
    f('from', 'Start', 'month'), f('to', 'End (or expected graduation)', 'month'),
    f('current', 'I’m currently studying here', 'check', { full: true }),
    f('grade', 'Grade / CGPA / %', 'text', { ph: '8.5 CGPA / 85%' }), f('location', 'City (optional)', 'text', { ph: 'Hyderabad' }),
    f('courses', 'Relevant courses (optional)', 'courses', { full: true }),
  ] },
  proj: { item: 'Project', blank: { title: '', tagline: '', type: '', status: '', from: '', to: '', ongoing: false, description: '', tech: '', links: [] }, fields: [
    f('title', 'Project title *', 'text', { full: true }), f('tagline', 'One-line tagline', 'text', { full: true }),
    f('from', 'Start', 'month'), f('to', 'End', 'month', { disabledBy: 'ongoing' }), f('ongoing', 'Still working on it', 'check', { full: true }),
    f('type', 'Project type', 'select', { options: ['Personal / Side Project', 'Open Source', 'Freelance / Client Work', 'Startup / Product', 'Academic / Research', 'Hackathon'] }),
    f('status', 'Status', 'select', { options: ['Live / Production', 'In Development', 'Beta', 'Completed', 'On Hold', 'Archived'] }),
    f('description', 'Description & impact', 'area', { full: true, rich: true, ai: 'proj', ph: 'What you built, for whom, and the result' }),
    f('tech', 'Tech stack', 'text', { full: true, ph: 'React, FastAPI, PostgreSQL (comma-separated)' }),
  ] },
  certs: { item: 'Certification', blank: { name: '', issuer: '', issueDate: '', expiryDate: '', credentialId: '', noExpiry: false, links: [] }, fields: [
    f('name', 'Certification name *', 'text', { full: true, ph: 'AWS Certified Cloud Practitioner' }), f('issuer', 'Issuing organisation', 'select', { options: CERT_ISSUERS }), f('credentialId', 'Credential ID'),
    f('issueDate', 'Issue date', 'month'), f('expiryDate', 'Expiry date', 'month', { disabledBy: 'noExpiry' }), f('noExpiry', 'No expiry / lifetime valid', 'check', { full: true }),
  ] },
  ach: { item: 'Achievement', blank: { title: '', type: '', date: '', issuer: '', description: '', links: [] }, fields: [
    f('title', 'Title *', 'text', { full: true, ph: '1st Place — Smart India Hackathon 2024' }), f('type', 'Type', 'select', { options: ACH }), f('issuer', 'Issuer / organisation'),
    f('date', 'Date', 'month', { full: true }), f('description', 'Description (optional)', 'area', { full: true, rich: true, ai: 'ach' }),
  ] },
  langs: { item: 'Language', blank: { name: '', level: '' }, fields: [f('name', 'Language', 'text', { ph: 'Tamil, Hindi, English' }), f('level', 'Proficiency', 'select', { options: LANG })] },
  custom: { item: 'Entry', blank: { title: '', subtitle: '', date: '', description: '', links: [] }, fields: [
    f('title', 'Title / role', 'text', { ph: 'e.g. NSS Volunteer' }), f('subtitle', 'Organisation / place'), f('date', 'Dates', 'text', { full: true, ph: 'e.g. Aug 2023 – Present' }),
    f('description', 'Details', 'area', { full: true, rich: true, ai: 'custom' }),
  ] },
};

/* ---------- clickable word after a title ("Sales Dashboard | Live Demo") ---------- */
// how many links each kind of entry can have, and quick-tap words. The word is free text — users type anything.
export const LINK_SLOTS = { proj: 2, certs: 1, exp: 1, ach: 1, custom: 1 };
export const LINK_WORDS = {
  proj: ['Link', 'Live Demo', 'GitHub', 'Code', 'Video', 'Case Study'],
  certs: ['Link', 'Verify', 'Certificate', 'Credential'],
  exp: ['Website', 'Link', 'Certificate'],
  ach: ['Link', 'Certificate', 'News', 'Video'],
  custom: ['Link', 'Website', 'Certificate'],
};
export const LINK_WORD_MAX = 20;
/** Moves the old fields (liveUrl, repoUrl, credentialUrl) into links: [{ url, label }]. */
export function migrateLinks(d) {
  const proj = (d.proj || []).map((p) => {
    if (p.links) return p;
    const { liveUrl, repoUrl, ...rest } = p;
    return { ...rest, links: [liveUrl && { url: liveUrl, label: 'Live Demo' }, repoUrl && { url: repoUrl, label: 'GitHub' }].filter(Boolean) };
  });
  const certs = (d.certs || []).map((c) => {
    if (c.links) return c;
    const { credentialUrl, ...rest } = c;
    return { ...rest, links: credentialUrl ? [{ url: credentialUrl, label: 'Link' }] : [] };
  });
  return migrateEntries({ ...d, proj, certs }); // and entry on/off flags (old resumes: everything visible)
}

export const PERSONAL_FIELDS = [
  f('name', 'Full name *', 'text', { full: true }),
  f('headline', 'Headline / target role · optional', 'text', { full: true, ph: 'e.g. Data Analyst · SQL · Power BI' }),
  f('email', 'Email *', 'email'), f('phone', 'Phone *', 'tel'),
  f('location', 'City / location'), f('level', 'Experience level *', 'select', { options: EXP_LEVELS }),
];
// Personal Information section (common on Indian resumes). Blank fields are not printed.
export const PINFO_FIELDS = [
  f('father', "Father's name", 'text', { ph: 'e.g. Sreeramulu B' }), f('mother', "Mother's name", 'text', { ph: 'e.g. Lakshmi Devi B' }),
  f('spouse', "Husband's / wife's name", 'text', { ph: 'Optional' }),
  f('dob', 'Date of birth', 'date'), f('gender', 'Gender', 'select', { options: ['Male', 'Female', 'Other', 'Prefer not to say'] }),
  f('marital', 'Marital status', 'select', { options: ['Single', 'Married', 'Prefer not to say'] }), f('nationality', 'Nationality', 'text', { ph: 'Indian' }),
  f('languages', 'Languages known', 'text', { full: true, ph: 'English, Telugu, Hindi' }),
  f('address', 'Address', 'area', { full: true, ph: '2/87, Polepalli (V), Ramagiri (M), Anantapur (D), Andhra Pradesh – 515101' }),
];
export const PINFO_LABELS = { father: "Father's Name", mother: "Mother's Name", spouse: "Spouse's Name", dob: 'Date of Birth', gender: 'Gender', marital: 'Marital Status', nationality: 'Nationality', languages: 'Languages Known', address: 'Address' };
export const DECL_TEXT = 'I hereby declare that the information given above is true and correct to the best of my knowledge and belief.';
export const DECL_FIELDS = [
  f('text', 'Declaration text', 'area', { full: true }),
  f('place', 'Place', 'text', { ph: 'Leave blank to sign by hand' }), f('date', 'Date', 'text', { ph: 'DD/MM/YYYY or leave blank' }),
  f('name', 'Name under the declaration', 'text', { full: true, ph: 'Your name in capitals — uses your full name if blank' }),
];
export const HOBBY_IDEAS = ['Reading', 'Playing cricket', 'Listening to music', 'Travelling', 'Chess', 'Photography', 'Cooking', 'Drawing', 'Yoga', 'Blogging', 'Volunteering', 'Badminton'];
export const STRENGTH_IDEAS = ['Quick learner', 'Hard working', 'Team player', 'Good communication skills', 'Positive attitude', 'Adaptable', 'Problem solving', 'Time management', 'Self-motivated', 'Leadership'];
// the fields that print as running text and can hold **bold** words (lib/bold.js)
export const RICH_FIELDS = { exp: 'description', proj: 'description', ach: 'description', custom: 'description' };
/** "a, b" or one per line → ['a', 'b'] */
/** A typed value, or '' when it is empty or still a sample placeholder like “[College]”. */
export const real = (v) => { const t = (v ?? '').toString().trim(); return !t || /\[[^\]]*\]/.test(t) ? '' : t; };
export const splitList = (v) => (v || '').split(/\n|,/).map((x) => x.trim().replace(/^[•\-*▸–]\s*/, '')).filter(Boolean);
export const LINK_FIELDS = [
  f('linkedin', 'LinkedIn · optional', 'url', { full: true, ph: 'linkedin.com/in/yourname' }), f('github', 'GitHub · optional', 'url', { full: true, ph: 'github.com/yourusername' }),
  f('portfolio', 'Portfolio / website · optional', 'url', { full: true, ph: 'yourname.dev' }), f('twitter', 'X / Twitter · optional', 'url', { ph: 'x.com/yourhandle' }),
  f('stackoverflow', 'Stack Overflow · optional', 'url', { ph: 'stackoverflow.com/users/…' }), f('medium', 'Blog / Medium · optional', 'url', { ph: 'medium.com/@you' }),
  f('resume', 'Resume / CV link · optional', 'url', { ph: 'Google Drive link' }),
];

export const FIXED_SECTIONS = [
  { id: 'personal', label: 'Personal Info', help: 'How recruiters reach you. Required fields are marked *.' },
  { id: 'summary', label: 'Summary', help: '3–5 sentences: who you are, your strongest skills, one result with a number, and the role you want next.' },
  { id: 'exp', label: 'Experience', help: 'Internships count. Most recent first.', fresherTip: 'No experience yet? Skip this — projects carry your resume.' },
  { id: 'edu', label: 'Education', help: 'Most recent first. Add CGPA if it’s 7+ or 70%+.' },
  { id: 'skills', label: 'Skills', help: 'List skills under matching categories. Separate items with commas. Rename or add categories as you like — only add what you can talk about in an interview.' },
  { id: 'proj', label: 'Projects', help: 'What you built, the tech you used and what changed because of it.' },
  { id: 'certs', label: 'Certifications', help: 'AWS, Google, Microsoft, NPTEL and similar certificates are strong signals for recruiters.' },
  { id: 'ach', label: 'Achievements', help: 'Hackathons, scholarships, ranks, publications, open source — anything you’re proud of.' },
  { id: 'langs', label: 'Languages', help: 'Useful for customer-facing and multi-city roles.' },
  { id: 'hobbies', label: 'Hobbies', help: 'Two to five real hobbies. One per line, or separate with commas. Interviewers often ask about them, so only add ones you can talk about.' },
  { id: 'strengths', label: 'Strengths', help: 'Three to five strengths. One per line, or separate with commas. Back them up in your experience and projects if you can.' },
  { id: 'pinfo', label: 'Personal Information', help: 'Common on Indian resumes for government, PSU and many local employers. Private companies and MNCs usually don’t need it — leaving it off also protects your privacy. Blank fields are not printed.' },
  { id: 'decl', label: 'Declaration', help: 'The closing statement with place, date and your name. Leave place and date blank to fill them in by hand after printing.' },
  { id: 'links', label: 'Links', help: 'All links are optional. LinkedIn and GitHub are the two recruiters click most. Choose how they appear on your resume.' },
];

// Demo AI rewrites — replace with a call to your AI endpoint.
export const AI_SAMPLES = {
  exp: '• Built 6 Power BI dashboards for the sales team, cutting weekly reporting from 5 hours to 30 minutes.\n• Automated cleaning of weekly CSV exports in Python (Pandas), removing 1,200+ duplicate records.',
  proj: '• Designed Power BI dashboards tracking sponsor sales across 40+ sponsors.\n• Modelled raw sales sheets in SQL; insights shifted outreach to the 2 highest-converting sponsor tiers.',
  ach: '• Led a team of 4 to build [project] in 24 hours; placed [rank] among [N] teams.',
  custom: '• [What you did] — [result, with a number if you have one].',
};

export const TEMPLATES = {
  fresher: { name: 'Fresher First', desc: 'Projects before experience. Best with little work history.', font: 'var(--font-body)', accent: '#121316', align: 'left' },
  classic: { name: 'Classic', desc: 'Centered serif header. Safe for banks, consulting, PSU roles.', font: 'var(--font-serif)', accent: '#1A1A1A', align: 'center' },
  modern: { name: 'Modern', desc: 'Clean sans with a blue accent. Tech and startups.', font: 'var(--font-body)', accent: '#2E46D8', align: 'left' },
  compact: { name: 'Compact', desc: 'Tighter spacing to fit more on one page.', font: 'var(--font-body)', accent: '#0E7A52', align: 'left' },
};

export const INITIAL = {
  personal: { name: 'Sai Varsha', headline: 'Data Analyst · SQL · Power BI', email: 'saivarsha@example.com', phone: '+91 98765 43210', location: 'Chennai, Tamil Nadu', level: 'Fresher (0–1 yr)' },
  hobbies: 'Reading\nPlaying chess\nVolunteering at NSS camps',
  strengths: 'Quick learner\nTeam player\nGood communication skills',
  pinfo: { father: 'R. Raman', mother: 'S. Lakshmi', dob: '2003-05-15', gender: '', marital: '', nationality: 'Indian', languages: 'English, Tamil, Hindi', address: '' },
  decl: { text: DECL_TEXT, place: '', date: '', name: '' },
  summary: '',
  exp: [{ company: 'Northwind Retail', role: 'Data Analyst Intern', employmentType: 'Internship', from: '2025-01', to: '2025-06', current: false, description: 'made dashboards in power bi for sales team\ncleaned csv files in python' }],
  edu: [{ institution: 'Lakeview Institute of Technology', degree: 'B.Tech', field: 'Computer Science', from: '2021-08', to: '2025-05', current: false, grade: '8.1 CGPA' }],
  skillGroups: [
    { id: 'core', label: 'Core Technologies / Languages', value: 'Python, SQL, Statistics' },
    { id: 'frameworks', label: 'Frameworks & Libraries', value: 'Pandas, NumPy' },
    { id: 'tools', label: 'Tools & Platforms', value: 'Power BI, Excel, Git' },
    { id: 'soft', label: 'Soft Skills / Domains', value: '' },
  ],
  proj: [{ title: 'Sales Dashboard Revamp', tagline: 'Power BI dashboards for a college fest’s sponsor sales', type: 'Academic / Research', status: 'Completed', from: '2024-08', to: '2024-11', ongoing: false, description: '', tech: 'Power BI, SQL, Excel', links: [{ url: 'github.com/sai-varsha-example/sales-dashboard', label: 'GitHub' }] }],
  certs: [{ name: 'Google Data Analytics Certificate', issuer: 'Google', issueDate: '2024-11', expiryDate: '', credentialId: '', noExpiry: true, links: [] }],
  ach: [{ title: '', type: '', date: '', issuer: '', description: '' }],
  langs: [{ name: 'English', level: 'Fluent' }, { name: 'Tamil', level: 'Native' }, { name: 'Hindi', level: 'Professional' }],
  // legacy: the sample's old job preferences, kept only so sampleData.js recognises them in old saved resumes
  prefs: { jobTypes: ['Full-time', 'Internship'], salary: 'Under ₹5 LPA', notice: 'Immediately', locations: 'Bengaluru, Chennai, Hyderabad', remote: true, relocation: true, industries: ['Technology', 'Finance / Fintech'] },
  links: { linkedin: 'linkedin.com/in/sai-varsha-example', github: 'github.com/sai-varsha-example', portfolio: '', twitter: '', stackoverflow: '', medium: '', resume: '' },
  linkStyle: 'icon', // 'icon' = icon + handle, 'url' = full link
  linkExtras: [], // up to 3 more profile links: [{ url, label, icon: 'auto' | globe | briefcase | code | link | pen }]
  portfolioIcon: 'auto', // auto = platform logo if known (Kaggle, Behance…), else a globe
  portfolioLabel: '', // optional word shown instead of the address, e.g. "Portfolio"
  custom: [],
  order: null, // resume section order; null = default for the experience level
  hidden: { hobbies: true, strengths: true, pinfo: true, decl: true }, // { sectionId: true } = kept in the profile but not printed
  showPhoto: false,
  titles: {}, // renamed section titles, e.g. { exp: 'Work Experience' }
  design: null, // filled from the chosen template (see design.js)
  cover: { company: '', role: '', manager: '', jd: '', body: '', subject: true }, // cover letter (see cover.js)
};

/**
 * A truly empty resume: every field present, nothing filled in. New resumes start from this (with only the
 * account's name, email and phone), and anything loaded is completed with it — never with the sample person
 * (INITIAL is only for "how this template looks when filled" views and demos, and is never saved).
 */
export const EMPTY = {
  personal: { name: '', headline: '', email: '', phone: '', location: '', level: '' },
  hobbies: '', strengths: '',
  pinfo: { father: '', mother: '', dob: '', gender: '', marital: '', nationality: '', languages: '', address: '' },
  decl: { text: DECL_TEXT, place: '', date: '', name: '' },
  summary: '', exp: [], edu: [],
  skillGroups: DEFAULT_SKILL_GROUPS.map((g) => ({ id: g.id, label: g.label, value: '' })),
  proj: [], certs: [], ach: [], langs: [],
  links: { linkedin: '', github: '', portfolio: '', twitter: '', stackoverflow: '', medium: '', resume: '' },
  linkStyle: 'icon', linkExtras: [], portfolioIcon: 'auto', portfolioLabel: '',
  custom: [], order: null, hidden: { hobbies: true, strengths: true, pinfo: true, decl: true }, showPhoto: false, titles: {},
  design: null, cover: { company: '', role: '', manager: '', jd: '', body: '', subject: true },
};
export const emptyResume = () => structuredClone(EMPTY);
/** A stored or imported resume with every field present: missing fields are empty, never the sample's. */
export const completeResume = (d) => migrateLinks({ ...emptyResume(), ...(d || {}) });

/** Which sections have meaningful content (drives ✓ marks and the score). */
export function completeness(d) {
  const has = {
    personal: !!(d.personal.name && d.personal.email && d.personal.phone && d.personal.level), // the required fields
    summary: d.summary.length > 80,
    exp: d.exp.some((e) => e.company && e.role),
    edu: d.edu.some((e) => e.institution && e.degree),
    skills: allSkills(d.skillGroups).length >= 5,
    proj: d.proj.some((p) => p.title),
    certs: d.certs.some((c) => c.name),
    ach: d.ach.some((a) => a.title),
    langs: d.langs.some((l) => l.name),
    hobbies: splitList(d.hobbies).length > 0,
    strengths: splitList(d.strengths).length > 0,
    pinfo: Object.values(d.pinfo || {}).some(Boolean),
    decl: !!d.decl?.text,
    links: Object.values(d.links).some(Boolean) || (d.linkExtras || []).some((x) => x.url),
  };
  d.custom.forEach((c) => { has[c.id] = c.items.some((x) => x.title || x.description); });
  has.review = !!d.reviewedAt; // "Submit profile & finish" passed its checks
  return { has, score: strengthOf(has) };
}

/**
 * Profile strength comes only from the ticks: the weights of the ticked steps over the weights of the steps shown,
 * so 100% means every scored step is ticked and each unticked one visibly costs points. Steps without a weight
 * (hobbies, strengths, personal information, declaration, own sections) are optional and marked so.
 */
export const SCORE_WEIGHTS = { personal: 20, summary: 12, exp: 17, edu: 10, skills: 10, proj: 10, certs: 5, ach: 5, langs: 3, links: 5, review: 3 }; // job preferences removed (Oct 2026): their 7 points moved to personal, summary, experience
export function strengthOf(has, steps = Object.keys(SCORE_WEIGHTS)) {
  const ids = steps.filter((id) => id in SCORE_WEIGHTS);
  const total = ids.reduce((n, id) => n + SCORE_WEIGHTS[id], 0);
  const got = ids.reduce((n, id) => n + (has[id] ? SCORE_WEIGHTS[id] : 0), 0);
  return total ? Math.floor((got / total) * 100) : 0;
}

/* ---------- Resume section order & visibility ---------- */
export const PRINTABLE = { summary: 'Summary', exp: 'Experience', proj: 'Projects', edu: 'Education', skills: 'Skills', certs: 'Certifications', ach: 'Achievements', langs: 'Languages', hobbies: 'Hobbies', strengths: 'Strengths', pinfo: 'Personal Information', decl: 'Declaration' };
const TAIL = ['hobbies', 'strengths', 'pinfo', 'decl'];

/** Section layouts a template can bring with it: order + which sections start switched on. */
export const SECTION_LAYOUTS = {
  standard: { order: null, hidden: { hobbies: true, strengths: true, pinfo: true, decl: true } },
  kio: { order: ['summary', 'edu', 'exp', 'proj', 'skills', 'certs', 'ach', 'langs', 'hobbies', 'strengths', 'pinfo', 'decl'], hidden: { proj: true, skills: true, certs: true, ach: true, langs: true } },
  campus: { order: ['summary', 'edu', 'proj', 'exp', 'skills', 'certs', 'ach', 'langs', 'hobbies', 'strengths', 'pinfo', 'decl'], hidden: { hobbies: true, strengths: true, pinfo: true, decl: true } },
  stack: { order: ['summary', 'skills', 'exp', 'proj', 'edu', 'certs', 'ach', 'langs', 'hobbies', 'strengths', 'pinfo', 'decl'], hidden: { hobbies: true, strengths: true, pinfo: true, decl: true } },
  formal: { order: null, hidden: { hobbies: true, strengths: true } },
  executive: { order: ['summary', 'skills', 'exp', 'edu', 'certs', 'ach', 'proj', 'langs', 'hobbies', 'strengths', 'pinfo', 'decl'], hidden: { hobbies: true, strengths: true, pinfo: true, decl: true }, titles: { skills: 'Core Strengths' } },
  care: { order: ['summary', 'certs', 'exp', 'edu', 'skills', 'ach', 'proj', 'langs', 'hobbies', 'strengths', 'pinfo', 'decl'], hidden: { hobbies: true, strengths: true, pinfo: true, decl: true }, titles: { certs: 'Licences & Certifications' } },
  // skills and work first, education last and small (switched off when there is none) — for trades and field jobs
  work: { order: ['summary', 'skills', 'exp', 'certs', 'langs', 'edu', 'ach', 'proj', 'hobbies', 'strengths', 'pinfo', 'decl'], hidden: { proj: true, ach: true, hobbies: true, strengths: true, pinfo: true, decl: true }, titles: { exp: 'Work Experience', certs: 'Licences & Certificates' } },
  portrait: { order: null, hidden: { hobbies: true, strengths: true, pinfo: true, decl: true }, showPhoto: true },
};
// every layout sets these, so switching layouts never leaves stale renames or a stray photo
Object.values(SECTION_LAYOUTS).forEach((l) => { l.titles = l.titles || {}; l.showPhoto = !!l.showPhoto; });
export const isFresher = (d) => (d.personal.level || '').startsWith('Fresher');
export function resolveOrder(d) {
  const base = isFresher(d) ? ['summary', 'proj', 'exp', 'edu', 'skills', 'certs', 'ach', 'langs'] : ['summary', 'exp', 'proj', 'edu', 'skills', 'certs', 'ach', 'langs'];
  const valid = [...Object.keys(PRINTABLE), ...d.custom.map((c) => c.id)];
  const start = (d.order || base).filter((id) => valid.includes(id));
  // new custom sections go before the closing sections (hobbies … declaration) when using the default order
  const rest = valid.filter((id) => !start.includes(id));
  if (!d.order) return [...start, ...rest.filter((id) => !TAIL.includes(id)), ...TAIL];
  const di = start.indexOf('decl');
  if (di >= 0) return [...start.slice(0, di), ...rest, ...start.slice(di)];
  return [...start, ...rest];
}
export const sectionLabel = (d, id) => d.titles?.[id] || PRINTABLE[id] || d.custom.find((c) => c.id === id)?.title || id;

/* ---------- Quality checks ---------- */
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const URLISH = /^(https?:\/\/)?[^\s/]+\.[^\s]{2,}$/i;
export function fieldError(type, value) {
  if (!value) return '';
  if (type === 'email' && !EMAIL.test(value.trim())) return 'Check this email — it should look like name@example.com.';
  if (type === 'tel') { const n = value.replace(/[^\d]/g, ''); if (n.length < 10 || n.length > 13) return 'Enter a 10-digit mobile number, with or without +91.'; }
  if (type === 'url' && !URLISH.test(value.trim())) return 'This doesn’t look like a link. Example: linkedin.com/in/yourname';
  return '';
}
/** End-before-start check. Returns the message for the `to` field, or ''. */
export function dateOrderError(from, to, skip) {
  if (skip || !from || !to) return '';
  return to < from ? 'End date is before the start date.' : '';
}
const REQUIRED = {
  exp: [['company', 'Company'], ['role', 'Job title']], edu: [['institution', 'Institution'], ['degree', 'Degree']],
  proj: [['title', 'Project title']], certs: [['name', 'Certification name']], ach: [['title', 'Title']],
};
const DATE_PAIRS = { exp: ['from', 'to', 'current'], edu: ['from', 'to', null], proj: ['from', 'to', 'ongoing'], certs: ['issueDate', 'expiryDate', 'noExpiry'] };
const filled = (o) => Object.entries(o).some(([, v]) => (typeof v === 'string' ? v.trim() : false));

/** Every problem that should block “Submit”. [{ sec, msg }] */
export function collectIssues(d) {
  const out = [];
  [['name', 'Full name'], ['email', 'Email'], ['phone', 'Phone'], ['level', 'Experience level']].forEach(([k, l]) => { if (!d.personal[k]) out.push({ sec: 'personal', msg: `${l} is required.` }); });
  const e1 = fieldError('email', d.personal.email); if (e1) out.push({ sec: 'personal', msg: e1 });
  const e2 = fieldError('tel', d.personal.phone); if (e2) out.push({ sec: 'personal', msg: e2 });
  Object.entries(d.links).forEach(([k, v]) => { if (fieldError('url', v)) out.push({ sec: 'links', msg: `${k[0].toUpperCase() + k.slice(1)} link doesn’t look right.` }); });
  (d.linkExtras || []).forEach((x, i) => { if (x.url && fieldError('url', x.url)) out.push({ sec: 'links', msg: `Extra link ${i + 1} doesn’t look right.` }); });
  Object.entries(REQUIRED).forEach(([sec, req]) => {
    d[sec].forEach((o, i) => {
      if (!filled(o)) return; // empty entries are ignored
      req.forEach(([k, l]) => { if (!o[k]) out.push({ sec, msg: `${PRINTABLE[sec].replace(/s$/, '')} ${i + 1}: ${l} is missing.` }); });
    });
  });
  Object.keys(LINK_SLOTS).forEach((sec) => (sec === 'custom' ? d.custom.flatMap((c) => c.items) : d[sec] || []).forEach((o, i) => {
    (o.links || []).forEach((l) => { if (l.url && fieldError('url', l.url)) out.push({ sec: sec === 'custom' ? 'review' : sec, msg: `${PRINTABLE[sec] ? `${PRINTABLE[sec].replace(/s$/, '')} ${i + 1}` : 'Entry'}: a link doesn’t look right.` }); });
  }));
  Object.entries(DATE_PAIRS).forEach(([sec, [a, b, skip]]) => {
    d[sec].forEach((o, i) => { if (dateOrderError(o[a], o[b], skip && o[skip])) out.push({ sec, msg: `${PRINTABLE[sec].replace(/s$/, '')} ${i + 1}: end date is before the start date.` }); });
  });
  return out;
}
