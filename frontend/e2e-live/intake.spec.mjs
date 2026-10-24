// The order intake form (new finding during the audit fixes): its answers reach the server before the page says
// they were sent, and a failed save says so and keeps the answers.
import { expect, test } from '@playwright/test';
import { API, PASSWORD, email, login, seed } from './helpers.mjs';

const work = (page, id) => page.evaluate(async ([base, oid]) => (await fetch(`${base}/api/work/${oid}`, { credentials: 'include' })).json(), [API, id]);

async function fill(page) {
  await page.getByRole('button', { name: 'Next', exact: true }).click(); // roles: Data Analyst is pre-picked
  await page.getByRole('textbox').first().fill('I built the weekly sales dashboard that the regional managers now use every Monday.');
  await page.getByRole('button', { name: 'Next', exact: true }).click();
  await page.getByRole('button', { name: /Next · or skip/ }).click();
}

test('intake answers are saved on the order; a failed save is said plainly and nothing is lost', async ({ page }) => {
  const mail = email('intake');
  seed('customer', mail, 'Asha Rao', PASSWORD);
  const order = seed('paid-order', mail, 'expert').id;
  await login(page, mail);
  await page.waitForURL('**/me');
  await page.goto(`/orders/${order}/intake`);
  await fill(page);
  // the server refuses once: the page must not claim it was sent
  let refused = false;
  await page.route(`**/api/work/${order}`, (route) => {
    if (route.request().method() === 'PATCH' && !refused) { refused = true; return route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: { code: 'down', message: 'The server is busy.' } }) }); }
    return route.continue();
  });
  await page.getByRole('button', { name: 'Send to my expert' }).click();
  await expect(page.getByTestId('intake-error')).toContainText('Your answers are still here');
  expect((await work(page, order)).intake?.wins || '').toBe('');
  // second try goes through, and only then the page says done
  await page.getByRole('button', { name: 'Send to my expert' }).click();
  await expect(page.getByTestId('intake-error')).toHaveCount(0);
  await expect.poll(async () => (await work(page, order)).intake?.wins || '').toContain('weekly sales dashboard');
  expect((await work(page, order)).intake.target).toBe('Data Analyst');
});
