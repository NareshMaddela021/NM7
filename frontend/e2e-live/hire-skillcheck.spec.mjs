// Vetting V2 skill checks, on a desktop and a 390 px phone, against the real API: a candidate reads what the test
// checks and ticks "I understand", starts the SQL check for an experience band, answers all 18 questions one at a
// time (a tap or a number key, then Next), survives a reload mid-test, sends the answers and sees a score out of 100
// with topic bars; the same check can't start again for 30 days. A second candidate whose result the server couldn't
// confirm (signals sent through the API, as backend/tests/test_vetting.py does) sees the polite free-retest message,
// never any blame. Vetting V5: after the test, "I think this is wrong" sends an appeal and the page says our team will
// reply within 72 hours. No browser dialogs, no sideways scrolling.
import { expect, test } from '@playwright/test';
import { PASSWORD, email, login, seed } from './helpers.mjs';
import { SIZES, call, json, noSideScroll } from './college.mjs';

for (const [label, opts] of SIZES) {
  test.describe(label, () => {
    test.use(opts);

    test('consent, start for a band, answer all, see the score and topics', async ({ page }) => {
      test.setTimeout(240_000);
      page.on('dialog', () => { throw new Error('no browser dialogs'); });
      const mail = email(`sk-${label}`);
      seed('customer', mail, 'Asha Rao', PASSWORD);
      seed('vetting-tester', mail); // the vetting engine is hidden by default (Admin → Skill checks → Launch)
      await login(page, mail);
      await expect(page).toHaveURL(/\/me/);
      await page.goto('/me/skill-checks');
      const list = page.getByTestId('sk-list');
      for (const s of ['Electrical', 'Java', 'Web basics', 'Spoken English', 'Nursing basics', 'Delivery and logistics', 'Tally and GST', 'Retail']) await expect(list).toContainText(s);
      expect(await noSideScroll(page)).toBe(true);
      // the consent card, in plain words
      const consent = page.getByTestId('vt-consent');
      await expect(consent).toContainText('No camera');
      await expect(consent).toContainText('No audio is stored');
      await consent.getByTestId('vt-consent-tick').check();
      await consent.getByTestId('vt-consent-go').click();
      await expect(consent).toBeHidden();
      // search, then start for an experience band
      await page.getByTestId('vt-search').fill('data analyst');
      await list.getByTestId('sk-start-SQL').click();
      const dlg = page.getByTestId('vt-start');
      // Batch C item 27: a short line first, the rest behind "Read more"
      await expect(dlg.getByTestId('vt-start-short')).toContainText(/questions, about \d+ minutes\. Pass mark/);
      await expect(dlg.getByText('Find a quiet place')).toBeHidden();
      await dlg.getByTestId('vt-read-more').locator('summary').click();
      await expect(dlg.getByText('Find a quiet place')).toBeVisible();
      await dlg.getByText('1–3 years').click();
      await expect(dlg.getByTestId('vt-band-1-3')).toBeChecked();
      await dlg.getByTestId('vt-go').click();
      await expect(page.getByTestId('vt-q')).toBeVisible();
      await expect(page.getByTestId('vt-time')).toContainText(/1[45]:\d\d/);
      await expect(page.getByTestId('vt-qtime')).toContainText(/\d:\d\d/);
      expect(await noSideScroll(page)).toBe(true);
      // a reload carries on with the same paper and the answer already given
      await page.getByTestId('vt-opt').first().click();
      await expect(page.getByTestId('vt-save')).toHaveText('Saved');
      await page.reload();
      await expect(page.getByTestId('vt-q')).toBeVisible();
      await expect(page.getByTestId('vt-runner')).toContainText('1 of 18 answered');
      for (let i = 0; i < 18; i += 1) {
        if (!(await page.getByTestId('vt-q').isVisible())) break;
        await page.keyboard.press(String((i % 4) + 1)); // number keys pick an answer
        await page.getByTestId('vt-next').click();
      }
      await expect(page.getByTestId('vt-end')).toContainText('18 of 18 answered');
      await page.getByTestId('vt-submit').click();
      const res = page.getByTestId('vt-result');
      await expect(res).toBeVisible();
      await expect(res.getByTestId('vt-ring')).toHaveAttribute('aria-label', /Data analyst score: \d+ out of 100/);
      await expect(res.getByTestId('vt-pass')).toContainText(/\d+\/100/);
      expect(await res.getByTestId('vt-topic').count()).toBeGreaterThan(1);
      await expect(res).toContainText('1–3 years');
      await expect(res.getByTestId('vt-again')).toContainText('Next try from');
      expect(await noSideScroll(page)).toBe(true);
      // an appeal: a reason of 10+ characters, then the 72-hour promise and the open status
      await res.getByTestId('ap-skill').getByTestId('ap-open').click();
      const ap = page.getByTestId('ap-dialog');
      await ap.getByLabel('What looks wrong?').fill('Question 5 has two right answers, I think.');
      await ap.getByTestId('ap-send').click();
      await expect(ap).toHaveCount(0);
      await expect(res.getByTestId('ap-skill')).toContainText('Our team will reply within 72 hours');
      await page.reload();
      await expect(page.getByTestId('ap-skill')).toContainText('Our team will reply within 72 hours');
      const again = await call(page, '/api/me/skill-checks/start', json('POST', { skill: 'SQL' }));
      expect(again.status).toBe(409); // once in 30 days
    });

    test('a result we could not confirm offers a polite free retest', async ({ page }) => {
      test.setTimeout(120_000);
      page.on('dialog', () => { throw new Error('no browser dialogs'); });
      const mail = email(`skr-${label}`);
      seed('customer', mail, 'Meena S', PASSWORD);
      seed('vetting-tester', mail); // the vetting engine is hidden by default (Admin → Skill checks → Launch)
      await login(page, mail);
      await expect(page).toHaveURL(/\/me/);
      expect((await call(page, '/api/me/skill-checks/consent', json('POST', {}))).status).toBe(200);
      const p = (await call(page, '/api/me/skill-checks/start', json('POST', { skill: 'Excel' }))).body;
      const answers = Object.fromEntries(p.questions.map((q) => [q.id, 0]));
      const times = Object.fromEntries(p.questions.map((q) => [q.id, 300])); // faster than anyone can read
      const signals = { blurs: 12, blurMs: 200_000, devtools: 1 };
      const r = (await call(page, `/api/me/skill-checks/${p.id}/submit`, json('POST', { answers, times, signals }))).body;
      expect(r.retest).toBe(true);
      await page.goto(`/me/skill-checks/${p.id}`);
      const box = page.getByTestId('vt-retest');
      await expect(box).toContainText('We couldn’t confirm this result — please take a free retest under quieter conditions. This doesn’t mean anything is wrong.');
      await expect(page.getByTestId('vt-result')).not.toContainText(/cheat/i);
      await box.getByTestId('vt-retest-start').click();
      await expect(page.getByTestId('vt-start')).toBeVisible(); // the start dialog for the free retest
      expect(await noSideScroll(page)).toBe(true);
    });
  });
}
