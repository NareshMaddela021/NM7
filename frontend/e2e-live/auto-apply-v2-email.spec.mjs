// Auto Apply 2.0, phase A3 (email applications) on a desktop and a 390 px phone, against the real API. A tester has
// 2.0 on (full auto). Two email jobs: one whose address the company published on its own careers page, one with no
// known source. The run (with the email channel on in the seed process only; every email is captured, none is sent)
// emails the first to the tester's own inbox, never to the company, because the 2.0 switch is OFF. The second is
// "Ready" with the address for one tap. The tracker shows channel Email; "What was sent" shows the exact email from the
// candidate's apply address with the tailored resume attached. A company reply (as Resend's webhook delivers it) makes
// the row "Replied" and is listed. The Email tab shows the apply address, the follow-up opt-in and the replies (the
// API itself has no Resend settings in these tests, so it also says the channel is off). The employer's one-click
// opt-out page blocks a domain and can switch to one address; a test email's link blocks nothing. Admin sees the
// channel health and the block, and undoes it. Each test uses its own candidate, jobs and addresses (desktop and
// phone share one database), so nothing needs putting back. No browser dialogs, no sideways scrolling.
import { expect, test } from '@playwright/test';
import { PASSWORD, adminLogin, seed } from './helpers.mjs';
import { SIZES, call, json, noSideScroll } from './college.mjs';
import { STRONG, studentWith } from './autoapply.mjs';

const DESC = 'Build weekly dashboards in SQL and Power BI for our retail stores. Freshers are welcome; training is given.';
const emailJob = (tag, title, extra = {}) => seed('job', JSON.stringify({
  title, company: { name: `Orbit ${tag}`, website: `${tag}.example` }, locations: ['Hyderabad'], experience: 'fresher',
  skills: ['SQL', 'Power BI'], description: DESC, applyMethod: 'email', applyEmail: `hr@${tag}.example`, ...extra,
}));

for (const [label, opts] of SIZES) {
  test.describe(label, () => {
    test.use(opts);

    test('candidate: sent to the test inbox only, what was sent, a reply, the Email tab', async ({ page }) => {
      test.setTimeout(200_000);
      const tag = `a3${label[0]}${Date.now().toString(36)}`;
      page.on('dialog', () => { throw new Error('no browser dialogs'); });
      const me = await studentWith(page, label, STRONG, 'aa3');
      seed('aa2-tester', me);
      const rules = { roles: [tag], cities: ['Hyderabad'], remote: true, dailyLimit: 10, mode: 'full_auto' };
      expect((await call(page, '/api/me/auto-apply/v2/rules', json('PUT', rules))).status).toBe(200);
      expect((await call(page, '/api/me/auto-apply/v2/consent', json('POST', { agree: true }))).status).toBe(200);
      const published = emailJob(tag, `Data Analyst ${tag}`, { applyEmailSource: `https://${tag}.example/careers/42` });
      emailJob(tag, `Reporting Analyst ${tag}`, { applyEmail: `jobs@${tag}.example` }); // no known source

      const run = seed('aa2-email-run', me);
      expect(run.sent).toHaveLength(1);
      const mail = run.sent[0];
      expect(mail.to).toBe(me); // the tester's own inbox: the switch is OFF, so never the company
      expect(run.sent.some((m) => m.to.endsWith(`@${tag}.example`))).toBe(false);
      expect(mail.subject).toBe(`[Test: would go to hr@${tag}.example] Application for Data Analyst ${tag} – Asha Rao`);
      expect(mail.from).toMatch(/^Asha Rao via Nm7 <asha\.[a-z2-9]{4}@apply\.nm7\.si>$/);
      expect(mail.attachments).toEqual(['Asha_Rao_Resume.pdf']);
      expect(mail.text).toContain("Sent via Nm7 Auto Apply on Asha Rao's behalf");
      expect(mail.text).toMatch(/\/stop-alerts#k=employer&t=\S+/);
      expect(mail.text).not.toMatch(/<img|utm_/i);

      // the tracker: Email channel, Applied; the other job is Ready with the address
      await page.goto('/me/auto-apply/v2');
      const row = page.getByTestId('aa2-row').filter({ hasText: `Data Analyst ${tag}` });
      await expect(row).toContainText('Email');
      await expect(row).toHaveAttribute('data-stage', 'applied');
      const ready = page.getByTestId('aa2-row').filter({ hasText: `Reporting Analyst ${tag}` });
      await expect(ready).toHaveAttribute('data-stage', 'ready');
      await expect(ready.getByTestId('aa2-row-applyto')).toContainText(`jobs@${tag}.example`);
      await row.getByTestId('aa2-what').click();
      const sent = row.getByTestId('aa2-email');
      await expect(sent).toContainText(mail.from.match(/<(.+)>/)[1]);
      await expect(sent.getByTestId('aa2-email-attachment')).toContainText('Asha_Rao_Resume.pdf');
      await expect(sent.getByTestId('aa2-email-test')).toContainText(me);
      await expect(sent).toContainText(`https://${tag}.example/careers/42`);
      expect(await noSideScroll(page)).toBe(true);

      // a company reply comes back to the apply address: stored, forwarded, "Replied"
      const reply = seed('aa2-email-reply', me, `priya@${tag}.example`, `Hi Asha, can you talk on Monday? ${tag}`);
      expect(reply.stored).toBe(true);
      expect(reply.forwarded).toBe(true);
      expect(reply.sent[0].to).toBe(me);
      await page.reload();
      await expect(row).toHaveAttribute('data-stage', 'replied');
      await expect(row.getByTestId('aa2-row-replies')).toContainText('1 reply');
      await row.getByTestId('aa2-what').click();
      await expect(row.getByTestId('aa2-reply')).toContainText(`can you talk on Monday? ${tag}`);
      expect(await noSideScroll(page)).toBe(true);

      // the Email tab: address, follow-up opt-in, the reply; this API has no Resend settings, so the channel says off
      await page.getByTestId('aa2-tab-email').click();
      const tab = page.getByTestId('aa2-email-tab');
      await expect(tab.getByTestId('aa2-email-address')).toHaveText(reply.alias);
      await expect(tab.getByTestId('aa2-email-off')).toContainText('off for now');
      await expect(tab.getByTestId('aa2-email-testmode')).toBeVisible();
      await expect(tab.getByTestId('aa2-reply')).toContainText(`priya@${tag}.example`);
      const follow = tab.getByTestId('aa2-email-follow');
      await expect(follow).not.toBeChecked();
      const saved = page.waitForResponse((r) => r.url().includes('/auto-apply/v2/email') && r.request().method() === 'PUT');
      await follow.click(); // saved first, then shown ticked (the server's answer)
      expect((await saved).ok()).toBe(true);
      await expect(follow).toBeChecked();
      expect((await call(page, '/api/me/auto-apply/v2/email')).body.followUp).toBe(true);
      expect(await noSideScroll(page)).toBe(true);
      expect(published.id).toBeTruthy();
    });

    test('employer opt-out page, and Admin sees the health and undoes the block', async ({ page, browser }) => {
      test.setTimeout(150_000);
      const tag = `a3o${label[0]}${Date.now().toString(36)}`;
      page.on('dialog', () => { throw new Error('no browser dialogs'); });
      const addr = `hr@${tag}.example`;
      const { token } = seed('aa2-optout-token', addr);
      await page.goto(`/stop-alerts#k=employer&t=${token}`);
      await expect(page.getByTestId('aa-optout-done')).toHaveText('You won’t get Auto Apply emails from Nm7 again.');
      await expect(page.getByTestId('aa-optout-scope')).toContainText(`@${tag}.example`);
      expect(await noSideScroll(page)).toBe(true);
      const moved = page.waitForResponse((r) => r.url().includes('/auto-apply/opt-out') && r.request().method() === 'POST');
      await page.getByTestId('aa-optout-address').click();
      expect((await moved).ok()).toBe(true);
      await expect(page.getByTestId('aa-optout-scope')).toContainText(`${addr} only`);
      // a broken link says so
      await page.goto('/old-home');
      await page.goto(`/stop-alerts#k=employer&t=${token.slice(0, -4)}xxxx`);
      await expect(page.getByTestId('aa-optout-error')).toBeVisible();

      // Admin: the email channel's health, the opt-out on the list, undo
      const owner = `aa3-owner-${tag}@nm7.si`;
      const { secret } = seed('admin', owner, 'owner', PASSWORD);
      const ctx = await browser.newContext(opts);
      const admin = await ctx.newPage();
      admin.on('dialog', () => { throw new Error('no browser dialogs'); });
      await adminLogin(admin, owner, secret);
      await expect(admin).not.toHaveURL(/\/login/);
      await admin.goto('/admin/auto-apply');
      const panel = admin.getByTestId('aa2-email-admin');
      await expect(panel.getByTestId('aa2-email-admin-state')).toContainText('Off');
      await expect(panel.getByTestId('aa2-email-missing')).toContainText('RESEND_INBOUND_SECRET');
      await expect(admin.getByTestId('aa2-test-inbox')).toBeVisible();
      await panel.getByTestId('aa2-email-blocks-toggle').click();
      const blockRow = panel.getByTestId('aa2-email-block').filter({ hasText: addr });
      await expect(blockRow).toContainText('Opted out');
      expect(await noSideScroll(admin)).toBe(true);
      const undone = admin.waitForResponse((r) => r.url().includes('/email/blocks/') && r.request().method() === 'DELETE');
      await blockRow.getByTestId('aa2-email-unblock').click();
      expect((await undone).ok()).toBe(true);
      await expect(panel.getByTestId('aa2-email-block').filter({ hasText: addr })).toHaveCount(0);
      await ctx.close();
    });
  });
}
