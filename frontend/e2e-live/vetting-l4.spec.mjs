// Vetting V4 (the Nm7 human check) on a desktop and a 390 px phone, against the real API: a referee link that is
// missing or wrong says "This link doesn't work"; an approved expert fills in the reviewer profile (a role and weekly
// hours), passes calibration with Nm7's own scores, and sees "Not active yet" under My checks; the owner opens
// Admin → Skill checks → L4 checks, sees the free settings ("Free — payments off"), activates the reviewer and makes
// them senior; the reviewer's My checks then says no calls are booked. No sideways scrolling.
// (The company request → booking → reference → verified flow needs a candidate at level 3, which seed() cannot make;
// the backend tests cover it.)
import { expect, test } from '@playwright/test';
import { PASSWORD, adminLogin, login, seed } from './helpers.mjs';
import { SIZES, noSideScroll } from './college.mjs';

// the gold scores of the 5 calibration samples (backend/app/hire/vetting/verify.py CALIBRATION)
const GOLD = {
  c1: { communication: 4, knowledge: 4, problem_solving: 4, ownership: 5, clarity: 5 },
  c2: { communication: 3, knowledge: 4, problem_solving: 4, ownership: 4, clarity: 2 },
  c3: { communication: 2, knowledge: 1, problem_solving: 1, ownership: 2, clarity: 5 },
  c4: { communication: 4, knowledge: 5, problem_solving: 5, ownership: 4, clarity: 5 },
  c5: { communication: 4, knowledge: 4, problem_solving: 4, ownership: 4, clarity: 4 },
};

for (const [label, opts] of SIZES) {
  test.describe(label, () => {
    test.use(opts);

    test('referee bad link; reviewer profile and calibration; admin L4 tab activates the reviewer', async ({ browser }) => {
      test.setTimeout(150_000);
      const tag = `${label}-${Date.now().toString(36)}`;

      // a referee link without a token, and one with a made-up token
      const rctx = await browser.newContext(opts);
      const ref = await rctx.newPage();
      await ref.goto('/reference');
      await expect(ref.getByRole('heading', { name: "This link doesn't work" })).toBeVisible();
      await ref.goto('/reference#t=000000000000000000000000.0123456789abcdef0123456789abcdef');
      await ref.reload();
      await expect(ref.getByTestId('ref-bad')).toContainText("This link doesn't work");
      expect(await noSideScroll(ref)).toBe(true);
      await rctx.close();

      // the reviewer: profile, then calibration
      const ex = `l4-rev-${tag}@example.com`;
      const name = `Ravi ${tag}`;
      seed('expert', ex, name, PASSWORD, 'approved');
      const ectx = await browser.newContext(opts);
      const ep = await ectx.newPage();
      await login(ep, ex);
      await ep.waitForURL(/\/expert/);
      await ep.goto('/expert/reviewer');
      await expect(ep.getByRole('heading', { name: 'Reviewer workspace', level: 1 })).toBeVisible();
      await expect(ep.getByTestId('rv-status')).toHaveText('Not applied yet');
      await expect(ep.getByTestId('rv-free')).toContainText('nothing is charged or paid');
      await ep.getByRole('tab', { name: 'Calibration' }).click();
      await expect(ep.getByTestId('rv-cal-first')).toBeVisible();
      await ep.getByRole('tab', { name: 'Profile' }).click();
      await ep.getByTestId('rv-save').click();
      await expect(ep.getByRole('alert')).toContainText('Pick at least one role');
      await ep.getByTestId('rv-role-filter').fill('SQL');
      await ep.getByTestId('rv-role').filter({ hasText: /^SQL$/ }).click();
      await expect(ep.getByTestId('rv-role').filter({ hasText: /^SQL$/ })).toHaveAttribute('aria-pressed', 'true');
      await ep.getByRole('button', { name: 'Mon 10 am' }).click();
      await ep.getByRole('button', { name: 'Wed 6 pm' }).click();
      await ep.getByTestId('rv-about').fill('Ten years of data work; Telugu, Hindi and English.');
      expect(await noSideScroll(ep)).toBe(true);
      await ep.getByTestId('rv-save').click();
      await expect(ep.getByTestId('rv-saved')).toContainText('Saved');
      await expect(ep.getByTestId('rv-status')).toHaveText('Calibration next');

      await ep.getByRole('tab', { name: 'Calibration' }).click();
      await expect(ep).toHaveURL(/tab=calibration/);
      await expect(ep.getByTestId('rv-sample')).toHaveCount(5);
      for (const [sid, lines] of Object.entries(GOLD)) for (const [k, v] of Object.entries(lines)) await ep.getByTestId(`rv-cal-${sid}-${k}-${v}`).click();
      expect(await noSideScroll(ep)).toBe(true);
      await ep.getByTestId('rv-cal-send').click();
      await expect(ep.getByTestId('rv-cal-result')).toContainText('Passed: 100%');
      await expect(ep.getByTestId('rv-status')).toHaveText('Waiting for Nm7 to turn you on');
      await ep.getByRole('tab', { name: 'My checks' }).click();
      await expect(ep.getByTestId('rv-not-active')).toBeVisible();

      // the owner: Admin → Skill checks → L4 checks
      const owner = `l4-owner-${tag}@nm7.si`;
      const { secret } = seed('admin', owner, 'owner', PASSWORD);
      const actx = await browser.newContext(opts);
      const ap = await actx.newPage();
      await adminLogin(ap, owner, secret);
      await expect(ap).not.toHaveURL(/\/login/, { timeout: 15_000 });
      await ap.goto('/admin/skill-tests?tab=l4');
      await expect(ap.getByRole('heading', { name: 'Skill checks', level: 1 })).toBeVisible({ timeout: 15_000 });
      await expect(ap.getByRole('tab', { name: /L4 checks/ })).toHaveAttribute('aria-selected', 'true');
      await expect(ap.getByTestId('l4-free')).toHaveText('Free — payments off');
      await expect(ap.getByTestId('l4-free-note')).toContainText('No prices yet; nothing is charged or paid');
      await expect(ap.getByTestId('l4-payments')).not.toBeChecked();
      await expect(ap.getByTestId('l4-sla')).toContainText('24 h SLA');
      const row = ap.getByTestId('l4-rv').filter({ hasText: name });
      await expect(row).toContainText('Passed calibration');
      await expect(row).toContainText('100%');
      expect(await noSideScroll(ap)).toBe(true);
      await row.getByTestId('l4-activate').click();
      await expect(row).toContainText('Active');
      await row.getByTestId('l4-senior').click();
      await expect(row).toContainText('Senior');
      await expect(row.getByTestId('l4-pause')).toBeVisible();
      await actx.close();

      await ep.reload();
      await expect(ep.getByTestId('rv-status')).toHaveText('Active reviewer');
      await expect(ep.getByTestId('rv-no-checks')).toBeVisible();
      expect(await noSideScroll(ep)).toBe(true);
      await ectx.close();
    });
  });
}
