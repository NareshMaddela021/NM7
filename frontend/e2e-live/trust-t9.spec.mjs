// Vetting Trust T9 (the honesty pledge, visible retake limits, "Explain your answer") on a desktop and a 390 px phone,
// against the real API (no AI key here, so the explain question comes from the rules template and the answer is
// checked by rules):
//   - a skill check: the start dialog shows the limits (allowed, used, can start now) and the pledge; Start stays off
//     until it is ticked; the test opens. A role taken 10 days ago says when the next attempt opens, and its result
//     shows the same date with a countdown and what counts;
//   - the AI interview in Hindi: the limits, the note about questions on their own task and the pledge (in Hindi) before
//     starting; the interview has 8 questions, one quoting their own practical task; the result shows
//     "Explained own work" with the reason and when they can take it again;
//   - Admin → Vetting Trust → Honesty and retakes: the numbers within bounds (a change is saved and put back) and the
//     pledge in three languages;
//   - while the switch is off, someone who isn't a tester sees no pledge and no limits block (the old flow).
// Desktop and phone share one database: every test uses its own people and puts any global setting back.
import { expect, test } from '@playwright/test';
import { PASSWORD, adminLogin, email, login, seed } from './helpers.mjs';
import { SIZES, fitsPhone } from './college.mjs';

const uniq = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 5);

async function person(page, who, name, { trust = true } = {}) {
  const mail = email(`${who}-${uniq()}`);
  seed('customer', mail, name, PASSWORD);
  seed('vetting-tester', mail);
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

async function openStart(page, search, test) {
  await page.goto('/me/skill-checks');
  const consent = page.getByTestId('vt-consent');
  await consent.getByTestId('vt-consent-tick').check();
  await consent.getByTestId('vt-consent-go').click();
  await expect(consent).toHaveCount(0);
  await page.getByTestId('vt-search').fill(search);
  return page.getByTestId('sk-list').getByTestId(`sk-start-${test}`);
}

for (const [label, opts] of SIZES) {
  test.describe(label, () => {
    test.use(opts);

    test('skill check: limits before starting and on a result, the pledge needed to start', async ({ page }) => {
      page.on('dialog', () => { throw new Error('no browser dialogs'); });
      const mail = await person(page, `tt9sk-${label}`, `Asha Pledge ${label}`);
      const { id: excel } = seed('trust-t9-attempt', mail, 'Excel', '10'); // taken 10 days ago: the next one opens in 20 days

      // a role taken 10 days ago: its card says when, the result says the same with a countdown and what counts
      const start = await openStart(page, 'excel', 'Excel');
      const card = page.getByTestId('sk-list').locator('[data-test="Excel"]');
      await expect(card.getByTestId('vt-wait')).toContainText('Next try from');
      await expect(start).toHaveCount(0);
      await page.goto(`/me/skill-checks/${excel}`);
      const rk = page.getByTestId('vt-result').getByTestId('retake');
      await expect(rk.getByTestId('retake-rule')).toHaveText('Allowed: 1 attempt every 30 days for this role.', { timeout: 20_000 });
      await expect(rk.getByTestId('retake-used')).toHaveText('Used: 1 of 1 in the last 30 days.');
      await expect(rk.getByTestId('retake-next')).toContainText(/Next attempt opens on .+ \(in (20|21) days\)/);
      await expect(rk.getByTestId('retake-counts')).toContainText('latest passed attempt');
      await expect(page.getByTestId('vt-again')).toContainText('Next try from');
      expect(await fitsPhone(page)).toBe(true);

      // a new role: the limits say "start now", and Start waits for the pledge
      await page.goto('/me/skill-checks');
      await page.getByTestId('vt-search').fill('data analyst');
      await page.getByTestId('sk-list').getByTestId('sk-start-SQL').click();
      const dlg = page.getByTestId('vt-start');
      await expect(dlg.getByTestId('retake').getByTestId('retake-next')).toContainText('You can start now', { timeout: 20_000 });
      const pledge = dlg.getByTestId('pledge-skill');
      await expect(pledge.getByTestId('pledge-text')).toContainText('without help from other people or AI tools', { timeout: 20_000 });
      await expect(pledge.getByTestId('pledge-text')).toContainText('Nothing is decided automatically');
      await expect(pledge.getByTestId('pledge-tick')).not.toBeChecked();
      await expect(dlg.getByTestId('vt-go')).toBeDisabled();
      expect(await fitsPhone(page)).toBe(true);
      await pledge.getByTestId('pledge-tick').check();
      await expect(dlg.getByTestId('vt-go')).toBeEnabled();
      await dlg.getByTestId('vt-go').click();
      await expect(page.getByTestId('vt-runner')).toBeVisible({ timeout: 20_000 });
      expect(await fitsPhone(page)).toBe(true);
    });

    test('AI interview in Hindi: limits, the pledge, a question about their own task, "Explained own work"', async ({ page }) => {
      test.setTimeout(180_000);
      page.on('dialog', () => { throw new Error('no browser dialogs'); });
      const mail = await person(page, `tt9iv-${label}`, `Ravi Explain ${label}`);
      seed('trust-t9-task', mail, 'Sales', 'voice');
      await page.goto('/me/interviews');
      const role = page.getByTestId('iv-role').filter({ hasText: 'Sales' });
      await role.getByTestId('iv-start-Sales').click();
      const consent = page.getByTestId('iv-consent');
      await expect(consent).toContainText('1 every 30 days');
      await expect(consent.getByTestId('explain-note')).toContainText('explain your own answer', { timeout: 20_000 });
      await expect(consent.getByTestId('retake-next')).toContainText('You can start now');
      await page.getByTestId('iv-lang-hi').check();
      await page.getByTestId('iv-mode-text').check();
      const pledge = page.getByTestId('pledge-interview');
      await expect(pledge.getByTestId('pledge-text')).toContainText('मेरे जवाब मेरे अपने होंगे');
      await page.getByTestId('iv-agree').check();
      await expect(page.getByTestId('iv-go')).toBeDisabled(); // the pledge isn't ticked yet
      expect(await fitsPhone(page)).toBe(true);
      await pledge.getByTestId('pledge-tick').check();
      await page.getByTestId('iv-go').click();

      // 8 questions: the 7 of the role and one quoting their own practical task (in Hindi, before the last)
      for (let n = 1; n <= 8; n += 1) {
        await expect(page.getByTestId('iv-progress')).toContainText(`${n} of 8`, { timeout: 30_000 });
        const q = page.getByTestId('iv-q');
        const own = n === 7;
        if (own) await expect(q).toContainText('अपने प्रैक्टिकल टास्क में आपने लिखा');
        if (own) await expect(q).toContainText(/two phones in their budget|I offer a demo and note their number/); // a sentence of their task
        if (n === 7) expect(await fitsPhone(page)).toBe(true);
        await page.getByTestId('iv-text').fill(own ? 'I show two phones in the budget so the customer can compare the battery and the camera.'
          : `I talk to the customer, understand the need and show the right phone. Answer ${n}.`);
        await page.getByTestId('iv-send').click();
      }
      await expect(page.getByTestId('iv-review-text')).toContainText('Our team will grade it', { timeout: 60_000 }); // no AI here
      const ex = page.getByTestId('iv-explained');
      await expect(ex).toContainText('Explained own work: Partial');
      await expect(ex.getByTestId('iv-explained-reason')).toContainText('battery');
      await expect(page.getByTestId('retake').getByTestId('retake-next')).toContainText(/Next attempt opens on .+ \(in (29|30) days\)/);
      await expect(page.getByTestId('pledge-note')).toContainText('honesty pledge for the interview (version 1)');
      await page.getByTestId('iv-transcript-fold').locator('summary').click();
      await expect(page.getByTestId('iv-transcript-fold')).toContainText('About your task:');
      expect(await fitsPhone(page)).toBe(true);
    });

    test('Admin: honesty and retake numbers within bounds, the pledge in three languages', async ({ page }) => {
      const owner = `tt9-owner-${label}-${uniq()}@nm7.si`;
      const { secret } = seed('admin', owner, 'owner', PASSWORD);
      await adminLogin(page, owner, secret);
      await expect(page).not.toHaveURL(/\/login/);
      page.on('dialog', () => { throw new Error('no browser dialogs'); });
      await page.goto('/admin/skill-tests?tab=trust');
      const card = page.getByTestId('th-card');
      await expect(card.getByTestId('th-skillAttempts')).toHaveValue('1', { timeout: 20_000 });
      await expect(page.getByTestId('tt-page').getByRole('status').filter({ hasText: 'Loading' })).toHaveCount(0, { timeout: 20_000 });
      expect(await fitsPhone(page)).toBe(true);
      await expect(card.getByTestId('th-skillAttempts')).toHaveAttribute('max', '3');
      const saved = () => page.waitForResponse((r) => new URL(r.url()).pathname === '/api/admin/trust/honesty' && r.request().method() === 'GET');
      await card.getByTestId('th-skillAttempts').fill('2');
      let back = saved();
      await card.getByTestId('th-save').click();
      await back;
      await expect(card.getByTestId('th-skillAttempts')).toHaveValue('2');
      await card.getByTestId('th-skillAttempts').fill('1'); // put it back (shared database)
      back = saved();
      await card.getByTestId('th-save').click();
      await back;
      await expect(card.getByTestId('th-skillAttempts')).toHaveValue('1');
      await card.getByTestId('th-pledge').locator('summary').click();
      await expect(card.getByTestId('th-pledge')).toContainText('without help from other people or AI tools');
      await expect(card.getByTestId('th-pledge')).toContainText('మాట ఇస్తున్నాను');
      await expect(card.getByTestId('th-pledge')).toContainText('वादा करता/करती हूँ');
      expect(await fitsPhone(page)).toBe(true);
    });

    test('switch off: no pledge and no limits block for someone who is not a tester', async ({ page }) => {
      await person(page, `tt9off-${label}`, `Lata Off ${label}`, { trust: false });
      await (await openStart(page, 'data analyst', 'SQL')).click();
      const dlg = page.getByTestId('vt-start');
      await expect(dlg).toContainText('One try every 30 days');
      await page.waitForLoadState('networkidle');
      await expect(dlg.getByTestId('pledge-skill')).toHaveCount(0);
      await expect(dlg.getByTestId('retake')).toHaveCount(0);
      await expect(dlg.getByTestId('vt-go')).toBeEnabled();
      expect(await fitsPhone(page)).toBe(true);
    });
  });
}
