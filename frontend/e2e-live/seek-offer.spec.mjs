// Phase 6 S5 offer checker, on a desktop and a 390 px phone, against the real API: a pasted letter with a joining
// fee and a 2-year bond gets "Warning" with both points and the "ask HR or a lawyer" note; a PDF of the same letter
// is read (and not kept); a saved check lists and deletes; compare shows in-hand only after deductions are typed.
// No browser dialogs, no sideways scrolling.
import { expect, test } from '@playwright/test';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PASSWORD, email, login, seed } from './helpers.mjs';
import { SIZES, noSideScroll } from './college.mjs';

const here = fileURLToPath(new URL('.', import.meta.url));
const BAD = `Bright Future Solutions
Congratulations! You are selected as Data Analyst. Salary Rs 25,000 per month.
Please pay a registration fee of Rs 2,500 to confirm your seat.
You must sign a service agreement to serve the company for 2 years; leaving early carries a penalty of Rs 1,50,000.`;

for (const [label, opts] of SIZES) {
  test.describe(label, () => {
    test.use(opts);

    test('offer checker: fee + bond warning, PDF, save, compare', async ({ page }) => {
      test.setTimeout(120_000);
      page.on('dialog', () => { throw new Error('no browser dialogs'); });
      const mail = email(`oc-${label}`);
      seed('customer', mail, 'Lakshmi N', PASSWORD);
      await login(page, mail);
      await expect(page).toHaveURL(/\/me/);
      await page.goto('/me/offer-check');
      await page.getByTestId('oc-go').click();
      await expect(page.getByTestId('oc-form').getByRole('alert')).toContainText('Paste the offer letter');
      await page.getByTestId('oc-text').fill(BAD);
      await page.getByTestId('oc-go').click();
      const res = page.getByTestId('oc-result');
      await expect(res.getByTestId('oc-verdict')).toHaveText('Warning');
      await expect(res.locator('[data-kind="fee"]')).toContainText('pay a fee or deposit');
      await expect(res.locator('[data-kind="bond"]')).toContainText('2 year(s)');
      await expect(res.getByTestId('oc-note')).toContainText("ask the company's HR or a lawyer");
      await expect(res).not.toContainText(/legal advice/i);
      expect(await noSideScroll(page)).toBe(true);
      // the same letter as a PDF, saved
      await page.getByTestId('oc-text').fill('');
      await page.getByTestId('oc-pdf').setInputFiles(join(here, 'fixtures', 'offer-bond.pdf'));
      await page.getByTestId('oc-save').check();
      await page.getByTestId('oc-go').click();
      await expect(res.getByTestId('oc-verdict')).toHaveText('Warning');
      await expect(page.getByTestId('oc-saved')).toContainText('Warning');
      // compare: in hand only with deductions
      await page.getByTestId('oc-tab-compare').click();
      await page.getByTestId('oc-ctc-0').fill('3');
      await page.getByTestId('oc-ctc-1').fill('3.6');
      await expect(page.getByTestId('oc-sum-1')).toContainText('Highest CTC');
      await expect(page.getByTestId('oc-sum-0')).toContainText('type deductions to see');
      await page.getByTestId('oc-ded-0').fill('2000');
      await expect(page.getByTestId('oc-sum-0')).toContainText('₹23,000 a month');
      expect(await noSideScroll(page)).toBe(true);
      // delete the saved check
      await page.getByTestId('oc-tab-check').click();
      await page.getByTestId('oc-saved').getByRole('button', { name: 'Delete' }).click();
      await expect(page.getByTestId('oc-saved')).toHaveCount(0);
    });
  });
}
