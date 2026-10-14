// Expert test task: one sample resume + job post per domain, rewritten in the real workspace, scored by an admin.
import { original } from './expertStore';
import { atsScore } from './atsScore';

const H = 3600 * 1000;
export const TEST_HOURS = 48;
export const PASS = { avg: 3.5, min: 3 }; // average of the 5 scores, and no single score below this

export const RUBRIC = [
  ['ats', 'ATS-safe & readable', 'One column, clean headings, nothing a parser would drop.'],
  ['impact', 'Results & numbers', 'Bullets show outcomes, with numbers where the candidate gave them.'],
  ['fit', 'Fit to the job', 'Keywords and order match the job post — without inventing skills.'],
  ['language', 'Language', 'No spelling or grammar mistakes; short, active sentences.'],
  ['judgement', 'Judgement & honesty', 'Nothing made up; [brackets] where facts are missing; sensible length.'],
];

export const TASKS = {
  data: {
    id: 'T-DATA', title: 'Data Analyst (fresher)', domains: ['Data & analytics', 'Finance', 'Product'],
    jd: 'Data Analyst — 0–1 years. SQL, Excel, Python (Pandas) and Power BI or Tableau. Build dashboards, track KPIs, clean data and present insights to stakeholders.',
    notes: 'Candidate: B.Com graduate, 3-month internship at a retail chain. Says: “I made the weekly sales report faster — it used to take my manager a full day, now about 2 hours.” Wants one page.',
    original: original({ name: '[Test Candidate]', email: 'candidate@example.com', role: 'Intern', company: '[Retail company]', desc: 'did excel work\nhelped manager in reports\nattended meetings', degree: 'B.Com', field: 'Commerce', inst: '[College]', grade: '72%', skills: 'MS Office, Excel, Tally', summary: 'Hardworking fresher looking for a job in a good company.' }),
  },
  software: {
    id: 'T-SDE', title: 'SDE-1 / Backend (fresher)', domains: ['Software engineering', 'Core engineering'],
    jd: 'SDE-1 Backend — Java or Python, data structures and algorithms, REST APIs, SQL, Git. Docker or AWS is a plus.',
    notes: 'Candidate: B.Tech CSE. Built a college event-registration app used by about 800 students (Spring Boot + MySQL). Solved ~250 LeetCode problems.',
    original: original({ name: '[Test Candidate]', email: 'candidate@example.com', degree: 'B.Tech', field: 'Computer Science', inst: '[College]', grade: '7.6 CGPA', skills: 'Java, C, HTML, MySQL', proj: { title: 'Event App', desc: 'made an app for college events using spring boot', tech: 'Java, Spring Boot, MySQL' } }),
  },
  general: {
    id: 'T-GEN', title: 'Business / Operations (fresher)', domains: [],
    jd: 'Operations Executive — fresher. Excel, reporting, coordination with vendors and teams, good communication. Inventory or supply chain exposure is a plus.',
    notes: 'Candidate: BBA. Summer internship at a logistics company; tracked 40+ daily shipments in Excel and flagged delays to the team lead.',
    original: original({ name: '[Test Candidate]', email: 'candidate@example.com', role: 'Summer Intern', company: '[Logistics company]', desc: 'tracked shipments\nworked in excel\ncoordinated with team', degree: 'BBA', field: 'Business Administration', inst: '[College]', grade: '68%', skills: 'Excel, Communication' }),
  },
};
export function taskFor(domains = []) {
  return Object.values(TASKS).find((t) => t.domains.some((d) => domains.includes(d))) || TASKS.general;
}
export const newTest = (domains) => { const t = taskFor(domains); return { taskId: t.id, sentAt: Date.now(), due: Date.now() + TEST_HOURS * H, submitted: null }; };
export const taskById = (id) => Object.values(TASKS).find((t) => t.id === id) || TASKS.general;

export function scoreOf(scores) {
  const vals = RUBRIC.map(([k]) => scores?.[k] || 0);
  const avg = vals.reduce((a, b) => a + b, 0) / vals.length;
  return { avg, pass: vals.every((v) => v >= PASS.min) && avg >= PASS.avg, complete: vals.every((v) => v > 0) };
}
export const atsDelta = (t, data) => ({ before: atsScore(t.original, t.jd).score, after: atsScore(data, t.jd).score });

/** Preview only: a second sample expert (Ravi) who is at the test-task step. */
export function seedPreviewExpert(keyFor, BLANK) {
  const k = keyFor('u-ravi');
  try {
    if (localStorage.getItem(k)) return;
    const p = structuredClone(BLANK);
    Object.assign(p, { userId: 'u-ravi', source: 'manual', status: 'test', agree: true, test: newTest(['Data & analytics']) });
    p.about = { name: 'Ravi Kumar', headline: 'Senior Data Analyst · 5 yrs · hires interns', bio: 'I lead a 4-person analytics team and screen 200+ fresher resumes a year.', city: 'Hyderabad', languages: ['English', 'Telugu', 'Hindi'] };
    p.expertise = { domains: ['Data & analytics'], roles: 'Data Analyst, MIS Executive', levels: ['fresher', 'early'] };
    p.proof = { ...p.proof, experience: [{ role: 'Senior Data Analyst', company: '[Company]', period: '2020–now' }], linkedin: 'linkedin.com/in/ravi-sample', recruiterYears: '3', resumesWritten: '30' };
    p.payout = { ...p.payout, method: 'upi', upi: 'ravi@okaxis', pan: 'ABCDE5678F' };
    localStorage.setItem(k, JSON.stringify(p));
  } catch { /* ignore */ }
}
