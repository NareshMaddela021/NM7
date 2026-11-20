// Vetting Trust T1 (the DPDP pack) on a desktop and a 390 px phone, against the real API:
//   - a tester confirms their age, turns a consent on and takes it back (the confirm dialog), then takes another back
//     through the signed email link without signing in;
//   - an under-18 tester is locked until a parent opens the one-time link from the email and agrees;
//   - the owner sees the Vetting Trust tab: the switch (hidden by default), the retention schedule (a change is saved and
//     put back), "Run now", erase-after-inactivity (off) and the breach log with its 72-hour countdown;
//   - while the switch is off, someone who isn't a tester sees no Privacy & consent card.
// Desktop and phone share one database: every test uses its own people and puts any global setting back.
import { expect, test } from '@playwright/test';
import { PASSWORD, adminLogin, email, emailsTo, login, seed } from './helpers.mjs';
import { SIZES, fitsPhone } from './college.mjs';

const yearsAgo = (n) => { const d = new Date(); d.setFullYear(d.getFullYear() - n); return d.toISOString().slice(0, 10); };

async function tester(page, who) {
  const mail = email(who);
  seed('customer', mail, 'Asha Rao', PASSWORD);
  seed('trust-tester', mail);
  await login(page, mail);
  await page.waitForURL('**/me');
  await page.goto('/me/settings');
  await expect(page.getByTestId('tc-card')).toBeVisible({ timeout: 20_000 });
  return mail;
}

for (const [label, opts] of SIZES) {
  test.describe(label, () => {
    test.use(opts);

    test('age check, a consent on and taken back, then the signed withdraw link', async ({ page, browser }) => {
      page.on('dialog', () => { throw new Error('no browser dialogs'); });
      const mail = await tester(page, `tt1-${label}`);
      const card = page.getByTestId('tc-card');
      await expect(card.getByTestId('tc-age')).toBeVisible();
      await expect(card.getByTestId('tc-toggle').first()).toBeDisabled(); // locked until the age check
      await card.getByTestId('tc-dob').fill(yearsAgo(25));
      await card.getByTestId('tc-age-save').click();
      await expect(card.getByTestId('tc-age')).toHaveCount(0);
      const voice = card.getByTestId('tc-voice');
      await expect(voice).toContainText('Voice recordings');
      await voice.getByTestId('tc-toggle').click();
      await expect(voice.getByTestId('tc-state')).toContainText('On');
      await voice.getByTestId('tc-toggle').click();
      const dlg = page.getByRole('dialog', { name: /Take back/ });
      await expect(dlg).toBeVisible();
      await dlg.getByTestId('tc-withdraw-confirm').click();
      await expect(dlg).toHaveCount(0);
      await expect(voice.getByTestId('tc-state')).toContainText('Taken back');
      await expect(card.getByTestId('tc-keep')).toContainText('days');
      expect(await fitsPhone(page)).toBe(true);

      // the signed link from an email works without signing in
      await card.getByTestId('tc-documents').getByTestId('tc-toggle').click();
      await expect(card.getByTestId('tc-documents').getByTestId('tc-state')).toContainText('On');
      const { token } = seed('trust-withdraw-token', mail, 'all');
      const ctx = await browser.newContext(opts);
      const anon = await ctx.newPage();
      await anon.goto(`/stop-alerts#k=consent&t=${token}`);
      await expect(anon.getByRole('heading', { name: 'Take back your consent' })).toBeVisible();
      await expect(anon.getByTestId('tl-documents')).toBeChecked();
      expect(await fitsPhone(anon)).toBe(true);
      await anon.getByTestId('tl-withdraw').click();
      await expect(anon.getByTestId('tl-done')).toContainText('1 purpose');
      await anon.goto('about:blank');
      await anon.goto('/stop-alerts#k=consent&t=someone.all.1700000000.00000000000000000000000000000000');
      await expect(anon.getByRole('alert')).toContainText(/doesn’t work|expired/);
      await ctx.close();
      await page.reload();
      await expect(page.getByTestId('tc-documents').getByTestId('tc-state')).toContainText('Taken back', { timeout: 20_000 });
    });

    test('under 18: locked until a parent agrees through the one-time link', async ({ page, browser }) => {
      await tester(page, `tt1kid-${label}`);
      const card = page.getByTestId('tc-card');
      await card.getByTestId('tc-dob').fill(yearsAgo(15));
      await card.getByTestId('tc-age-save').click();
      await expect(card.getByTestId('tc-parent')).toBeVisible();
      await expect(card.getByTestId('tc-toggle').first()).toBeDisabled();
      const parent = email(`tt1parent-${label}`);
      await card.getByTestId('tc-parent-email').fill(parent);
      await card.getByTestId('tc-parent-send').click();
      await expect(card.getByTestId('tc-parent-state')).toContainText('We sent a link');
      expect(await fitsPhone(page)).toBe(true);
      let link = '';
      await expect.poll(() => { const m = emailsTo(parent).join('\n').match(/#k=parent&t=([A-Za-z0-9_-]+)/); link = m ? m[1] : ''; return link; }).not.toBe('');
      const ctx = await browser.newContext(opts);
      const p = await ctx.newPage();
      await p.goto(`/stop-alerts#k=parent&t=${link}`);
      await expect(p.getByRole('heading', { name: 'Parent or guardian consent' })).toBeVisible();
      await expect(p.getByRole('main')).toContainText('Asha is under 18');
      await expect(p.getByTestId('tl-confirm')).toBeDisabled();
      await p.getByTestId('tl-parent-name').fill('Lakshmi Rao');
      await p.getByTestId('tl-agree').check();
      expect(await fitsPhone(p)).toBe(true);
      await p.getByTestId('tl-confirm').click();
      await expect(p.getByTestId('tl-done')).toContainText('can now use');
      await p.reload(); // one-time
      await expect(p.getByRole('alert')).toContainText(/used|expired/);
      await ctx.close();
      await page.reload();
      const ai = page.getByTestId('tc-ai_interview');
      await expect(ai.getByTestId('tc-toggle')).toBeEnabled({ timeout: 20_000 });
      await ai.getByTestId('tc-toggle').click();
      await expect(ai.getByTestId('tc-state')).toContainText('On');
    });

    test('owner: switch, retention, inactivity and the breach log', async ({ page }) => {
      const owner = `tt1-owner-${label}-${Date.now().toString(36)}@nm7.si`;
      const { secret } = seed('admin', owner, 'owner', PASSWORD);
      await adminLogin(page, owner, secret);
      await expect(page).not.toHaveURL(/\/login/);
      page.on('dialog', () => { throw new Error('no browser dialogs'); });
      await page.goto('/admin/skill-tests?tab=trust');
      await expect(page.getByRole('tab', { name: 'Vetting Trust' })).toHaveAttribute('aria-selected', 'true');
      await expect(page.getByTestId('tt-state')).toContainText('Hidden', { timeout: 20_000 });
      // every card of the tab has loaded (a card that arrives later could still widen the page)
      await expect(page.getByTestId('tt-page').getByRole('status').filter({ hasText: 'Loading' })).toHaveCount(0, { timeout: 20_000 });
      expect(await fitsPhone(page)).toBe(true);
      const rt = page.getByTestId('tt-retention');
      await expect(rt.getByTestId('tt-rt-selfie_face')).toContainText('Selfies');
      // a save or a run reloads the settings and the cards are drawn again: wait for that reload, not just the toast
      const reloaded = () => page.waitForResponse((r) => new URL(r.url()).pathname === '/api/admin/trust' && r.request().method() === 'GET');
      const voiceDays = rt.getByTestId('tt-rt-voice').getByTestId('tt-rt-days');
      const before = await voiceDays.inputValue();
      const other = before === '60' ? '61' : '60';
      await voiceDays.fill(other);
      let back = reloaded();
      await rt.getByTestId('tt-rt-save').click();
      await expect(page.getByText('Retention saved')).toBeVisible();
      await back;
      await expect(voiceDays).toHaveValue(other);
      await expect(rt.getByTestId('tt-rt-save')).toBeDisabled();
      await voiceDays.fill(before); // put it back (shared database)
      back = reloaded();
      await rt.getByTestId('tt-rt-save').click();
      await back;
      await expect(voiceDays).toHaveValue(before);
      await expect(rt.getByTestId('tt-rt-save')).toBeDisabled();
      back = reloaded();
      await rt.getByTestId('tt-rt-run').click();
      await expect(page.getByText('Deletion job ran')).toBeVisible();
      await back;
      await expect(page.getByTestId('tt-in-state')).toContainText('Off');
      expect(await fitsPhone(page)).toBe(true);

      const title = `Test incident ${label} ${Date.now().toString(36)}`;
      await page.getByTestId('tb-new').click();
      const dlg = page.getByRole('dialog', { name: 'Log a breach' });
      await dlg.getByTestId('tb-title').fill(title);
      await dlg.getByTestId('tb-data').fill('selfies');
      await dlg.getByTestId('tb-people').fill('3');
      await dlg.getByTestId('tb-save').click();
      await expect(dlg).toHaveCount(0);
      const item = page.getByTestId('tb-item').filter({ hasText: title });
      await expect(item.getByTestId('tb-countdown')).toContainText(/7[01] h \d+ min left/);
      await item.getByTestId('tb-to').selectOption('certin');
      await item.getByTestId('tb-notify').click();
      await expect(item).toContainText('CERT-In:');
      await item.getByTestId('tb-status').selectOption('closed');
      await expect(item.getByTestId('tb-countdown')).toHaveCount(0);
      expect(await fitsPhone(page)).toBe(true);
    });

    test('switch off: no Privacy & consent for someone who is not a tester', async ({ page }) => {
      const mail = email(`tt1-none-${label}`);
      seed('customer', mail, 'Ravi K', PASSWORD);
      await login(page, mail);
      await page.waitForURL('**/me');
      await page.goto('/me/settings');
      await expect(page.getByRole('heading', { name: 'Privacy', exact: true })).toBeVisible({ timeout: 20_000 });
      await page.waitForLoadState('networkidle');
      await expect(page.getByTestId('tc-card')).toHaveCount(0);
      expect(await fitsPhone(page)).toBe(true);
    });
  });
}
