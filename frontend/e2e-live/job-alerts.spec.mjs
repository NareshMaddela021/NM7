// Job alerts (Phase 2, C6) on a desktop and a 390 px phone, against the real API: Profile & settings → Job alerts
// (a role is needed to turn them on), the alert pass emails the new matching job with its link and a WhatsApp share
// link in the chosen language (Telugu here), and the email's "Stop these emails" link turns alerts off. No sideways
// scrolling.
import { expect, test } from '@playwright/test';
import { email, login, seed } from './helpers.mjs';
import { SIZES, noSideScroll } from './college.mjs';

const DESC = 'Build weekly dashboards in SQL and Power BI for our retail stores. Freshers are welcome; training is given.';

for (const [label, opts] of SIZES) {
  test.describe(label, () => {
    test.use(opts);

    test('set an alert, get the matching job by email in Telugu, stop it from the link', async ({ page }) => {
      test.setTimeout(120_000);
      const tag = `${label}j${Date.now().toString(36)}`;
      const mail = email(`alerts-${label}`);
      seed('customer', mail, 'Alert Person', 'Strong-pass-123');
      await login(page, mail);
      await expect(page).toHaveURL(/\/me/);
      await page.goto('/me/settings#job-alerts');
      const box = page.getByTestId('job-alerts');
      await box.getByText('Send me job alerts').click();
      await expect(box.getByTestId('alerts-on')).toBeChecked();
      await box.getByRole('button', { name: 'Save job alerts' }).click();
      await expect(box.getByRole('alert')).toContainText('Add at least one role');
      await box.getByLabel('Roles or skills (comma between, up to 5)').fill(`Alert Analyst ${tag}`);
      await box.getByLabel('Cities (comma between; empty = anywhere)').fill('Hyderabad');
      await box.getByText('Daily', { exact: true }).click();
      await box.getByLabel('Email language').selectOption('te');
      expect(await noSideScroll(page)).toBe(true);
      await box.getByRole('button', { name: 'Save job alerts' }).click();
      await expect(box.getByTestId('alerts-status')).toHaveText('On · daily');

      // a matching job and one in another city
      const job = seed('job', JSON.stringify({ title: `Alert Analyst ${tag}`, description: DESC, experience: 'fresher', applyMethod: 'link', applyUrl: 'https://alertco.example/jobs', company: { name: `Alertco ${tag}` }, locations: ['Hyderabad'], skills: ['SQL'] }));
      seed('job', JSON.stringify({ title: `Alert Analyst ${tag} Chennai`, description: DESC, experience: 'fresher', applyMethod: 'link', applyUrl: 'https://alertco.example/jobs', company: { name: `Alertco ${tag}` }, locations: ['Chennai'], skills: ['SQL'] }));
      const out = seed('job-alerts', mail);
      expect(out.sent).toHaveLength(1);
      const sent = out.sent[0];
      expect(sent.subject).toBe('Nm7లో మీకోసం 1 కొత్త ఉద్యోగం');
      expect(sent.text).toContain(`/jobs/${job.slug}`);
      expect(sent.text).toContain('WhatsAppలో షేర్ చేయండి: https://wa.me/?text=');
      expect(sent.text).not.toContain('Chennai');

      // the email's "Stop these emails" link
      await page.goto(`/stop-alerts#t=${out.stop}&k=alerts`);
      await expect(page.getByRole('heading', { level: 1 })).toHaveText('Job alert emails');
      await page.getByTestId('stop-confirm').click();
      await expect(page.getByTestId('stop-done')).toContainText('job alert emails');
      await page.goto('/me/settings#job-alerts');
      await expect(page.getByTestId('alerts-on')).not.toBeChecked();
    });
  });
}
