// Vetting Trust T2 (DigiLocker documents through a KYC vendor; the test provider here) on a desktop and a 390 px phone,
// against the real API:
//   - a tester turns on the Documents consent, picks documents, "Verify with DigiLocker" opens the test DigiLocker,
//     Allow → each document shows "Verified via DigiLocker" with the date; one is removed; taking the consent back
//     deletes the rest;
//   - a profile name that differs from the documents: plainly told, never rejected; they explain it;
//   - the owner sees the DigiLocker card (test provider, Setu keys "not set", the callback URL, counts) and clears a
//     document in the review queue;
//   - the demo company sees the badges on applicant cards and the applicant's profile;
//   - while the switch is off, someone who isn't a tester sees no DigiLocker card.
// Desktop and phone share one database: every test uses its own people and changes no global setting.
import { expect, test } from '@playwright/test';
import { PASSWORD, adminLogin, email, login, seed } from './helpers.mjs';
import { SIZES, noSideScroll } from './college.mjs';

async function tester(page, who, name = 'Asha Rao') {
  const mail = email(who);
  seed('customer', mail, name, PASSWORD);
  seed('trust-tester', mail);
  await login(page, mail);
  await page.waitForURL('**/me');
  await page.goto('/me/settings');
  const card = page.getByTestId('tc-card');
  await expect(card).toBeVisible({ timeout: 20_000 });
  await card.getByTestId('tc-dob').fill('1999-04-12');
  await card.getByTestId('tc-age-save').click();
  await expect(card.getByTestId('tc-age')).toHaveCount(0);
  return mail;
}

async function consentAndFetch(page, untick = []) {
  const dl = page.getByTestId('dl-card');
  await expect(dl.getByTestId('dl-consent')).toContainText('Documents (DigiLocker / KYC)');
  await page.getByTestId('tc-documents').getByTestId('tc-toggle').click();
  await expect(page.getByTestId('tc-documents').getByTestId('tc-state')).toContainText('On');
  await expect(dl.getByTestId('dl-start')).toBeVisible(); // the card heard the consent change
  for (const k of untick) await dl.getByTestId(`dl-pick-${k}`).uncheck();
  await dl.getByTestId('dl-start').click();
  const mock = page.getByRole('dialog', { name: 'Test DigiLocker' });
  await expect(mock).toBeVisible();
  await mock.getByTestId('dl-mock-allow').click();
  await expect(mock).toHaveCount(0);
  return dl;
}

for (const [label, opts] of SIZES) {
  test.describe(label, () => {
    test.use(opts);

    test('verify with DigiLocker, badges with dates, remove one, take the consent back', async ({ page }) => {
      page.on('dialog', () => { throw new Error('no browser dialogs'); });
      await tester(page, `tt2-${label}`);
      const dl = await consentAndFetch(page, ['class12']);
      const docs = dl.getByTestId('dl-docs');
      await expect(docs.locator('[data-testid^="dl-doc-"]')).toHaveCount(4);
      await expect(dl.getByTestId('dl-doc-class12')).toHaveCount(0); // only what was picked
      await expect(dl.getByTestId('dl-doc-dl').getByTestId('dl-state')).toContainText(/Verified via DigiLocker, \d+ \w+ \d{4}/);
      await expect(dl.getByTestId('dl-doc-dl')).toContainText('Driving licence (MCWG, LMV) · valid to 11 Apr 2039');
      await expect(dl.getByTestId('dl-doc-pan')).toContainText(/PAN verified \(ending \d{3}L\)/);
      await expect(dl).not.toContainText(/aadhaar number|9999\d{8}/i);
      expect(await noSideScroll(page)).toBe(true);

      await dl.getByTestId('dl-doc-degree').getByTestId('dl-remove').click();
      const rm = page.getByRole('dialog', { name: 'Remove Degree?' });
      await rm.getByTestId('dl-remove-confirm').click();
      await expect(dl.getByTestId('dl-doc-degree')).toHaveCount(0);
      await expect(docs.locator('[data-testid^="dl-doc-"]')).toHaveCount(3);

      await page.getByTestId('tc-documents').getByTestId('tc-toggle').click();
      const take = page.getByRole('dialog', { name: /Take back/ });
      await take.getByTestId('tc-withdraw-confirm').click();
      await expect(take).toHaveCount(0);
      await expect(dl.getByTestId('dl-consent')).toBeVisible();
      await expect(dl.getByTestId('dl-docs')).toHaveCount(0); // deleted with the consent
      await page.reload();
      await expect(page.getByTestId('dl-card').getByTestId('dl-consent')).toBeVisible({ timeout: 20_000 });
      await expect(page.getByTestId('dl-docs')).toHaveCount(0);
    });

    test('a name that differs goes to a person, never a rejection; they explain', async ({ page }) => {
      await tester(page, `tt2mm-${label}`, `Bala Mismatch ${label}`);
      const dl = await consentAndFetch(page, ['class10', 'class12', 'degree', 'pan']);
      const doc = dl.getByTestId('dl-doc-dl');
      await expect(doc.getByTestId('dl-state')).toHaveText('A person at Nm7 is checking this');
      await expect(doc.getByTestId('dl-why')).toContainText('DigiLocker says “Ramesh Kumar Sharma”');
      await expect(doc.getByTestId('dl-why')).toContainText('Nobody is turned away');
      await doc.getByTestId('dl-explain-open').click();
      await doc.getByTestId('dl-explain').fill('Ramesh Kumar Sharma is my name on documents.');
      await doc.getByTestId('dl-explain-send').click();
      await expect(doc).toContainText('Your note: Ramesh Kumar Sharma is my name on documents.');
      expect(await noSideScroll(page)).toBe(true);
    });

    test('owner: provider, keys not set, callback URL, counts; clears a document', async ({ page }) => {
      const who = email(`tt2rv-${label}`);
      const name = `Chitra Mismatch ${label} ${Date.now().toString(36)}`;
      seed('customer', who, name, PASSWORD);
      seed('trust-docs', who);
      const owner = `tt2-owner-${label}-${Date.now().toString(36)}@nm7.si`;
      const { secret } = seed('admin', owner, 'owner', PASSWORD);
      await adminLogin(page, owner, secret);
      await expect(page).not.toHaveURL(/\/login/);
      page.on('dialog', () => { throw new Error('no browser dialogs'); });
      await page.goto('/admin/skill-tests?tab=trust');
      const card = page.getByTestId('td-card');
      await expect(card.getByTestId('td-provider')).toHaveValue('mock', { timeout: 20_000 });
      await expect(card.getByTestId('td-state')).toContainText('Test mode');
      await expect(card.getByTestId('td-keys-setu')).toContainText('SETU_DG_CLIENT_SECRET: not set');
      await expect(card.getByTestId('td-callback')).toHaveText(/\/api\/public\/trust\/digilocker\/callback\/setu$/);
      await expect(card.getByTestId('td-counts')).toContainText('Fetched today');
      const items = card.getByTestId('td-review-item').filter({ hasText: name });
      await expect(items).toHaveCount(5);
      await items.first().getByTestId('td-clear').click();
      await expect(items).toHaveCount(4);
      expect(await noSideScroll(page)).toBe(true);
    });

    test('demo company: badges on applicant cards and the profile', async ({ page }) => {
      test.setTimeout(150_000);
      const owner = `tt2-co-${label}-${Date.now().toString(36)}@nm7.si`;
      const { secret } = seed('admin', owner, 'owner', PASSWORD);
      page.on('dialog', () => { throw new Error('no browser dialogs'); });
      await adminLogin(page, owner, secret);
      await expect(page).not.toHaveURL(/\/login/);
      await page.goto('/admin/companies');
      await page.getByTestId('demo-company').getByTestId('demo-as-company').click();
      await expect(page).toHaveURL(/\/company$/);
      expect(seed('trust-docs', '@demo-applicants').n).toBeGreaterThan(0);
      await page.reload();
      await page.getByRole('tab', { name: 'Applicants' }).click();
      const first = page.getByTestId('co-applicant').first();
      await expect(first.getByTestId('co-docs-line')).toContainText('Verified via DigiLocker: Driving licence, Class 10, Class 12, Degree, PAN (test)');
      expect(await noSideScroll(page)).toBe(true);
      await first.getByRole('button', { name: 'Profile', exact: true }).click();
      const docs = page.getByTestId('co-docs');
      await expect(docs.first()).toBeVisible();
      await expect(docs.first().getByTestId('co-doc-pan')).toContainText(/PAN verified · Verified via DigiLocker, \d+ \w+ \d{4} \(test\)/);
      await expect(docs.first()).not.toContainText('ending');
      expect(await noSideScroll(page)).toBe(true);
    });

    test('switch off: no DigiLocker card for someone who is not a tester', async ({ page }) => {
      const mail = email(`tt2-none-${label}`);
      seed('customer', mail, 'Ravi K', PASSWORD);
      await login(page, mail);
      await page.waitForURL('**/me');
      await page.goto('/me/settings');
      await expect(page.getByRole('heading', { name: 'Privacy', exact: true })).toBeVisible({ timeout: 20_000 });
      await page.waitForLoadState('networkidle');
      await expect(page.getByTestId('dl-card')).toHaveCount(0);
    });
  });
}
