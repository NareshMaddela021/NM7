// The same resume open in two tabs: after one tab saves, the other tab's save is refused (409) — it no longer stays
// on "Not saved yet — retrying" but asks "Use latest" / "Keep mine", and each does what it says.
import { expect, test } from '@playwright/test';
import { API, PASSWORD, email, login, seed } from './helpers.mjs';

const status = (p) => p.getByTestId('save-status');
async function openBuilder(p) {
  await p.goto('/builder');
  await p.evaluate(() => window.history.replaceState({ usr: { open: 'build' }, key: 'x' }, ''));
  await p.reload();
  await expect(status(p)).toHaveText('All changes saved', { timeout: 15_000 });
}
const serverName = (p) => p.evaluate(async (base) => {
  const rs = await (await fetch(`${base}/api/me/resumes`, { credentials: 'include' })).json();
  return rs.find((r) => r.active).data.personal;
}, API);

for (const choice of ['Use latest', 'Keep mine']) {
  test(`two tabs on one resume: ${choice}`, async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const a = await ctx.newPage();
    const mail = email('tabs');
    seed('customer', mail, 'Lakshmi Devi', PASSWORD);
    await login(a, mail);
    await a.waitForURL('**/me');
    await openBuilder(a);
    const b = await ctx.newPage();
    await openBuilder(b);

    await a.getByLabel('Headline').fill('Head Nurse');
    await expect(status(a)).toHaveText('All changes saved', { timeout: 15_000 });
    await b.getByLabel('Headline').fill('Staff Nurse');
    const ask = b.getByTestId('save-conflict');
    await expect(ask).toContainText('This resume was changed in another tab or device', { timeout: 15_000 });
    await expect(status(b)).not.toHaveText('Not saved yet — retrying');
    await ask.getByRole('button', { name: choice }).click();
    await expect(ask).toHaveCount(0);
    await expect(status(b)).toHaveText('All changes saved', { timeout: 15_000 });
    if (choice === 'Use latest') {
      await expect(b.getByLabel('Headline')).toHaveValue('Head Nurse');
      expect((await serverName(b)).headline).toBe('Head Nurse');
    } else {
      await expect(b.getByLabel('Headline')).toHaveValue('Staff Nurse');
      await expect.poll(async () => (await serverName(b)).headline).toBe('Staff Nurse');
    }
    await ctx.close();
  });
}
