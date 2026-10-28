// WhatsApp / SMS reminders (free, no gateway) on a desktop and a 390 px phone, against the real API: from the
// placement dashboard's "who's missing" list the coordinator makes a batch; each student gets a wa.me link carrying
// only the message and their first name; tapping it marks it sent ("1 of 2 sent"); students without a mobile are left
// out; phone-list CSV; on a phone the SMS option gives sms: links.
import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { SIZES, call, college, json, noSideScroll } from './college.mjs';

for (const [label, opts] of SIZES) {
  test.describe(label, () => {
    test.use(opts);

    test('who’s missing → WhatsApp links with only the message and name, progress, CSV', async ({ browser }) => {
      test.setTimeout(150_000);
      const c = await college(browser, opts, label, { students: 3, prefix: 'wa' });
      const [a, b] = c.students;
      expect((await call(a.page, '/api/me/profile', json('PATCH', { phone: '98765 43210' }))).status).toBe(200);
      expect((await call(b.page, '/api/me/profile', json('PATCH', { phone: '98765 43211' }))).status).toBe(200);
      await c.coord.context().route('https://wa.me/**', (r) => r.fulfill({ status: 200, contentType: 'text/html', body: '<p>WhatsApp</p>' }));

      await c.coord.goto(`/org/${c.org.id}/dashboard`);
      const missing = c.coord.getByTestId('pl-missing');
      await expect(missing).toBeVisible({ timeout: 20_000 });
      await missing.getByRole('tab', { name: /Not printed/ }).click();
      await missing.getByRole('checkbox', { name: 'Select all' }).check();
      await missing.getByTestId('pl-wa').click();
      await c.coord.getByTestId('wa-message').fill('Hi {name}, please add your projects on Nm7 today.');
      if (label === 'phone') await expect(c.coord.getByTestId('wa-sms')).toBeVisible();
      await c.coord.getByTestId('wa-make').click();
      const batch = c.coord.getByTestId('wa-batch');
      await expect(batch.getByTestId('wa-progress')).toHaveText('0 of 2 sent');
      await expect(batch).toContainText('1 without a mobile number');
      const hrefs = await batch.getByTestId('wa-link').evaluateAll((as) => as.map((x) => x.getAttribute('href')));
      for (const h of hrefs) {
        const u = new URL(h);
        expect(u.origin).toBe('https://wa.me');
        expect(u.pathname).toMatch(/^\/91987654321[01]$/);
        expect([...u.searchParams.keys()]).toEqual(['text']);
        expect(u.searchParams.get('text')).toBe('Hi Student, please add your projects on Nm7 today.');
      }
      const [pop] = await Promise.all([c.coord.waitForEvent('popup'), batch.getByTestId('wa-link').first().click()]);
      await pop.close();
      await expect(batch.getByTestId('wa-progress')).toHaveText('1 of 2 sent');
      await batch.getByTestId('wa-sent').nth(1).click(); // saved, then shown ticked
      await expect(batch.getByTestId('wa-progress')).toHaveText('2 of 2 sent');
      const [file] = await Promise.all([c.coord.waitForEvent('download'), batch.getByTestId('wa-csv').click()]);
      const csv = readFileSync(await file.path(), 'utf8');
      expect(csv).toContain('+919876543210');
      expect(csv.split('\n')[0].trim()).toBe('Name,Mobile');
      expect(await noSideScroll(c.coord)).toBe(true);
      const log = (await call(c.coord, `/api/org/${c.org.id}/audit`)).body.map((x) => x.action);
      for (const x of ['wa_batch', 'wa_sent', 'wa_phones_csv']) expect(log).toContain(x);
      await c.close();
    });
  });
}
