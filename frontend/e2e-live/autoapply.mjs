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

