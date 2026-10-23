// Target role → the words recruiters search for on LinkedIn. The role comes from the role box, else the headline.
// A keyword counts as present when it appears (whole word, any case) anywhere in the profile text.

export const ROLES = [
  { role: 'Data Analyst', match: /data analy|business intelligence|\bbi analyst|mis analyst|reporting analyst/i, words: ['SQL', 'Excel', 'Power BI', 'Tableau', 'Python', 'Dashboards', 'Data Visualization', 'Statistics', 'Data Cleaning', 'Reporting'] },
  { role: 'Data Scientist', match: /data scien|machine learning|\bml engineer|\bai engineer/i, words: ['Python', 'Machine Learning', 'SQL', 'Statistics', 'Pandas', 'Scikit-learn', 'Deep Learning', 'Data Visualization', 'NLP', 'Model Deployment'] },
  { role: 'Business Analyst', match: /business analy/i, words: ['Requirements Gathering', 'SQL', 'Excel', 'Stakeholder Management', 'Process Mapping', 'Power BI', 'User Stories', 'Documentation', 'Agile', 'JIRA'] },
  { role: 'Software Developer', match: /software (dev|eng)|\bsde\b|programmer|backend|java dev|python dev/i, words: ['Java', 'Python', 'Data Structures', 'Algorithms', 'SQL', 'Git', 'REST APIs', 'OOP', 'Problem Solving', 'Debugging'] },
  { role: 'Web Developer', match: /web dev|front ?end|full ?stack|react dev|mern/i, words: ['HTML', 'CSS', 'JavaScript', 'React', 'Node.js', 'REST APIs', 'Git', 'Responsive Design', 'TypeScript', 'MongoDB'] },
  { role: 'Mobile App Developer', match: /mobile|android|ios dev|flutter|app dev/i, words: ['Android', 'Kotlin', 'Flutter', 'Dart', 'Java', 'Firebase', 'REST APIs', 'Git', 'UI Design', 'Play Store'] },
  { role: 'DevOps Engineer', match: /devops|cloud eng|site reliab|\bsre\b/i, words: ['AWS', 'Docker', 'Kubernetes', 'Linux', 'CI/CD', 'Terraform', 'Jenkins', 'Git', 'Monitoring', 'Shell Scripting'] },
  { role: 'Software Tester', match: /test(er|ing)|\bqa\b|quality assurance|automation eng/i, words: ['Manual Testing', 'Selenium', 'Test Cases', 'Bug Tracking', 'JIRA', 'API Testing', 'SQL', 'Regression Testing', 'Agile', 'Automation'] },
  { role: 'UI/UX Designer', match: /\bui\b|\bux\b|product design|graphic design|visual design/i, words: ['Figma', 'User Research', 'Wireframing', 'Prototyping', 'Design Systems', 'Usability Testing', 'Adobe XD', 'Typography', 'Accessibility', 'Portfolio'] },
  { role: 'Digital Marketer', match: /digital market|\bseo\b|social media|content market|performance market/i, words: ['SEO', 'Google Ads', 'Social Media Marketing', 'Content Marketing', 'Google Analytics', 'Email Marketing', 'Meta Ads', 'Copywriting', 'Campaigns', 'Canva'] },
  { role: 'Sales Executive', match: /sales|business develop|\bbde\b|inside sales/i, words: ['Lead Generation', 'Negotiation', 'CRM', 'Client Relationships', 'Cold Calling', 'Targets', 'B2B Sales', 'Communication', 'Presentations', 'Follow-ups'] },
  { role: 'HR Executive', match: /\bhr\b|human resource|recruit|talent acq/i, words: ['Recruitment', 'Onboarding', 'Payroll', 'HR Policies', 'Employee Engagement', 'Sourcing', 'Interviewing', 'HRMS', 'Excel', 'Communication'] },
  { role: 'Accountant', match: /account|finance exec|\bca\b|tally|bookkeep/i, words: ['Tally', 'GST', 'Excel', 'Accounts Payable', 'Accounts Receivable', 'Bank Reconciliation', 'TDS', 'Financial Reporting', 'Bookkeeping', 'Auditing'] },
  { role: 'Customer Support Executive', match: /customer (support|service|care)|call cent|bpo|voice process|chat process/i, words: ['Customer Service', 'Communication', 'CRM', 'Problem Solving', 'Ticketing', 'Email Support', 'Chat Support', 'English', 'Typing', 'Escalations'] },
  { role: 'Mechanical Engineer', match: /mechanical|design eng|production eng/i, words: ['AutoCAD', 'SolidWorks', 'CATIA', 'GD&T', 'Manufacturing', 'Quality Control', 'Lean', 'ANSYS', 'Maintenance', 'Six Sigma'] },
  { role: 'Civil Engineer', match: /civil|site eng|structural/i, words: ['AutoCAD', 'Site Supervision', 'Estimation', 'STAAD Pro', 'Quantity Surveying', 'Revit', 'Project Planning', 'Quality Control', 'BOQ', 'Safety'] },
  { role: 'Electronics Engineer', match: /electronic|\bece\b|embedded|vlsi/i, words: ['Embedded C', 'Microcontrollers', 'PCB Design', 'VLSI', 'Verilog', 'Arduino', 'IoT', 'MATLAB', 'Circuit Design', 'Testing'] },
  { role: 'Teacher', match: /teach|tutor|lecturer|faculty|educator/i, words: ['Lesson Planning', 'Classroom Management', 'Curriculum', 'Student Assessment', 'Communication', 'Online Teaching', 'Mentoring', 'Subject Knowledge', 'Parent Communication', 'MS Office'] },
  { role: 'Nurse', match: /nurs|staff nurse|\bgnm\b|\banm\b/i, words: ['Patient Care', 'Vital Signs', 'Medication Administration', 'BLS', 'Infection Control', 'Documentation', 'ICU', 'Wound Care', 'Communication', 'Emergency Care'] },
];

const ESC = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const hasWord = (text, w) => new RegExp(`(?<![\\p{L}\\p{N}])${ESC(w)}(?![\\p{L}\\p{N}])`, 'iu').test(text);

/** The role to check against: the role box first, else the first part of the headline. */
export function roleFrom(roleBox, headline) {
  const box = String(roleBox || '').replace(/\s+/g, ' ').trim();
  if (box) return box;
  const first = String(headline || '').split(/\s*[|·•,–—]\s*|\s+-\s+|\s+at\s+/i)[0].replace(/^(aspiring|fresher|entry[- ]level|junior|senior|trainee)\s+/i, '').trim();
  return first.length >= 3 && first.length <= 60 ? first : '';
}

/** The known role that matches, or null. */
export const roleInfo = (role) => (role ? ROLES.find((r) => r.match.test(role)) || null : null);

/** { role, known, have, missing } — missing in the order recruiters care about. */
export function keywordMatch(role, text) {
  const info = roleInfo(role);
  if (!info) return { role: role || '', known: false, have: [], missing: [] };
  const have = info.words.filter((w) => hasWord(text, w));
  const missing = info.words.filter((w) => !hasWord(text, w));
  return { role: info.role, known: true, have, missing };
}

/** "Data Analyst: missing Excel, Dashboards" (the top few). */
export function keywordLine(m, top = 4) {
  if (!m.known) return '';
  if (!m.missing.length) return `${m.role}: all the key words are there`;
  return `${m.role}: missing ${m.missing.slice(0, top).join(', ')}`;
}
