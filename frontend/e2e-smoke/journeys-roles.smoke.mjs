// Deep journeys of the LIVE site as each demo account (job seeker, student, Easy dashboard, company, college),
// desktop + 390 px (projects j-desktop / j-phone). The accounts are the made-up demos setup.smoke.mjs opens. Plain page
// visits work as the page checks do (writes only listed); clicks run with the guard blocking every write except the
// ones a step names (Save / unsave a job, the resume export record, the Easy dashboard language, put back after).
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test, expect } from '@playwright/test';
import { API, STATE } from './common.mjs';
import { guard, recorder, menuLinks, linksUnder } from './journeys-common.mjs';

const info = () => { try { return JSON.parse(readFileSync(join(STATE, 'info.json'), 'utf8')); } catch { return { demos: {} }; } };
const ready = (who) => { const i = info(); const d = i.demos?.[who]; test.skip(!d?.ok, i.adminError ? `admin sign-in failed: ${i.adminError}` : d?.error ? `demo not opened: ${d.error}` : 'no live admin secrets'); return d; };
const ALLOW404 = ['/api/me/offer', '/api/me/drive'];
const ME = ['/me', '/me/orders', '/me/messages', '/me/profile', '/me/certificates', '/me/resumes', '/me/ats', '/me/covers', '/me/jobs', '/me/auto-apply', '/me/auto-apply/v2',
  '/me/hire', '/me/skill-checks', '/me/interviews', '/me/verification', '/me/roles', '/me/learn', '/me/practice', '/me/offer-check', '/me/feedback', '/me/programs', '/me/guidance',
  '/me/progress', '/me/share', '/me/groups', '/me/launch', '/me/payments', '/me/upgrade', '/me/settings', '/me/help', '/me/drive', '/me/alumni', '/builder', '/jobs', '/start/jobseeker'];

/** Visits each path, then every menu link (header, nav, aside, footer) it finds under the same area. */
async function sweep(page, r, paths, { area = /^\/(me|builder|jobs)/, skip = /^\/(api|admin|org\/|company|expert)/ } = {}) {
  const seen = new Set(); const links = new Set();
  for (const p of paths) { await r.visit(page, p); seen.add(p); (await menuLinks(page).catch(() => [])).forEach((l) => links.add(l)); }
  for (const l of [...links]) if (!seen.has(l) && area.test(l) && !skip.test(l)) { await r.visit(page, l, `menu link ${l}`); seen.add(l); }
  r.note(`pages checked: ${seen.size}`);
}

/** The setup card: shown (or "Profile complete"), all steps open, and Next step opens a working page. */
async function setupCard(page, r, home) {
  await r.visit(page, home, `${home} setup card`);
  await r.step(page, `${home} setup card shows`, async () => {
    await expect(page.getByTestId('sc-card').or(page.getByTestId('sc-complete')).first()).toBeVisible({ timeout: 25_000 });
  });
  if (!(await page.getByTestId('sc-card').count())) { r.note(`${home}: setup card says complete`); return; }
  await r.step(page, `${home} See all steps`, async () => {
    await page.getByTestId('sc-toggle').click();
    await expect(page.getByTestId('sc-list')).toBeVisible();
    await r.check(page, `${home} setup steps open`);
    const rows = await page.getByTestId('sc-row').evaluateAll((els) => els.map((e) => `${e.dataset.step}:${e.dataset.status}`));
    r.note(`${home} setup steps: ${rows.join(', ')}`);
  });
  const next = page.getByTestId('sc-next');
  if (!(await next.count())) { r.note(`${home}: no Next step (all waiting or done)`); return; }
  const to = await next.getAttribute('href');
  r.note(`${home} Next step -> ${to}`);
  await r.step(page, `${home} Next step`, async () => {
    await next.click();
    await page.waitForTimeout(1000);
    await r.check(page, `Next step from ${home} (${to})`);
  });
  // every step's own link opens a working page too
  await page.goto(home); await page.waitForLoadState('networkidle', { timeout: 20_000 }).catch(() => {});
  if (await page.getByTestId('sc-toggle').count()) {
    await page.getByTestId('sc-toggle').click().catch(() => {});
    const hrefs = [...new Set(await page.getByTestId('sc-row-open').evaluateAll((as) => as.map((a) => a.getAttribute('href'))))];
    for (const h of hrefs) if (h && h.startsWith('/')) await r.visit(page, h, `setup step link ${h}`);
  }
}

test.describe('journey seeker', () => {
  test.use({ storageState: join(STATE, 'seeker.json') });

  test('journey seeker › every page and menu link', async ({ page }, ti) => {
    test.setTimeout(1_200_000);
    ready('seeker');
    const r = recorder(ti, { role: 'job seeker', signedIn: true, allow404: ALLOW404 });
    r.watch(page);
    const writes = await guard(page, { mode: 'log' });
    await sweep(page, r, ME);
    // Auto Apply: every screen linked from it
    await page.goto('/me/auto-apply'); await page.waitForLoadState('networkidle').catch(() => {});
    for (const l of (await linksUnder(page, '/me/auto-apply/')).slice(0, 12)) await r.visit(page, l, `auto apply screen ${l}`);
    r.finish(writes);
  });

  test('journey seeker › setup card and Next step', async ({ page }, ti) => {
    test.setTimeout(300_000);
    ready('seeker');
    const r = recorder(ti, { role: 'job seeker', signedIn: true, allow404: ALLOW404 });
    r.watch(page);
    const writes = await guard(page, { mode: 'block', allow: [/^POST \/api\/(track|events)\b/, /^POST \/api\/me\/checklist\/never/] });
    await setupCard(page, r, '/me');
    r.finish(writes);
  });

  test('journey seeker › a job: Save then unsave, Apply comes back to the same job, Share', async ({ page }, ti) => {
    test.setTimeout(300_000);
    ready('seeker');
    const r = recorder(ti, { role: 'job seeker', signedIn: true, allow404: ALLOW404 });
    r.watch(page);
    // Save/unsave is the only write allowed; an application is never sent (blocked and listed)
    const writes = await guard(page, { mode: 'block', allow: [/^(PUT|DELETE) \/api\/me\/saved-jobs\//, /^POST \/api\/(track|events)\b/] });
    await r.visit(page, '/jobs');
    // desktop and phone run at the same time with the same demo account: each takes a different job
    const nth = ti.project.name.includes('phone') ? 1 : 0;
    const href = await page.evaluate((n) => [...new Set([...document.querySelectorAll('a[href^="/jobs/"]')].map((a) => a.getAttribute('href')).filter((h) => /^\/jobs\/[^/?#]+$/.test(h)))][n], nth);
    if (!href) { await r.fail(page, 'jobs list', 'no job link on /jobs'); r.finish(writes); return; }
    const slug = href.split('/')[2];
    await r.visit(page, href, `job page ${href}`);
    await r.step(page, 'Save then unsave', async () => {
      const save = page.getByTestId('job-detail').getByRole('button', { name: /^(Save|Saved)\b/ });
      await expect(save).toBeVisible({ timeout: 20_000 });
      const before = await save.getAttribute('aria-pressed');
      await save.click();
      await expect(save).toHaveAttribute('aria-pressed', before === 'true' ? 'false' : 'true', { timeout: 15_000 });
      await r.check(page, 'after Save');
      await save.click(); // put it back as it was
      await expect(save).toHaveAttribute('aria-pressed', before || 'false', { timeout: 15_000 });
    });
    // Apply after signing in: /login?next=/jobs/<slug>?apply=1 brings a signed-in person back to the same job
    await r.step(page, 'back to the same job after sign-in', async () => {
      await page.goto(`/login?next=${encodeURIComponent(`/jobs/${slug}?apply=1`)}`);
      await page.waitForURL(new RegExp(`/jobs/${slug}`), { timeout: 20_000 });
      await page.waitForLoadState('networkidle').catch(() => {});
      await expect(page.getByTestId('job-detail')).toBeVisible({ timeout: 20_000 });
      r.note(`apply attempts blocked by the guard: ${writes.filter((w) => !w.allowed).map((w) => `${w.method} ${w.path}`).join(', ') || 'none'}`);
    });
    await r.step(page, 'Share menu signed in', async () => {
      await page.goto(href); await page.waitForLoadState('networkidle').catch(() => {});
      await page.evaluate(() => { try { delete Navigator.prototype.share; delete navigator.share; } catch { /* no sheet */ } });
      await page.getByTestId('share-job').click();
      await expect(page.getByTestId('share-options')).toBeVisible({ timeout: 10_000 });
      await r.check(page, 'share menu signed in');
    });
    r.finish(writes);
  });

  test('journey seeker › resume builder and PDF download', async ({ page }, ti) => {
    test.setTimeout(300_000);
    ready('seeker');
    const r = recorder(ti, { role: 'job seeker', signedIn: true, allow404: ALLOW404 });
    r.watch(page);
    const writes = await guard(page, { mode: 'block', allow: [/^POST \/api\/me\/exports\b/, /^POST \/api\/(track|events)\b/] });
    await r.visit(page, '/builder');
    await r.step(page, 'Download PDF', async () => {
      const btn = page.getByRole('button', { name: 'Download PDF' }).filter({ visible: true }).first();
      await expect(btn).toBeVisible({ timeout: 30_000 });
      if (await btn.isDisabled()) { r.note('Download PDF is disabled (no name on the demo resume)'); return; }
      const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 60_000 }), btn.click()]);
      const name = dl.suggestedFilename();
      const path = ti.outputPath(name);
      await dl.saveAs(path);
      const head = readFileSync(path).subarray(0, 5).toString();
      if (!/\.pdf$/i.test(name) || head !== '%PDF-') throw new Error(`download ${name} is not a PDF (starts ${JSON.stringify(head)})`);
      r.note(`PDF downloaded: ${name}, ${readFileSync(path).length} bytes`);
      await r.check(page, 'builder after PDF');
    });
    r.finish(writes);
  });

  test('journey seeker › payments say coming soon; skill checks, Hire now, orders open', async ({ page, request }, ti) => {
    test.setTimeout(300_000);
    ready('seeker');
    const r = recorder(ti, { role: 'job seeker', signedIn: true, allow404: ALLOW404 });
    r.watch(page);
    const writes = await guard(page, { mode: 'block', allow: [/^POST \/api\/(track|events)\b/] });
    const { mode } = await (await request.get(`${API}/api/public/payment-mode`, { timeout: 60_000 })).json();
    r.note(`payment mode: ${mode}`);
    for (const p of ['/me/upgrade', '/me/payments', '/me/orders', '/pricing', '/linkedin']) {
      await r.visit(page, p);
      if (mode === 'off') {
        const pay = await page.getByRole('button', { name: /^(Pay|Buy|Checkout)\b|₹\s?\d/ }).filter({ visible: true }).evaluateAll((bs) => bs.filter((b) => !b.disabled).map((b) => b.innerText.trim().slice(0, 40)));
        const soon = await page.getByText(/Payments coming soon/i).count();
        r.note(`${p}: "Payments coming soon" shown ${soon} time(s); enabled pay buttons: ${pay.join(' | ') || 'none'}`);
        if (pay.length) await r.fail(page, `${p} pay buttons`, `payments are off but these buttons can be pressed: ${pay.join(' | ')}`);
      }
    }
    await r.visit(page, '/me/skill-checks');
    const checks = (await linksUnder(page, '/me/skill-checks/')).slice(0, 2);
    for (const c of checks) await r.visit(page, c, `skill check ${c}`);
    await r.visit(page, '/me/hire');
    r.finish(writes);
  });
});

test.describe('journey student', () => {
  test.use({ storageState: join(STATE, 'student.json') });
  test('journey student › pages, setup card and Next step', async ({ page }, ti) => {
    test.setTimeout(900_000);
    ready('student');
    const r = recorder(ti, { role: 'student', signedIn: true, allow404: ALLOW404 });
    r.watch(page);
    const writes = await guard(page, { mode: 'log' });
    await sweep(page, r, ['/me', '/me/learn', '/me/auto-apply', '/me/progress', '/me/jobs', '/me/groups', '/me/resumes', '/me/skill-checks', '/me/practice', '/me/roles', '/me/programs', '/start/student']);
    for (const home of ['/me', '/me/learn']) await setupCard(page, r, home);
    r.finish(writes);
  });
});

test.describe('journey easy', () => {
  test.use({ storageState: join(STATE, 'easy.json') });
  test('journey easy › Easy dashboard: every screen, and Telugu / Hindi', async ({ page, browser }, ti) => {
    test.setTimeout(600_000);
    ready('easy');
    const r = recorder(ti, { role: 'student (Easy dashboard)', signedIn: true, allow404: ALLOW404 });
    r.watch(page);
    // the only write: the language of this made-up demo account, put back at the end
    const writes = await guard(page, { mode: 'block', allow: [/^PUT \/api\/me\/simple\/prefs\b/, /^POST \/api\/(track|events)\b/] });
    await r.visit(page, '/me/simple');
    const screens = new Set(['/me/simple/more', '/me/simple/ready', '/me/simple/jobs', '/me/simple/apps', '/me/simple/practice', '/me/simple/fixes', '/me/simple/hire', '/me/simple/roles', '/me/simple/myresume', '/me/simple/answers', '/me/simple/outside', '/me/simple/auto']);
    for (const l of await linksUnder(page, '/me/simple/')) screens.add(l);
    await page.goto('/me/simple/more'); await page.waitForLoadState('networkidle').catch(() => {});
    for (const l of await linksUnder(page, '/me/simple/')) screens.add(l);
    for (const l of screens) if (!/\/resume$/.test(l)) await r.visit(page, l); // the guided resume saves answers: opened only
    await r.visit(page, '/me/simple/resume', '/me/simple/resume (opened only)');
    // a job inside the Easy dashboard
    await page.goto('/me/simple/jobs'); await page.waitForLoadState('networkidle').catch(() => {});
    const j = (await linksUnder(page, '/me/simple/jobs/'))[0];
    if (j) await r.visit(page, j, `Easy job ${j}`); else r.note('no job in the Easy dashboard list');
    // languages: the account's own setting, so only j-desktop changes it (desktop and phone share the demo account);
    // a 390 px window looks at the same screens while it is Telugu / Hindi
    await page.goto('/me/simple'); await page.waitForLoadState('networkidle').catch(() => {});
    if (!(await page.getByTestId('sx-lang').count())) r.note('Easy dashboard: no language chip (Telugu/Hindi hidden by Admin > Settings)');
    else if (ti.project.name.includes('phone')) r.note('Easy languages: checked from j-desktop (with a 390 px window too)');
    else {
      const phoneCtx = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, storageState: join(STATE, 'easy.json') });
      const phone = await phoneCtx.newPage();
      r.watch(phone);
      await guard(phone, { mode: 'block', allow: [/^POST \/api\/(track|events)\b/] });
      const was = (await page.locator('.sx').getAttribute('lang')) || 'en';
      r.note(`Easy dashboard language before: ${was}`);
      for (const code of ['te', 'hi']) {
        await r.step(page, `Easy in ${code}`, async () => {
          await page.goto('/me/simple/language');
          await page.getByTestId(`sx-pick-${code}`).click();
          await expect(page.locator('.sx')).toHaveAttribute('lang', code, { timeout: 15_000 });
          await r.check(page, `Easy home in ${code}`);
          for (const s of ['/me/simple/more', '/me/simple/jobs', '/me/simple/ready']) await r.visit(page, s, `${s} in ${code}`);
          for (const s of ['/me/simple', '/me/simple/more', '/me/simple/jobs', '/me/simple/ready']) await r.visit(phone, s, `390 px: ${s} in ${code}`);
        });
      }
      await phoneCtx.close();
      await page.goto('/me/simple/language');
      await page.getByTestId(`sx-pick-${was}`).click().catch(() => r.note(`could not put the language back to ${was}`));
      await page.waitForTimeout(1500);
    }
    r.finish(writes);
  });
});

test.describe('journey company', () => {
  test.use({ storageState: join(STATE, 'company.json') });
  test('journey company › every tab, Hire now', async ({ page }, ti) => {
    test.setTimeout(600_000);
    ready('company');
    const r = recorder(ti, { role: 'company', signedIn: true });
    r.watch(page);
    const writes = await guard(page, { mode: 'block', allow: [/^POST \/api\/(track|events)\b/] });
    await r.visit(page, '/company');
    const tabs = await page.getByRole('tab').evaluateAll((ts) => ts.map((t) => t.innerText.trim()).filter(Boolean));
    r.note(`company tabs: ${tabs.join(', ')}`);
    for (const t of tabs) {
      await r.step(page, `tab ${t}`, async () => {
        await page.getByRole('tab', { name: t, exact: true }).first().click({ timeout: 15_000 });
        await r.check(page, `/company tab ${t}`);
      });
    }
    r.note(`writes blocked: ${writes.filter((w) => !w.allowed).map((w) => `${w.method} ${w.path}`).join(', ') || 'none'}`);
    r.finish(writes);
  });
});

test.describe('journey college', () => {
  test.use({ storageState: join(STATE, 'college.json') });
  test('journey college › the college portal, every page and menu link', async ({ page }, ti) => {
    test.setTimeout(900_000);
    const d = ready('college');
    const base = d.base || '/org';
    const r = recorder(ti, { role: 'college', signedIn: true });
    r.watch(page);
    const writes = await guard(page, { mode: 'log' });
    const pages = ['', '/dashboard', '/resumes', '/drives', '/offers', '/kiosks', '/recruiters', '/branding', '/billing', '/team', '/alumni', '/reviewers', '/activity'].map((p) => `${base}${p}`);
    await sweep(page, r, pages, { area: new RegExp(`^${base}`), skip: /^\/(api|admin)/ });
    // a group's page, if the demo college has one
    await page.goto(base); await page.waitForLoadState('networkidle').catch(() => {});
    const g = (await linksUnder(page, `${base}/groups/`))[0];
    if (g) await r.visit(page, g, `group ${g}`);
    r.finish(writes);
  });
});
