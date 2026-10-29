// Placement dashboard (colleges, Phase 1) on a desktop and a 390 px phone, against the real API:
//   Free plan: tiles only, with the upgrade note; Drive: funnel, ATS bands, top missing items, skills, weekly progress,
//   roll list upload (matched to members who joined), "who's missing" tabs, reminder, mark needs changes, CSV;
//   a student's edit shows on the next refresh; no sideways scroll on a phone.
//   Admin: the demo college (Create / reset), its dashboard (48 students, 12 not joined), marked Demo.
import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { API, PASSWORD, adminLogin, apiMember, email, login, seed } from './helpers.mjs';

const SIZES = [['desktop', { viewport: { width: 1280, height: 900 } }], ['phone', { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true }]];
const call = (page, path, init = {}) => page.evaluate(async ([base, p, i]) => {
  const r = await fetch(`${base}${p}`, { credentials: 'include', headers: { 'Content-Type': 'application/json' }, ...i });
  return { status: r.status, body: r.status === 204 ? null : await r.json() };
}, [API, path, init]);
const FIELDS = [
  { key: 'roll', label: 'Roll number', type: 'text', required: true },
  { key: 'branch', label: 'Branch', type: 'select', options: ['CSE', 'ECE'], required: true },
];
const STRONG = {
  personal: { name: 'Asha Rao', email: 'asha@example.com', phone: '+91 90000 00001', headline: 'Backend Developer' },
  links: { linkedin: 'linkedin.com/in/asha-demo' },
  summary: 'Backend developer with an internship building REST APIs in Python and Django. Cut API response time by 40% at Acme Labs and shipped a payments module used by 2,000 students. Looking for a backend role.',
  exp: [{ company: 'Acme Labs', role: 'Backend Intern', from: '2025-01', to: '2025-06', description: 'Built REST APIs in Django for 3 internal tools\nReduced API response time by 40% with Redis caching' }],
  proj: [{ title: 'Campus Pay', tagline: '', description: 'Designed a payments module used by 2,000 students', tech: 'Python, Django', links: [] }],
  edu: [{ institution: 'Test Institute', degree: 'B.Tech', field: 'CSE', from: '2021-08', to: '2025-05', grade: '8.6 CGPA' }],
  skillGroups: [{ id: 'core', label: 'Core', value: 'Python, Java, SQL, Django, REST API, Redis, PostgreSQL, Git, Docker' }],
  certs: [{ name: 'AWS Cloud Practitioner' }],
};
const THIN = { personal: { name: 'Bala K', email: 'bala@example.com' }, edu: [{ degree: 'B.Tech' }], skillGroups: [{ value: 'C' }] };

async function setup(page, browser, playwright, label) {
  const owner = email(`pl-owner-${label}`);
  const { secret } = seed('admin', owner, 'owner', PASSWORD);
  await adminLogin(page, owner, secret);
  await expect(page).not.toHaveURL(/\/login/);
  const made = await call(page, '/api/admin/orgs', { method: 'POST', body: JSON.stringify({ name: `Placement College ${label}`, type: 'college', city: 'Nellore' }) });
  expect(made.status, JSON.stringify(made.body)).toBe(201);
  const org = made.body;
  const code = `PL${Date.now().toString(36).slice(-6).toUpperCase()}`;
  const g = await call(page, `/api/admin/orgs/${org.id}/groups`, { method: 'POST', body: JSON.stringify({ name: 'B.Tech 2026', code, customFields: FIELDS }) });
  expect(g.status).toBe(201);
  const coordMail = email(`pl-coord-${label}`);
  const inv = (await call(page, `/api/admin/orgs/${org.id}/staff`, { method: 'POST', body: JSON.stringify({ email: coordMail, role: 'coordinator' }) })).body;
  const asha = email(`pl-asha-${label}`);
  const bala = email(`pl-bala-${label}`);
  await apiMember(playwright, asha, 'Asha Rao', code, { roll: '26CS001', branch: 'CSE' }, STRONG);
  const b = await apiMember(playwright, bala, 'Bala K', code, { roll: '26CS002', branch: 'CSE' }, THIN);
  seed('customer', coordMail, 'Placement Officer', PASSWORD);
  const ctx = await browser.newContext({ ...test.info().project.use, ...SIZES.find(([l]) => l === label)[1], baseURL: 'http://localhost:5182' });
  const c = await ctx.newPage();
  await login(c, coordMail);
  await c.waitForURL(/\/(me|org)/);
  const token = inv.inviteUrl.split('/').pop();
  expect((await call(c, `/api/org-invites/${token}/accept`, { method: 'POST', body: '{}' })).status).toBe(200);
  return { org, groupId: g.body.id, c, ctx, asha, bala, balaApi: b.api };
}

for (const [label, opts] of SIZES) {
  test.describe(label, () => {
    test.use(opts);

    test('placement dashboard: Free tiles, then Drive: charts, roll list, who’s missing, reminder, needs changes, CSV', async ({ page, browser, playwright }) => {
      const { org, c, ctx, asha, balaApi } = await setup(page, browser, playwright, label);
      await c.goto(`/org/${org.id}`);
      await c.getByRole('navigation', { name: 'Organization' }).getByRole('link', { name: 'Dashboard' }).click();
      await expect(c).toHaveURL(new RegExp(`/org/${org.id}/dashboard$`));
      const dash = c.getByTestId('placement');
      await expect(dash.getByTestId('pl-joined')).toContainText('2');
      await expect(dash.getByTestId('pl-shared')).toContainText('100%');
      await expect(dash.getByTestId('pl-linkedin')).toContainText('50%');
      await expect(dash.getByTestId('pl-upgrade')).toContainText('Drive and Campus');
      await expect(dash.getByTestId('pl-funnel')).toHaveCount(0);

      // Nm7 puts the organization on Drive: charts, lists and the roll list appear
      expect((await call(page, `/api/admin/orgs/${org.id}/billing/plan`, { method: 'PUT', body: JSON.stringify({ planId: 'drive' }) })).status).toBe(200);
      await c.reload();
      await expect(dash.getByTestId('pl-funnel')).toContainText('Joined');
      await expect(dash.getByTestId('pl-bands')).toContainText('ATS score by branch');
      await expect(dash.getByTestId('pl-gaps')).toContainText('% ');
      await expect(dash.getByTestId('pl-skills')).toContainText('Python');
      await expect(dash.getByTestId('pl-weekly')).toBeVisible();
      // roll list: two who joined and one who hasn't
      const csv = `Name,Roll Number,Branch,Email\nAsha Rao,26CS001,CSE,${asha}\nBala K,26cs-002,CSE,\nChitra S,26CS003,CSE,chitra@example.com\n`;
      await dash.getByLabel('Roll list CSV').setInputFiles({ name: 'roll.csv', mimeType: 'text/csv', buffer: Buffer.from(csv) });
      await expect(dash.getByTestId('pl-roll-count')).toHaveText('3 students · 2 joined');
      await expect(dash.getByTestId('pl-joined')).toContainText('of 3 on the roll list');
      const missing = dash.getByTestId('pl-missing');
      await missing.getByRole('tab', { name: /Not joined/ }).click();
      await expect(missing.getByTestId('pl-missing-table')).toContainText('Chitra S');
      await expect(missing.getByTestId('pl-missing-table')).toContainText('26CS003');
      // low ATS: Bala; mark needs changes with a note, then remind
      await missing.getByRole('tab', { name: /Low ATS/ }).click();
      await expect(missing.getByTestId('pl-missing-table')).toContainText('Bala K');
      await missing.getByRole('checkbox', { name: 'Select Bala K' }).check();
      await missing.getByRole('button', { name: 'Mark needs changes' }).click();
      await c.getByLabel('What needs to change').fill('Add a project with a result.');
      await c.getByRole('dialog').getByRole('button', { name: 'Mark needs changes' }).click();
      await expect(c.getByText('1 marked “Needs changes”')).toBeVisible();
      await missing.getByRole('tab', { name: /Needs changes/ }).click();
      await expect(missing.getByTestId('pl-missing-table')).toContainText('Add a project with a result.');
      await missing.getByRole('checkbox', { name: 'Select Bala K' }).check();
      await missing.getByRole('button', { name: /Send reminder/ }).click();
      await c.getByRole('dialog').getByRole('button', { name: 'Send' }).click();
      await expect(c.getByText(/1 reminder sent|0 reminders sent/)).toBeVisible();
      // CSV of the tab
      const [file] = await Promise.all([c.waitForEvent('download'), missing.getByRole('button', { name: 'Download CSV' }).click()]);
      expect(file.suggestedFilename()).toMatch(/^Needs_changes_\d{4}-\d{2}-\d{2}\.csv$/);
      expect(readFileSync(await file.path(), 'utf8')).toContain('Bala K,26CS002,CSE');
      // a student improves their resume: the next refresh shows it
      await balaApi.patch('/api/me/resumes/r1', { data: { data: STRONG } });
      await c.reload();
      await expect(dash.getByTestId('pl-ats')).toContainText('0 under 60');
      expect(await c.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(opts.viewport.width);
      // the activity log has the roll list upload
      await c.getByRole('navigation', { name: 'Organization' }).getByRole('link', { name: 'Activity' }).click();
      await expect(c.getByText('roll_list_upload').first()).toBeVisible();
      await ctx.close();
    });
  });
}

test('admin: the demo college, its dashboard, marked Demo', async ({ page }) => {
  const owner = email('pl-demo-owner');
  const { secret } = seed('admin', owner, 'owner', PASSWORD);
  await adminLogin(page, owner, secret);
  await expect(page).not.toHaveURL(/\/login/);
  await page.goto('/admin/orgs');
  await page.getByTestId('demo-org').getByRole('button', { name: 'Create / reset demo' }).click();
  await expect(page.getByRole('heading', { name: 'Placement dashboard' })).toBeVisible();
  const dash = page.getByTestId('placement');
  await expect(dash.getByTestId('pl-joined')).toContainText('48');
  await expect(dash.getByTestId('pl-joined')).toContainText('of 60 on the roll list');
  await dash.getByRole('tab', { name: /Not joined/ }).click();
  await expect(dash.getByTestId('pl-missing-table').getByRole('row')).toHaveCount(13);
  await page.getByRole('button', { name: 'Back to the organization' }).click();
  await expect(page.getByRole('heading', { name: 'Demo Engineering College' })).toBeVisible();
  await page.goto('/admin/orgs');
  await expect(page.getByRole('row', { name: /Demo Engineering College/ }).getByText('Demo', { exact: true })).toBeVisible();
});
