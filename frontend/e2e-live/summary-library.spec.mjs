// "Pick a ready summary" on the Summary step (freshers): 12 cards with headings, the one matching the target role
// first; a tap fills the summary box, which can be edited and is saved; small personal touches (languages in #11,
// skills in #3). Desktop and a 390 px phone. The guest draft is the sample resume (Data Analyst headline, fresher).
import { expect, test } from '@playwright/test';

const HEADINGS = ['Best Overall Resume Summary', 'Software Developer / IT Fresher', 'Data Analyst Fresher', 'Data Science / AI Fresher', 'Electronics and Communication Engineering Fresher', 'Non-Technical / Any Graduate Fresher', 'HR / Recruitment Fresher', 'Business Analyst Fresher', 'Sales and Marketing Fresher', 'Finance / Accounts Fresher', 'General Fresher (no course mentioned)', 'Skills and Project Fresher (no course mentioned)'];
const BEST = 'Motivated and detail-oriented graduate with a strong willingness to learn, adapt, and contribute to organizational success. Possess good analytical, problem-solving, and communication skills, with the ability to work collaboratively in a team environment. Eager to apply academic knowledge, develop professional expertise, and contribute to business growth.';

async function openSummaryStep(page) {
  await page.goto('/builder');
  await page.getByRole('button', { name: /Start from scratch/ }).click();
  await page.getByTestId('tp-use-top').click();
  await expect(page.getByText(/Live preview ·/)).toBeVisible();
  await page.getByRole('navigation', { name: 'Sections' }).getByRole('button', { name: /^Summary/ }).click();
}
const panel = (page) => page.getByTestId('ready-summaries');
const box = (page) => page.getByLabel('Your summary');

for (const [label, size] of [['desktop', { width: 1280, height: 900 }], ['phone', { width: 390, height: 844 }]]) {
  test.describe(label, () => {
    test.use({ viewport: size });

    test('12 ready summaries with headings, Data Analyst first; a tap fills the box, it edits and saves', async ({ page }) => {
      await openSummaryStep(page);
      await expect(panel(page).getByRole('heading', { name: 'Pick a ready summary' })).toBeVisible();
      const cards = panel(page).getByRole('listitem');
      await expect(cards).toHaveCount(12);
      for (const h of HEADINGS) await expect(panel(page).getByText(h, { exact: true })).toBeVisible();
      await expect(cards.first().getByRole('button')).toHaveAttribute('data-testid', 'ready-3'); // headline "Data Analyst · …"
      await expect(page.getByTestId('ready-tip')).toHaveText('Change it to match your real skills, projects and target role. Remove anything that doesn’t describe you.');
      // tap → the box holds the text exactly; it stays editable and is saved
      await page.getByTestId('ready-1').click();
      await expect(box(page)).toHaveValue(BEST);
      await box(page).fill(`${BEST} Built a sales dashboard in Power BI.`);
      await expect(page.getByRole('region', { name: 'Live resume preview' })).toContainText('Built a sales dashboard in Power BI.');
      await page.waitForTimeout(1200);
      await page.evaluate(() => window.history.replaceState({ usr: { open: 'build' }, key: 'x' }, '')); // back into the editor
      await page.reload();
      await page.getByRole('navigation', { name: 'Sections' }).getByRole('button', { name: /^Summary/ }).click();
      await expect(box(page)).toHaveValue(`${BEST} Built a sales dashboard in Power BI.`);
      // chips filter
      await panel(page).getByRole('button', { name: 'Tech', exact: true }).click();
      await expect(cards).toHaveCount(4);
      await panel(page).getByRole('button', { name: 'All', exact: true }).click();
      await expect(cards).toHaveCount(12);
    });

    test('personal touches: the resume\'s languages in #11 and its skills in #3', async ({ page }) => {
      await openSummaryStep(page);
      await page.getByTestId('ready-11').click();
      await expect(box(page)).toHaveValue(/communicates clearly in English, Tamil and Hindi\./);
      await page.getByTestId('ready-3').click();
      await expect(box(page)).toHaveValue(/practical skills in Python, SQL, Statistics, and Pandas to transform raw data/);
    });
  });
}

test('only for freshers; headings in Telugu when the site is in Telugu', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('nm7-lang', 'te'));
  await openSummaryStep(page);
  await expect(panel(page).getByText('డేటా అనలిస్ట్ ఫ్రెషర్')).toBeVisible();
  await expect(page.getByTestId('ready-3')).toContainText('Detail-oriented graduate'); // the text stays English
  await page.getByRole('navigation', { name: 'Sections' }).getByRole('button', { name: /^Personal Info(?!rmation)/ }).click();
  await page.getByLabel('Experience level').selectOption('Junior (1–3 yrs)');
  await page.getByRole('navigation', { name: 'Sections' }).getByRole('button', { name: /^Summary/ }).click();
  await expect(box(page)).toBeVisible();
  await expect(panel(page)).toHaveCount(0);
});
