// LinkedIn on My dashboard (latest score, top 3 fixes, Re-check; "Create your LinkedIn" for Path 2), the prompt
// after a resume download in the builder, and "Delete my LinkedIn data" in settings. Desktop and 390 px.
import { expect, test } from '@playwright/test';
import { API, PASSWORD, TEST_PERSON, email, login, seed, downloadThrough } from './helpers.mjs';

const SIZES = [['desktop', { viewport: { width: 1280, height: 900 } }], ['phone', { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true }]];
const api = (page, path, init = {}) => page.evaluate(async ([base, p, i]) => {
  const r = await fetch(`${base}${p}`, { credentials: 'include', headers: { 'Content-Type': 'application/json' }, ...i });
  if (!r.ok) throw new Error(`${r.status} ${await r.text()}`);
  return r.status === 204 ? null : r.json();
}, [API, path, init]);

async function signIn(page, who) {
  const mail = email(who);
  seed('customer', mail, 'Meena Iyer', PASSWORD);
  await login(page, mail);
  await page.waitForURL('**/me');
  return mail;
}

for (const [label, opts] of SIZES) {
  test.describe(label, () => {
    test.use(opts);

    test('dashboard card: free check first, then the latest score with top 3 fixes and Re-check', async ({ page }) => {
      await signIn(page, `li-dash-${label}`);
      const card = page.getByTestId('me-linkedin');
      await expect(card.getByRole('link', { name: 'Check my LinkedIn' })).toBeVisible();
      await card.getByRole('link', { name: 'Check my LinkedIn' }).click();
      await expect(page).toHaveURL(/\/linkedin\?path=fix/);
      await page.getByRole('button', { name: 'Paste sections' }).click();
      await page.getByLabel('Headline').fill('Student');
      await page.getByLabel('Skills').fill('Excel');
      await page.getByTestId('li-check').click();
      await expect(page.getByTestId('li-saved')).toHaveText('Saved to your account.');
      const score = (await page.getByTestId('li-score').innerText()).split('/')[0];
      await page.goto('/me');
      await expect(card.getByTestId('me-li-score')).toHaveText(score);
      await expect(card.getByTestId('me-li-fixes').locator('li')).toHaveCount(3);
      await card.getByRole('link', { name: 'Re-check' }).click();
      await expect(page).toHaveURL(/\/linkedin\?path=fix/);
      await expect(page.getByLabel('Headline')).toHaveValue('Student'); // the pasted text comes back
      await page.getByTestId('li-check').click();
      await expect(page.getByTestId('li-score')).toHaveText(`${score}/100`);
    });

    test('Re-check after a PDF upload reuses the saved PDF text', async ({ page }) => {
      await signIn(page, `li-pdfre-${label}`);
      await api(page, '/api/me/linkedin', { method: 'PUT', body: JSON.stringify({ path: 'fix', source: 'pdf', targetRole: 'Data Analyst', sections: { headline: 'Student at JNTU Hyderabad', skills: ['SQL'], experience: [], education: [] }, result: { score: 20, top: [] } }) });
      await page.goto('/me');
      await page.getByTestId('me-linkedin').getByRole('link', { name: 'Re-check' }).click();
      await expect(page.getByTestId('li-pdf-read')).toContainText('your saved LinkedIn PDF');
      await page.getByTestId('li-check').click();
      await expect(page.getByTestId('li-before')).toHaveText('Student at JNTU Hyderabad');
    });

    test('dashboard card for a new profile: "Create your LinkedIn"', async ({ page }) => {
      await signIn(page, `li-dash2-${label}`);
      await page.goto('/linkedin?path=create');
      await page.getByLabel('The job you want').fill('Accountant');
      await page.getByLabel('Skills').fill('Tally, GST, Excel');
      await page.getByTestId('li-make').click();
      await expect(page.getByTestId('li-option')).toHaveCount(5);
      await expect.poll(async () => (await api(page, '/api/me/linkedin')).path).toBe('create');
      await page.goto('/me');
      const card = page.getByTestId('me-linkedin');
      await expect(card).toContainText('5 headline options');
      await card.getByRole('link', { name: 'Create your LinkedIn' }).click();
      await expect(page).toHaveURL(/\/linkedin\?path=create/);
      await expect(page.getByLabel('The job you want')).toHaveValue('Accountant');
    });

    test('after a resume download the builder suggests the free LinkedIn check', async ({ page }) => {
      const mail = await signIn(page, `li-nudge-${label}`);
      await expect.poll(async () => (await api(page, '/api/me/resumes')).length).toBe(1);
      const [cur] = await api(page, '/api/me/resumes');
      await api(page, `/api/me/resumes/${cur.id}`, { method: 'PATCH', body: JSON.stringify({ data: { ...structuredClone(TEST_PERSON), personal: { ...TEST_PERSON.personal, email: mail } } }) });
      await page.goto('/builder');
      await page.evaluate(() => window.history.replaceState({ usr: { open: 'build' }, key: 'x' }, ''));
      await page.reload();
      await expect(page.getByTestId('save-status')).toHaveText('All changes saved', { timeout: 15_000 });
      await expect(page.getByTestId('li-nudge')).toHaveCount(0);
      await downloadThrough(page, () => page.getByRole('button', { name: 'Download PDF' }).first().click(), { timeout: 30_000 });
      const nudge = page.getByTestId('li-nudge');
      await expect(nudge).toContainText('Your resume is ready. Check your LinkedIn for free');
      await nudge.getByRole('link', { name: 'Check your LinkedIn for free' }).click();
      await expect(page).toHaveURL(/\/linkedin$/);
    });

    test('settings: "Delete my LinkedIn data" removes it; the delete-account text names it', async ({ page }) => {
      await signIn(page, `li-del-${label}`);
      await api(page, '/api/me/linkedin', { method: 'PUT', body: JSON.stringify({ url: 'linkedin.com/in/meena-iyer', path: 'fix', sections: { headline: 'Student' }, result: { score: 30 } }) });
      await page.goto('/me/settings');
      await page.getByRole('button', { name: 'Delete my LinkedIn data' }).click();
      await page.getByRole('dialog').getByRole('button', { name: 'Delete LinkedIn data' }).click();
      await expect(page.getByText('Your LinkedIn data is deleted.')).toBeVisible();
      expect((await api(page, '/api/me/linkedin')).updatedAt).toBeNull();
      await page.getByRole('button', { name: 'Delete account' }).click();
      await expect(page.getByRole('dialog')).toContainText('your LinkedIn link, PDF text and checks');
    });
  });
}
