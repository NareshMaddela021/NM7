// Vetting Trust T15 (typing, situational-judgement and aptitude tests in English / Hindi / Telugu, and the reliability
// record) on a desktop and a 390 px phone, against the real API:
//   - a tester takes the typing test in Hindi on Get skill verified: the pledge first, a paste is blocked (and said
//     so), typing the passage letter by letter sends it by itself; the result shows the speed, "Typing … wpm+ (Hindi)"
//     and the plain line about the paste;
//   - the situational-judgement test in Telugu: most / least effective for each of 10 situations, answers saved as
//     they go (a reload carries on with the same paper), the score; then a short aptitude test in English;
//   - My hiring: the reliability record's consent, "Showed up 1/1 · Joined 1/1" and a no-show waiting for their side,
//     "I had an emergency" → not counted; the candidate's one-tap link; the company's one-tap Attended and "still
//     working after 30 days?" links (no sign-in);
//   - Hire now: each person's work-test badges and record ("No history yet" for the other, never a negative), the
//     "Typing 35 wpm+" filter, and no filter on the record;
//   - Admin: the Work tests & reliability card (banks valid, a dispute → Remove it); someone the switch is off for sees
//     no work tests and no record card.
// Desktop and phone share one database: every test uses its own people, companies and place; no global setting changes.
import { expect, test } from '@playwright/test';
import { API, PASSWORD, adminLogin, email, lastCode, login, ownNetwork, seed } from './helpers.mjs';
import { SIZES, noSideScroll } from './college.mjs';

const uniq = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
const letters = () => Math.random().toString(36).replace(/[^a-z]/g, '').slice(0, 5).padEnd(5, 'x');
const phone = () => `9${String(Date.now()).slice(-6)}${String(Math.floor(Math.random() * 900) + 100)}`;

function person(who, name, { trust = true } = {}) {
  const mail = email(`${who}-${uniq()}`);
  seed('customer', mail, name, PASSWORD);
  seed('vetting-tester', mail);
  if (trust) { seed('trust-tester', mail); seed('trust-face', mail, 'no'); seed('trust-agent-person', mail, phone()); } // T3 done, adult age check
  return mail;
}

async function signIn(page, mail) {
  await login(page, mail);
  await page.waitForURL('**/me');
}

async function company(request, tag) {
  const site = `t15${tag}.example`;
  const mail = `hr-t15${tag}@example.com`;
  const body = { details: { legalName: `T15${tag} Stores Pvt Ltd`, website: site, category: 'startup', structure: 'private_limited', industry: 'Retail', size: '11_50', about: '' }, registration: { kind: 'llpin', number: 'AAB-1234' }, phone: '' };
  const NET = ownNetwork();
  await request.post(`${API}/api/company/signup/code`, { headers: NET, data: { email: mail, name: 'Tara' } });
  const r = await (await request.post(`${API}/api/company/signup/start`, { headers: NET, data: { email: mail, name: 'Tara', code: lastCode(mail), company: body } })).json();
  const H = { 'X-Recruiter-Account': r.session };
  await request.post(`${API}/api/company/${r.company.id}/company-email/code`, { data: { email: `jobs@${site}` }, headers: { ...H, ...NET } });
  await request.post(`${API}/api/company/${r.company.id}/company-email/verify`, { data: { code: lastCode(`jobs@${site}`) }, headers: H });
  seed('company-verify', r.company.id);
  seed('trust-tester', mail);
  return { id: r.company.id, session: r.session, H, mail };
}

async function job(request, co, city, tag) {
  const data = { job: { title: `Customer Support Executive ${tag}`, description: 'Talk to our customers on calls and chat, solve their order questions and keep notes. Freshers are welcome.', locations: [city], experience: 'fresher', jobType: 'full_time', workType: 'onsite', skills: ['Communication'] } };
  const j = await (await request.post(`${API}/api/company/${co.id}/jobs`, { headers: co.H, data })).json();
  expect(j.status).toBe('active');
  return j;
}

async function fresh(browser, opts) {
  const ctx = await browser.newContext(opts); // no sign-in: the link is enough
  const page = await ctx.newPage();
  page.on('dialog', () => { throw new Error('no browser dialogs'); });
  return { ctx, page };
}

async function openTest(page, test, lang) {
  const card = page.getByTestId(`wt-test-${test}`);
  await card.getByTestId(`wt-open-${test}`).click();
  await card.getByTestId(`wt-lang-${lang}`).check();
  await expect(card.getByTestId('wt-go')).toBeDisabled(); // the pledge first
  await card.getByTestId('pledge-tick').check();
  await card.getByTestId('wt-go').click();
}

for (const [label, opts] of SIZES) {
  test.describe(label, () => {
    test.use(opts);

    test('typing test in Hindi: the pledge, paste blocked, letter-by-letter typing sends it; the badge', async ({ page }) => {
      test.setTimeout(180_000);
      page.on('dialog', () => { throw new Error('no browser dialogs'); });
      const mail = person(`tt15ty-${label}`, `Asha Typing ${label}`);
      await signIn(page, mail);
      await page.goto('/me/skill-checks');
      const wt = page.getByTestId('wt');
      await expect(wt).toContainText('Typing, work situations and aptitude', { timeout: 30_000 });
      await expect(wt.getByTestId('wt-test-typing')).toContainText('Paste is switched off');
      expect(await noSideScroll(page)).toBe(true);
      await openTest(page, 'typing', 'hi');
      const passage = (await page.getByTestId('wt-passage').innerText()).trim();
      expect(passage).toMatch(/[ऀ-ॿ]/);
      const box = page.getByTestId('wt-type');
      await box.focus();
      await page.evaluate(() => {
        const t = document.querySelector('[data-testid="wt-type"]');
        t.dispatchEvent(new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: new DataTransfer() }));
      });
      await expect(page.getByTestId('wt-error')).toContainText('पेस्ट बंद है');
      await expect(box).toHaveValue('');
      expect(await noSideScroll(page)).toBe(true);
      await box.pressSequentially(passage);
      const res = page.getByTestId('wt-result');
      await expect(res).toBeVisible({ timeout: 30_000 });
      await expect(res.getByTestId('wt-result-line')).toContainText('words a minute');
      await expect(res.getByTestId('wt-result-line')).toContainText('100% accuracy');
      await expect(res.getByTestId('wt-badge')).toContainText(/Typing \d+ wpm\+ \(Hindi\)/);
      await expect(res.getByTestId('wt-flag').first()).toContainText('Nothing is decided by this alone');
      expect(await noSideScroll(page)).toBe(true);
      await res.getByTestId('wt-again').click();
      await expect(page.getByTestId('wt-test-typing').getByTestId('wt-mine')).toContainText('(Hindi)');
    });

    test('situational judgement in Telugu (saved as you go, a reload carries on), then aptitude in English', async ({ page }) => {
      test.setTimeout(240_000);
      page.on('dialog', () => { throw new Error('no browser dialogs'); });
      const mail = person(`tt15sj-${label}`, `Ravi Judgement ${label}`);
      await signIn(page, mail);
      await page.goto('/me/skill-checks');
      await expect(page.getByTestId('wt')).toBeVisible({ timeout: 30_000 });
      await openTest(page, 'sjt', 'te');
      const q = page.getByTestId('wt-questions');
      await expect(q.getByTestId('wt-q')).toHaveText(/[ఀ-౿]/, { timeout: 20_000 });
      const answer = async () => {
        const opts = q.getByTestId('wt-option');
        await opts.nth(0).getByTestId('wt-most').click();
        await opts.nth(1).getByTestId('wt-least').click();
        await expect(opts.nth(0).getByTestId('wt-most')).toHaveAttribute('aria-pressed', 'true');
      };
      for (let i = 0; i < 3; i += 1) { await answer(); await q.getByTestId('wt-next').click(); }
      await expect(q.getByTestId('wt-count')).toContainText('✓ 3');
      expect(await noSideScroll(page)).toBe(true);
      await page.waitForTimeout(800); // the last answer's save
      await page.reload();
      const q2 = page.getByTestId('wt-questions');
      await expect(q2.getByTestId('wt-count')).toContainText('✓ 3', { timeout: 30_000 }); // the same paper, answers kept
      for (let i = 0; i < 10; i += 1) {
        await answer();
        if (i < 9) await q2.getByTestId('wt-next').click();
      }
      await expect(q2.getByTestId('wt-count')).toContainText('✓ 10');
      await q2.getByTestId('wt-submit').click();
      const res = page.getByTestId('wt-result');
      await expect(res.getByTestId('wt-result-line')).toContainText('/100', { timeout: 20_000 });
      await res.getByTestId('wt-again').click();
      await expect(page.getByTestId('wt-test-sjt').getByTestId('wt-mine')).toBeVisible();
      // aptitude in English: one answer, then submit
      await openTest(page, 'aptitude', 'en');
      const a = page.getByTestId('wt-questions');
      await expect(a.getByTestId('wt-clock')).toContainText(/1[45]:\d\d/, { timeout: 20_000 });
      await a.getByTestId('wt-option').nth(0).click();
      await expect(a.getByTestId('wt-count')).toContainText('✓ 1');
      expect(await noSideScroll(page)).toBe(true);
      await a.getByTestId('wt-submit').click();
      await expect(page.getByTestId('wt-result').getByTestId('wt-result-line')).toContainText('numbers', { timeout: 20_000 });
    });

    test('reliability record: consent on My hiring, a no-show waits for their side; the one-tap links', async ({ page, request, browser }) => {
      test.setTimeout(180_000);
      page.on('dialog', () => { throw new Error('no browser dialogs'); });
      const tag = `${label[0]}r${Date.now().toString(36)}`;
      const co = await company(request, tag);
      const j = await job(request, co, `Tr${letters()}pur`, tag);
      const mail = person(`tt15rl-${label}`, `Mala Record ${label}`);
      await signIn(page, mail);
      await page.goto('/me/hire');
      const card = page.getByTestId('rel-card');
      await expect(card).toBeVisible({ timeout: 30_000 });
      await card.getByTestId('rel-consent-text').locator('summary').click();
      await expect(card.getByTestId('rel-consent-text')).toContainText('48 hours to tell us why first');
      await expect(card.getByTestId('rel-consent')).not.toBeChecked();
      await card.getByTestId('rel-consent').click(); // saved first, then ticked
      await expect(card.getByTestId('rel-consent')).toBeChecked({ timeout: 20_000 });
      await expect(card.getByTestId('rel-summary')).toContainText('No history yet', { timeout: 20_000 });
      expect(await noSideScroll(page)).toBe(true);
      const { token } = seed('trust-t15-record', mail, co.id, j.id);
      await page.reload();
      await expect(card.getByTestId('rel-summary')).toContainText('Showed up 1/1 · Joined 1/1', { timeout: 30_000 });
      await expect(card.getByTestId('rel-summary')).toContainText('confirmed by employers');
      const waiting = card.getByTestId('rel-item').filter({ has: page.getByTestId('rel-window') });
      await expect(waiting.getByTestId('rel-state')).toHaveText('Waiting for your answer');
      await waiting.getByTestId('rel-explain').click();
      await waiting.getByTestId('rel-why-emergency').check();
      await waiting.getByTestId('rel-send').click();
      await expect(card.getByTestId('rel-msg')).toContainText('Saved', { timeout: 20_000 });
      await expect(card.getByTestId('rel-state').filter({ hasText: 'Not counted (you explained)' })).toHaveCount(1);
      await expect(card.getByTestId('rel-summary')).toContainText('Showed up 1/1 · Joined 1/1');
      expect(await noSideScroll(page)).toBe(true);

      // the candidate's own link (no sign-in)
      const me = await fresh(browser, opts);
      await me.page.goto(`/stop-alerts#k=rme&t=${token}`);
      await expect(me.page.getByRole('heading', { name: 'Your reliability record' })).toBeVisible({ timeout: 20_000 });
      await expect(me.page.getByTestId('rel-summary')).toContainText('Showed up 1/1');
      expect(await noSideScroll(me.page)).toBe(true);
      await me.ctx.close();
      // the company: "Did they come?" after the interview time, and "still working after 30 days?"
      const att = seed('trust-t15-att', mail, co.id, j.id, co.mail).token;
      const c1 = await fresh(browser, opts);
      await c1.page.goto(`/stop-alerts#k=ratt&t=${att}`);
      await expect(c1.page.getByTestId('ratt')).toContainText('Did', { timeout: 20_000 });
      await c1.page.getByTestId('ratt-yes').click();
      await expect(c1.page.getByTestId('ratt-done')).toContainText('attended');
      expect(await noSideScroll(c1.page)).toBe(true);
      const stay = seed('trust-t15-stay', mail, co.id, co.mail).token;
      await c1.page.goto('/');
      await c1.page.goto(`/stop-alerts#k=rstay&t=${stay}`);
      const rs = c1.page.getByTestId('rstay-30');
      await expect(rs).toContainText('Still working with you after 30 days?', { timeout: 20_000 });
      await rs.getByTestId('rstay-yes').click();
      await expect(rs.getByTestId('rstay-done')).toContainText('still working');
      await c1.ctx.close();
      await page.reload();
      await expect(card.getByTestId('rel-summary')).toContainText('Stayed 30 days 1/1', { timeout: 30_000 });
    });

    test('Hire now: work-test badges, the record (No history yet is plain), the typing filter, no record filter', async ({ page, request }) => {
      test.setTimeout(180_000);
      page.on('dialog', () => { throw new Error('no browser dialogs'); });
      const tag = `${label[0]}h${Date.now().toString(36)}`;
      const city = `Tw${letters()}pur`; // this test's own place: Hire now's top 10 holds only its people
      const co = await company(request, tag);
      const j = await job(request, co, city, tag);
      const [asha, bala] = [`Asha${letters()}`, `Bala${letters()}`];
      const am = person(`tt15ha-${label}`, `${asha} Rao`);
      const bm = person(`tt15hb-${label}`, `${bala} K`);
      for (const m of [am, bm]) seed('trust-t6-ready', m, '', city);
      seed('trust-t15-results', am);
      seed('trust-t15-record', am, co.id, j.id);
      seed('trust-t15-dispute', bm, co.id, j.id); // consent, and only a disputed record: nothing counts yet
      await page.goto('/company');
      await page.evaluate((s) => localStorage.setItem('nm7-recruiter-account', s), co.session);
      await page.reload();
      await page.getByRole('tab', { name: 'Hire now' }).click();
      await page.getByTestId('co-hire-job').selectOption(j.id);
      const filters = page.getByTestId('co-hire-wt-filters');
      await expect(filters.getByTestId('co-hire-wt-typing')).toBeVisible({ timeout: 30_000 });
      await expect(filters).toContainText('there is no filter on it');
      const a = page.getByTestId('co-hire-row').filter({ hasText: asha });
      const b = page.getByTestId('co-hire-row').filter({ hasText: bala });
      await expect(a.getByTestId('co-hire-wt-typing')).toContainText('Typing 35 wpm+ (Hindi) · 38 wpm, 96% accuracy', { timeout: 20_000 });
      await expect(a.getByTestId('co-hire-wt-sjt')).toContainText('SJT: strong');
      await expect(a.getByTestId('co-hire-wt-aptitude')).toContainText('Aptitude: top 30%');
      await expect(a.getByTestId('co-hire-wt-record')).toContainText('Showed up 1/1 · Joined 1/1 · confirmed by employers');
      await expect(b.getByTestId('co-hire-wt-record')).toHaveText('🤝 No history yet');
      expect(await noSideScroll(page)).toBe(true);
      await filters.getByTestId('co-hire-wt-typing').selectOption('35');
      await expect(b).toHaveCount(0, { timeout: 20_000 });
      await expect(a).toBeVisible();
      await expect(filters).toContainText('Typing (1)');
      await filters.getByTestId('co-hire-wt-clear').click();
      await expect(b).toBeVisible({ timeout: 20_000 });
      expect(await noSideScroll(page)).toBe(true);
    });

    test('Admin: the Work tests & reliability card decides a dispute; switch off: nothing new for real users', async ({ page, request }) => {
      test.setTimeout(150_000);
      page.on('dialog', () => { throw new Error('no browser dialogs'); });
      const tag = `${label[0]}a${Date.now().toString(36)}`;
      const co = await company(request, tag);
      const j = await job(request, co, `Ta${letters()}pur`, tag);
      const name = `Dev${letters()}`;
      const dm = person(`tt15ad-${label}`, `${name} Dispute`);
      seed('trust-t15-dispute', dm, co.id, j.id);
      const owner = `tt15-own-${label}-${uniq()}@nm7.si`;
      const { secret } = seed('admin', owner, 'owner', PASSWORD);
      await adminLogin(page, owner, secret);
      await expect(page).not.toHaveURL(/\/login/);
      await page.goto('/admin/skill-tests?tab=trust');
      const card = page.getByTestId('tw-admin');
      await expect(card.getByTestId('tw-bank-sjt')).toContainText('Valid', { timeout: 30_000 });
      await expect(card.getByTestId('tw-bank-typing')).toContainText('typing-a, typing-b');
      await expect(card.getByTestId('tw-bank-aptitude')).toContainText('15 / 15');
      const d = card.getByTestId('tw-dispute').filter({ hasText: name });
      await expect(d).toContainText('The company cancelled or moved it');
      await d.getByTestId('tw-remove').click();
      await expect(d).toHaveCount(0, { timeout: 20_000 });
      expect(await noSideScroll(page)).toBe(true);
      // someone the Trust switch is off for: no work tests, no record card
      const off = person(`tt15off-${label}`, `Zara Off ${label}`, { trust: false });
      await page.context().clearCookies();
      await signIn(page, off);
      await page.goto('/me/skill-checks');
      await expect(page.getByTestId('vt-hero')).toBeVisible({ timeout: 30_000 });
      await page.waitForTimeout(1500);
      await expect(page.getByTestId('wt')).toHaveCount(0);
      await page.goto('/me/hire');
      await expect(page.getByTestId('hire-form')).toBeVisible({ timeout: 30_000 });
      await page.waitForTimeout(1500);
      await expect(page.getByTestId('rel-card')).toHaveCount(0);
    });
  });
}
