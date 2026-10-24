// The example person (Sai Varsha) is never saved: "New blank" in My resumes starts truly empty (only the account's
// name, email and phone), even when this browser still holds an old draft filled with the sample; the old draft is
// cleaned once; nothing of the sample reaches the server, the Job Profile or the browser draft. Desktop + 390 px phone.
import { expect, test } from '@playwright/test';
import { API, PASSWORD, email, login, seed } from './helpers.mjs';

const SIZES = [['desktop', { width: 1280, height: 900 }], ['phone', { width: 390, height: 844 }]];
const SAMPLE_TEXT = ['sai-varsha-example', 'R. Raman', 'S. Lakshmi', '2003-05-15', 'Lakeview Institute', 'Northwind Retail', 'Sai Varsha', 'saivarsha@example.com', 'Volunteering at NSS', 'Quick learner', 'Python, SQL, Statistics', 'Power BI, Excel, Git', 'Sales Dashboard Revamp', 'Google Data Analytics'];
const leaks = (v) => SAMPLE_TEXT.filter((t) => JSON.stringify(v).includes(t));

/** What older versions left in the browser: a draft that is the sample person. */
const OLD_DRAFT = {
  personal: { name: 'Sai Varsha', headline: 'Data Analyst · SQL · Power BI', email: 'saivarsha@example.com', phone: '+91 98765 43210', location: 'Chennai, Tamil Nadu', level: 'Fresher (0–1 yr)' },
  links: { linkedin: 'linkedin.com/in/sai-varsha-example', github: 'github.com/sai-varsha-example' },
  pinfo: { father: 'R. Raman', mother: 'S. Lakshmi', dob: '2003-05-15', languages: 'English, Tamil, Hindi', nationality: 'Indian' },
  hobbies: 'Reading\nPlaying chess\nVolunteering at NSS camps', strengths: 'Quick learner\nTeam player\nGood communication skills',
  edu: [{ institution: 'Lakeview Institute of Technology', degree: 'B.Tech', field: 'Computer Science', from: '2021-08', to: '2025-05', current: false, grade: '8.1 CGPA' }],
  exp: [{ company: 'Northwind Retail', role: 'Data Analyst Intern', from: '2025-01', to: '2025-06', current: false, description: 'x' }],
  skillGroups: [{ id: 'core', label: 'Core', value: 'Python, SQL, Statistics' }, { id: 'tools', label: 'Tools', value: 'Power BI, Excel, Git' }],
};
const plantOldDraft = (page) => page.evaluate((d) => {
  localStorage.removeItem('nm7-sample-drafts-cleared');
  localStorage.setItem('asuraa-builder-draft-v6', JSON.stringify(d));
  localStorage.setItem('asuraa-builder-draft-v6:old-user', JSON.stringify(d));
}, OLD_DRAFT);
const drafts = (page) => page.evaluate(() => Object.keys(localStorage).filter((k) => k.startsWith('asuraa-builder-draft')).map((k) => localStorage.getItem(k)));
const api = (page, path) => page.evaluate(async ([base, p]) => (await fetch(`${base}${p}`, { credentials: 'include' })).json(), [API, path]);

for (const [label, size] of SIZES) {
  test.describe(label, () => {
    test.use({ viewport: size });

    test('New blank saves no sample text anywhere, even with an old sample draft in this browser', async ({ page }) => {
      const mail = email('blank');
      seed('customer', mail, 'Anjali Kumar', PASSWORD);
      await page.goto('/');
      await plantOldDraft(page);
      await login(page, mail);
      await page.waitForURL('**/me');
      await expect.poll(() => page.evaluate(() => localStorage.getItem('nm7-sample-drafts-cleared'))).toBe('1'); // cleaned once
      expect(leaks(await drafts(page))).toEqual([]);

      await page.goto('/me/resumes');
      await page.getByRole('button', { name: 'New blank' }).click();
      await expect(page).toHaveURL(/\/builder$/);
      await expect(page.getByTestId('save-status')).toHaveText('All changes saved', { timeout: 15_000 });
      await expect(page.getByLabel('Full name')).toHaveValue('Anjali Kumar');
      const live = page.getByRole('region', { name: 'Live resume preview' });
      await expect(live).toContainText('Anjali Kumar');
      for (const t of ['Sai Varsha', 'Lakeview', 'R. Raman', 'Northwind']) await expect(live).not.toContainText(t);

      const resumes = await api(page, '/api/me/resumes');
      expect(resumes.length).toBeGreaterThanOrEqual(2);
      expect(leaks(resumes)).toEqual([]);
      const fresh = resumes.find((r) => r.name.startsWith('New resume'));
      expect(fresh.data.personal).toMatchObject({ name: 'Anjali Kumar', email: mail, headline: '', location: '' });
      expect([fresh.data.exp, fresh.data.edu, fresh.data.proj, fresh.data.langs]).toEqual([[], [], [], []]);
      expect(leaks(await api(page, '/api/me/job-profile'))).toEqual([]);
      expect(leaks(await drafts(page))).toEqual([]);
    });

    test('a guest starts with an empty builder and the sample is never saved as their draft', async ({ page }) => {
      await page.goto('/');
      await plantOldDraft(page);
      await page.goto('/builder');
      await page.evaluate(() => window.history.replaceState({ usr: { open: 'build' }, key: 'x' }, ''));
      await page.reload();
      await expect(page.getByLabel('Full name')).toHaveValue('');
      await page.getByLabel('Full name').fill('Ravi Teja');
      await expect.poll(async () => (await drafts(page)).join('')).toContain('Ravi Teja');
      expect(leaks(await drafts(page))).toEqual([]);
    });
  });
}
