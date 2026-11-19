// Vetting V2: the 50 roles with a skill check (a copy of backend/app/hire/vetting/roles.py: slug, the test's name,
// the job it is for, group, practical task type) and the "Skill verified" badge line companies see. Only the company
// and Admin pages import this, so it never weighs on the main bundle.

/** [slug, test, role, group, task] — in the same order as roles.py. */
const R = [
  ['sql', 'SQL', 'Data analyst', 'tech', 'tech'],
  ['python', 'Python', 'Python developer', 'tech', 'tech'],
  ['java', 'Java', 'Java developer', 'tech', 'tech'],
  ['web-basics', 'Web basics', 'Front-end (React) developer', 'tech', 'tech'],
  ['software-testing', 'Software testing', 'QA / software tester', 'tech', 'tech'],
  ['excel', 'Excel', 'Office assistant (Excel)', 'business', 'written'],
  ['customer-support', 'Customer support', 'Customer support (voice)', 'business', 'voice'],
  ['spoken-english', 'Spoken English', 'Customer support (spoken English)', 'business', 'voice'],
  ['sales', 'Sales', 'Field sales executive', 'business', 'voice'],
  ['retail', 'Retail', 'Retail store associate', 'business', 'voice'],
  ['accounting', 'Accounting', 'Accounts executive', 'business', 'written'],
  ['tally-gst', 'Tally and GST', 'Accounts executive (Tally + GST)', 'business', 'written'],
  ['data-entry', 'Data entry', 'Data entry operator', 'business', 'written'],
  ['delivery', 'Delivery and logistics', 'Delivery partner', 'trades', 'proof'],
  ['warehouse', 'Warehouse', 'Warehouse picker / packer', 'trades', 'proof'],
  ['electrical', 'Electrical', 'Electrician (ITI)', 'trades', 'proof'],
  ['mechanical', 'Mechanical basics', 'Fitter (ITI)', 'trades', 'proof'],
  ['nursing', 'Nursing basics', 'Staff nurse (GNM / BSc)', 'health', 'written'],
  ['fullstack-mern', 'Full-stack (MERN)', 'Full-stack developer (MERN)', 'tech', 'tech'],
  ['mobile-dev', 'Mobile apps (Android / Flutter)', 'Android / Flutter developer', 'tech', 'tech'],
  ['devops-aws', 'DevOps and cloud (AWS basics)', 'DevOps / cloud engineer', 'tech', 'tech'],
  ['data-science', 'Data science (ML basics)', 'Data scientist', 'tech', 'tech'],
  ['ui-ux', 'UI / UX design', 'UI / UX designer', 'tech', 'written'],
  ['cybersecurity', 'Cybersecurity basics', 'Cybersecurity analyst (junior)', 'tech', 'tech'],
  ['business-analyst', 'Business analysis', 'Business analyst', 'tech', 'written'],
  ['salesforce-crm', 'Salesforce / CRM admin', 'Salesforce / CRM admin', 'tech', 'written'],
  ['it-support', 'IT support', 'IT support / desktop engineer', 'tech', 'written'],
  ['cloud-db', 'Databases (SQL design)', 'Database developer', 'tech', 'tech'],
  ['support-chat', 'Customer support (chat / email)', 'Customer support (chat / email)', 'business', 'written'],
  ['telecaller', 'Telecalling and telesales', 'Telecaller / telesales', 'business', 'voice'],
  ['cashier', 'Cashier and billing', 'Cashier / billing executive', 'business', 'written'],
  ['hr-recruiter', 'HR recruiting', 'HR recruiter', 'business', 'written'],
  ['hr-admin', 'HR and admin', 'HR / admin executive', 'business', 'written'],
  ['front-office', 'Front office', 'Receptionist / hotel front desk', 'business', 'voice'],
  ['digital-marketing', 'Digital marketing', 'Digital marketing executive', 'business', 'written'],
  ['content-writing', 'Content writing', 'Content writer', 'business', 'written'],
  ['graphic-design', 'Graphic design', 'Graphic designer', 'business', 'written'],
  ['back-office', 'Operations and back office', 'Operations / back-office executive', 'business', 'written'],
  ['welding', 'Welding', 'Welder', 'trades', 'proof'],
  ['ac-tech', 'AC and refrigeration', 'AC / refrigeration technician', 'trades', 'proof'],
  ['two-wheeler', 'Two-wheeler mechanic', 'Two-wheeler mechanic', 'trades', 'proof'],
  ['cnc', 'CNC operation', 'CNC operator', 'trades', 'proof'],
  ['plumbing', 'Plumbing', 'Plumber', 'trades', 'proof'],
  ['security-guard', 'Security guard', 'Security guard', 'trades', 'proof'],
  ['housekeeping', 'Housekeeping', 'Housekeeping staff', 'trades', 'proof'],
  ['cook', 'Cooking and kitchen', 'Cook / kitchen helper', 'trades', 'proof'],
  ['driver', 'Driving (LMV)', 'Driver (LMV)', 'trades', 'proof'],
  ['pharmacy', 'Pharmacy assistant', 'Pharmacy assistant', 'health', 'written'],
  ['lab-tech', 'Lab technician', 'Lab technician', 'health', 'written'],
  ['teaching', 'Primary teaching and tutoring', 'Primary teacher / tutor', 'health', 'written'],
];

export const VETTING_ROLES = R.map(([slug, test, role, group, task]) => ({ slug, test, role, group, task }));
export const TEST_NAMES = VETTING_ROLES.map((r) => r.test);
export const BY_TEST = Object.fromEntries(VETTING_ROLES.map((r) => [r.test, r]));
export const GROUP_LABEL = { tech: 'Tech', business: 'Business and office', trades: 'Trades and services', health: 'Health and teaching' };
export const TASK_LABEL = { tech: 'Written mini task', written: 'Written scenario', voice: 'Spoken reply', proof: 'Situations + work photo' };

/** "3–5 years" -> "3–5 yrs band"; "Fresher" -> "Fresher band". */
export const bandText = (label) => `${String(label || '').replace(/\byears?\b/, 'yrs')} band`;

/** "Nov 2026" from a millisecond time. */
export const monthYear = (at) => (at ? new Date(at).toLocaleDateString('en-IN', { month: 'short', year: 'numeric' }) : '');

/** The badge's parts after "Skill verified": test · band · score · task stars · month. */
export function badgeParts(sv) {
  if (!sv) return [];
  return [
    sv.test,
    sv.bandLabel && bandText(sv.bandLabel),
    sv.score != null && `${sv.score}/100`,
    sv.taskStars != null && `task ${Number(sv.taskStars).toFixed(1)}/5`,
    monthYear(sv.at),
  ].filter(Boolean);
}

/** "Skill verified · Java · 3–5 yrs band · 82/100 · task 4.2/5 · Nov 2026", or "Skill verified (expired) · Java …". */
export function badgeLine(sv) {
  if (!sv) return '';
  return [sv.expired ? 'Skill verified (expired)' : 'Skill verified', ...badgeParts(sv)].join(' · ');
}
