// Kiosk mode (Phase 3A) against the real API: Nm7 switches kiosks on for an organization and makes a kiosk link;
// a candidate at the kiosk signs in with an emailed code (a new account), consents, answers the group's question,
// builds a resume step by step and prints it; Finish wipes the device. A second candidate walks away and the idle
// timer wipes the screen. The coordinator view counts sign-ins and prints; revoking ends the kiosk; the exit PIN works.
import { expect, test } from '@playwright/test';
import { PASSWORD, adminLogin, email, lastCode, seed } from './helpers.mjs';

async function candidateSignsIn(k, who, name) {
  await k.getByRole('button', { name: 'Start' }).click();
  await k.getByLabel('Email address').fill(who);
  await k.getByRole('button', { name: 'Send my code' }).click();
  await expect(k.getByRole('heading', { name: 'Enter your code' })).toBeVisible();
  await k.getByLabel('6-digit code').fill(lastCode(who));
  await k.getByLabel('Your full name').fill(name);
  await k.getByRole('checkbox', { name: /I agree to Nm7’s Terms/ }).check();
  await k.getByRole('button', { name: 'Continue' }).click();
}

test('kiosk: switch on → kiosk link → code sign-in → build → print → wipe → idle wipe → revoke', async ({ page, browser }) => {
  const owner = email('owner3');
  const { secret } = seed('admin', owner, 'owner', PASSWORD);
  const code = `KI${Date.now().toString(36).slice(-6).toUpperCase()}`;

  // 1. Nm7: an organization with a group, kiosks switched on, one kiosk link
  await adminLogin(page, owner, secret);
  await page.getByRole('navigation', { name: 'Admin sections' }).getByRole('link', { name: 'Organizations' }).click();
  const newOrg = page.getByRole('form', { name: 'New organization' });
  await newOrg.getByLabel('Organization name').fill('Mega Job Mela Guntur');
  await newOrg.getByRole('button', { name: 'Add organization' }).click();
  await expect(page.getByRole('heading', { name: 'Mega Job Mela Guntur' })).toBeVisible();
  await page.getByRole('button', { name: 'New group' }).click();
  const form = page.getByRole('form', { name: 'New group' });
  await form.getByLabel('Group name').fill('Walk-in drive');
  await form.getByLabel('Join code').fill(code);
  await form.getByRole('button', { name: '+ Roll number' }).click();
  await form.getByRole('button', { name: 'Save group' }).click();
  await expect(page.getByRole('region', { name: 'Group Walk-in drive' })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Kiosks' })).toHaveCount(0); // off by default
  const kioskSwitch = page.getByRole('region', { name: 'Features' }).getByRole('checkbox', { name: /Kiosk mode/ });
  await kioskSwitch.click();
  await expect(kioskSwitch).toBeChecked();
  const kiosks = page.getByRole('region', { name: 'Kiosks' });
  await expect(kiosks).toBeVisible();
  await kiosks.getByLabel('Label').fill('Stall 1');
  await kiosks.getByLabel('Exit PIN (4–6 digits)').fill('2468');
  await kiosks.getByRole('button', { name: 'Make kiosk link' }).click();
  const kioskUrl = await kiosks.getByTestId('kiosk-url').textContent();
  const kioskPath = new URL(kioskUrl).pathname;

  // 2. the kiosk device: welcome → code → consent + question → guided builder → print → finish (wiped)
  const kctx = await browser.newContext();
  const k = await kctx.newPage();
  await k.addInitScript(() => { window.print = () => { window.__printed = (window.__printed || 0) + 1; }; });
  // a deploy during the event: the PDF maker's file of this (old) build is gone (404, served as HTML) until the
  // kiosk reloads onto the new build
  let loads = 0;
  k.on('load', () => { loads += 1; });
  await k.route(/\/src\/pages\/builder\/resumePdf\.js/, (r) => (loads < 2 ? r.fulfill({ status: 404, contentType: 'text/html', body: '<!doctype html><title>404</title>' }) : r.continue()));
  await k.goto(kioskPath);
  await expect(k.getByRole('heading', { name: 'Make your resume here' })).toBeVisible();
  await expect(k).toHaveTitle('Kiosk · Mega Job Mela Guntur · Nm7');
  await expect(k.getByRole('navigation')).toHaveCount(0); // no site navigation on a kiosk
  const asha = email('kiosk-asha');
  await candidateSignsIn(k, asha, 'Asha Kumari');
  await expect(k.getByRole('heading', { name: 'Share with Mega Job Mela Guntur' })).toBeVisible();
  await k.getByLabel('Roll number *').fill('GNT-042');
  await k.getByRole('checkbox', { name: /My resume will be shared with Mega Job Mela Guntur/ }).check();
  await k.getByRole('button', { name: 'Agree and continue' }).click();
  await k.getByRole('button', { name: /Type it in, step by step/ }).click();
  await expect(k.getByRole('heading', { name: 'About you' })).toBeVisible();
  await expect(k.getByLabel('Full name *')).toHaveValue('Asha Kumari');
  await expect(k.getByLabel('Email *')).toHaveValue(asha);
  await k.getByLabel('Phone *').fill('98765 43210');
  await k.getByRole('button', { name: 'Next' }).click();
  await expect(k.getByRole('heading', { name: 'Education' })).toBeVisible();
  await k.getByLabel('Institution *').fill('Govt ITI Guntur');
  await k.getByLabel('Degree *').fill('ITI Electrician');
  await k.getByRole('button', { name: 'Next' }).click();
  await k.getByRole('button', { name: 'Next' }).click(); // no work yet: skipped
  await k.getByLabel(/Your skills/).fill('Wiring, Panel fitting, Safety');
  await k.getByRole('button', { name: 'Next' }).click();
  await k.getByRole('button', { name: 'Next' }).click();
  await expect(k.getByRole('heading', { name: 'Check & finish' })).toBeVisible();
  await expect(k.getByRole('article', { name: 'Resume preview' })).toContainText('Govt ITI Guntur');
  await k.getByRole('button', { name: 'My resume is ready' }).click();
  // nothing on the finish screen moves when Send / Print change their labels and messages (tablet, then phone)
  const boxes = async () => { await k.mouse.move(1, 1); return Promise.all(['k-print', 'k-mail', 'k-status', 'k-edit', 'k-finish'].map((id) => k.getByTestId(id).boundingBox())); }; // (the mouse away: buttons lift 1px on hover)
  const same = (a, b) => a.forEach((x, i) => ['x', 'y', 'width', 'height'].forEach((p) => expect(Math.abs(x[p] - b[i][p]), `box ${i} ${p}`).toBeLessThan(1)));
  await k.setViewportSize({ width: 820, height: 1180 });
  await expect(k.getByTestId('k-print')).toBeVisible();
  const tablet = await boxes();
  await k.getByTestId('k-mail').click();
  await expect(k.getByTestId('k-status')).toHaveText('Check your email for a link to keep going on your phone.');
  same(await boxes(), tablet);
  await k.setViewportSize({ width: 390, height: 844 });
  const phone = await boxes();
  // Print: the stale file fails → a friendly message (not the raw error) → the kiosk reloads onto the new build,
  // comes back to this screen still signed in, and prints
  await k.getByTestId('k-print').click();
  await expect(k.getByTestId('k-status')).toContainText('Nm7 was just updated');
  await expect(k.getByTestId('k-status')).not.toContainText('Failed to fetch');
  await expect(k.getByTestId('k-status')).toHaveText('Sent to the printer. Collect your copy from the printer.', { timeout: 20_000 });
  expect(loads).toBe(2);
  await expect(k.getByRole('heading', { name: 'Your resume is ready' })).toBeVisible();
  same(await boxes(), phone);
  expect(await k.evaluate(() => window.__printed)).toBe(1);
  await k.setViewportSize({ width: 1280, height: 720 });
  expect(await k.locator('.kiosk-print img').count()).toBeGreaterThan(0); // the PDF's pages, drawn for the printer
  // something personal in this browser's storage (as any page might leave), then Finish
  await k.evaluate(() => new Promise((res) => { localStorage.setItem('nm7-test', 'x'); sessionStorage.setItem('s', 'y'); const r = indexedDB.open('nm7-kiosk-test'); r.onsuccess = () => { r.result.close(); res(); }; }));
  await k.getByRole('button', { name: 'Finish and sign out' }).click();
  await expect(k.getByRole('heading', { name: 'Make your resume here' })).toBeVisible();
  await expect(k.getByText(/You’re signed out and this screen is clear/)).toBeVisible();
  const left = await k.evaluate(async () => ({ local: localStorage.length, session: sessionStorage.length, dbs: (await indexedDB.databases()).length, prints: document.querySelectorAll('[data-kiosk-print]').length }));
  expect(left).toEqual({ local: 0, session: 0, dbs: 0, prints: 0 });
  expect((await k.request.get('http://localhost:8001/api/auth/me')).status()).toBe(401);
  // her resume is in her own account (the coordinator sees her in the group)
  await page.getByRole('navigation', { name: 'Admin sections' }).getByRole('link', { name: 'Shared resumes' }).click();
  await expect(page.getByRole('cell', { name: /^Asha Kumari kiosk-asha/ })).toBeVisible();

  // 3. a second candidate walks away: 2 minutes, a 20-second warning, then the screen wipes itself
  await k.clock.install();
  await k.reload();
  await candidateSignsIn(k, email('kiosk-ravi'), 'Ravi Teja');
  await expect(k.getByRole('heading', { name: 'Share with Mega Job Mela Guntur' })).toBeVisible();
  await k.clock.fastForward('02:01');
  await expect(k.getByRole('dialog', { name: 'Are you still there?' })).toContainText('clears itself in');
  await k.clock.fastForward(21_000);
  await expect(k.getByRole('heading', { name: 'Make your resume here' })).toBeVisible();
  await expect(k.getByText(/Signed out after 2 minutes/)).toBeVisible();
  expect((await k.request.get('http://localhost:8001/api/auth/me')).status()).toBe(401);

  // 4. the coordinator view: today's sign-ins and prints; revoke ends the kiosk
  await page.getByRole('navigation', { name: 'Admin sections' }).getByRole('link', { name: 'Organizations' }).click();
  await page.getByRole('button', { name: /Mega Job Mela Guntur/ }).first().click();
  const row = page.getByRole('region', { name: 'Kiosks' }).getByTestId('kiosk-row').first();
  await expect(row.getByTestId('kiosk-today')).toHaveText('2 sign-ins · 1 print');
  await expect(row).toContainText('Active now');
  // the exit PIN: wrong, then right (leaves the kiosk screen)
  await k.getByRole('button', { name: 'Staff: exit kiosk' }).click();
  await k.getByLabel('Exit PIN').fill('1111');
  await k.getByRole('button', { name: 'Exit', exact: true }).click();
  await expect(k.getByText('That PIN is wrong.')).toBeVisible();
  await k.getByLabel('Exit PIN').fill('2468');
  await k.getByRole('button', { name: 'Exit', exact: true }).click();
  await k.waitForURL((u) => u.pathname === '/');
  // revoked: the link shows "ended"
  page.once('dialog', (d) => d.accept());
  await row.getByRole('button', { name: 'Revoke' }).click();
  await expect(row).toContainText('Revoked');
  await k.goto(kioskPath);
  await expect(k.getByRole('heading', { name: 'This kiosk has ended' })).toBeVisible();
  await kctx.close();
});
