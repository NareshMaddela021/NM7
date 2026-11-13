// Phase 6 S10 first 90 days and progress, plus the Phase 6 demo, on a desktop and a 390 px phone, against the real
// API: the weekly card shows real numbers and a kind message; a student adds a job joined 8 days ago, ticks the
// checklist, answers the day 7 check-in "No" (pay lower), and Admin sees it in Joining reports. Admin opens the demo
// students: Meera lands on her learning path with "Skill verified: SQL"; Arjun on day 10 of his new job.
// No browser dialogs, no sideways scrolling.
import { expect, test } from '@playwright/test';
import { PASSWORD, adminLogin, email, login, seed } from './helpers.mjs';
import { SIZES, call, json, noSideScroll } from './college.mjs';

const daysAgo = (n) => new Date(Date.now() - n * 86_400_000 + 5.5 * 3_600_000).toISOString().slice(0, 10);

for (const [label, opts] of SIZES) {
  test.describe(label, () => {
    test.use(opts);

    test('weekly card, joined job checklist + day 7 report → Admin; demo students', async ({ page, browser }) => {
      test.setTimeout(150_000);
      page.on('dialog', () => { throw new Error('no browser dialogs'); });
      const mail = email(`pg10-${label}`);
      seed('customer', mail, 'Nisha K', PASSWORD);
      await login(page, mail);
      await expect(page).toHaveURL(/\/me/);
      await page.goto('/me/progress');
      await expect(page.getByTestId('pr-apps')).toHaveText('0');
      await expect(page.getByTestId('pr-message')).toContainText('quiet week');
      await page.getByTestId('pr-add').click();
      await page.getByTestId('pr-company').fill(`Shopco ${label}`);
      await page.getByTestId('pr-role').fill('Store associate');
      await page.getByTestId('pr-date').fill(daysAgo(7));
      await page.getByTestId('pr-save').click();
      const card = page.getByTestId('pr-joined');
      await expect(card.getByTestId('pr-day')).toHaveText('Day 8');
      await card.getByTestId('pr-item-w1-docs').click();
      await expect(card.getByTestId('pr-item-w1-docs')).toBeChecked();
      await card.getByTestId('pr-no').click();
      await card.getByTestId('pr-report').click();
      await expect(card.getByRole('alert')).toContainText("Pick what isn't as promised");
      await card.getByTestId('pr-p-salary').check();
      await card.getByTestId('pr-report').click();
      await expect(card).toContainText('Day 7 check-in: reported to Nm7');
      expect(await noSideScroll(page)).toBe(true);

      const owner = `pg10-owner-${label}-${Date.now().toString(36)}@nm7.si`;
      const { secret } = seed('admin', owner, 'owner', PASSWORD);
      const admin = await (await browser.newContext(opts)).newPage();
      admin.on('dialog', () => { throw new Error('no browser dialogs'); });
      await adminLogin(admin, owner, secret);
      await expect(admin).not.toHaveURL(/\/login/);
      await admin.goto('/admin/joining-reports');
      await expect(admin.getByTestId('ad-jr-row').filter({ hasText: `Shopco ${label}` })).toContainText('Pay lower than promised'); // readable, at a check-in (round E)
      expect(await noSideScroll(admin)).toBe(true);

      // the demo students (Arjun's one-time link first, while this browser is still the admin)
      const arjun = await call(admin, '/api/admin/seek/demo', json('POST', { who: 'arjun' }));
      expect(arjun.status).toBe(200);
      await admin.goto('/admin/auto-apply');
      await admin.getByTestId('aa-demo-meera').click();
      await expect(admin).toHaveURL(/\/me\/learn\?role=data-analyst/);
      await expect(admin.getByTestId('lp-badge')).toContainText('Skill verified: SQL');
      await admin.goto('/me/offer-check');
      await expect(admin.getByTestId('oc-saved')).toContainText('Warning');
      await admin.goto('/me/programs');
      await expect(admin.getByTestId('pg-status')).toHaveText('Completed');
      const a2 = await (await browser.newContext(opts)).newPage();
      a2.on('dialog', () => { throw new Error('no browser dialogs'); });
      await a2.goto(arjun.body.path);
      await expect(a2).toHaveURL(/\/me\/progress/);
      await expect(a2.getByTestId('pr-day')).toHaveText('Day 10');
      // round E: day 7 was "as promised", and Arjun can still report something any day of the first 90
      await a2.getByTestId('pr-report-open').click();
      await a2.getByTestId('pr-r-send').click();
      await expect(a2.getByRole('alert')).toContainText("Pick what isn't as promised");
      await a2.getByTestId('pr-r-fee').check();
      await a2.getByTestId('pr-r-note').fill('Asked to pay Rs 2,000 for the uniform.');
      expect(await noSideScroll(a2)).toBe(true);
      await a2.getByTestId('pr-r-send').click();
      await expect(a2.getByTestId('pr-report-sent')).toContainText('What happens next');
      await expect(a2.getByTestId('pr-reported')).toContainText('Asked to pay a deposit or fee');
      await a2.reload();
      await expect(a2.getByTestId('pr-reported')).toHaveCount(1); // kept after a reload
      expect(await noSideScroll(a2)).toBe(true);
    });
  });
}
