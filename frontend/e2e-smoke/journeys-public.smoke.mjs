// Deep journeys of the LIVE site as a signed-out visitor, desktop + 390 px (projects j-desktop / j-phone). Read-only:
// nothing is submitted (sign-up pages are only opened), every write to the API is blocked by the guard.
import { test, expect } from '@playwright/test';
import { API } from './common.mjs';
import { guard, recorder, menuLinks } from './journeys-common.mjs';

/** Whether this site has Google sign-in on (live: yes; a local copy: no client ID, so no button). */
const googleOn = async (request) => { try { return !!(await (await request.get(`${API}/api/public/site-flags`, { timeout: 60_000 })).json()).googleClientId; } catch { return true; } };

const PUBLIC = ['/', '/jobs', '/salaries', '/templates', '/builder', '/linkedin', '/for-companies', '/for-orgs', '/pricing', '/grievance', '/login', '/signup',
  '/signup?role=expert', '/forgot-password', '/admin/login', '/terms', '/privacy', '/refund-policy', '/delivery-policy', '/expert-terms', '/company-terms', '/contact', '/blog',
  '/status', '/accessibility', '/partners', '/partner', '/recruiter', '/new-home', '/old-home', '/scan', '/checkout', '/editor', '/start/jobseeker', '/start/student',
  '/start/expert', '/demo-student', '/org/demo-login'];

test.describe('journey public', () => {
  test('journey public › every public page and every menu link (sideways scroll, emoji, errors)', async ({ page }, ti) => {
    test.setTimeout(900_000);
    const r = recorder(ti, { role: 'signed-out visitor' });
    r.watch(page);
    const writes = await guard(page, { mode: 'block', allow: [/^POST \/api\/(track|events|t)\b/] });
    const seen = new Set();
    const links = new Set();
    for (const p of PUBLIC) {
      await r.visit(page, p);
      seen.add(p);
      (await menuLinks(page).catch(() => [])).forEach((l) => links.add(l));
    }
    // phone: the header menu opens and its links are collected too
    if (ti.project.name.includes('phone')) {
      await page.goto('/'); await page.waitForLoadState('networkidle', { timeout: 20_000 }).catch(() => {});
      const btn = page.getByRole('button', { name: /^Menu$/i }).first();
      if (await btn.waitFor({ timeout: 15_000 }).then(() => true, () => false)) { await btn.click(); await page.waitForTimeout(400); (await menuLinks(page)).forEach((l) => links.add(l)); await r.check(page, 'phone menu open on /'); } else r.note('no Menu button on the phone home page');
    }
    // detail pages found from their lists
    for (const [list, re] of [['/jobs', /^\/jobs\/[^/?#]+$/], ['/salaries', /^\/salaries\/[^/?#]+$/], ['/blog', /^\/blog\/(?!category\/)[^/?#]+\/?$/], ['/jobs', /^\/companies\/[^/?#]+$/], ['/blog', /^\/blog\/category\/[^/?#]+$/]]) {
      await page.goto(list); await page.waitForLoadState('networkidle', { timeout: 20_000 }).catch(() => {});
      const hrefs = await page.evaluate((src) => [...new Set([...document.querySelectorAll('a[href]')].map((a) => a.getAttribute('href')).filter((h) => new RegExp(src).test(h)))].slice(0, 2), re.source);
      if (!hrefs.length) r.note(`no ${re.source} link on ${list}`);
      for (const h of hrefs) { await r.visit(page, h, `${list} detail ${h}`); seen.add(h); }
    }
    const todo = [...links].filter((l) => !seen.has(l) && !/^\/(api|me|admin(?!\/login)|company$|org\/(?!demo-login)|expert)/.test(l));
    for (const l of [...new Set(todo)]) { await r.visit(page, l, `menu link ${l}`); seen.add(l); }
    r.note(`pages checked: ${seen.size}`);
    r.finish(writes);
  });

  test('journey public › sign in and sign up pages: email form and the Google button', async ({ page, request }, ti) => {
    test.setTimeout(300_000);
    const r = recorder(ti, { role: 'signed-out visitor' });
    const google = await googleOn(request);
    if (!google) r.note('Google sign-in is off on this site (no client ID): the Google button is not expected');
    r.watch(page);
    const writes = await guard(page, { mode: 'block' });
    for (const [p, email] of [['/login', 'Email'], ['/signup', 'Email'], ['/signup?role=expert', 'Email']]) {
      await r.visit(page, p);
      await r.step(page, `${p} email field`, async () => { await expect(page.getByLabel(email, { exact: true }).first()).toBeVisible({ timeout: 15_000 }); });
      if (google) await r.step(page, `${p} Google button`, async () => {
        await expect(page.getByTestId('google-button')).toBeVisible({ timeout: 20_000 });
        await expect(page.getByTestId('google-button').locator('iframe')).toBeVisible({ timeout: 20_000 });
      });
    }
    // companies and colleges have their own sign-in pages: they open, with a form
    for (const p of ['/for-companies', '/for-orgs', '/admin/login', '/forgot-password']) {
      await r.visit(page, p);
      await r.step(page, `${p} has a form`, async () => { await expect(page.locator('main').locator('form, input, a[href*="signup"], button').filter({ visible: true }).first()).toBeVisible({ timeout: 15_000 }); });
    }
    r.finish(writes);
  });

  test('journey public › a job: View, Save, Share, Apply while signed out goes to sign-up and back to the same job', async ({ page, request }, ti) => {
    test.setTimeout(300_000);
    const r = recorder(ti, { role: 'signed-out visitor' });
    const google = await googleOn(request);
    r.watch(page);
    const writes = await guard(page, { mode: 'block', allow: [/^POST \/api\/(track|events)\b/] });
    await r.visit(page, '/jobs');
    const href = await page.evaluate(() => [...document.querySelectorAll('[data-testid=job-card] a[href^="/jobs/"], a[href^="/jobs/"]')].map((a) => a.getAttribute('href')).find((h) => /^\/jobs\/[^/?#]+$/.test(h)));
    if (!href) { await r.fail(page, 'jobs list', 'no job link on /jobs'); r.finish(writes); return; }
    const slug = href.split('/')[2];
    // View: from the list (a click), the job's own page opens
    await r.step(page, 'click a job card', async () => {
      await page.locator(`a[href="${href}"]`).first().click();
      await page.waitForTimeout(800);
      if (!page.url().includes(href)) { // desktop may open a preview panel: then the full page through its link
        r.note(`clicking a card on /jobs stayed on ${page.url().replace(/^https?:\/\/[^/]+/, '')} (preview)`);
        await page.goto(href);
      }
    });
    await r.check(page, `job page ${href}`);
    await r.step(page, 'job buttons', async () => {
      await expect(page.getByTestId('job-detail')).toBeVisible({ timeout: 20_000 });
      const closed = await page.getByTestId('job-closed-note').count();
      if (closed) { r.note(`${href} is closed: Apply/Save not shown`); return; }
      await expect(page.getByTestId('job-detail').getByTestId('apply')).toBeVisible();
      await expect(page.getByTestId('job-detail').getByRole('button', { name: /^Save/ })).toBeVisible();
      await expect(page.getByTestId('share-job')).toBeVisible();
    });
    // Share: the menu with the job's address in every link
    await r.step(page, 'Share menu', async () => {
      await page.evaluate(() => { try { delete Navigator.prototype.share; delete navigator.share; } catch { /* no sheet */ } });
      await page.getByTestId('share-job').click();
      await expect(page.getByTestId('share-options')).toBeVisible({ timeout: 10_000 });
      const hrefs = await page.getByTestId('share-options').locator('a[href]').evaluateAll((as) => as.map((a) => a.href));
      const bad = hrefs.filter((h) => !decodeURIComponent(h).includes(`/jobs/${slug}`));
      if (bad.length) throw new Error(`share links without the job address: ${bad.join(' ')}`);
      if (!hrefs.some((h) => h.includes('wa.me') || h.includes('whatsapp'))) throw new Error('no WhatsApp share link');
      await expect(page.getByTestId('share-url')).toContainText(`/jobs/${slug}`);
      await r.check(page, 'share menu open');
      await page.keyboard.press('Escape');
    });
    // Save while signed out: to sign-in, coming back to this job
    await r.step(page, 'Save signed out', async () => {
      await page.getByTestId('job-detail').getByRole('button', { name: /^Save/ }).click();
      await page.waitForURL(/\/login\?/, { timeout: 15_000 });
      const next = new URL(page.url()).searchParams.get('next') || '';
      if (!next.startsWith(`/jobs/${slug}`)) throw new Error(`Save sent to ${page.url()} (next should be /jobs/${slug})`);
      await r.check(page, 'sign-in after Save');
      await page.goBack();
      await page.waitForURL(new RegExp(`/jobs/${slug}`), { timeout: 15_000 });
    });
    // Apply while signed out: the ask, then sign-up (and sign-in) with next = this job with apply=1
    await r.step(page, 'Apply signed out', async () => {
      await page.getByTestId('job-detail').getByTestId('apply').click();
      await expect(page.getByTestId('apply-ask')).toBeVisible({ timeout: 10_000 });
      await r.check(page, 'apply ask dialog');
      const su = await page.getByTestId('apply-ask-signup').getAttribute('href');
      const li = await page.getByTestId('apply-ask-login').getAttribute('href');
      for (const [n, h] of [['sign-up', su], ['sign-in', li]]) {
        const next = new URL(h, 'https://x').searchParams.get('next');
        if (next !== `/jobs/${slug}?apply=1`) throw new Error(`${n} link ${h} (next should be /jobs/${slug}?apply=1)`);
      }
      await page.getByTestId('apply-ask-signup').click();
      await page.waitForURL(/\/signup\?/, { timeout: 15_000 });
      await r.check(page, 'sign-up after Apply');
      if (google) await expect(page.getByTestId('google-button')).toBeVisible({ timeout: 20_000 });
      // the "Sign in" link on the sign-up page keeps the way back to the job
      const back = await page.getByRole('link', { name: 'Sign in', exact: true }).last().getAttribute('href');
      if (new URL(back, 'https://x').searchParams.get('next') !== `/jobs/${slug}?apply=1`) throw new Error(`Sign in link on sign-up is ${back}`);
    });
    r.finish(writes);
  });

  test('journey public › Telugu and Hindi on the public pages', async ({ page }, ti) => {
    test.setTimeout(300_000);
    const r = recorder(ti, { role: 'signed-out visitor' });
    r.watch(page);
    const writes = await guard(page, { mode: 'block', allow: [/^POST \/api\/(track|events)\b/] });
    for (const p of ['/', '/for-orgs', '/login', '/builder', '/jobs']) {
      await r.visit(page, p, `${p} (English)`);
      const sw = page.locator('.hx-lang');
      if (!(await sw.count())) { r.note(`${p}: no language switch (Telugu/Hindi hidden by Admin > Settings, or not on this page)`); continue; }
      for (const [code, label] of [['te', 'తెలుగు'], ['hi', 'हिन्दी']]) {
        await r.step(page, `${p} ${code}`, async () => {
          await sw.first().locator(`button[lang=${code}]`).click();
          await page.waitForTimeout(600);
          const t = await page.locator('main, body').first().innerText();
          const script = code === 'te' ? /[ఀ-౿]/ : /[ऀ-ॿ]/;
          if (!script.test(t)) throw new Error(`${label} chosen but no ${label} text on ${p}`);
          await r.check(page, `${p} in ${label}`);
        });
      }
      await sw.first().locator('button[lang=en]').click().catch(() => {});
    }
    r.finish(writes);
  });
});
