// Shared set-up for the Auto Apply browser tests (Phase 3): a resume that passes the ATS gate and a signed-in student.
import { expect } from '@playwright/test';
import { PASSWORD, email, lastCode } from './helpers.mjs';
import { call, json } from './college.mjs';

export const STRONG = {
  personal: { name: 'Asha Rao', email: 'asha@example.com', phone: '+91 90000 11111', location: 'Hyderabad' },
  links: { linkedin: 'linkedin.com/in/asha-rao' },
  summary: 'Data Analyst Intern at Northwind Retail, skilled in Python, SQL and Statistics. Built Power BI dashboards used by 12 store managers and cleaned weekly sales files, cutting report time by 30%.',
  exp: [{ company: 'Northwind Retail', role: 'Data Analyst Intern', employmentType: 'Internship', from: '2025-01', to: '2025-07', current: false, description: 'Built 6 Power BI dashboards for 12 store managers\nAutomated weekly CSV cleaning in Python, saving 4 hours a week\nAnalyzed 2 years of sales data in SQL to find 3 slow-moving product lines' }],
  edu: [{ institution: 'Lakeview Institute of Technology', degree: 'B.Tech', field: 'Computer Science', from: '2021-08', to: '2025-05', grade: '8.2 CGPA' }],
  skillGroups: [{ id: 'core', label: 'Core', value: 'Python, SQL, Statistics, Pandas, Data Cleaning' }, { id: 'tools', label: 'Tools', value: 'Power BI, Excel, Git, Tableau, Jupyter' }],
  proj: [{ title: 'Sales Dashboard Revamp', tagline: "Power BI dashboards for a college fest's sponsor sales", description: '', tech: 'Power BI, SQL, Excel' }],
};

/** A signed-in, confirmed student with one resume (their data), from their own made-up network. */
export async function studentWith(page, label, data, who = 'auto') {
  await page.route('http://localhost:8001/**', (r) => r.continue({ headers: { ...r.request().headers(), 'x-forwarded-for': `10.8.${label === 'phone' ? 2 : 1}.${Date.now() % 200}` } }));
  await page.goto('/');
  const mail = email(`${who}-${label}`);
  expect((await call(page, '/api/auth/signup', json('POST', { role: 'customer', name: 'Asha Rao', email: mail, password: PASSWORD, passwordConfirm: PASSWORD, termsAccepted: true }))).status).toBe(201);
  expect((await call(page, '/api/auth/verify-email', json('POST', { email: mail, code: lastCode(mail) }))).status).toBe(200);
  const rs = (await call(page, '/api/me/resumes')).body;
  if (rs.length) await call(page, `/api/me/resumes/${rs[0].id}`, json('PATCH', { data }));
  else expect((await call(page, '/api/me/resumes', json('POST', { id: 'r1', name: 'Main', data, active: true }))).status).toBe(201);
  return mail;
}


const DESC = 'Build weekly dashboards in SQL and Power BI for our retail stores. Freshers are welcome; training is given.';

/** A verified company (its own made-up network for the sign-up), with a helper to post Nm7 jobs in Hyderabad. */
export async function verifiedCompany(request, tag, name = 'Autoco') {
  const { API, ownNetwork, seed } = await import('./helpers.mjs');
  const site = `co${tag}.example`.toLowerCase();
  const mail = `hr-${tag}@example.com`.toLowerCase();
  const NET = ownNetwork();
  const company = { details: { legalName: `${name} ${tag} Pvt Ltd`, website: site, category: 'startup', structure: 'private_limited', industry: 'Software', size: '11_50', about: '' }, registration: { kind: 'llpin', number: 'AAB-1234' }, phone: '' };
  await request.post(`${API}/api/company/signup/code`, { headers: NET, data: { email: mail, name: 'Ira' } });
  const r = await (await request.post(`${API}/api/company/signup/start`, { headers: NET, data: { email: mail, name: 'Ira', code: lastCode(mail), company } })).json();
  const H = { 'X-Recruiter-Account': r.session };
  await request.post(`${API}/api/company/${r.company.id}/company-email/code`, { data: { email: `jobs@${site}` }, headers: H });
  await request.post(`${API}/api/company/${r.company.id}/company-email/verify`, { data: { code: lastCode(`jobs@${site}`) }, headers: H });
  seed('company-verify', r.company.id);
  const post = async (title, extra = {}) => (await (await request.post(`${API}/api/company/${r.company.id}/jobs`, { headers: H, data: { job: { title, description: DESC, locations: ['Hyderabad'], experience: 'fresher', skills: ['SQL', 'Power BI'], ...extra } } })).json());
  return { session: r.session, id: r.company.id, name: `${name} ${tag} Pvt Ltd`, post };
}
