// Job Profile against the real API: fill it, reload and sign in elsewhere, start a resume from it, fill builder
// sections from it (Add vs Replace), keep resume edits out of it until saved, review profile updates, privacy.
import { expect, test } from '@playwright/test';
import { API, PASSWORD, email, login, seed } from './helpers.mjs';

const api = (page, path, opts = {}) => page.evaluate(async ([base, p, o]) => {
  const r = await fetch(`${base}${p}`, { credentials: 'include', ...o, headers: o.body ? { 'Content-Type': 'application/json' } : undefined });
  return r.status === 204 ? null : r.json();
}, [API, path, opts]);

async function signIn(page, who = 'Kiran Rao') {
  const mail = email('profile');
  seed('customer', mail, who, PASSWORD);
  await login(page, mail);
  await page.waitForURL('**/me');
  return mail;
}
const saved = (page) => expect(page.getByText('All changes saved')).toBeVisible({ timeout: 10_000 });
const serverProfile = async (page) => (await api(page, '/api/me/job-profile')).data;

test('fill the Job Profile; it autosaves and survives a reload and another sign-in; phone and keyboard work', async ({ page, browser }) => {
  const mail = await signIn(page);
  // the sidebar has it between My resumes and ATS & job match
  const nav = page.getByRole('navigation', { name: 'My dashboard', exact: true });
  const around = async () => { const n = await nav.getByRole('link').allInnerTexts(); const at = n.findIndex((x) => x.includes('Job Profile')); return at > 0 ? [n[at - 1], n[at + 1]].map((x) => x.replace(/^\W+/, '').trim()) : null; };
  await expect.poll(around).toEqual(['My resumes', 'ATS & job match']);
  await nav.getByRole('link', { name: /Job Profile/ }).click();
  await expect(page).toHaveURL(/\/me\/profile$/);
  await expect(page.getByRole('heading', { name: 'Job Profile', level: 1 })).toBeVisible();
  await expect(page.getByText(/Profile complete: \d+%/)).toBeVisible();
  await expect(page.getByLabel('Full name')).toHaveValue('Kiran Rao');

  await page.locator('#pf-personal-headline').fill('Data Analyst');
  await page.locator('#pf-personal-phone').fill('98765 43210');
  await page.locator('#pf-personal-location').fill('Pune');
  await page.locator('#pf-links-linkedin').fill('linkedin.com/in/kiran');
  await page.locator('#pf-sum-0').fill('Data analyst who turns messy sales data into dashboards that managers use every week.');
  for (const [k, item, field, a, b] of [['exp', 'experience', '#pf-exp-0-company', 'Zoho', null], ['proj', 'project', '#pf-proj-0-title', 'Apollo Tracker', 'Borealis App'], ['edu', 'education', '#pf-edu-0-institution', 'Anna University', null]]) {
    await page.getByRole('button', { name: `+ Add ${item}` }).click();
    await page.locator(field).fill(a);
    if (b) { await page.getByRole('button', { name: `+ Add ${item}` }).click(); await page.locator(field.replace('-0-', '-1-')).fill(b); }
    void k;
  }
  await page.locator('#pf-exp-0-role').fill('Analyst');
  await page.locator('#pf-sg-0').fill('Python, SQL, Excel, Power BI, Statistics');
  await page.locator('#pf-prefs-targetRoles').fill('Data Analyst');
  await page.locator('#pf-prefs-cities').fill('Pune, Remote');
  await page.locator('#pf-prefs-salaryMin').fill('6');
  await page.locator('#pf-prefs-salaryMax').fill('9');

  // entry controls: keyboard move keeps focus on the moved card; switch off; remove asks first
  await page.getByRole('button', { name: 'Move Project 1 down', exact: true }).focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('#pf-proj-0-title')).toHaveValue('Borealis App');
  await expect(page.locator('#entry-pf-proj-1-title')).toBeFocused();
  await page.getByRole('switch', { name: 'Hide Project 1 from resume' }).click();
  await expect(page.getByRole('switch', { name: 'Show Project 1 on resume' })).toBeVisible();
  await page.getByRole('button', { name: 'Remove Education 1' }).click();
  await expect(page.getByRole('dialog', { name: 'Remove Education 1?' })).toBeVisible();
  await page.getByRole('button', { name: 'Cancel' }).click();
  await expect(page.locator('#pf-edu-0-institution')).toHaveValue('Anna University');

  await saved(page);
  const pct = Number((await page.getByText(/Profile complete: \d+%/).innerText()).match(/(\d+)%/)[1]);
  expect(pct).toBeGreaterThanOrEqual(60);
  await expect(page.getByText(/Missing:.*Languages/)).toBeVisible();

  const p = await serverProfile(page);
  expect(p.personal).toMatchObject({ name: 'Kiran Rao', headline: 'Data Analyst', phone: '98765 43210', location: 'Pune' });
  expect(p.proj.map((x) => [x.title, !!x.off])).toEqual([['Borealis App', true], ['Apollo Tracker', false]]);
  expect(p.prefs).toMatchObject({ salaryMin: '6', salaryMax: '9' });

  await page.reload();
  await expect(page.locator('#pf-proj-1-title')).toHaveValue('Apollo Tracker');
  await expect(page.locator('#pf-prefs-salaryMax')).toHaveValue('9');

  // another browser (another sign-in) sees the same profile
  const other = await browser.newContext({ viewport: { width: 375, height: 800 } });
  const phone = await other.newPage();
  await login(phone, mail);
  await phone.waitForURL('**/me');
  await phone.goto('/me/profile');
  await expect(phone.locator('#pf-sum-0')).toHaveValue(/turns messy sales data/);
  await expect(phone.locator('#pf-exp-0-company')).toHaveValue('Zoho');
  // phone width: no sideways scrolling, entry controls in one row and tappable
  expect(await phone.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(375);
  const up = await phone.getByRole('button', { name: 'Move Project 2 up', exact: true }).boundingBox();
  const rm = await phone.getByRole('button', { name: 'Remove Project 2' }).boundingBox();
  expect(Math.abs(up.y - rm.y)).toBeLessThan(12);
  expect(up.height).toBeGreaterThanOrEqual(24);
  // editing on the phone shows up in the first browser after a reload
  await phone.locator('#pf-personal-location').fill('Pune, Maharashtra');
  await expect(phone.getByText('All changes saved')).toBeVisible({ timeout: 10_000 });
  await other.close();
  await page.reload();
  await expect(page.locator('#pf-personal-location')).toHaveValue('Pune, Maharashtra');

  // Settings keeps account details only
  await page.goto('/me/settings');
  await expect(page.getByLabel('Target role')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Fill these into my resume' })).toHaveCount(0);
  await expect(page.getByRole('link', { name: /Job Profile/ }).last()).toBeVisible();
});
