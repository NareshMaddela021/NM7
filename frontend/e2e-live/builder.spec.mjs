// Builder downloads (PDF and Word) for signed-in customers, on the live setup (guests: see downloads.spec.mjs).
import { expect, test } from '@playwright/test';
import { PASSWORD, email, login, seed } from './helpers.mjs';

async function downloadBoth(page) {
  await page.goto('/builder');
  await page.evaluate(() => window.history.replaceState({ usr: { open: 'build' }, key: 'x' }, ''));
  await page.reload();
  for (const [button, ext] of [['Download PDF', '.pdf'], ['Word', '.docx']]) {
    const [file] = await Promise.all([
      page.waitForEvent('download', { timeout: 30_000 }),
      page.getByRole('button', { name: new RegExp(button) }).first().click(),
    ]);
    expect(file.suggestedFilename()).toMatch(new RegExp(`_Resume\\${ext}$`));
    const path = await file.path();
    const { size } = await import('node:fs').then((fs) => fs.statSync(path));
    const head = (await import('node:fs')).readFileSync(path).subarray(0, 4).toString('latin1');
    expect(head).toBe(ext === '.pdf' ? '%PDF' : 'PK\u0003\u0004'); // a real PDF / Word (zip) file
    expect(size).toBeGreaterThan(1500);
  }
}

test('signed-in customer can download PDF and Word', async ({ page }) => {
  const mail = email('dl');
  seed('customer', mail, 'Dee Ell', PASSWORD);
  await login(page, mail);
  await page.waitForURL('**/me');
  await downloadBoth(page);
});
