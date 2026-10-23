// Job preferences are gone (Naresh's decision, Oct 2026), on a desktop and a 390 px phone: no "Job preferences" card
// on the Job Profile, no "Preferences" step in the builder, no preferences note under the live preview; Job Profile
// completeness and Profile strength still reach 100%; an old resume that still holds saved preferences opens and
// downloads normally (nothing of them printed); the drive join form still asks "Preferred job / location".
import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { API, PASSWORD, adminLogin, asTestPerson, email, login, pdfText, seed } from './helpers.mjs';

const SIZES = [['desktop', { width: 1280, height: 900 }], ['phone', { width: 390, height: 844 }]];
const api = (page, path, init = {}) => page.evaluate(async ([base, p, i]) => {
  const r = await fetch(`${base}${p}`, { credentials: 'include', headers: { 'Content-Type': 'application/json' }, ...i });
  if (!r.ok) throw new Error(`${r.status} ${await r.text()}`);
  return r.status === 204 ? null : r.json();
}, [API, path, init]);
const sections = (page) => page.getByRole('navigation', { name: 'Sections' });
async function openEditor(page) {
  await page.goto('/builder');
  await page.evaluate(() => window.history.replaceState({ usr: { open: 'build' }, key: 'x' }, ''));
  await page.reload();
  await expect(page.getByText(/Live preview ·/)).toBeVisible();
}
const LEGACY_PREFS = { jobTypes: ['Full-time'], salary: '₹5–10 LPA', notice: '1 month', locations: 'Pune, Remote', remote: true, relocation: false, industries: ['Technology'] };

for (const [label, size] of SIZES) {
  test.describe(label, () => {
    test.use({ viewport: size });

    test('builder: no Preferences step, no preferences note, and Profile strength reaches 100%', async ({ page }) => {
      // a complete resume (summary and an achievement added) that has passed Review & Submit
      await asTestPerson(page, { summary: 'Data analyst who turns raw sales data into dashboards that managers use every week.', ach: [{ title: 'Hackathon winner', type: '', issuer: '', date: '', description: '', links: [] }], reviewedAt: Date.now() });
      await openEditor(page);
      await expect(sections(page).getByRole('button', { name: /^Preferences/ })).toHaveCount(0);
      await expect(sections(page).getByRole('button', { name: /^Links/ })).toBeVisible();
      const note = page.getByText('Personal information, declaration and your photo print only when you switch them on.');
      await expect(note).toBeVisible();
      await expect(page.getByText(/Job preferences stay on your Nm7 profile/)).toHaveCount(0);
      await expect(page.locator('[aria-live="polite"].display').first()).toHaveText('100%');
    });

    test('Job Profile: no Job preferences card, Experience level in Basics, and completeness reaches 100%', async ({ page }) => {
      const mail = email(`noprefs-${label}`);
      seed('customer', mail, 'Kiran Rao', PASSWORD);
      await login(page, mail);
      await page.waitForURL('**/me');
      const cur = await api(page, '/api/me/job-profile').catch(() => ({ version: 0 }));
      const e = (x, i) => ({ ...x, pid: `p${i}`, pu: 1 });
      const full = {
        personal: { name: 'Kiran Rao', headline: 'Data Analyst', email: mail, phone: '98765 43210', location: 'Pune', level: 'Fresher (0–1 yr)' },
        links: { linkedin: 'linkedin.com/in/kiran', github: '', portfolio: '' },
        summaries: [{ id: 's1', name: 'Main', text: 'Data analyst who turns messy sales data into dashboards that managers use every week.' }],
        exp: [e({ company: 'Zoho', role: 'Analyst' }, 1)], intern: [], proj: [e({ title: 'Sales dashboard' }, 2)], edu: [e({ institution: 'Anna University', degree: 'B.Sc' }, 3)],
        certs: [e({ name: 'Google Data Analytics' }, 4)], ach: [], langs: [e({ name: 'Tamil', level: 'Native' }, 5)], extra: [],
        skillGroups: [e({ id: 'core', label: 'Core', value: 'Python, SQL, Excel, Power BI, Statistics' }, 6)],
        hobbies: '', strengths: '', offLines: {}, pinfo: {}, decl: {},
      };
      await api(page, '/api/me/job-profile', { method: 'PUT', body: JSON.stringify({ data: full, version: cur.version || 0 }) });
      await page.goto('/me/profile');
      await expect(page.getByText('Profile complete: 100%')).toBeVisible();
      await expect(page.getByRole('heading', { name: 'Job preferences' })).toHaveCount(0);
      for (const t of ['Target roles', 'Preferred cities', 'Notice period', 'Expected salary']) await expect(page.getByText(t, { exact: false })).toHaveCount(0);
      await expect(page.locator('#pf-personal-level')).toHaveValue('Fresher (0–1 yr)');
    });

    test('an old resume that still holds job preferences opens and downloads normally; nothing of them is printed', async ({ page }) => {
      const mail = email(`legacy-${label}`);
      seed('customer', mail, 'Meena Iyer', PASSWORD);
      await login(page, mail);
      await page.waitForURL('**/me');
      // a resume saved before the change: it still holds job preferences
      const first = { id: `r${Date.now()}` };
      const data = { personal: { name: 'Meena Iyer', headline: 'Accounts Executive', email: mail, phone: '', location: 'Chennai', level: '' }, summary: 'Accounts executive with GST filing experience.', prefs: LEGACY_PREFS };
      await api(page, '/api/me/resumes', { method: 'POST', body: JSON.stringify({ id: first.id, name: 'Old resume', data, jd: '', active: true, versions: [] }) });
      await openEditor(page);
      await expect(page.getByTestId('save-status')).toHaveText('All changes saved', { timeout: 15_000 });
      await expect(page.getByLabel('Full name')).toHaveValue('Meena Iyer');
      const [file] = await Promise.all([page.waitForEvent('download', { timeout: 30_000 }), page.getByRole('button', { name: 'Download PDF' }).click()]);
      expect(file.suggestedFilename()).toBe('Meena_Iyer_Resume.pdf');
      const text = (await pdfText(readFileSync(await file.path()))).join(' ');
      expect(text).toContain('Meena Iyer');
      for (const t of ['LPA', 'Pune, Remote', '1 month', 'Full-time']) expect(text).not.toContain(t);
      // the stored values stay untouched (kept unused for 30 days)
      const again = (await api(page, '/api/me/resumes')).find((r) => r.id === first.id);
      expect(again.data.prefs).toEqual(LEGACY_PREFS);
    });
  });
}

test('the drive join form still asks preferred job and preferred location', async ({ page, browser }) => {
  const owner = email('noprefs-owner');
  const { secret } = seed('admin', owner, 'owner', PASSWORD);
  const code = `NP${Date.now().toString(36).slice(-6).toUpperCase()}`;
  await adminLogin(page, owner, secret);
  await page.getByRole('navigation', { name: 'Admin sections' }).getByRole('link', { name: 'Organizations' }).click();
  const newOrg = page.getByRole('form', { name: 'New organization' });
  await newOrg.getByLabel('Organization name').fill('Job Mela Vizag');
  await newOrg.getByRole('button', { name: 'Add organization' }).click();
  await page.getByRole('button', { name: 'New group' }).click();
  const form = page.getByRole('form', { name: 'New group' });
  await form.getByLabel('Group name').fill('Walk-in 2026');
  await form.getByLabel('Join code').fill(code);
  await form.getByRole('button', { name: '+ Preferred job' }).click();
  await form.getByRole('button', { name: '+ Preferred location' }).click();
  await form.getByRole('button', { name: 'Save group' }).click();
  await expect(page.getByRole('region', { name: 'Group Walk-in 2026' })).toBeVisible();

  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const m = await ctx.newPage();
  const mail = email('noprefs-member');
  seed('customer', mail, 'Ravi Teja', PASSWORD);
  await login(m, mail);
  await m.waitForURL('**/me');
  await m.goto(`/join/${code}`);
  await expect(m.getByLabel(/^Preferred job/)).toBeVisible();
  await expect(m.getByLabel(/^Preferred location/)).toBeVisible();
  await ctx.close();
});
