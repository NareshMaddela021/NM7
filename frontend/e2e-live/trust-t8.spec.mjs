// Vetting Trust T8 (the integrity rating, its evidence and review, optional webcam snapshots) on a desktop and a 390 px
// phone, against the real API, with Chromium's fake camera (--use-fake-device-for-media-stream):
//   - a skill check with webcam snapshots: the separate consent in plain words, one tick, the test starts, a still photo
//     is taken at a random moment ("1 of 4"); a reviewer opens that photo (the look is recorded);
//   - without the tick the test works exactly the same, nothing is taken, and the rating says "no snapshots";
//   - High risk → the Admin review queue: the evidence view (weights, status), Clear one, Ask to explain; the candidate
//     sees it plainly and explains; the reviewer finishes → "Reviewed by Nm7";
//   - the demo company sees only "Under review by Nm7" on the applicant card, never the signals or the word fraud;
//   - while the switch is off, someone who isn't a tester sees no snapshot choice and no rating card.
// Desktop and phone share one database: every test uses its own people and changes no global setting.
import { expect, test } from '@playwright/test';
import { PASSWORD, adminLogin, email, login, seed } from './helpers.mjs';
import { SIZES, noSideScroll } from './college.mjs';

test.use({
  launchOptions: {
    ...(process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {}),
    args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'],
  },
  permissions: ['camera'],
});

const uniq = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 5);

async function person(page, who, name, { vetting = false, trust = true } = {}) {
  const mail = email(`${who}-${uniq()}`);
  seed('customer', mail, name, PASSWORD);
  if (vetting) seed('vetting-tester', mail);
  if (trust) { seed('trust-tester', mail); seed('trust-face', mail, 'no'); } // T3's ID + selfie already done
  await login(page, mail);
  await page.waitForURL('**/me');
  if (trust) { // the T1 age gate comes before any consent
    await page.goto('/me/settings');
    const card = page.getByTestId('tc-card');
    await expect(card).toBeVisible({ timeout: 20_000 });
    await card.getByTestId('tc-dob').fill('1999-04-12');
    await card.getByTestId('tc-age-save').click();
    await expect(card.getByTestId('tc-age')).toHaveCount(0);
  }
  return mail;
}

async function startSql(page) {
  await page.goto('/me/skill-checks');
  const consent = page.getByTestId('vt-consent');
  await consent.getByTestId('vt-consent-tick').check();
  await consent.getByTestId('vt-consent-go').click();
  await page.getByTestId('vt-search').fill('data analyst');
  await page.getByTestId('sk-list').getByTestId('sk-start-SQL').click();
  return page.getByTestId('vt-start');
}

async function owner(browser, opts, label) {
  const mail = `tt8-owner-${label}-${uniq()}@nm7.si`;
  const { secret } = seed('admin', mail, 'owner', PASSWORD);
  const ctx = await browser.newContext({ ...opts });
  const admin = await ctx.newPage();
  admin.on('dialog', () => { throw new Error('no browser dialogs'); });
  await adminLogin(admin, mail, secret);
  await expect(admin).not.toHaveURL(/\/login/, { timeout: 15_000 });
  return { ctx, admin };
}

for (const [label, opts] of SIZES) {
  test.describe(label, () => {
    test.use(opts);

    test('skill check with webcam snapshots: own consent, a still photo, a reviewer opens it', async ({ page, browser }) => {
      test.setTimeout(150_000);
      page.on('dialog', () => { throw new Error('no browser dialogs'); });
      const name = `Asha Snap ${label} ${uniq()}`;
      const mail = await person(page, `tt8sn-${label}`, name, { vetting: true });
      const dlg = await startSql(page);
      const choice = dlg.getByTestId('snap-choice');
      await expect(choice.getByTestId('snap-text')).toContainText('No video and no sound', { timeout: 20_000 });
      await expect(choice.getByTestId('snap-text')).toContainText('only a few reviewers at Nm7');
      await expect(choice.getByTestId('snap-text')).toContainText('30 days');
      await expect(choice.getByTestId('snap-tick')).not.toBeChecked(); // never on by itself
      expect(await noSideScroll(page)).toBe(true);
      await choice.getByTestId('snap-tick').check();
      await expect(choice.getByTestId('snap-tick')).toBeChecked();
      await dlg.getByTestId('pledge-tick').check(); // T9: the honesty pledge
      await dlg.getByTestId('vt-go').click();
      await expect(page.getByTestId('vt-q')).toBeVisible({ timeout: 20_000 });
      await expect(page.getByTestId('snap-status')).toContainText('0 of 4 still photos taken', { timeout: 20_000 });
      await expect(page.getByTestId('snap-status')).toContainText('1 of 4 still photos taken', { timeout: 45_000 }); // the first within ~25 s
      expect(await noSideScroll(page)).toBe(true);
      await page.getByTestId('vt-opt').first().click(); // the test carries on as normal
      await expect(page.getByTestId('vt-save')).toContainText(/Saved|Saving/);

      // a reviewer sees the photo only by opening it (recorded); the person is in the queue once rated High
      seed('trust-t8-high', mail);
      const { ctx, admin } = await owner(browser, opts, label);
      await admin.goto('/admin/skill-tests?tab=trust');
      const card = admin.getByTestId('ti-card');
      const item = card.getByTestId('ti-item').filter({ hasText: name });
      await expect(item).toBeVisible({ timeout: 20_000 });
      await item.getByTestId('ti-evidence-open').click();
      const ev = item.getByTestId('ti-evidence');
      await expect(ev.getByTestId('ti-photo')).toHaveCount(1, { timeout: 20_000 });
      await expect(ev.getByTestId('ti-photo')).toContainText('1 face');
      await expect(ev.getByTestId('ti-photo-img')).toHaveCount(0);
      await ev.getByTestId('ti-photo-open').click();
      await expect(ev.getByTestId('ti-photo-img')).toBeVisible();
      expect(await noSideScroll(admin)).toBe(true);
      await ctx.close();
    });

    test('without the tick the test works the same and nothing is taken', async ({ page }) => {
      page.on('dialog', () => { throw new Error('no browser dialogs'); });
      let posted = 0;
      page.on('request', (r) => { if (r.method() === 'POST' && r.url().endsWith('/api/me/trust/integrity/snapshots')) posted += 1; });
      await person(page, `tt8no-${label}`, `Bala NoSnap ${label}`, { vetting: true });
      const dlg = await startSql(page);
      await expect(dlg.getByTestId('snap-choice')).toBeVisible({ timeout: 20_000 });
      await dlg.getByTestId('pledge-tick').check(); // T9: the honesty pledge
      await dlg.getByTestId('vt-go').click();
      await expect(page.getByTestId('vt-q')).toBeVisible({ timeout: 20_000 });
      await page.waitForLoadState('networkidle');
      await expect(page.getByTestId('snap-status')).toHaveCount(0);
      await page.getByTestId('vt-opt').first().click();
      await page.getByTestId('vt-next').click();
      await expect(page.getByTestId('vt-q')).toBeVisible();
      expect(posted).toBe(0);
      await page.goto('/me/settings');
      const ig = page.getByTestId('ig-card');
      await expect(ig.getByTestId('ig-label')).toBeVisible({ timeout: 20_000 });
      await ig.getByText('How it is worked out').click();
      await expect(ig).toContainText('No webcam snapshots (they are optional).');
      expect(await noSideScroll(page)).toBe(true);
    });

    test('High risk → a person reviews: evidence, clear, ask; the candidate explains; Reviewed by Nm7', async ({ page, browser }) => {
      test.setTimeout(150_000);
      page.on('dialog', () => { throw new Error('no browser dialogs'); });
      const name = `Chitra Review ${label} ${uniq()}`;
      const mail = await person(page, `tt8rv-${label}`, name);
      seed('trust-t8-high', mail);
      await page.goto('/me/settings');
      const ig = page.getByTestId('ig-card');
      await expect(ig.getByTestId('ig-label')).toHaveText('High risk', { timeout: 20_000 });
      await expect(ig.getByTestId('ig-review')).toContainText('Nothing is decided automatically');
      await expect(ig.getByTestId('ig-signal')).toHaveCount(3);
      await expect(ig.getByTestId('ig-signals')).toContainText('This PAN is already verified on another Nm7 account.');
      await expect(ig.getByTestId('ig-signals')).toContainText('counts 4 points');
      await expect(ig).not.toContainText(/fraud/i);
      expect(await noSideScroll(page)).toBe(true);

      const { ctx, admin } = await owner(browser, opts, label);
      await admin.goto('/admin/skill-tests?tab=trust');
      const item = admin.getByTestId('ti-card').getByTestId('ti-item').filter({ hasText: name });
      await expect(item).toContainText('High risk', { timeout: 20_000 });
      await expect(item).toContainText('High risk rating');
      await item.getByTestId('ti-evidence-open').click();
      const ev = item.getByTestId('ti-evidence');
      const pattern = ev.getByTestId('ti-signal').filter({ hasText: 'Answer similarity' });
      await expect(pattern).toContainText('weight 3, counts 3 (cap 4)');
      await pattern.getByTestId('ti-clear').click();
      await expect(pattern.getByTestId('ti-signal-status')).toHaveText('Cleared by a person');
      await expect(ev).toContainText('score 6'); // 3 + 2 + 4 = 9 before; the shared device 2 + the PAN 4 are left: still High
      expect(await noSideScroll(admin)).toBe(true);
      await ev.getByTestId('ti-note').fill('Please tell us who else used your laptop.');
      await ev.getByTestId('ti-ask').click();
      await expect(ev.getByTestId('ti-ev-review')).toContainText('asked');

      await page.reload();
      await expect(ig.getByTestId('ig-review')).toContainText('asked you to explain', { timeout: 20_000 });
      await expect(ig.getByTestId('ig-review')).toContainText('Please tell us who else used your laptop.');
      await expect(ig.getByTestId('ig-signals')).toContainText('Cleared by a person');
      await ig.getByTestId('ig-note').fill('My brother took his own test on my laptop the same week.');
      await ig.getByTestId('ig-send').click();
      await expect(ig.getByTestId('ig-review')).toContainText('My brother took his own test');

      await admin.reload();
      const item2 = admin.getByTestId('ti-card').getByTestId('ti-item').filter({ hasText: name });
      await expect(item2).toContainText('My brother took his own test', { timeout: 20_000 });
      await item2.getByTestId('ti-evidence-open').click();
      await item2.getByTestId('ti-note').fill('Explained; PAN checked on a call.');
      await item2.getByTestId('ti-close').click();
      await expect(admin.getByTestId('ti-card').getByTestId('ti-item').filter({ hasText: name })).toHaveCount(0, { timeout: 20_000 });
      await ctx.close();

      await page.reload();
      await expect(ig.getByTestId('ig-reviewed')).toHaveText('Reviewed by Nm7', { timeout: 20_000 });
      await expect(ig.getByTestId('ig-outcome')).toContainText('Explained; PAN checked on a call.');
    });

    test('demo company: only "Under review by Nm7" on the applicant card, never the signals', async ({ page }) => {
      test.setTimeout(150_000);
      const mail = `tt8-co-${label}-${uniq()}@nm7.si`;
      const { secret } = seed('admin', mail, 'owner', PASSWORD);
      page.on('dialog', () => { throw new Error('no browser dialogs'); });
      await adminLogin(page, mail, secret);
      await expect(page).not.toHaveURL(/\/login/);
      await page.goto('/admin/companies');
      await page.getByTestId('demo-company').getByTestId('demo-as-company').click();
      await expect(page).toHaveURL(/\/company$/);
      expect(seed('trust-t8-high', '@demo-first').n).toBe(1);
      await page.reload();
      await page.getByRole('tab', { name: 'Applicants' }).click();
      const chips = page.getByTestId('co-integrity');
      await expect(chips.filter({ hasText: 'Under review by Nm7' })).toHaveCount(1, { timeout: 20_000 });
      await expect(chips.filter({ hasText: /High risk|pattern|PAN|device/ })).toHaveCount(0);
      await expect(page.locator('body')).not.toContainText(/fraud/i);
      expect(await noSideScroll(page)).toBe(true);
    });

    test('switch off: no snapshot choice and no rating card for someone who is not a tester', async ({ page }) => {
      await person(page, `tt8off-${label}`, `Ravi Off ${label}`, { vetting: true, trust: false });
      const dlg = await startSql(page);
      await expect(dlg.getByTestId('vt-go')).toBeVisible();
      await page.waitForLoadState('networkidle');
      await expect(dlg.getByTestId('snap-choice')).toHaveCount(0);
      await page.goto('/me/settings');
      await expect(page.getByRole('heading', { name: 'Privacy', exact: true })).toBeVisible({ timeout: 20_000 });
      await page.waitForLoadState('networkidle');
      await expect(page.getByTestId('ig-card')).toHaveCount(0);
    });
  });
}
