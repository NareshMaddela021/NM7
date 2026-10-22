// "Write it from my resume" on the Summary step (no AI): an empty summary is filled from the resume when the step
// opens and labelled; a full resume gives 3 sentences, skills only 1–2; never an empty blank; the course only with
// "Mention my course"; changed skills ask "Update the summary?"; an edited summary is never replaced without asking.
// Also: Profile strength comes only from the ticks. Desktop and a 390 px phone; the guest draft is a filled-in test person (helpers TEST_PERSON).
import { expect, test } from '@playwright/test';
import { asTestPerson } from './helpers.mjs';

const DRAFT = 'asuraa-builder-draft-v6';
const nav = (page) => page.getByRole('navigation', { name: 'Sections' });
const box = (page) => page.getByLabel('Your summary');
const sentences = (t) => t.split(/(?<=\.)\s+/).filter(Boolean);

async function openEditor(page, patch = null) {
  await page.goto('/builder');
  if (patch) {
    await page.evaluate(([key, p]) => {
      const d = JSON.parse(localStorage.getItem(key) || 'null');
      if (d) localStorage.setItem(key, JSON.stringify({ ...d, ...p, personal: { ...d.personal, ...(p.personal || {}) } }));
    }, [DRAFT, patch]);
  }
  await page.evaluate(() => window.history.replaceState({ usr: { open: 'build' }, key: 'x' }, ''));
  await page.reload();
  await expect(page.getByText(/Live preview ·/)).toBeVisible();
}
async function ensureDraft(page) { // the first visit writes the test person's draft to this browser
  await openEditor(page);
  await page.waitForFunction((k) => !!localStorage.getItem(k), DRAFT);
}
const toSummary = (page) => nav(page).getByRole('button', { name: /^Summary/ }).click();

for (const [label, size] of [['desktop', { width: 1280, height: 900 }], ['phone', { width: 390, height: 844 }]]) {
  test.describe(label, () => {
    test.use({ viewport: size });
    test.beforeEach(({ page }) => asTestPerson(page));

    test('a full resume: the empty summary is written on arrival — three sentences, labelled, no blanks', async ({ page }) => {
      await openEditor(page);
      await toSummary(page);
      await expect(box(page)).toHaveValue('Data Analyst Intern at Northwind Retail, skilled in Python, SQL and Statistics. Completed Google Data Analytics Certificate, with project work including Sales Dashboard Revamp. Looking for an entry-level Data Analyst role.');
      expect(sentences(await box(page).inputValue())).toHaveLength(3);
      await expect(page.getByTestId('written-note')).toHaveText('Written from your resume, edit anything');
      // three versions to pick from; the course only with "Mention my course"
      await page.getByRole('button', { name: 'Write it from my resume' }).click();
      const versions = page.getByTestId('from-resume-versions');
      await expect(versions.getByRole('button')).toHaveCount(3);
      await expect(versions).toContainText('Role-first');
      await expect(versions).toContainText('Skills-first');
      await expect(versions).toContainText('Simple');
      await expect(versions).not.toContainText('B.Tech');
      await page.getByLabel('Mention my course').check();
      await expect(versions).not.toContainText('B.Tech'); // she has a job: the course isn't in "who"
      await page.getByTestId('from-skills_first').click();
      await expect(box(page)).toHaveValue(/^Skilled in Python, SQL and Statistics, with experience as Data Analyst Intern at Northwind Retail\./);
      for (const t of [await box(page).inputValue()]) expect(t).not.toMatch(/\{|\}|undefined|\s\.|\b(I|me|my)\b/);
    });

    test('skills only: one or two sentences; the course appears only when switched on', async ({ page }) => {
      await ensureDraft(page);
      await openEditor(page, { summary: '', exp: [], proj: [], certs: [], personal: { headline: '', level: 'Fresher (0–1 yr)' }, skillGroups: [{ id: 'core', label: 'Core', value: 'Tally, GST filing' }] });
      await toSummary(page);
      await expect(box(page)).toHaveValue('Fresher skilled in Tally and GST filing.');
      expect(sentences(await box(page).inputValue()).length).toBeLessThanOrEqual(2);
      await page.getByLabel('Mention my course').check();
      await page.getByRole('button', { name: 'Write it from my resume' }).click();
      await expect(page.getByTestId('from-role_first')).toContainText('B.Tech in Computer Science graduate skilled in Tally and GST filing.');
    });

    test('changed skills ask to update; Update rewrites, Keep mine never replaces an edited summary', async ({ page }) => {
      await openEditor(page);
      await toSummary(page);
      await expect(page.getByTestId('written-note')).toBeVisible();
      // a skills change → the prompt → Update
      await nav(page).getByRole('button', { name: /^Skills/ }).click();
      await page.locator('#sg-core').fill('R, Tableau, SQL');
      await toSummary(page);
      await expect(page.getByTestId('summary-changed')).toContainText('Your resume changed. Update the summary?');
      await page.getByTestId('summary-changed').getByRole('button', { name: 'Update' }).click();
      await expect(box(page)).toHaveValue(/skilled in R, Tableau and SQL\./);
      await expect(page.getByTestId('summary-changed')).toHaveCount(0);
      // she edits it; another skills change → the prompt, but nothing is replaced until she says so
      const mine = 'My own words about dashboards and SQL reports for a retail team, written by me.';
      await box(page).fill(mine);
      await nav(page).getByRole('button', { name: /^Skills/ }).click();
      await page.locator('#sg-core').fill('Python, SQL');
      await toSummary(page);
      await expect(page.getByTestId('summary-changed')).toBeVisible();
      await expect(box(page)).toHaveValue(mine);
      await page.getByTestId('summary-changed').getByRole('button', { name: 'Keep mine' }).click();
      await expect(page.getByTestId('summary-changed')).toHaveCount(0);
      await page.waitForTimeout(1200);
      await page.evaluate(() => window.history.replaceState({ usr: { open: 'build' }, key: 'x' }, ''));
      await page.reload();
      await toSummary(page);
      await expect(box(page)).toHaveValue(mine);
      await expect(page.getByTestId('summary-changed')).toHaveCount(0);
    });
  });
}

test('profile strength comes only from the ticks: Review & Submit unticked keeps it under 100%', async ({ page }) => {
  await asTestPerson(page);
  await ensureDraft(page);
  await openEditor(page, { hobbies: '' });
  const strength = async () => Number((await page.locator('[aria-live="polite"].display').first().innerText()).replace('%', ''));
  const s = await strength();
  expect(s).toBeLessThan(100); // Achievements is empty and Review & Submit not done
  await expect(nav(page).getByRole('button', { name: /^Hobbies/ })).toContainText('optional');
  await expect(nav(page).getByRole('button', { name: /^Achievements/ })).not.toContainText('optional');
});
