// Auto Apply settings (Phase 3, A1) on a desktop and a 390 px phone, against the real API: a weak resume shows the
// ATS gate with what to fix; a strong resume can start once the consent box is ticked; "What will happen" follows the
// rules typed; Auto Apply is on with preview days; the big Pause / Resume button works; links from My applications
// and the dashboard. No browser dialogs, no sideways scrolling.
import { expect, test } from '@playwright/test';
import { PASSWORD, email, lastCode } from './helpers.mjs';
import { SIZES, call, json, noSideScroll } from './college.mjs';

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

for (const [label, opts] of SIZES) {
  test.describe(label, () => {
    test.use(opts);

    test('gate, consent, what will happen, start, pause and resume', async ({ page }) => {
      test.setTimeout(120_000);
      page.on('dialog', () => { throw new Error('no browser dialogs'); });
      await studentWith(page, label, { personal: { name: 'Asha Rao', email: 'a@example.com' }, summary: '' });
      await page.goto('/me/jobs');
      await page.getByTestId('jobs-auto-apply').click();
      await expect(page).toHaveURL(/\/me\/auto-apply$/);
      // the gate: what to fix, and Start is off
      const gate = page.getByTestId('aa-gate');
      await expect(gate).toContainText('Auto Apply starts at 60');
      await expect(gate.getByRole('link', { name: 'Write a summary of 150–450 characters' })).toHaveAttribute('href', '/builder');
      await expect(page.getByTestId('aa-save')).toBeDisabled();
      expect(await noSideScroll(page)).toBe(true);
      // a strong resume passes
      const rs = (await call(page, '/api/me/resumes')).body;
      await call(page, `/api/me/resumes/${rs[0].id}`, json('PATCH', { data: STRONG }));
      await page.reload();
      await expect(page.getByTestId('aa-gate')).toHaveCount(0);
      const form = page.getByTestId('aa-form');
      await form.getByLabel('Roles or skills to apply for (comma between)').fill('Data Analyst, SQL');
      await form.getByLabel('Cities (comma between; empty = anywhere)').fill('Hyderabad');
      await form.getByText('Fresher', { exact: true }).click();
      await form.getByLabel('Minimum match score (50–100)').fill('75');
      await form.getByLabel('Companies to avoid (comma between)').fill('Spam Corp');
      const will = page.getByTestId('aa-will');
      await expect(will).toContainText('new jobs for Data Analyst, SQL, in Hyderabad or remote');
      await expect(will).toContainText('matches 75% or more');
      await expect(will).toContainText('Never to: Spam Corp.');
      await expect(will).toContainText('Nm7 never fills in other sites');
      // consent needed
      await page.getByTestId('aa-save').click();
      await expect(form.getByRole('alert')).toContainText('Tick the box');
      await form.getByText('Nm7 may apply for me and share my profile with these companies.').click();
      expect(await noSideScroll(page)).toBe(true);
      await page.getByTestId('aa-save').click();
      await expect(page.getByTestId('aa-state')).toHaveText('Auto Apply is on');
      await expect(page.getByTestId('aa-preview')).toContainText('for 3 more days');
      // the big Pause / Resume
      await page.getByTestId('aa-pause').click();
      await expect(page.getByTestId('aa-state')).toHaveText('Auto Apply is paused');
      await page.getByTestId('aa-pause').click();
      await expect(page.getByTestId('aa-state')).toHaveText('Auto Apply is on');
      // in Telugu too
      await page.getByRole('button', { name: 'తెలుగు' }).click();
      await expect(page.getByTestId('aa-state')).toHaveText('ఆటో అప్లై ఆన్‌లో ఉంది');
      await page.getByRole('button', { name: 'English' }).click();
      // the dashboard link
      await page.goto('/me');
      await expect(page.getByTestId('home-auto-apply')).toHaveAttribute('href', '/me/auto-apply');
    });
  });
}
