// /templates with "Sample resume | My details", on a desktop and a 390 px phone: Sample shows the example person,
// My details shows the signed-in person's own resume (and follows edits made in the builder, also in another tab);
// signed out, My details asks them to start a resume; "Use this template" and the builder's "Change template" keep
// every bit of content. Nothing downloads unless Download is tapped.
import { expect, test } from '@playwright/test';
import { API, PASSWORD, email, login, seed, downloadThrough } from './helpers.mjs';

const SIZES = [['desktop', { width: 1280, height: 900 }], ['phone', { width: 390, height: 844 }]];
const card = (page, i = 0) => page.getByTestId('template-grid').getByRole('button', { name: /^Preview the .* template$/ }).nth(i);
const preview = (page) => page.getByRole('dialog', { name: /template preview$/ });
const switchTo = (scope, name) => scope.getByRole('group', { name: 'Show the templates with' }).getByRole('button', { name });

async function signIn(page, name) {
  const mail = email('tg');
  seed('customer', mail, name, PASSWORD);
  await login(page, mail);
  await page.waitForURL('**/me');
}
/** In the builder (signed in): fills the name and headline, adds a skill, and waits until the server has them. */
async function writeResume(page, { name, headline }) {
  await page.goto('/builder');
  await page.evaluate(() => window.history.replaceState({ usr: { open: 'build' }, key: 'x' }, ''));
  await page.reload();
  await expect(page.getByTestId('save-status')).toHaveText('All changes saved', { timeout: 15_000 });
  await page.getByLabel('Full name').fill(name);
  await page.getByLabel('Headline').fill(headline);
  await expect(page.getByTestId('save-status')).toHaveText('All changes saved', { timeout: 15_000 });
}
const noDownloads = (page) => { const seen = []; page.on('download', (d) => seen.push(d.suggestedFilename())); return () => expect(seen).toEqual([]); };

for (const [label, size] of SIZES) {
  test.describe(label, () => {
    test.use({ viewport: size });

    test('signed out: Sample shows the example person; My details asks to start a resume', async ({ page }) => {
      const done = noDownloads(page);
      await page.goto('/templates');
      await expect(page.getByRole('heading', { level: 1, name: 'Resume templates' })).toBeVisible();
      await expect(switchTo(page, 'Sample resume')).toHaveAttribute('aria-pressed', 'true');
      await expect(card(page)).toContainText('Sample');
      await expect(card(page)).toContainText('Sai Varsha'); // the thumbnail is the sample resume
      await card(page).click();
      await expect(preview(page).getByTestId('template-preview')).toContainText('Data Analyst');
      await switchTo(preview(page), 'My details').click();
      await expect(preview(page).getByText('Add your details to see them here')).toBeVisible();
      await preview(page).getByRole('button', { name: 'Close' }).last().click();
      await expect(page.getByTestId('no-details')).toBeVisible();
      await page.reload(); // the choice is remembered on this device
      await expect(switchTo(page, 'My details')).toHaveAttribute('aria-pressed', 'true');
      await page.getByTestId('no-details').getByRole('button', { name: 'Start my resume' }).click();
      await expect(page).toHaveURL(/\/builder$/);
      done();
    });

    test('signed in: My details shows my own resume, follows builder edits, and Use this template keeps everything', async ({ page }) => {
      const done = noDownloads(page);
      await signIn(page, 'Meera Nair');
      await writeResume(page, { name: 'Meera Nair', headline: 'Staff Nurse · ICU' });
      await page.goto('/templates');
      await expect(switchTo(page, 'My details')).toHaveAttribute('aria-pressed', 'true'); // she has a name: My details
      await expect(card(page)).toContainText('Meera Nair');
      await expect(card(page)).not.toContainText('Sai Varsha');
      await expect(card(page)).not.toContainText('Sample');
      await switchTo(page, 'Sample resume').click();
      await expect(card(page)).toContainText('Sai Varsha');
      await switchTo(page, 'My details').click();
      // an edit in the builder shows here next time
      await writeResume(page, { name: 'Meera K Nair', headline: 'Staff Nurse · ICU' });
      await page.goto('/templates');
      await expect(card(page)).toContainText('Meera K Nair');
      // open one large and use it: the builder opens with it, content unchanged
      const name = (await card(page, 3).getAttribute('aria-label')).replace(/^Preview the | template$/g, '');
      await card(page, 3).click();
      await expect(preview(page).getByTestId('template-preview')).toContainText('Staff Nurse · ICU');
      await preview(page).getByRole('button', { name: 'Use this template' }).click();
      await expect(page).toHaveURL(/\/builder$/);
      await expect(page.getByText(`Live preview · ${name}`)).toBeVisible();
      const live = page.getByRole('region', { name: 'Live resume preview' });
      await expect(live).toContainText('Meera K Nair');
      await expect(live).toContainText('Staff Nurse · ICU');
      await expect(page.getByLabel('Full name')).toHaveValue('Meera K Nair');
      done();
    });

    test('Change template in the builder opens My details and swaps the look without losing content', async ({ page }) => {
      await signIn(page, 'Arjun Das');
      await writeResume(page, { name: 'Arjun Das', headline: 'Electrician · ITI' });
      const before = await page.getByRole('region', { name: 'Live resume preview' }).innerText();
      await page.getByRole('button', { name: 'Change template' }).click();
      await expect(page.getByRole('heading', { name: 'Change template' })).toBeVisible();
      await expect(switchTo(page, 'My details')).toHaveAttribute('aria-pressed', 'true');
      const c = page.locator('[data-testid="tp-card-classic"]');
      await c.scrollIntoViewIfNeeded();
      await expect(c).toContainText('Arjun Das');
      await c.getByRole('radio').click();
      await c.getByTestId('tp-use-card').click();
      await expect(page.getByText('Live preview · Classic')).toBeVisible();
      await expect(page.getByTestId('page-count')).toHaveText(/1 page ✓|pages · aim for 1/); // the 1-page check runs
      const after = await page.getByRole('region', { name: 'Live resume preview' }).innerText();
      for (const line of ['Arjun Das', 'Electrician · ITI']) expect(after).toContain(line);
      expect(after.replace(/Live preview · [^\n]+/, '')).toContain(before.split('\n').find((l) => l.includes('Arjun Das')));
      await expect(page.getByLabel('Full name')).toHaveValue('Arjun Das');
    });
  });
}

test('an open Templates tab shows a builder edit within about a second', async ({ browser }) => {
  const ctx = await browser.newContext();
  const builder = await ctx.newPage();
  await signIn(builder, 'Kavya Rao');
  await writeResume(builder, { name: 'Kavya Rao', headline: 'Sales Executive' });
  const gallery = await ctx.newPage();
  await gallery.goto('/templates');
  await expect(card(gallery)).toContainText('Kavya Rao');
  await builder.getByLabel('Full name').fill('Kavya S Rao');
  await expect(card(gallery)).toContainText('Kavya S Rao', { timeout: 2500 }); // saved 0.8 s after typing stops
  await ctx.close();
});

test('the Download button in the preview window makes my resume in that template; no PDF code loads before it', async ({ page }) => {
  const scripts = [];
  page.on('request', (r) => { if (r.resourceType() === 'script') scripts.push(new URL(r.url()).pathname); });
  await signIn(page, 'Divya Menon');
  await writeResume(page, { name: 'Divya Menon', headline: 'Accounts Executive' });
  scripts.length = 0;
  await page.goto('/templates');
  await card(page, 1).click();
  await expect(preview(page).getByTestId('template-preview')).toContainText('Divya Menon');
  expect(scripts.filter((s) => /resumePdf|jspdf|resumeDocx/i.test(s)), 'no PDF code yet').toEqual([]);
  const [file] = await downloadThrough(page, () => preview(page).getByRole('button', { name: 'Download PDF' }).click(), { timeout: 30_000 });
  expect(file.suggestedFilename()).toBe('Divya_Menon_Resume.pdf');
});

test('more than one resume: "Showing" picks which one the templates show', async ({ page }) => {
  await signIn(page, 'Nikhil Varma');
  await writeResume(page, { name: 'Nikhil Varma', headline: 'Java Developer' });
  // a second resume, as "New resume" in My resumes makes it
  await page.evaluate(async (base) => {
    const data = { personal: { name: 'Nikhil V (Govt)', headline: 'Junior Engineer · PSU', email: 'nv@example.com', phone: '', location: '', level: '' } };
    const r = await fetch(`${base}/api/me/resumes`, { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: `r${Date.now()}`, name: 'Govt version', data, jd: '', active: false, versions: [] }) });
    if (!r.ok) throw new Error(await r.text());
  }, API);
  await page.goto('/templates');
  const showing = page.getByLabel('Showing:');
  await expect(showing).toBeVisible();
  await expect(card(page)).toContainText('Nikhil Varma'); // the active one first
  await showing.selectOption({ label: 'Govt version' });
  await expect(card(page)).toContainText('Nikhil V (Govt)');
  await expect(card(page)).toContainText('Junior Engineer · PSU');
});
