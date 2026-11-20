// Auto Apply 2.0, phase A6 (one tap) on a desktop and a 390 px phone, against the real API. A tester has 2.0 on; the
// collector found three jobs on a company's own site, so (switch OFF) Nm7 doesn't send them: they are Ready for one
// tap. The seed process runs the tester's morning run and morning list, then the third job closes. The page shows the
// morning banner, the Jobs ready list (2 open, 1 Closed), each kit (cover note, ready answers, the candidate's details,
// all with Copy buttons; download the tailored PDF), Apply now (the company's page in a new tab, the kit stays here),
// I applied (tracker → Applied, channel One tap), Not applying, copy mode one field at a time, and the Nm7 Apply helper
// pairing code. Every test uses its own candidate and jobs. No browser dialogs, no sideways scrolling.
import { expect, test } from '@playwright/test';
import { seed } from './helpers.mjs';
import { SIZES, call, json, noSideScroll } from './college.mjs';
import { STRONG, studentWith } from './autoapply.mjs';

async function setUp(page, label, who) {
  const tag = `a6${label[0]}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;
  page.on('dialog', () => { throw new Error('no browser dialogs'); });
  const me = await studentWith(page, label, STRONG, who);
  seed('aa2-tester', me);
  const rules = { roles: [tag], cities: ['Hyderabad'], remote: true, dailyLimit: 10, mode: 'approve' };
  expect((await call(page, '/api/me/auto-apply/v2/rules', json('PUT', rules))).status).toBe(200);
  expect((await call(page, '/api/me/auto-apply/v2/consent', json('POST', { agree: true }))).status).toBe(200);
  const out = seed('aa6-onetap-run', me, tag);
  expect(out.listed).toBe(3);
  for (const t of ['Data Analyst', 'Reporting Analyst', 'BI Analyst']) expect(out.items[`${t} ${tag}`].state).toBe('ready');
  // the company's page (never really fetched: answered here)
  await page.context().route(`https://careers.co${tag}.example/**`, (r) => r.fulfill({ contentType: 'text/html', body: '<h1>Apply here</h1>' }));
  return { tag, me };
}

for (const [label, opts] of SIZES) {
  test.describe(label, () => {
    test.use(opts);

    test('morning list, kit with Copy buttons, Apply now, I applied and Not applying', async ({ page }) => {
      test.setTimeout(180_000);
      const { tag, me } = await setUp(page, label, 'aa6m');
      await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
      await page.goto('/me/auto-apply/v2');
      const banner = page.getByTestId('aa2-morning');
      await expect(banner).toContainText('2 jobs ready');
      expect(await noSideScroll(page)).toBe(true);
      await banner.getByTestId('aa2-morning-open').click();
      await expect(page).toHaveURL(/tab=ready/);
      await expect(page.getByTestId('aa2-onetap-head')).toContainText('2 jobs ready');
      const cards = page.getByTestId('aa2-kitcard');
      await expect(cards).toHaveCount(3);
      const closed = cards.filter({ hasText: `BI Analyst ${tag}` });
      await expect(closed).toHaveAttribute('data-closed', '1');
      await expect(closed.getByTestId('aa2-kit-closed')).toContainText('The company closed this job.');
      await expect(closed.getByTestId('aa2-apply-now')).toHaveCount(0);

      const card = cards.filter({ hasText: `Data Analyst ${tag}` });
      await expect(card).toHaveAttribute('data-closed', '0');
      const [company] = await Promise.all([page.context().waitForEvent('page'), card.getByTestId('aa2-apply-now').click()]);
      await expect.poll(() => company.url()).toContain(`careers.co${tag}.example/jobs/1`);
      await company.close();
      const kit = card.getByTestId('aa2-kit');
      await expect(kit).toBeVisible(); // the kit stays open on Nm7, beside the company's tab
      if (label === 'phone') {
        await expect(kit.getByTestId('aa2-copymode')).toBeVisible(); // phones start in copy mode
        await kit.getByTestId('aa2-copymode-close').click();
      }
      await expect(kit.getByTestId('aa2-kit-cover')).toContainText('Northwind Retail');
      await expect(kit.getByTestId('aa2-kit-answer').first()).toBeVisible();
      const email = kit.locator('[data-testid="aa2-kit-field"][data-key="email"]');
      await expect(email).toContainText(me);
      await email.getByTestId('aa2-copy').click();
      await expect(page.getByText('Copied: Email')).toBeVisible();
      expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(me);
      await expect(kit.locator('[data-testid="aa2-kit-field"][data-key="full_name"]')).toContainText('Asha Rao');
      const [download] = await Promise.all([page.waitForEvent('download'), kit.getByTestId('aa2-kit-pdf').click()]);
      expect(download.suggestedFilename()).toBe('Asha_Rao_Resume.pdf');
      expect(await noSideScroll(page)).toBe(true);

      await card.getByTestId('aa2-i-applied').click();
      await expect(page.getByText('Moved to Applied')).toBeVisible();
      await expect(cards.filter({ hasText: `Data Analyst ${tag}` })).toHaveCount(0);
      await cards.filter({ hasText: `Reporting Analyst ${tag}` }).getByTestId('aa2-not-applying').click();
      await expect(cards.filter({ hasText: `Reporting Analyst ${tag}` })).toHaveCount(0);
      await expect(cards).toHaveCount(1);
      await expect(page.getByTestId('aa2-onetap-head')).toContainText('0 jobs ready');

      await page.getByTestId('aa2-tab-tracker').click();
      const row = page.getByTestId('aa2-row').filter({ hasText: `Data Analyst ${tag}` });
      await expect(row).toHaveAttribute('data-stage', 'applied');
      await expect(row.getByTestId('aa2-ch')).toHaveText('One tap');
      await expect(page.getByTestId('aa2-row').filter({ hasText: `Reporting Analyst ${tag}` })).toHaveCount(0);
      expect(await noSideScroll(page)).toBe(true);
    });

    test('copy mode one field at a time, and the helper pairing code', async ({ page }) => {
      test.setTimeout(150_000);
      const { tag } = await setUp(page, label, 'aa6c');
      await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
      await page.goto('/me/auto-apply/v2?tab=ready');
      const card = page.getByTestId('aa2-kitcard').filter({ hasText: `Reporting Analyst ${tag}` });
      await card.getByTestId('aa2-kit-open').click();
      const kit = card.getByTestId('aa2-kit');
      if (label === 'desktop') await kit.getByTestId('aa2-copymode-open').click();
      const cm = kit.getByTestId('aa2-copymode');
      await expect(cm).toBeVisible();
      await expect(cm.getByTestId('aa2-copymode-step')).toHaveText(/^1 of \d+$/);
      await expect(cm.getByTestId('aa2-copymode-label')).toHaveText('Full name');
      await expect(cm.getByTestId('aa2-copymode-value')).toHaveText('Asha Rao');
      await expect(cm.getByTestId('aa2-copymode-back')).toBeDisabled();
      const copy = cm.getByTestId('aa2-copy');
      expect((await copy.boundingBox()).height).toBeGreaterThanOrEqual(48); // a big button for thumbs
      await copy.click();
      expect(await page.evaluate(() => navigator.clipboard.readText())).toBe('Asha Rao');
      await cm.getByTestId('aa2-copymode-next').click();
      await expect(cm.getByTestId('aa2-copymode-step')).toHaveText(/^2 of \d+$/);
      await expect(cm.getByTestId('aa2-copymode-label')).toHaveText('First name');
      await expect(cm.getByTestId('aa2-copymode-value')).toHaveText('Asha');
      expect(await noSideScroll(page)).toBe(true);
      // walk to the end: the cover note is there too, and Next stops at the last one
      const total = Number((await cm.getByTestId('aa2-copymode-step').textContent()).split(' of ')[1]);
      for (let i = 2; i < total; i += 1) await cm.getByTestId('aa2-copymode-next').click();
      await expect(cm.getByTestId('aa2-copymode-next')).toBeDisabled();
      expect(await noSideScroll(page)).toBe(true);

      const helper = page.getByTestId('aa2-helper');
      await helper.getByTestId('aa2-helper-make').click();
      await expect(helper.getByTestId('aa2-helper-code')).toContainText(/[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}/);
      await expect(helper.getByTestId('aa2-helper-code')).toContainText('10 minutes');
      expect(await noSideScroll(page)).toBe(true);
    });
  });
}
