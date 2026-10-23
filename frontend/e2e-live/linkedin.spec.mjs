// /linkedin (Phase 1, free), on a desktop and a 390 px phone, against the real API (no AI key here, so the rules
// write the headlines unless the AI call is mocked in the browser).
//   Path 1: an invalid link is refused; a link alone asks for the PDF or pasted sections; pasted sections → score,
//           fixes, "Keep as it is", one headline before → after; the LinkedIn PDF (signed in) → the same, saved.
//   Path 2: from a resume → 5 headlines + the guide (Telugu marked NEED NATIVE REVIEW); from details only, with a
//           Telugu note → English headlines, no experience step; AI's invented facts are dropped; over the limit →
//           rules, never an error page. Locked items never open a checkout.
import { expect, test } from '@playwright/test';
import { API, PASSWORD, TEST_PERSON, email, login, seed } from './helpers.mjs';
import { linkedinPdf } from './linkedinPdf.mjs';

const SIZES = [['desktop', { viewport: { width: 1280, height: 900 } }], ['phone', { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true }]];
const HEADLINES = '**/api/me/linkedin/headlines';
const json = (status, body) => ({ status, contentType: 'application/json', body: JSON.stringify(body) });
const api = (page, path, init = {}) => page.evaluate(async ([base, p, i]) => {
  const r = await fetch(`${base}${p}`, { credentials: 'include', headers: { 'Content-Type': 'application/json' }, ...i });
  if (!r.ok) throw new Error(`${r.status} ${await r.text()}`);
  return r.status === 204 ? null : r.json();
}, [API, path, init]);
const PRIVATE = /98765|ravi@example\.com|testperson@example\.com/;

async function noCheckout(page) {
  const asked = [];
  page.on('request', (r) => { if (/\/api\/(orders|payments|checkout)|razorpay/i.test(r.url())) asked.push(r.url()); });
  for (const b of await page.getByTestId('li-locked').getByRole('button', { name: 'Coming soon' }).all()) await b.click({ force: true });
  await expect(page).toHaveURL(/\/linkedin/);
  expect(asked).toEqual([]);
}

for (const [label, opts] of SIZES) {
  test.describe(label, () => {
    test.use(opts);

    test('header link; path 1 with pasted sections: link checks, score, fixes, keep, before → after, locked', async ({ page }) => {
      await page.goto('/templates');
      if (label === 'phone') await page.getByRole('button', { name: 'Menu' }).click();
      const nav = page.getByRole('navigation', { name: 'Main' });
      await expect(nav.getByRole('link', { name: 'Templates' })).toBeVisible();
      const names = await nav.getByRole('link').evaluateAll((els) => els.map((e) => e.textContent.trim()));
      expect(names.indexOf('LinkedIn')).toBe(names.indexOf('Templates') + 1);
      await nav.getByRole('link', { name: 'LinkedIn' }).click();
      await expect(page).toHaveURL(/\/linkedin$/);
      await expect(page.getByText('We never ask for your LinkedIn password')).toBeVisible();
      await page.getByTestId('li-path-fix').click();

      // an invalid link is refused; a link alone asks for the PDF or sections
      await page.getByLabel(/Your LinkedIn link/).fill('https://www.linkedin.com/company/acme');
      await page.getByTestId('li-check').click();
      await expect(page.getByRole('alert').filter({ hasText: 'Paste your profile link, like linkedin.com/in/your-name.' })).toBeVisible();
      await expect(page.getByTestId('li-result')).toHaveCount(0);
      await page.getByLabel(/Your LinkedIn link/).fill('linkedin.com/in/divya-nair');
      await page.getByTestId('li-check').click();
      await expect(page.getByTestId('li-need')).toHaveText(/upload your LinkedIn PDF or paste your sections/);
      await expect(page.getByLabel(/Your LinkedIn link/)).toHaveValue('https://www.linkedin.com/in/divya-nair');

      // pasted sections: a strong headline (kept), an About with a phone number (flagged)
      await page.getByRole('button', { name: 'Paste sections' }).click();
      await page.getByLabel('The job you want').fill('Data Analyst');
      await page.getByLabel('Headline').fill('Data Analyst | SQL · Excel · Power BI | B.Com 2024 | Built a sales dashboard');
      await page.getByLabel('About').fill('I am looking for a job. Call 98765 43210.');
      await page.getByLabel('Skills').fill('SQL, Excel, Power BI');
      await page.getByTestId('li-check').click();
      const res = page.getByTestId('li-result');
      await expect(res).toBeVisible();
      const score = Number((await page.getByTestId('li-score').innerText()).split('/')[0]);
      expect(score).toBeGreaterThan(10);
      expect(score).toBeLessThan(70);
      await expect(page.getByTestId('li-item-headline').getByTestId('li-keep')).toHaveText('Keep as it is');
      await expect(page.getByTestId('li-item-about')).toContainText('It has a phone number, email or ID number.');
      await expect(page.getByTestId('li-item-experience')).toContainText('There is no experience.');
      await expect(page.getByTestId('li-item-url')).toHaveCount(1);
      await expect(page.getByTestId('li-keywords')).toContainText('Data Analyst: missing Tableau, Python');
      await expect(page.getByTestId('li-before')).toHaveText('Data Analyst | SQL · Excel · Power BI | B.Com 2024 | Built a sales dashboard');
      const after = await page.getByTestId('li-after').innerText();
      expect(after).toMatch(/^Data Analyst/);
      expect(after.length).toBeLessThanOrEqual(220);
      expect(after).not.toMatch(PRIVATE);
      // ticking the checklist raises the score
      await page.getByLabel('Open to Work is on, with my target roles').check();
      await expect.poll(async () => Number((await page.getByTestId('li-score').innerText()).split('/')[0])).toBe(score + 5);
      await expect(page.getByTestId('li-item-openToWork').getByTestId('li-keep')).toBeVisible();
      await expect(page.getByTestId('li-signin')).toBeVisible(); // guests: nothing saved
      await noCheckout(page);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
    });

    test('path 1 with the LinkedIn PDF, signed in: score, fixes, before → after, saved on the account only', async ({ page }) => {
      const mail = email(`li-pdf-${label}`);
      seed('customer', mail, 'Ravi Kumar', PASSWORD);
      await login(page, mail);
      await page.waitForURL('**/me');
      await page.goto('/linkedin?path=fix');
      await expect(page.getByTestId('li-pdf-picture')).toBeVisible();
      await expect(page.getByText('Save to PDF', { exact: false }).first()).toBeVisible();
      await page.getByLabel(/Your LinkedIn link/).fill('www.linkedin.com/in/ravi-kumar-4b2a91a3/');
      await page.getByLabel('The job you want').fill('Data Analyst');
      await page.getByTestId('li-pdf-input').setInputFiles({ name: 'Profile.pdf', mimeType: 'application/pdf', buffer: await linkedinPdf() });
      await expect(page.getByTestId('li-pdf-read')).toContainText('1 role, 3 skills, 1 education', { timeout: 30_000 });
      await page.getByTestId('li-check').click();
      await expect(page.getByTestId('li-score')).toBeVisible();
      await expect(page.getByTestId('li-before')).toHaveText('Student at JNTU Hyderabad');
      await expect(page.getByTestId('li-after')).toHaveText(/^Data Analyst \| /);
      await expect(page.getByTestId('li-ai-notice')).toHaveText('AI is busy. Here are quick suggestions.'); // no key here: the rules, no error
      await expect(page.getByTestId('li-item-headline')).toContainText('Your headline doesn\'t say "Data Analyst".');
      await expect(page.getByTestId('li-item-url')).toContainText('Your link ends in a random code.');
      await expect(page.getByTestId('li-item-education').getByTestId('li-keep')).toHaveText('Keep as it is');
      await expect(page.getByTestId('li-saved')).toHaveText('Saved to your account.');
      const rec = await api(page, '/api/me/linkedin');
      expect(rec.url).toBe('https://www.linkedin.com/in/ravi-kumar-4b2a91a3');
      expect(rec.source).toBe('pdf');
      expect(rec.sections.headline).toBe('Student at JNTU Hyderabad');
      expect(String(rec.result.score)).toBe((await page.getByTestId('li-score').innerText()).split('/')[0]);
      expect(JSON.stringify(rec)).not.toMatch(PRIVATE);
      await expect(page.getByTestId('li-result')).not.toContainText(/98765|ravi@example/);
    });

    test('path 2 from a resume: 5 headlines, the guide in 3 languages with copy, AI invented facts dropped, locked', async ({ page }) => {
      const mail = email(`li-res-${label}`);
      seed('customer', mail, 'Sai Varsha', PASSWORD);
      await login(page, mail);
      await page.waitForURL('**/me');
      await expect.poll(async () => (await api(page, '/api/me/resumes')).length).toBe(1);
      const [cur] = await api(page, '/api/me/resumes');
      await api(page, `/api/me/resumes/${cur.id}`, { method: 'PATCH', body: JSON.stringify({ data: { ...structuredClone(TEST_PERSON), personal: { ...TEST_PERSON.personal, email: mail } } }) });
      const sent = [];
      await page.route(HEADLINES, async (route) => {
        sent.push(route.request().postDataJSON());
        return route.fulfill(json(200, { headlines: ['Data Analyst with 7 years at Google | SQL', 'Data Analyst | SQL · Power BI · Excel | Built dashboards in Python'], model: 'claude-haiku-5-5', fallback: false }));
      });
      await page.goto('/linkedin');
      await page.getByTestId('li-path-create').click();
      await page.getByTestId('li-resume').first().click();
      await page.getByTestId('li-make').click();
      const opts = page.getByTestId('li-option');
      await expect(opts).toHaveCount(5);
      await expect(opts.first()).toHaveText('Data Analyst | SQL · Power BI · Excel | Built dashboards in Python');
      const texts = await opts.allInnerTexts();
      for (const t of texts) { expect(t.length).toBeLessThanOrEqual(220); expect(t).not.toMatch(PRIVATE); expect(t).not.toMatch(/7 years|at Google|Sai Varsha/); } // (Google Data Analytics is their own certificate)
      expect(JSON.stringify(sent[0].facts)).not.toMatch(/Sai Varsha|98765|@/);
      // the guide: English, then Telugu and Hindi (marked for review); the copy text stays English
      const guide = page.getByTestId('li-guide');
      for (const id of ['signup', 'photo', 'headline', 'about', 'experience', 'skills', 'openToWork']) await expect(guide.getByTestId(`li-step-${id}`)).toBeVisible();
      await expect(guide.getByTestId('li-step-headline')).toContainText(texts[0]);
      await page.getByRole('radio').nth(2).check();
      await expect(guide.getByTestId('li-step-headline')).toContainText(texts[2]);
      await expect(page.getByTestId('li-review')).toHaveCount(0);
      await guide.getByRole('button', { name: 'తెలుగు' }).click();
      await expect(page.getByTestId('li-review')).toContainText('NEED NATIVE REVIEW');
      await expect(guide.getByTestId('li-step-signup')).toContainText('సైన్ అప్');
      await expect(guide.getByTestId('li-step-headline')).toContainText(texts[2]);
      await guide.getByRole('button', { name: 'हिन्दी' }).click();
      await expect(guide.getByTestId('li-step-skills')).toContainText('स्किल्स');
      await expect(guide.getByTestId('li-copy-skills')).toBeVisible();
      await expect(page.getByTestId('li-locked-profile')).toContainText('Coming soon');
      await expect(page.getByTestId('li-locked-banner')).toContainText('Coming soon');
      await noCheckout(page);
      await expect.poll(async () => (await api(page, '/api/me/linkedin')).path).toBe('create');
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
    });

    test('path 2 from details only (guest), Telugu note: English headlines, no experience step; over the limit → rules', async ({ page }) => {
      await page.goto('/linkedin?path=create');
      await expect(page.getByTestId('li-resume')).toHaveCount(0);
      await page.getByTestId('li-make').click();
      await expect(page.getByTestId('li-need')).toBeVisible();
      await page.getByLabel('The job you want').fill('డేటా అనలిస్ట్');
      await page.getByLabel('Degree or course').fill('B.Com');
      await page.getByLabel('Year').fill('2024');
      await page.getByLabel('Skills').fill('Excel, Tally, SQL');
      await page.getByTestId('li-note').fill('naku data analyst job kavali. నేను B.Com 2024 లో పూర్తి చేశాను. ఫోన్ 98765 43210');
      await page.getByTestId('li-make').click();
      const opts = page.getByTestId('li-option');
      await expect(opts).toHaveCount(5);
      for (const t of await opts.allInnerTexts()) {
        expect(t).toMatch(/^[\p{Script=Latin}\p{N}\p{P}\p{S}\s]+$/u);
        expect(t).toMatch(/Data Analyst/i);
        expect(t).not.toMatch(/98765/);
      }
      await expect(page.getByTestId('li-step-experience')).toHaveCount(0);
      await expect(page.getByTestId('li-step-skills')).toContainText('SQL, Excel, Tally'); // the Data Analyst skills first
    });

    test('signed in, AI over the daily limit: the rules fill in with a one-line notice, never an error', async ({ page }) => {
      const mail = email(`li-cap-${label}`);
      seed('customer', mail, 'Kiran Rao', PASSWORD);
      await login(page, mail);
      await page.waitForURL('**/me');
      await page.route(HEADLINES, (route) => route.fulfill(json(429, { error: { code: 'rate_limited', message: 'You can write LinkedIn headlines with AI 10 times a day. Here are quick suggestions instead.' } })));
      await page.goto('/linkedin?path=create');
      await page.getByLabel('The job you want').fill('Web Developer');
      await page.getByLabel('Skills').fill('HTML, CSS, JavaScript, React');
      await page.getByTestId('li-make').click();
      await expect(page.getByTestId('li-option')).toHaveCount(5);
      await expect(page.getByTestId('li-ai-notice')).toHaveText('You can write LinkedIn headlines with AI 10 times a day. Here are quick suggestions instead.');
    });
  });
}
