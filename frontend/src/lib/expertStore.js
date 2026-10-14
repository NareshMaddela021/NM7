// Expert orders, drafts, comments, messages and snippets — shared by the expert workspace and the customer's review page.
// Preview: kept in this browser (localStorage). Live app: GET/PUT /api/expert/orders/{id}, /api/orders/{id}/drafts, etc.
import { useSyncExternalStore } from 'react';
import { INITIAL } from '../pages/builder/schema';

const KEY = 'asuraa-expert-orders-v3';
const SNIP_KEY = 'asuraa-expert-snippets-v1';
const H = 3600 * 1000;
const now = () => Date.now();

/* ---------- sample customer resumes (as read from their uploaded files) ---------- */
export function original({ name, email, headline = '', role, company, desc, degree, field, inst, grade, skills, proj, summary = '' }) {
  return {
    ...structuredClone(INITIAL),
    personal: { name, headline, email, phone: '+91 90000 00000', location: 'Bengaluru, Karnataka', level: 'Fresher (0–1 yr)' },
    summary,
    exp: role ? [{ company, role, employmentType: 'Internship', from: '2025-01', to: '2025-06', current: false, description: desc, links: [] }] : [],
    edu: [{ institution: inst, degree, field, from: '2021-08', to: '2025-05', current: false, grade }],
    skillGroups: [{ id: 'core', label: 'Core Technologies / Languages', value: skills }, { id: 'frameworks', label: 'Frameworks & Libraries', value: '' }, { id: 'tools', label: 'Tools & Platforms', value: '' }, { id: 'soft', label: 'Soft Skills / Domains', value: '' }],
    proj: proj ? [{ title: proj.title, tagline: '', type: 'Academic / Research', status: 'Completed', from: '2024-08', to: '2024-11', ongoing: false, description: proj.desc, tech: proj.tech, links: [] }] : [],
    certs: [], ach: [], langs: [{ name: 'English', level: 'Fluent' }],
    links: { ...INITIAL.links, linkedin: '', github: '' },
    design: null,
  };
}

const SAMPLE = () => {
  const t = now();
  return [
    {
      id: 'RS-1117', customer: 'Sai Varsha', customerId: 'u-sai', plan: 'expert', price: 999, role: 'Data Analyst', domain: 'Data & analytics', level: 'Fresher', createdAt: t - 18 * H, deadline: t + 30 * H, status: 'progress', accepted: t - 17.5 * H,
      intake: { target: 'Data Analyst (fresher)', wins: 'Power BI dashboards for my internship; college fest sponsor dashboard.', avoid: 'Don’t make it two pages.', companies: 'Product startups, fintech' },
      jd: 'We are hiring a Data Analyst (0–1 years). Must know SQL, Python (Pandas), Excel and Power BI or Tableau. You will build dashboards, track KPIs, clean data and present insights to stakeholders. Statistics and A/B testing are a plus.',
      original: original({ name: 'Sai Varsha', email: 'saivarsha@example.com', role: 'Data Analyst Intern', company: '[Company]', desc: 'made dashboards in power bi for sales team\ncleaned csv files in python\nhelped with weekly reports', degree: 'B.Tech', field: 'Computer Science', inst: '[College]', grade: '8.1 CGPA', skills: 'Python, SQL, Excel', proj: { title: 'Sales Dashboard', desc: 'made a dashboard for college fest', tech: 'Power BI' }, summary: 'Seeking a challenging role in a reputed organisation where I can grow my skills.' }),
      versions: [], comments: [], messages: [{ from: 'customer', text: 'Hi! Please keep it one page. I can share numbers from my internship if needed.', at: t - 17 * H }],
      linkedin: null, call: null, rating: null,
    },
    {
      id: 'RS-1124', customer: '[Customer 31]', plan: 'launch', price: 2999, role: 'SDE-1', domain: 'Software engineering', level: 'Fresher', createdAt: t - 0.2 * H, deadline: t + 47.8 * H, status: 'offer', offerExpires: t + 25 * 60 * 1000,
      intake: { target: 'SDE-1 / Backend', wins: 'Built a REST API for a college canteen app; 300+ LeetCode problems.', avoid: '—', companies: 'Product companies' },
      jd: 'SDE-1: Java or Python, data structures and algorithms, REST APIs, SQL, Git. Experience with Docker or AWS is a plus.',
      original: original({ name: '[Customer 31]', email: 'customer31@example.com', degree: 'B.E.', field: 'Information Science', inst: '[College]', grade: '7.9 CGPA', skills: 'Java, Python, SQL, HTML', proj: { title: 'Canteen App', desc: 'worked on backend of canteen app using spring boot', tech: 'Java, Spring Boot, MySQL' } }),
      versions: [], comments: [], messages: [], linkedin: null, call: null, rating: null,
    },
    {
      id: 'RS-1122', customer: '[Customer 29]', plan: 'expert', price: 999, role: 'Business Analyst', domain: 'Data & analytics', level: '0–1 yrs', createdAt: t - 34 * H, deadline: t + 14 * H, status: 'revision', accepted: t - 33 * H,
      intake: { target: 'Business Analyst', wins: 'MIS reports at internship; Excel automation.', avoid: '—', companies: 'Consulting, IT services' },
      jd: 'Business Analyst: Excel, SQL, requirement gathering, stakeholder communication, reporting, Power BI.',
      original: original({ name: '[Customer 29]', email: 'customer29@example.com', role: 'MIS Intern', company: '[Company]', desc: 'responsible for MIS reports\nhandled excel sheets', degree: 'BBA', field: 'Business Analytics', inst: '[College]', grade: '78%', skills: 'Excel, SQL, PowerPoint' }),
      versions: [], draft1: true, comments: [
        { id: 'c1', section: 'summary', text: 'Summary is a bit long — can it be 3 lines?', at: t - 3 * H, resolved: false },
        { id: 'c2', section: 'exp', text: 'Please mention I automated the weekly MIS report (saved about 4 hours a week).', at: t - 3 * H, resolved: false },
      ],
      messages: [{ from: 'customer', text: 'Thanks for draft 1! Left two comments.', at: t - 3 * H }], linkedin: null, call: null, rating: null,
    },
    {
      id: 'RS-1119', customer: '[Customer 21]', plan: 'expert', price: 999, role: 'Frontend Developer', domain: 'Software engineering', level: 'Fresher', createdAt: t - 43 * H, deadline: t + 5 * H, status: 'progress', accepted: t - 42 * H,
      intake: { target: 'Frontend Developer', wins: 'React portfolio site; hackathon finalist.', avoid: '—', companies: 'Startups' },
      jd: 'Frontend Developer: React, JavaScript, TypeScript, HTML, CSS, REST API, Git. Figma is a plus.',
      original: original({ name: '[Customer 21]', email: 'customer21@example.com', degree: 'B.Tech', field: 'ECE', inst: '[College]', grade: '7.4 CGPA', skills: 'HTML, CSS, JavaScript, React', proj: { title: 'Portfolio Website', desc: 'made my portfolio website in react', tech: 'React' } }),
      versions: [], comments: [], messages: [], linkedin: null, call: null, rating: null,
    },
    { id: 'RS-1108', customer: '[Customer 40]', plan: 'launch', price: 2999, role: 'Product Analyst', domain: 'Product', level: '1–3 yrs', createdAt: t - 9 * 24 * H, deadline: t - 7 * 24 * H, status: 'approved', deliveredAt: t - 7.4 * 24 * H, rating: 5, review: 'Clear, quick and the LinkedIn tips were gold.', intake: {}, jd: '', original: null, versions: [{ n: 1 }, { n: 2 }], comments: [], messages: [] },
    { id: 'RS-1102', customer: '[Customer 44]', plan: 'expert', price: 999, role: 'Data Analyst', domain: 'Data & analytics', level: 'Fresher', createdAt: t - 12 * 24 * H, deadline: t - 10 * 24 * H, status: 'approved', deliveredAt: t - 10.3 * 24 * H, rating: 4, review: 'Good, but took 2 rounds to get the projects right.', intake: {}, jd: '', original: null, versions: [{ n: 1 }, { n: 2 }, { n: 3 }], comments: [], messages: [] },
  ];
};

/* RS-1122 already had draft 1 sent (the customer commented on it). */
function withDraft1(list) {
  return list.map((o) => {
    if (!o.draft1) return o;
    const { draft1, ...rest } = o;
    const data = structuredClone(o.original);
    data.summary = 'Business analyst with an MIS internship behind me, where I built the weekly management reports in Excel and SQL for a 40-person sales team. I turn messy spreadsheets into clear reports and dashboards, and I am comfortable presenting numbers to managers. Looking for a Business Analyst role in consulting or IT services where I can grow into requirement gathering and stakeholder work.';
    data.exp = data.exp.map((e) => ({ ...e, description: 'Prepared weekly MIS reports in Excel and SQL for a 40-person sales team\nMaintained 12 shared Excel trackers with pivot tables and VLOOKUP checks' }));
    return { ...rest, versions: [{ n: 1, at: o.accepted + 20 * H, label: 'Draft 1', note: 'Rewrote the summary and experience with numbers.', data, sent: true }] };
  });
}

/* ---------- tiny store ---------- */
let state = null;
const subs = new Set();
const load = () => { try { const s = localStorage.getItem(KEY); return s ? JSON.parse(s) : withDraft1(SAMPLE()); } catch { return withDraft1(SAMPLE()); } };
const get = () => { if (!state) state = load(); return state; };
const emit = () => { try { localStorage.setItem(KEY, JSON.stringify(state)); } catch { /* ignore */ } subs.forEach((f) => f()); };
export function updateOrder(id, fn) { state = get().map((o) => (o.id === id ? { ...o, ...fn(o) } : o)); emit(); }
export function resetExpertOrders() { state = withDraft1(SAMPLE()); emit(); }
export function useExpertOrders() { return useSyncExternalStore((f) => { subs.add(f); return () => subs.delete(f); }, get); }
export const findOrder = (id) => get().find((o) => o.id === id);
export function addExpertOrder(o) { state = [o, ...get()]; emit(); }

/* ---------- snippets ---------- */
const SNIP_DEFAULT = [
  { id: 's1', role: 'Data Analyst', kind: 'Bullet', text: 'Built [N] Power BI dashboards for the [team], cutting weekly reporting from [X] hours to [Y] minutes' },
  { id: 's2', role: 'Data Analyst', kind: 'Bullet', text: 'Cleaned and merged [N] CSV files ([X] rows) in Python (Pandas), removing [N] duplicate records' },
  { id: 's3', role: 'Data Analyst', kind: 'Summary', text: 'Data analyst who turns raw sales data into dashboards teams actually use. Skilled in SQL, Python and Power BI. [One result with a number]. Looking for a Data Analyst role in a product-led team.' },
  { id: 's4', role: 'SDE-1', kind: 'Bullet', text: 'Built a REST API in [framework] serving [N] users, with [N] endpoints and [X]% test coverage' },
  { id: 's5', role: 'Business Analyst', kind: 'Bullet', text: 'Automated the weekly MIS report in Excel (macros + pivot tables), saving [X] hours a week' },
  { id: 's6', role: 'Frontend Developer', kind: 'Bullet', text: 'Built a responsive React site with [N] pages; Lighthouse performance score [X]/100' },
];
let snips = null;
const ssubs = new Set();
const sget = () => { if (!snips) { try { snips = JSON.parse(localStorage.getItem(SNIP_KEY)) || SNIP_DEFAULT; } catch { snips = SNIP_DEFAULT; } } return snips; };
export function setSnippets(next) { snips = next; try { localStorage.setItem(SNIP_KEY, JSON.stringify(next)); } catch { /* ignore */ } ssubs.forEach((f) => f()); }
export function useSnippets() { return useSyncExternalStore((f) => { ssubs.add(f); return () => ssubs.delete(f); }, sget); }
