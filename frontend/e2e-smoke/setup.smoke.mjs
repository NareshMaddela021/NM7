// Signs in to the live admin (secrets) and opens each demo account once, saving its browser state for the page
// checks. "Reset and open" only resets the made-up demo data; nothing real is created and no email is sent.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from '@playwright/test';
import { ADMIN, API, STATE, hasAdmin, totp } from './common.mjs';

const call = (page, p, body) => page.evaluate(async ([base, path, b]) => {
  const r = await fetch(`${base}${path}`, { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b) });
  const t = await r.text(); let j = t; try { j = JSON.parse(t); } catch { /* text */ }
  return { status: r.status, body: j };
}, [API, p, body]);

test('sign in to admin and open the demo accounts', async ({ browser }) => {
  mkdirSync(STATE, { recursive: true });
  const info = { admin: false, demos: {} };
  // an empty browser state for every area first, so the page checks can always load theirs (and skip by info.json)
  for (const n of ['admin', 'seeker', 'student', 'easy', 'college', 'company']) writeFileSync(join(STATE, `${n}.json`), JSON.stringify({ cookies: [], origins: [] }));
  if (!hasAdmin) { writeFileSync(join(STATE, 'info.json'), JSON.stringify(info)); return; } // no live admin secrets: public pages only (passes, so the page checks still run)
  const actx = await browser.newContext();
  const admin = await actx.newPage();
  // never fail here: a failed sign-in must not stop the public checks; the reason is saved and shown as the skip reason
  try { await signedIn(); } catch (e) { info.adminError = e.message.split('\n')[0]; }
  writeFileSync(join(STATE, 'info.json'), JSON.stringify(info, null, 2));
  console.log(JSON.stringify(info));
  await actx.close();

  async function signedIn() {
    await admin.goto('/admin/login');
    await admin.getByLabel('Work email').fill(ADMIN.email);
    await admin.getByLabel('Password').fill(ADMIN.password);
    await admin.getByRole('button', { name: 'Continue' }).click();
    await admin.getByLabel('Authenticator code').fill(totp(ADMIN.secret));
    await admin.getByRole('button', { name: 'Verify & open admin' }).click();
    await admin.waitForURL(/\/admin(?!\/login)(\/|$|\?)/, { timeout: 30_000 }); // not /admin/login itself
    await admin.waitForLoadState('networkidle').catch(() => {});
    await actx.storageState({ path: join(STATE, 'admin.json') });
    info.admin = true;

    const open = async (name, path, body, after) => {
      let r = await call(admin, path, body);
      for (let i = 0; i < 4 && r.status === 401; i += 1) { await admin.waitForTimeout(2000); r = await call(admin, path, body); }
      if (r.status !== 200) { info.demos[name] = { error: `${r.status} ${JSON.stringify(r.body).slice(0, 200)}` }; return; }
      const ctx = await browser.newContext();
      const page = await ctx.newPage();
      try { info.demos[name] = await after(page, r.body, ctx); await ctx.storageState({ path: join(STATE, `${name}.json`) }); } catch (e) { info.demos[name] = { error: e.message.split('\n')[0] }; }
      await ctx.close();
    };
    const viaPath = async (page, body) => { await page.goto(body.path); await page.waitForLoadState('networkidle').catch(() => {}); return { ok: true, url: new URL(page.url()).pathname }; };
    // the demo college first: its reset also removed the other demos' students (fixed in the API, kept safe here)
    await open('college', '/api/admin/demo-org/coordinator', {}, async (page, body) => {
      await page.goto(body.path);
      await page.waitForURL(/\/org\/(?!demo-login)[^/?]+/, { timeout: 30_000 }).catch(() => {}); // not the sign-in step's own /org/demo-login
      return { ok: true, base: new URL(page.url()).pathname.match(/^\/org\/(?!demo-login)[^/]+/)?.[0] || null };
    });
    await open('seeker', '/api/admin/seek/demo', { who: 'meera' }, viaPath);
    await open('student', '/api/admin/auto-apply/demo', {}, viaPath);
    await open('easy', '/api/admin/simple/demo', {}, viaPath);
    await open('company', '/api/admin/demo-company/hire/open', {}, async (page, body) => {
      await page.goto('/');
      await page.evaluate((s) => localStorage.setItem('nm7-recruiter-account', s), body.session);
      return { ok: true };
    });
  }
});
