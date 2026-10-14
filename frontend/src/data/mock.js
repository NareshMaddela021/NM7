// Sample data so every screen works before the backend exists.
// Names in [brackets] are placeholders — real data will come from the API.

export const SAMPLE_REPORT = {
  file: 'Resume_Sai_Varsha.pdf',
  baseScore: 54,
  targetScore: 89,
  sections: [
    { id: 'name', title: 'Sai Varsha', isName: true, lines: [{ id: 'h1', text: 'Chennai · saivarsha@[email] · linkedin.com/in/[handle]', skim: true }] },
    { id: 'obj', title: 'Objective', lines: [{ id: 'o1', text: 'Seeking a challenging role in a reputed organisation where I can grow my skills.', skim: true }] },
    { id: 'sk', title: 'Skills', lines: [{ id: 's1', text: 'SKILLS | SQL | Python | Excel | (two-column table)', skim: true }] },
    { id: 'exp', title: 'Experience', lines: [
      { id: 'e0', text: 'Data Analyst Intern · [Company] · Jan–Jun 2025', skim: true },
      { id: 'e1', text: 'Helped with dashboards for the sales team.', skim: false },
      { id: 'e2', text: 'Cleaned weekly CSV exports in Python.', skim: false },
    ] },
    { id: 'prj', title: 'Projects', lines: [{ id: 'p1', text: 'Analysed website data for a college project.', skim: false }] },
    { id: 'edu', title: 'Education', lines: [{ id: 'd1', text: 'B.Tech, Computer Science · [College] · 2025 · 8.1 CGPA', skim: true }] },
  ],
  issues: [
    { id: 'tbl', n: 1, sev: 'Blocks ATS', line: 's1', pts: 9, title: 'Skills are inside a table', why: 'Most tracking systems read tables as one jumbled line, so your skills may never be indexed.', fix: 'Skills: SQL · Python (Pandas) · Excel · Power BI · Statistics' },
    { id: 'met', n: 2, sev: 'High', line: 'e1', pts: 8, title: 'This bullet shows no result', why: 'Recruiters scan for numbers. “Helped with” reads as a duty, not an outcome.', fix: 'Built 6 Power BI dashboards that cut weekly sales reporting from 5 hours to 30 minutes.' },
    { id: 'kw', n: 3, sev: 'High', line: 'p1', pts: 7, title: 'Missing keywords for this role', why: 'Data Analyst job descriptions commonly ask for A/B testing and dashboards. You mention neither.', fix: 'Ran an A/B test on 12K sessions for a college fest site; variant B lifted sign-ups 14%.' },
    { id: 'obj', n: 4, sev: 'Medium', line: 'o1', pts: 6, title: 'Generic objective wastes the top line', why: 'The most-read line on the page says nothing specific about you.', fix: 'Data analyst fresher who turns messy sales data into decisions — SQL, Python, Power BI.' },
    { id: 'lnk', n: 5, sev: 'Low', line: 'h1', pts: 2, title: 'LinkedIn link is plain text', why: 'Recruiters can’t click through to verify you.', fix: 'Chennai · saivarsha@[email] · linkedin.com/in/[handle] (clickable)' },
  ],
};

export const MATCHED_JOBS = [
  { id: 'j1', title: 'Data Analyst · [Company]', meta: 'Bengaluru · 0–1 yrs · verified' },
  { id: 'j2', title: 'Business Analyst Intern · [Company]', meta: 'Remote · Internship · verified' },
  { id: 'j3', title: 'Junior BI Analyst · [Company]', meta: 'Hyderabad · 0–2 yrs · verified' },
];

export const EXPERTS = [
  { id: 'a', name: '[Expert A]', domain: 'Data & analytics', load: 6, cap: 8 },
  { id: 'd', name: '[Expert D]', domain: 'Data & analytics', load: 2, cap: 6 },
  { id: 'b', name: '[Expert B]', domain: 'Software engineering', load: 4, cap: 8 },
  { id: 'c', name: '[Expert C]', domain: 'Product', load: 7, cap: 8 },
  { id: 'e', name: '[Expert E]', domain: 'Finance', load: 3, cap: 8 },
  { id: 'f', name: '[Expert F]', domain: 'Marketing & HR', load: 1, cap: 6 },
];

// hrs = hours left on the 48h SLA (negative = overdue, null = delivered)
export const ADMIN_ORDERS = [
  { id: 'RS-1044', name: '[Customer 5]', role: 'Frontend Developer', plan: 'Expert rewrite', expert: 'b', domain: 'Software engineering', stage: 'Draft 1', score: 58, hrs: -6 },
  { id: 'RS-1048', name: '[Customer 2]', role: 'SDE-1 Backend', plan: 'Career Launch', expert: 'b', domain: 'Software engineering', stage: 'Draft 1', score: 61, hrs: 18 },
  { id: 'RS-1051', name: 'Sai Varsha', role: 'Data Analyst', plan: 'Expert rewrite', expert: null, domain: 'Data & analytics', stage: 'Placed', score: 54, hrs: 30 },
  { id: 'RS-1047', name: '[Customer 3]', role: 'Product Analyst', plan: 'Expert rewrite', expert: 'c', domain: 'Product', stage: 'Revisions', score: 84, hrs: 40 },
  { id: 'RS-1052', name: '[Customer 4]', role: 'Finance Analyst', plan: 'Career Launch', expert: null, domain: 'Finance', stage: 'Placed', score: 47, hrs: 44 },
  { id: 'RS-1039', name: '[Customer 6]', role: 'Business Analyst', plan: 'Expert rewrite', expert: 'a', domain: 'Data & analytics', stage: 'Delivered', score: 92, hrs: null },
];

export const EXPERT_ORDERS = [
  { id: 'RS-1051', name: 'Sai Varsha', role: 'Data Analyst', stage: 'Writing draft', hrs: 30 },
  { id: 'RS-1055', name: '[Customer 7]', role: 'Business Analyst', stage: 'Waiting for intake', hrs: 44 },
  { id: 'RS-1039', name: '[Customer 6]', role: 'Business Analyst', stage: 'Revision requested', hrs: 10 },
];

export const DRAFT_BLOCKS = [
  { title: 'Summary', before: 'Seeking a challenging role in a reputed organisation where I can grow my skills.', after: 'Data analyst fresher who turns messy sales data into decisions — SQL, Python, Power BI.' },
  { title: 'Experience', before: 'Helped with dashboards for the sales team.', after: 'Built 6 Power BI dashboards that cut weekly sales reporting from 5 hours to 30 minutes.' },
  { title: 'Projects', before: 'Analysed website data for a college project.', after: 'Ran an A/B test on 12K sessions for a college fest site; variant B lifted sign-ups 14%.' },
  { title: 'Skills', before: 'SKILLS | SQL | Python | Excel | (table)', after: 'SQL · Python (Pandas) · Excel · Power BI · Statistics · A/B testing' },
];

// status: available | pending | refunded
export const EARNINGS = {
  oct: [
    { id: 'RS-1051', name: 'Sai Varsha', role: 'Data Analyst', plan: 'Expert rewrite', price: 999, time: '30 h', onTime: true, status: 'pending' },
    { id: 'RS-1039', name: '[Customer 6]', role: 'Business Analyst', plan: 'Expert rewrite', price: 999, time: '26 h', onTime: true, status: 'available' },
    { id: 'RS-1033', name: '[Customer 8]', role: 'Product Analyst', plan: 'Career Launch', price: 2999, time: '41 h', onTime: true, status: 'available' },
    { id: 'RS-1029', name: '[Customer 9]', role: 'Data Scientist', plan: 'Expert rewrite', price: 999, time: '52 h', onTime: false, status: 'refunded' },
    { id: 'RS-1021', name: '[Customer 10]', role: 'BI Analyst', plan: 'Expert rewrite', price: 999, time: '19 h', onTime: true, status: 'available' },
    { id: 'RS-1017', name: '[Customer 11]', role: 'Data Analyst', plan: 'Career Launch', price: 2999, time: '44 h', onTime: true, status: 'available' },
  ],
  sep: [
    { id: 'RS-0988', name: '[Customer 12]', role: 'ML Intern', plan: 'Expert rewrite', price: 999, time: '35 h', onTime: true, status: 'available' },
    { id: 'RS-0971', name: '[Customer 13]', role: 'Data Analyst', plan: 'Career Launch', price: 2999, time: '22 h', onTime: true, status: 'available' },
    { id: 'RS-0960', name: '[Customer 14]', role: 'Analyst', plan: 'Expert rewrite', price: 999, time: '47 h', onTime: true, status: 'available' },
  ],
  aug: [
    { id: 'RS-0902', name: '[Customer 15]', role: 'Data Analyst', plan: 'Expert rewrite', price: 999, time: '40 h', onTime: true, status: 'available' },
    { id: 'RS-0890', name: '[Customer 16]', role: 'BA Intern', plan: 'Expert rewrite', price: 999, time: '30 h', onTime: true, status: 'available' },
  ],
  history: [['May', 3996], ['Jun', 5994], ['Jul', 4995], ['Aug', 1998], ['Sep', 4997], ['Oct', 8995]],
};
