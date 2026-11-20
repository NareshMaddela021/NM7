// View · Apply · Save on every job card, and one Share button for all apps, on a desktop and a 390 px phone, against
// the real API: the three sit in one row (no sideways scrolling) on /jobs, the home page's live jobs, a company page,
// saved jobs and the Easy dashboard; signed out, Apply asks to create an account and comes back to the job and applies;
// a company-site job opens the company's site; "Applied" stays after a reload; the Share menu (desktop) has the
// seven ways and Copy link copies the job's link; the phone's share sheet is used on a phone; each share is counted.
import { expect, test } from '@playwright/test';
import { API, PASSWORD, email, lastCode, seed } from './helpers.mjs';
import { SIZES, call, json, noSideScroll } from './college.mjs';
import { STRONG, studentWith, verifiedCompany } from './autoapply.mjs';

const DESC = 'Build weekly dashboards in SQL and Power BI for our retail stores. Freshers are welcome; training is given.';
const job = (body) => seed('job', JSON.stringify({ description: DESC, locations: ['Hyderabad'], experience: 'fresher', skills: ['SQL', 'Power BI'], ...body }));
const own = (page, n) => page.route(`${API}/**`, (r) => r.continue({ headers: { ...r.request().headers(), 'x-forwarded-for': `10.77.${n}.${Date.now() % 200}` } }));

/** View, Apply (or Applied) and Save: all there, one row, big enough to tap, inside the screen. */
async function oneRow(page, card, ids = ['card-view', 'card-apply', 'card-save']) {
  const width = page.viewportSize().width;
  const boxes = [];
  for (const id of ids) {
    const el = card.getByTestId(id);
    await expect(el).toBeVisible();
    boxes.push(await el.boundingBox());
  }
  for (const b of boxes) {
    expect(Math.abs(b.y - boxes[0].y)).toBeLessThan(3);
    expect(b.height).toBeGreaterThanOrEqual(44);
    expect(b.x + b.width).toBeLessThanOrEqual(width);
  }
  for (let i = 1; i < boxes.length; i += 1) expect(boxes[i].x).toBeGreaterThan(boxes[i - 1].x); // View · Apply · Save
  expect(await noSideScroll(page)).toBe(true);
}

for (const [label, opts] of SIZES) {
  test.describe(label, () => {
    test.use(opts);

    test('one row everywhere, company site opens, applied on a card stays after reload', async ({ page, request, context }) => {
      test.setTimeout(200_000);
      page.on('dialog', () => { throw new Error('no browser dialogs'); });
      const tag = `${label}r${Date.now().toString(36)}`;
      const co = await verifiedCompany(request, tag, 'Rowco');
      const comp = await co.post(`Row Analyst ${tag}`);
      expect(comp.status).toBe('active');
      await co.post(`Easy Analyst ${tag}`);
      const site = `https://row${tag}.example/careers`;
      const ext = job({ title: `Row Tester ${tag}`, company: { name: `Siteco ${tag}` }, applyMethod: 'link', applyUrl: site }); // the newest

      // signed out: the job board
      await page.goto(`/jobs?q=${encodeURIComponent(tag)}`);
      const cards = page.getByTestId('job-card');
      await expect(cards).toHaveCount(3);
      for (const c of await cards.all()) await oneRow(page, c);
      // the home page's live jobs
      await page.goto('/');
      const home = page.getByTestId('job-card').filter({ hasText: `Row Tester ${tag}` });
      await oneRow(page, home);
      await home.getByTestId('card-view').click();
      await expect(page).toHaveURL(new RegExp(`/jobs/${ext.slug}$`));
      await expect(page.getByTestId('job-detail')).toContainText(`Row Tester ${tag}`);
      // the company's page
      const slug = (await call(page, `/api/jobs/${comp.slug}`)).body.companyTrust.slug;
      await page.goto(`/companies/${slug}`);
      const onCo = page.getByTestId('job-card').filter({ hasText: `Row Analyst ${tag}` });
      await oneRow(page, onCo);

      // signed in: the company's site opens and the card says Applied, also after a reload
      await studentWith(page, label, STRONG, 'rows');
      await context.route(`https://row${tag}.example/**`, (r) => r.fulfill({ status: 200, contentType: 'text/html', body: '<h1>Careers</h1>' }));
      await page.goto(`/jobs?q=${encodeURIComponent(tag)}`);
      const extCard = cards.filter({ hasText: `Row Tester ${tag}` });
      await oneRow(page, extCard);
      const [tab] = await Promise.all([context.waitForEvent('page'), extCard.getByTestId('card-apply').click()]);
      await expect.poll(() => tab.url()).toBe(site);
      await tab.close();
      await expect(extCard.getByTestId('card-applied')).toHaveText('Applied');
      await expect(extCard.getByTestId('card-applied')).toBeDisabled();
      await page.reload();
      await expect(extCard.getByTestId('card-applied')).toHaveText('Applied');
      await oneRow(page, extCard, ['card-view', 'card-applied', 'card-save']);
      // the company's Nm7 job: the job page's own steps (the consent box) in a dialog
      const compCard = cards.filter({ hasText: `Row Analyst ${tag}` });
      await compCard.getByTestId('card-apply').click();
      const dlg = page.getByTestId('apply-dialog');
      await expect(dlg.getByTestId('apply-form')).toBeVisible();
      await dlg.getByTestId('apply-consent').check();
      await dlg.getByTestId('apply-send').click();
      await expect(dlg.getByTestId('applied')).toHaveText('Applied');
      expect(await noSideScroll(page)).toBe(true);
      await page.keyboard.press('Escape');
      await expect(compCard.getByTestId('card-applied')).toHaveText('Applied');
      // the job page says so on load
      await page.goto(`/jobs/${ext.slug}`);
      await expect(page.getByTestId('applied')).toHaveText('Applied');
      await page.goto(`/jobs/${comp.slug}`);
      await expect(page.getByTestId('applied')).toHaveText('Applied');

      // saved jobs
      await page.goto(`/jobs?q=${encodeURIComponent(tag)}`);
      await extCard.getByTestId('card-save').click();
      await expect(extCard.getByTestId('card-save')).toHaveAttribute('aria-pressed', 'true');
      await page.goto('/jobs?saved=1');
      const saved = cards.filter({ hasText: `Row Tester ${tag}` });
      await oneRow(page, saved, ['card-view', 'card-applied', 'card-save']);

      // the Easy dashboard: View · Apply · Save on its big cards
      expect((await call(page, '/api/me/simple/prefs', json('PUT', { lang: 'en', mode: 'simple' }))).status).toBe(200);
      await page.goto('/me/simple/jobs');
      const easy = page.getByTestId('sx-job').first();
      await oneRow(page, easy, ['sx-job-view', 'sx-job-apply', 'sx-job-save']);
      await easy.getByTestId('sx-job-view').click();
      await expect(page).toHaveURL(/\/jobs\/[^/?]+$/);
      await expect(page.getByTestId('job-detail')).toBeVisible();
    });

    test('signed out: Apply → create account → back on the job and applied', async ({ page }) => {
      test.setTimeout(120_000);
      page.on('dialog', () => { throw new Error('no browser dialogs'); });
      const tag = `${label}s${Date.now().toString(36)}`;
      const j = job({ title: `Signup Trainee ${tag}`, company: { name: `Joinco ${tag}` }, applyMethod: 'nm7' });
      await own(page, label === 'phone' ? 2 : 1);
      await page.goto(`/jobs?q=${encodeURIComponent(tag)}`);
      const card = page.getByTestId('job-card').filter({ hasText: `Signup Trainee ${tag}` });
      await oneRow(page, card);
      await card.getByTestId('card-apply').click();
      const ask = page.getByTestId('apply-ask');
      await expect(ask).toContainText('You come straight back to this job');
      await expect(ask.getByTestId('apply-ask-login')).toHaveAttribute('href', `/login?next=${encodeURIComponent(`/jobs/${j.slug}?apply=1`)}`);
      expect(await noSideScroll(page)).toBe(true);
      await ask.getByTestId('apply-ask-signup').click();
      await expect(page).toHaveURL(/\/signup\?next=/);
      const mail = email(`jobact-${label}`);
      await page.getByLabel('Full name').fill('Ravi Teja');
      await page.getByLabel('Email').fill(mail);
      await page.getByLabel('Password', { exact: true }).fill(PASSWORD);
      await page.getByLabel('Re-type password').fill(PASSWORD);
      await page.getByRole('checkbox', { name: /I agree/ }).check();
      await page.getByRole('button', { name: 'Create account' }).click();
      await expect(page.getByRole('heading', { name: 'Confirm your email' })).toBeVisible();
      await page.getByLabel('6-digit code').fill(lastCode(mail));
      await page.getByRole('button', { name: 'Confirm & continue' }).click();
      // back on the job, and the application went on from there
      await expect(page).toHaveURL(new RegExp(`/jobs/${j.slug}$`));
      await expect(page.getByTestId('applied')).toHaveText('Applied');
      expect((await call(page, '/api/me/applied-jobs')).body.items.map((x) => x.id)).toContain(j.id);
      await page.reload();
      await expect(page.getByTestId('applied')).toHaveText('Applied');
      await page.goto(`/jobs?q=${encodeURIComponent(tag)}`);
      await expect(card.getByTestId('card-applied')).toHaveText('Applied');
      expect(await noSideScroll(page)).toBe(true);
    });

    test('Share: menu with seven ways on a computer, the share sheet on a phone, counted per channel', async ({ page, context, request }) => {
      test.setTimeout(90_000);
      const tag = `${label}h${Date.now().toString(36)}`;
      const j = job({ title: `Share Analyst ${tag}`, company: { name: `Shareco ${tag}` }, applyMethod: 'link', applyUrl: `https://share${tag}.example/jobs` });
      const url = `https://nm7.si/jobs/${j.slug}`;
      await own(page, label === 'phone' ? 4 : 3);
      // the link-preview robots' page: the job's title, company, city and the Nm7 logo
      const pre = await request.get(`${API}/api/jobs/${j.slug}/preview`);
      expect(pre.status()).toBe(200);
      const html = await pre.text();
      expect(html).toContain(`<meta property="og:title" content="Share Analyst ${tag} · Shareco ${tag} · Hyderabad">`);
      expect(html).toContain('<meta property="og:image" content="https://nm7.si/og-image.png">');
      expect(html).toContain('<meta name="twitter:card" content="summary_large_image">');
      expect(html).toContain(`<meta property="og:url" content="${url}">`);
      const before = seed('share-count');
      if (label === 'phone') {
        await page.addInitScript(() => {
          window.__shared = [];
          Object.defineProperty(navigator, 'share', { configurable: true, value: (d) => { window.__shared.push(d); return Promise.resolve(); } });
        });
        await page.goto(`/jobs/${j.slug}`);
        await page.getByTestId('share-job').click();
        await expect.poll(() => page.evaluate(() => window.__shared.length)).toBe(1);
        const shared = await page.evaluate(() => window.__shared[0]);
        expect(shared.url).toBe(url);
        expect(shared.text).toContain(`Share Analyst ${tag}`);
        await expect(page.getByRole('dialog')).toHaveCount(0); // the phone's own sheet, not the menu
        await expect.poll(() => seed('share-count').native || 0).toBe((before.native || 0) + 1);
        expect(await noSideScroll(page)).toBe(true);
        return;
      }
      await context.grantPermissions(['clipboard-read', 'clipboard-write']);
      await page.goto(`/jobs/${j.slug}`);
      await page.getByTestId('share-job').click();
      const menu = page.getByRole('dialog', { name: 'Share' });
      for (const c of ['whatsapp', 'linkedin', 'telegram', 'facebook', 'x', 'email', 'copy']) await expect(menu.getByTestId(`share-${c}`)).toBeVisible();
      await expect(menu.getByTestId('share-options').getByRole('listitem')).toHaveCount(7);
      const wa = new URL(await menu.getByTestId('share-whatsapp').getAttribute('href'));
      expect(wa.origin + wa.pathname).toBe('https://wa.me/');
      expect(wa.searchParams.get('text')).toBe(`Job: Share Analyst ${tag} at Shareco ${tag}. Details and apply: ${url}`);
      expect(new URL(await menu.getByTestId('share-linkedin').getAttribute('href')).searchParams.get('url')).toBe(url);
      await menu.getByTestId('share-copy').click();
      await expect(menu.getByTestId('share-note')).toHaveText('Link copied');
      expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(url);
      await expect.poll(() => seed('share-count').copy || 0).toBe((before.copy || 0) + 1);
      await context.route('https://wa.me/**', (r) => r.fulfill({ status: 200, contentType: 'text/html', body: '<p>WhatsApp</p>' }));
      const [tab] = await Promise.all([context.waitForEvent('page'), menu.getByTestId('share-whatsapp').click()]);
      await tab.close();
      await expect.poll(() => seed('share-count').whatsapp || 0).toBe((before.whatsapp || 0) + 1);
      await expect(page.getByRole('dialog')).toHaveCount(0);
      expect(await noSideScroll(page)).toBe(true);
    });
  });
}
