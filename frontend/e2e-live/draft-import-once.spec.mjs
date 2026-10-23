// The resume built in this browser before signing in moves into the account at most once (it once made three
// "My resume · from this browser · 22 Oct" copies): not again after a reload, a second tab or another sign-in, not
// when the account already has the same resume, and a later draft found in the same browser is only offered
// ("Is it yours?"). An empty draft, or one that only holds the sample person, is never imported.
import { expect, test } from '@playwright/test';
import { API, PASSWORD, TEST_PERSON, email, login, seed } from './helpers.mjs';

const GUEST = 'asuraa-builder-draft-v6';
const names = (page) => page.evaluate(async (b) => (await (await fetch(`${b}/api/me/resumes`, { credentials: 'include' })).json()).map((r) => r.name).sort(), API);
const putDraft = (page, d) => page.evaluate(([k, v]) => localStorage.setItem(k, JSON.stringify(v)), [GUEST, d]);
async function signOut(page, button) {
  await page.goto('/me');
  await page.getByRole('button', { name: button }).click();
  await page.getByRole('menuitem', { name: 'Sign out' }).click();
  await page.waitForURL((u) => !u.pathname.startsWith('/me'));
}

test('a browser draft is imported once: not after a reload, a second tab, a sign-out and sign-in, or a copy of it', async ({ page }) => {
  const mail = email('once');
  seed('customer', mail, 'Anjali Verma', PASSWORD);
  await login(page, mail);
  await page.waitForURL('**/me');
  await expect.poll(() => names(page)).toEqual(['My resume']);
  await signOut(page, 'Anjali');

  // as a guest: a resume without a name (like the ones that were copied three times)
  const draft = { ...TEST_PERSON, personal: { ...TEST_PERSON.personal, name: '', email: '' } };
  await page.goto('/');
  await putDraft(page, draft);
  await login(page, mail);
  await page.waitForURL('**/me');
  await expect.poll(() => names(page)).toHaveLength(2);
  const once = await names(page);
  expect(once.filter((n) => n.includes('from this browser'))).toHaveLength(1);
  expect(await page.evaluate((k) => localStorage.getItem(k), GUEST)).toBeNull();

  // the same draft written back (an old guest tab left open), then a reload, two tabs at once and another sign-in
  await putDraft(page, draft);
  const p2 = await page.context().newPage();
  await Promise.all([page.goto('/me'), p2.goto('/me')]);
  await page.waitForTimeout(2500);
  await p2.close();
  expect(await names(page)).toEqual(once);
  await signOut(page, 'Anjali');
  await putDraft(page, draft);
  await login(page, mail);
  await page.waitForURL('**/me');
  await page.waitForTimeout(2500);
  expect(await names(page)).toEqual(once);

  // a different draft later in this browser: offered on the builder, never added by itself
  await putDraft(page, { ...draft, summary: 'Maths teacher with five years of classroom experience.' });
  await page.goto('/builder');
  await page.evaluate(() => window.history.replaceState({ usr: { open: 'build' }, key: 'x' }, ''));
  await page.reload();
  await expect(page.getByText(/was built on this phone before signing in\. Is it yours\?/)).toBeVisible();
  expect(await names(page)).toEqual(once);
  await page.getByRole('button', { name: 'Yes, add it to my account' }).click();
  await expect.poll(() => names(page)).toHaveLength(3); // the person chose to add it
  await page.reload();
  await page.waitForTimeout(2500);
  expect(await names(page)).toHaveLength(3); // and only once
});

test('an empty draft or one that only holds the sample person is never imported', async ({ page }) => {
  const mail = email('never');
  seed('customer', mail, 'Anjali Verma', PASSWORD);
  await login(page, mail);
  await page.waitForURL('**/me');
  await expect.poll(() => names(page)).toEqual(['My resume']);
  const drafts = [
    { personal: { name: '', email: '', phone: '' }, summary: '  ', exp: [{ company: '', role: '', description: '' }], custom: [] },
    // the sample person's own values, as old versions saved them in the browser
    { personal: { name: 'Sai Varsha', email: 'saivarsha@example.com', phone: '+91 98765 43210', headline: 'Data Analyst · SQL · Power BI', location: 'Chennai, Tamil Nadu' } },
  ];
  for (const d of drafts) {
    await signOut(page, 'Anjali');
    await putDraft(page, d);
    await login(page, mail);
    await page.waitForURL('**/me');
    await page.waitForTimeout(2500);
    expect(await names(page)).toEqual(['My resume']);
    await page.goto('/builder');
    await expect(page.getByText(/Is it yours\?/)).toHaveCount(0);
  }
});
