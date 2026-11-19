// Sign in / sign up with Google on a desktop and a 390 px phone, against the real API. Google itself is never reached:
// the Google Identity Services script is replaced (page.route) by a tiny stand-in whose button hands the page a test
// ID token, signed with the key the test API was started with (e2e-live/api.sh, tests/e2e_google_key.py; ignored in
// production). The test client ID is not in the site flags for other tests, so this test adds it in the page.
//   - a new job seeker signs up with Google, lands on the same page as an email sign-up, then goes through the Trust
//     age check and a consent like everyone; Settings shows Google connected and Remove blocked (no password yet);
//   - signed out, Google signs them in again (no second account);
//   - someone with a password connects Google in Settings, then removes it;
//   - the admin login page has no Google button. No sideways scroll on the phone.
import { createSign } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';
import { API, PASSWORD, email, login, seed } from './helpers.mjs';
import { SIZES, call, noSideScroll } from './college.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const CLIENT_ID = 'e2e-test.apps.googleusercontent.com'; // GOOGLE_TEST_CLIENT_ID in api.sh
const yearsAgo = (n) => { const d = new Date(); d.setFullYear(d.getFullYear() - n); return d.toISOString().slice(0, 10); };
const b64 = (x) => Buffer.from(typeof x === 'string' ? x : JSON.stringify(x)).toString('base64url');

/** A Google ID token as Google would sign it, with the test key. */
function idToken(sub, mail, name) {
  const { kid, pem } = JSON.parse(readFileSync(join(here, '.google-key.json'), 'utf8'));
  const t = Math.floor(Date.now() / 1000);
  const head = `${b64({ alg: 'RS256', kid, typ: 'JWT' })}.${b64({ iss: 'https://accounts.google.com', aud: CLIENT_ID, sub, email: mail, email_verified: true, name, iat: t, exp: t + 3600 })}`;
  return `${head}.${createSign('RSA-SHA256').update(head).sign(pem).toString('base64url')}`;
}

/** The stand-in Google script and the client ID in the site flags. `who.token` is what the next button press sends. */
async function fakeGoogle(page, who) {
  await page.route(`${API}/api/public/site-flags`, async (route) => {
    const r = await route.fetch();
    await route.fulfill({ response: r, json: { ...(await r.json()), googleClientId: CLIENT_ID } });
  });
  await page.route('https://accounts.google.com/gsi/client', (route) => route.fulfill({
    contentType: 'application/javascript',
    body: `window.google = { accounts: { id: {
      initialize(o) { window.__gsi = o; },
      renderButton(el, o) {
        const b = document.createElement('button'); b.type = 'button'; b.dataset.testid = 'gsi-fake';
        b.textContent = o.text === 'signin_with' ? 'Sign in with Google' : 'Continue with Google'; b.style.cssText = 'min-height:44px;width:100%';
        b.onclick = () => window.__gsi.callback({ credential: ${JSON.stringify(who.token || '')}, select_by: 'btn' }); el.appendChild(b);
      } } } };`,
  }));
}

for (const [label, opts] of SIZES) {
  test.describe(label, () => {
    test.use(opts);

    test('new job seeker signs up with Google, consents, signs in again; Remove blocked without a password', async ({ page }) => {
      test.setTimeout(120_000);
      const mail = email(`gnew-${label}`);
      const who = { token: idToken(`g-${mail}`, mail, 'Gita Rao') };
      await fakeGoogle(page, who);

      await page.goto('/signup?role=jobseeker');
      await expect(page.getByTestId('google-button')).toContainText('Terms');
      expect(await noSideScroll(page)).toBe(true);
      await page.getByTestId('gsi-fake').click();
      // where an email sign-up lands: "What would you like to do?", the role from the link ticked
      await page.waitForURL('**/welcome?role=jobseeker');
      await expect(page.getByRole('checkbox', { name: /Find a job/ })).toBeChecked();
      await page.getByRole('button', { name: 'Continue' }).click();
      await page.waitForURL('**/me/profile');
      const me = (await call(page, '/api/auth/me')).body;
      expect(me).toMatchObject({ roles: ['jobseeker'], activeRole: 'jobseeker', rolesPending: false });
      expect(me).toMatchObject({ role: 'customer', name: 'Gita Rao', verified: true, hasPassword: false });

      // the same Trust steps as every new account: the age check, then a consent
      seed('trust-tester', mail);
      await page.goto('/me/settings');
      const card = page.getByTestId('tc-card');
      await expect(card).toBeVisible({ timeout: 20_000 });
      await expect(card.getByTestId('tc-toggle').first()).toBeDisabled();
      await card.getByTestId('tc-dob').fill(yearsAgo(25));
      await card.getByTestId('tc-age-save').click();
      await expect(card.getByTestId('tc-age')).toHaveCount(0);
      const voice = card.getByTestId('tc-voice');
      await voice.getByTestId('tc-toggle').click();
      await expect(voice.getByTestId('tc-state')).toContainText('On');

      // Settings: Google is the only way in, so it can't be removed yet
      const g = page.locator('#s-google');
      await expect(g).toContainText('Connected to Google');
      await expect(g).toContainText(mail);
      await expect(g.getByRole('button', { name: 'Remove Google' })).toBeDisabled();
      await expect(g.getByRole('link', { name: 'Set a password' })).toBeVisible();
      await expect(page.getByRole('heading', { name: 'Set a password' })).toBeVisible();
      expect(await noSideScroll(page)).toBe(true);

      // signed out, Google signs the same account in again
      await call(page, '/api/auth/logout', { method: 'POST' });
      await page.goto('/login?next=%2Fme%2Fsettings');
      await page.getByTestId('gsi-fake').click();
      await page.waitForURL('**/me/settings');
      expect((await call(page, '/api/auth/me')).body.id).toBe(me.id);
    });

    test('connect Google in Settings, then remove it; admin login has no Google button', async ({ page }) => {
      const mail = email(`glink-${label}`);
      seed('customer', mail, 'Asha Rao', PASSWORD);
      const gmail = email(`glink-g-${label}`);
      const who = { token: idToken(`g-${gmail}`, gmail, 'Asha R') };
      await fakeGoogle(page, who);
      await login(page, mail);
      await page.waitForURL('**/me');
      await page.goto('/me/settings');
      const g = page.locator('#s-google');
      await expect(g).toContainText('Sign in with one tap');
      await g.getByTestId('gsi-fake').click();
      await expect(g).toContainText('Connected to Google');
      await expect(g).toContainText(gmail);
      expect(await noSideScroll(page)).toBe(true);
      await g.getByRole('button', { name: 'Remove Google' }).click();
      await expect(g.getByTestId('gsi-fake')).toBeVisible();
      expect((await call(page, '/api/auth/me')).body.google).toBeNull();

      await call(page, '/api/auth/logout', { method: 'POST' });
      await page.goto('/admin/login');
      await expect(page.getByLabel('Work email')).toBeVisible();
      await expect(page.getByTestId('google-button')).toHaveCount(0);
      await expect(page.getByTestId('gsi-fake')).toHaveCount(0);
      expect(await noSideScroll(page)).toBe(true);
    });
  });
}
