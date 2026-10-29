// Drive days + QR check-in on a desktop and a 390 px phone, against the real API: the college (Campus plan) plans a
// drive day (companies, two rooms), auto-assigns its students, opens the room screen (QR + code that change every
// minute); a student checks in by typing the code, another by the QR's link; a student can't use another room's code;
// live attendance, marking by hand, CSV; "My drive day" shows each student's own slot only.
import { expect, test } from '@playwright/test';
import { API, PASSWORD, adminLogin, email, login, seed } from './helpers.mjs';

const SIZES = [['desktop', { viewport: { width: 1280, height: 900 } }], ['phone', { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true }]];
const call = (page, path, init = {}) => page.evaluate(async ([base, p, i]) => {
  const r = await fetch(`${base}${p}`, { credentials: 'include', headers: { 'Content-Type': 'application/json' }, ...i });
  const text = await r.text();
  let body = text; try { body = JSON.parse(text); } catch { /* csv */ }
  return { status: r.status, body };
}, [API, path, init]);
const ist = (ms = 0) => new Date(Date.now() + 5.5 * 3600e3 + ms);
const hhmm = (d) => d.toISOString().slice(11, 16);
const noSideScroll = (page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);

async function student(browser, opts, code, label, i) {
  const ctx = await browser.newContext(opts);
  const page = await ctx.newPage();
  const mail = email(`dr-${label}-${i}`);
  seed('customer', mail, `Student ${label} ${i}`, PASSWORD);
  await login(page, mail);
  await page.waitForURL('**/me');
  await expect.poll(async () => (await call(page, '/api/me/resumes')).body.length).toBe(1);
  const [r] = (await call(page, '/api/me/resumes')).body;
  const j = await call(page, '/api/me/groups/join', { method: 'POST', body: JSON.stringify({ code, consent: true, fields: { roll: `21A0${i}`, branch: 'CSE' }, resumeId: r.id }) });
  expect(j.status).toBe(201);
  return { ctx, page };
}

for (const [label, opts] of SIZES) {
  test.describe(label, () => {
    test.use(opts);

    test('plan a drive day, room QR, check in by code and by link, attendance and CSV', async ({ browser }) => {
      test.setTimeout(150_000);
      const tag = `${label}${Date.now().toString(36)}`;
      const actx = await browser.newContext({ ...opts, acceptDownloads: true });
      const admin = await actx.newPage();
      const amail = `owner-drives-${tag}@nm7.si`;
      const { secret } = seed('admin', amail, 'owner', PASSWORD);
      await adminLogin(admin, amail, secret);
      await expect(admin).not.toHaveURL(/\/login/);
      const org = (await call(admin, '/api/admin/orgs', { method: 'POST', body: JSON.stringify({ name: `College ${tag}`, type: 'college', city: 'Guntur' }) })).body;
      const code = `DR${Date.now().toString(36).toUpperCase().slice(-6)}${label === 'phone' ? 'P' : 'D'}`;
      const fields = [{ key: 'roll', label: 'Roll number', type: 'text', required: true }, { key: 'branch', label: 'Branch', type: 'select', options: ['CSE', 'ECE'], required: true }];
      expect((await call(admin, `/api/admin/orgs/${org.id}/groups`, { method: 'POST', body: JSON.stringify({ name: 'B.Tech 2026', code, customFields: fields }) })).status).toBe(201);
      expect((await call(admin, `/api/admin/orgs/${org.id}/billing/plan`, { method: 'PUT', body: JSON.stringify({ planId: 'campus' }) })).status).toBe(200);
      // the college's coordinator (invited by Nm7, signs in with their own account)
      const cmail = email(`coord-${label}`);
      const inv = await call(admin, `/api/admin/orgs/${org.id}/staff`, { method: 'POST', body: JSON.stringify({ email: cmail, role: 'coordinator' }) });
      expect(inv.status).toBe(201);
      const cctx = await browser.newContext({ ...opts, acceptDownloads: true });
      const coord = await cctx.newPage();
      seed('customer', cmail, 'Coord Inator', PASSWORD);
      await login(coord, cmail);
      await coord.waitForURL('**/me');
      expect((await call(coord, `/api/org-invites/${inv.body.inviteUrl.split('/').pop()}/accept`, { method: 'POST' })).status).toBe(200);
      const a = await student(browser, opts, code, label, 0);
      const b = await student(browser, opts, code, label, 1);

      // plan the drive day in Org > Drives
      await coord.goto(`/org/${org.id}/drives`);
      await coord.getByTestId('drive-name').fill('Campus drive');
      await coord.getByTestId('drive-companies').fill('Infosys');
      await coord.getByTestId('drive-create').click();
      const detail = coord.getByTestId('drive-detail');
      await expect(detail).toContainText('Infosys');
      const start = hhmm(ist(-5 * 60e3)) < hhmm(ist()) ? hhmm(ist(-5 * 60e3)) : '00:00';
      const end = hhmm(ist(90 * 60e3)) > hhmm(ist()) ? hhmm(ist(90 * 60e3)) : '23:59';
      for (const room of ['Lab 1', 'Lab 2']) {
        await coord.getByTestId('slot-room').fill(room);
        await coord.getByTestId('slot-start').fill(start);
        await coord.getByTestId('slot-end').fill(end);
        await coord.getByTestId('slot-add').click();
        await expect(detail.getByTestId('slot-row').filter({ hasText: room })).toBeVisible();
      }
      await coord.getByTestId('drive-auto').click();
      await expect(detail.getByTestId('slot-row').filter({ hasText: 'Lab 1' })).toContainText('1');
      expect(await noSideScroll(coord)).toBe(true);

      // the room screens
      const screen = async (room) => {
        const [p] = await Promise.all([coord.waitForEvent('popup'), detail.getByTestId('slot-row').filter({ hasText: room }).getByTestId('slot-qr').click()]);
        await expect(p.getByTestId('checkin-code')).toHaveText(/^\d{6}$/);
        await expect(p.getByRole('img', { name: 'Check-in QR code' })).toBeVisible();
        return p;
      };
      const lab1 = await screen('Lab 1');
      const lab2 = await screen('Lab 2');
      const lab1Code = await lab1.getByTestId('checkin-code').textContent();
      const lab2Code = await lab2.getByTestId('checkin-code').textContent();

      // student A (Lab 1) sees their slot and types the code
      await a.page.goto('/me/drive');
      await expect(a.page.getByTestId('my-slot')).toHaveCount(1);
      await expect(a.page.getByTestId('my-slot')).toContainText('Lab 1');
      // Lab 2's code isn't theirs
      if (lab2Code !== lab1Code) {
        await a.page.getByTestId('checkin-code-input').fill(lab2Code);
        await a.page.getByTestId('checkin-send').click();
        await expect(a.page.getByTestId('checkin-msg')).toContainText('isn’t right for your slot');
      }
      await a.page.getByTestId('checkin-code-input').fill(lab1Code);
      await a.page.getByTestId('checkin-send').click();
      await expect(a.page.getByTestId('checkin-msg')).toContainText('Checked in: Infosys · Test · Lab 1');
      await expect(a.page.getByTestId('my-slot').locator('[data-status]')).toHaveAttribute('data-status', /present|late/);
      expect(await noSideScroll(a.page)).toBe(true);
      // student B scans Lab 2's QR (its link)
      const lab2Slot = new URL(lab2.url()).pathname.split('/').pop();
      await b.page.goto(`/checkin?s=${lab2Slot}&c=${lab2Code}`);
      await expect(b.page.getByTestId('checkin-result')).toContainText('You’re checked in: Infosys · Test · Lab 2');
      await b.page.goto('/me/groups');
      await expect(b.page.getByTestId('drive-link')).toContainText('My drive day');

      // live attendance, by hand, CSV
      await coord.bringToFront();
      await detail.getByTestId('slot-row').filter({ hasText: 'Lab 1' }).getByTestId('slot-att').click();
      const att = coord.getByTestId('attendance');
      await expect(att.getByTestId('att-row')).toHaveCount(1);
      await expect(att.getByTestId('att-row').locator('[data-status]')).toHaveAttribute('data-status', /present|late/);
      await coord.getByRole('dialog').getByRole('button', { name: 'Close' }).click();
      const [file] = await Promise.all([coord.waitForEvent('download'), coord.getByTestId('drive-csv').click()]);
      const { readFileSync } = await import('node:fs');
      const csv = readFileSync(await file.path(), 'utf8');
      expect(csv).toContain('Lab 1');
      expect(csv).toContain('QR / code');
      const log = await call(coord, `/api/org/${org.id}/audit`);
      const acts = new Set(log.body.map((x) => x.action));
      for (const x of ['drive_create', 'drive_slot', 'drive_assign', 'drive_checkin', 'drive_export']) expect(acts.has(x)).toBe(true);
      await Promise.all([a.ctx.close(), b.ctx.close(), actx.close(), cctx.close()]);
    });
  });
}
