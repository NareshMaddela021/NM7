// Vetting Trust T3 (ID + live selfie; the test provider here) on a desktop and a 390 px phone, against the real API, with
// Chromium's fake camera (--use-fake-device-for-media-stream, --use-fake-ui-for-media-stream):
//   - before a skill check: the consent text, the card photo (an Aadhaar card is refused), the live selfie with the
//     prompt, "ID + selfie verified", and the test starts;
//   - before the AI interview: liveness fails three times → a person checks (told plainly, nobody turned away); the
//     owner sees the ID + selfie card (test provider, keys "not set", counts) and verifies after a video call; the
//     interview then starts;
//   - the camera blocked: plain help and a manual check instead (Profile & settings);
//   - the joining day: a fresh selfie matches → "Same person at joining" on the offer;
//   - the demo company sees "ID + selfie verified · Same person at joining" on applicant cards, never a photo;
//   - while the switch is off, someone who isn't a tester is never asked and sees no card.
// Desktop and phone share one database: every test uses its own people and changes no global setting.
import { expect, test } from '@playwright/test';
import { PASSWORD, adminLogin, email, login, seed } from './helpers.mjs';
import { SIZES, noSideScroll } from './college.mjs';

test.use({
  launchOptions: {
    ...(process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {}),
    args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'],
  },
  permissions: ['camera'],
});

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');
const CARD = { name: 'pan.png', mimeType: 'image/png', buffer: PNG };
const AADHAAR = { name: 'card.png', mimeType: 'image/png', buffer: Buffer.concat([PNG, Buffer.from('Government of India AADHAAR 1234 5678 9012')]) };

async function person(page, who, name, { vetting = false, trust = true } = {}) {
  const mail = email(who);
  seed('customer', mail, name, PASSWORD);
  if (vetting) seed('vetting-tester', mail);
  if (trust) seed('trust-tester', mail);
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

async function cardAndSelfie(dlg, file = CARD) {
  await dlg.getByTestId('fc-card').setInputFiles(file);
  await expect(dlg.getByTestId('fc-card-preview')).toBeVisible();
  await dlg.getByTestId('fc-next').click();
  await selfie(dlg);
}

async function selfie(dlg) {
  await expect(dlg.getByTestId('fc-video')).toBeVisible();
  await expect(dlg.getByTestId('fc-prompt')).toHaveText('Ready when you are.', { timeout: 15_000 });
  await dlg.getByTestId('fc-shoot').click();
}

for (const [label, opts] of SIZES) {
  test.describe(label, () => {
    test.use(opts);

    test('skill check: ID card + live selfie first (Aadhaar refused), then the test starts', async ({ page }) => {
      page.on('dialog', () => { throw new Error('no browser dialogs'); });
      await person(page, `tt3sk-${label}`, `Asha Face ${label}`, { vetting: true });
      await page.goto('/me/skill-checks');
      const consent = page.getByTestId('vt-consent');
      await consent.getByTestId('vt-consent-tick').check();
      await consent.getByTestId('vt-consent-go').click();
      await page.getByTestId('vt-search').fill('data analyst');
      await page.getByTestId('sk-list').getByTestId('sk-start-SQL').click();
      await page.getByTestId('vt-start').getByTestId('vt-go').click();

      const dlg = page.getByRole('dialog', { name: 'Quick check: is it really you?' });
      await expect(dlg.getByTestId('fc-consent-text')).toContainText('never Aadhaar');
      await expect(dlg.getByTestId('fc-consent-text')).toContainText('Amazon Web Services');
      await expect(dlg.getByTestId('fc-consent-text')).toContainText('days after your hiring process ends');
      expect(await noSideScroll(page)).toBe(true);
      await dlg.getByTestId('fc-agree').click();
      await expect(dlg.getByTestId('fc-id')).toContainText('We never take Aadhaar');
      await dlg.getByTestId('fc-doc-pan').check();
      expect(await noSideScroll(page)).toBe(true);

      await cardAndSelfie(dlg, AADHAAR);
      await expect(dlg.getByTestId('fc-error')).toContainText('never take Aadhaar', { timeout: 20_000 });
      await expect(dlg.getByTestId('fc-id')).toBeVisible(); // back to the card photo, nothing counted

      await cardAndSelfie(dlg);
      await expect(dlg.getByTestId('fc-done')).toContainText('ID + selfie verified', { timeout: 20_000 });
      expect(await noSideScroll(page)).toBe(true);
      await dlg.getByTestId('fc-continue').click();
      await expect(page.getByTestId('vt-q')).toBeVisible({ timeout: 20_000 });
    });

    test('interview: liveness fails 3 times, a person checks, the owner verifies, then it starts', async ({ page, browser }) => {
      test.setTimeout(180_000);
      page.on('dialog', () => { throw new Error('no browser dialogs'); });
      const name = `Nolive Bala ${label} ${Date.now().toString(36)}`; // the test provider fails liveness for "nolive"
      const mail = await person(page, `tt3iv-${label}`, name, { vetting: true });
      seed('skill-verified', mail, 'SQL', '1-3', '84', '86');
      await page.goto('/me/interviews');
      await page.getByTestId('iv-role').filter({ hasText: 'Data analyst' }).getByTestId('iv-start-SQL').click();
      await page.getByTestId('iv-mode-text').check();
      await page.getByTestId('iv-agree').check();
      await page.getByTestId('iv-go').click();

      const dlg = page.getByRole('dialog', { name: 'Quick check: is it really you?' });
      await dlg.getByTestId('fc-agree').click();
      await expect(dlg.getByTestId('fc-id')).toContainText('Before your AI interview');
      await cardAndSelfie(dlg);
      await expect(dlg.getByTestId('fc-retry')).toContainText('You can try 2 more times', { timeout: 20_000 });
      await expect(dlg.getByTestId('fc-retry')).toContainText('movement');
      await dlg.getByTestId('fc-again').click();
      await selfie(dlg);
      await expect(dlg.getByTestId('fc-retry')).toContainText('You can try 1 more time', { timeout: 20_000 });
      expect(await noSideScroll(page)).toBe(true);
      await dlg.getByTestId('fc-again').click();
      await selfie(dlg);
      await expect(dlg.getByTestId('fc-person')).toContainText('A person at Nm7 is checking it', { timeout: 20_000 });
      await expect(dlg.getByTestId('fc-person')).toContainText('Nobody is turned away');
      await expect(dlg.getByTestId('fc-person-why')).toContainText('after 3 tries');
      await dlg.getByRole('button', { name: 'Close', exact: true }).last().click();

      const owner = `tt3-owner-${label}-${Date.now().toString(36)}@nm7.si`;
      const { secret } = seed('admin', owner, 'owner', PASSWORD);
      const actx = await browser.newContext({ ...opts });
      const admin = await actx.newPage();
      admin.on('dialog', () => { throw new Error('no browser dialogs'); });
      await adminLogin(admin, owner, secret);
      await expect(admin).not.toHaveURL(/\/login/, { timeout: 15_000 });
      await admin.goto('/admin/skill-tests?tab=trust');
      const card = admin.getByTestId('tf-card');
      await expect(card.getByTestId('tf-provider')).toHaveValue('mock', { timeout: 20_000 });
      await expect(card.getByTestId('tf-state')).toContainText('Test mode');
      await expect(card.getByTestId('tf-keys-rekognition')).toContainText('REKOGNITION_SECRET_ACCESS_KEY: not set');
      await expect(card.getByTestId('tf-req-interview')).toBeChecked();
      await expect(card.getByTestId('tf-counts')).toContainText('With a person');
      const item = card.getByTestId('tf-review-item').filter({ hasText: name });
      await expect(item.getByTestId('tf-why')).toContainText('didn’t pass after 3 tries');
      await item.getByTestId('tf-method').selectOption('video_call');
      await item.getByTestId('tf-note').fill('Seen on a video call');
      await item.getByTestId('tf-verified').click();
      await expect(item).toHaveCount(0);
      expect(await noSideScroll(admin)).toBe(true);
      await actx.close();

      await page.getByTestId('iv-go').click(); // the Setup screen is still there: now it starts
      await expect(page.getByTestId('iv-text')).toBeVisible({ timeout: 20_000 });
    });

    test('camera blocked: plain help and a manual check instead', async ({ page }) => {
      await page.addInitScript(() => {
        navigator.mediaDevices.getUserMedia = () => Promise.reject(new DOMException('blocked', 'NotAllowedError'));
      });
      await person(page, `tt3cam-${label}`, `Chitra Cam ${label}`);
      const card = page.getByTestId('fc-card');
      await expect(card.getByTestId('fc-state')).toContainText('Not done yet');
      await card.getByTestId('fc-open').click();
      const dlg = page.getByRole('dialog', { name: 'Quick check: is it really you?' });
      await dlg.getByTestId('fc-agree').click();
      await dlg.getByTestId('fc-card').setInputFiles(CARD);
      await dlg.getByTestId('fc-next').click();
      await expect(dlg.getByTestId('fc-camera-error')).toContainText('blocked the camera');
      expect(await noSideScroll(page)).toBe(true);
      await dlg.getByTestId('fc-camera-manual').click();
      await dlg.getByTestId('fc-manual-reason').selectOption('disability');
      await dlg.getByTestId('fc-manual-note').fill('Please call me on video');
      await dlg.getByTestId('fc-manual-send').click();
      await expect(dlg.getByTestId('fc-person')).toContainText('A person at Nm7 is checking it');
      await expect(dlg.getByTestId('fc-person-why')).toContainText('A disability makes the camera check hard for me');
      await dlg.getByRole('button', { name: 'Close', exact: true }).last().click();
      await expect(card.getByTestId('fc-state')).toContainText('A person at Nm7 is checking this');
      expect(await noSideScroll(page)).toBe(true);
    });

    test('joining day: a fresh selfie matches the earlier check', async ({ page }) => {
      const mail = await person(page, `tt3jn-${label}`, `Devi Join ${label}`);
      const card = page.getByTestId('fc-card');
      await card.getByTestId('fc-open').click();
      const dlg = page.getByRole('dialog', { name: 'Quick check: is it really you?' });
      await dlg.getByTestId('fc-agree').click();
      await cardAndSelfie(dlg);
      await dlg.getByTestId('fc-continue').click();
      await expect(card.getByTestId('fc-state')).toContainText(/✓ ID \+ selfie verified, \d+ \w+ \d{4} \(test\)/);

      seed('trust-offer', mail, '0');
      await page.goto('/me/hire');
      const offer = page.getByTestId('hire-offer').filter({ hasText: 'Seed Foods' });
      await offer.getByTestId('hire-offer-face').click();
      const jd = page.getByRole('dialog', { name: 'Joining day: is it you?' });
      await selfie(jd);
      await expect(jd.getByTestId('fc-done')).toContainText('Same person at joining: confirmed', { timeout: 20_000 });
      await jd.getByTestId('fc-continue').click();
      await expect(offer.getByTestId('hire-offer-same')).toContainText('Same person at joining: confirmed');
      expect(await noSideScroll(page)).toBe(true);
    });

    test('demo company: "ID + selfie verified · Same person at joining", never a photo', async ({ page }) => {
      test.setTimeout(150_000);
      const owner = `tt3-co-${label}-${Date.now().toString(36)}@nm7.si`;
      const { secret } = seed('admin', owner, 'owner', PASSWORD);
      page.on('dialog', () => { throw new Error('no browser dialogs'); });
      await adminLogin(page, owner, secret);
      await expect(page).not.toHaveURL(/\/login/);
      await page.goto('/admin/companies');
      await page.getByTestId('demo-company').getByTestId('demo-as-company').click();
      await expect(page).toHaveURL(/\/company$/);
      expect(seed('trust-face', '@demo-applicants', 'same').n).toBeGreaterThan(0);
      await page.reload();
      await page.getByRole('tab', { name: 'Applicants' }).click();
      const first = page.getByTestId('co-applicant').first();
      await expect(first.getByTestId('co-face')).toHaveText('✓ ID + selfie verified · Same person at joining (test)');
      expect(await noSideScroll(page)).toBe(true);
      await first.getByRole('button', { name: 'Profile', exact: true }).click();
      const face = page.getByTestId('co-face').last();
      await expect(face).toContainText(/ID \+ selfie verified, \d+ \w+ \d{4} · Same person at joining, \d+ \w+ \d{4} \(test\)/);
      await expect(page.locator('img[alt*="selfie" i], img[alt*="card" i]')).toHaveCount(0);
      expect(await noSideScroll(page)).toBe(true);
    });

    test('switch off: never asked, no card, for someone who is not a tester', async ({ page }) => {
      await person(page, `tt3off-${label}`, `Ravi Off ${label}`, { vetting: true, trust: false });
      await page.goto('/me/skill-checks');
      const consent = page.getByTestId('vt-consent');
      await consent.getByTestId('vt-consent-tick').check();
      await consent.getByTestId('vt-consent-go').click();
      await page.getByTestId('vt-search').fill('data analyst');
      await page.getByTestId('sk-list').getByTestId('sk-start-SQL').click();
      await page.getByTestId('vt-start').getByTestId('vt-go').click();
      await expect(page.getByTestId('vt-q')).toBeVisible({ timeout: 20_000 });
      await expect(page.getByTestId('fc-dialog')).toHaveCount(0);
      await page.goto('/me/settings');
      await expect(page.getByRole('heading', { name: 'Privacy', exact: true })).toBeVisible({ timeout: 20_000 });
      await page.waitForLoadState('networkidle');
      await expect(page.getByTestId('fc-card')).toHaveCount(0);
    });
  });
}
