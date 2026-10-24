// The Academic template (LaTeX / Jake's-resume look), on a desktop and a 390 px phone: its card says 1 column,
// ATS-safe and Experienced + Freshers and draws with My details and the Sample; in the builder it keeps every section
// as it was (look-only), loads CMU Serif from our own origin (no CSP errors), shows the company in bold and the
// role and dates in italic, fits the standard test resume on 1 page, and the PDF and Word file follow the same layout.
import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { strFromU8, unzipSync } from 'fflate';
import { API, PASSWORD, TEST_PERSON, email, login, pdfText, seed } from './helpers.mjs';

const SIZES = [['desktop', { width: 1280, height: 900 }], ['phone', { width: 390, height: 844 }]];
const live = (page) => page.getByRole('region', { name: 'Live resume preview' });
const api = (page, path, init = {}) => page.evaluate(async ([base, p, i]) => {
  const r = await fetch(`${base}${p}`, { credentials: 'include', headers: { 'Content-Type': 'application/json' }, ...i });
  if (!r.ok) throw new Error(`${r.status} ${await r.text()}`);
  return r.status === 204 ? null : r.json();
}, [API, path, init]);
async function saved(page, click) {
  const [file] = await Promise.all([page.waitForEvent('download', { timeout: 30_000 }), click()]);
  return readFileSync(await file.path());
}
const RESUME = (mail) => ({
  ...structuredClone(TEST_PERSON),
  personal: { ...TEST_PERSON.personal, name: 'Anjali Verma', email: mail },
  exp: [
    { company: 'Northwind Retail', role: 'Data Analyst Intern', employmentType: 'Internship', location: 'Hybrid-Hyderabad', from: '2024-04', to: '', current: true, description: 'Built **Power BI** dashboards for the sales team\nCleaned CSV files in Python every week', links: [] },
    { company: 'Zoho', role: 'Analyst', employmentType: '', location: '', from: '', to: '', current: false, description: '', links: [] },
  ],
});

for (const [label, size] of SIZES) {
  test.describe(label, () => {
    test.use({ viewport: size });

    test('Academic: card tags, look-only switch, CMU Serif, bold company / italic role, 1 page, PDF and Word', async ({ page }) => {
      const csp = [];
      page.on('console', (m) => { if (m.type() === 'error' && /Content Security Policy|font/i.test(m.text())) csp.push(m.text()); });
      const mail = email(`acad-${label}`);
      seed('customer', mail, 'Anjali Verma', PASSWORD);
      await login(page, mail);
      await page.waitForURL('**/me');
      await expect.poll(async () => (await api(page, '/api/me/resumes')).length).toBe(1);
      const [cur] = await api(page, '/api/me/resumes');
      await api(page, `/api/me/resumes/${cur.id}`, { method: 'PATCH', body: JSON.stringify({ data: RESUME(mail) }) });

      // the gallery card, with My details and with the Sample
      await page.goto('/templates');
      const cardEl = page.getByTestId('tg-card-academic');
      await cardEl.scrollIntoViewIfNeeded();
      await expect(cardEl).toContainText('1 column · Experienced + Freshers');
      await expect(cardEl).toContainText('Anjali Verma');
      await page.getByRole('group', { name: 'Show the templates with' }).getByRole('button', { name: 'Sample resume' }).click();
      await expect(cardEl).toContainText('Sai Varsha');
      await page.getByRole('group', { name: 'Show the templates with' }).getByRole('button', { name: 'My details' }).click();

      // pick it in the builder: tags on the picker card, then use it
      await page.goto('/builder');
      await page.evaluate(() => window.history.replaceState({ usr: { open: 'build' }, key: 'x' }, ''));
      await page.reload();
      await expect(page.getByTestId('save-status')).toHaveText('All changes saved', { timeout: 15_000 });
      await page.getByLabel('Headline').fill('Data Analyst · SQL · Power BI '); // a save, so the builder's own tidy-up is in
      await page.getByLabel('Headline').fill('Data Analyst · SQL · Power BI');
      await expect(page.getByTestId('save-status')).toHaveText('All changes saved', { timeout: 15_000 });
      const before = (await api(page, '/api/me/resumes'))[0].data; // as the builder saves it
      await page.getByRole('button', { name: 'Change template' }).click();
      const c = page.locator('[data-testid="tp-card-academic"]');
      await c.scrollIntoViewIfNeeded();
      await expect(c).toContainText('1 column');
      await expect(c).toContainText('Experienced + Freshers');
      await expect(c).toContainText(/ATS (9\d|100)/);
      await c.getByRole('radio').click();
      await c.getByTestId('tp-use-card').click();
      await expect(page.getByText('Live preview · Academic')).toBeVisible();
      await expect(page.getByTestId('page-count')).toHaveText('1 page ✓', { timeout: 15_000 });

      // the look: CMU Serif from our own origin, centred name, two-line entries
      expect(await page.evaluate(async () => { await document.fonts.ready; return document.fonts.check('700 12px "CMU Serif"') && [...document.fonts].some((f) => f.family.includes('CMU Serif') && f.status === 'loaded'); })).toBe(true);
      const entry = live(page).locator('[data-entry="academic"]', { hasText: 'Northwind Retail' });
      await expect(entry.locator('strong', { hasText: /^Northwind Retail$/ })).toBeVisible();
      await expect(entry).toContainText('Hybrid-Hyderabad');
      const line2 = entry.locator('div', { hasText: /^Data Analyst Intern \(Internship\)/ }).first();
      await expect(line2).toHaveCSS('font-style', 'italic');
      await expect(line2).toContainText('Apr 2024 – Present');
      await expect(entry.locator('strong', { hasText: /^Power BI$/ })).toHaveCount(1); // bold words work here too
      const zoho = live(page).locator('[data-entry="academic"]', { hasText: 'Zoho' });
      await expect(zoho).toHaveText(/^ZohoAnalyst$/); // no "()", no dates, no stray dash
      expect(await live(page).innerText()).not.toMatch(/\(\s*\)/);

      // look-only: the saved sections, order and content are unchanged (only the design differs)
      await expect(page.getByTestId('save-status')).toHaveText('All changes saved', { timeout: 15_000 });
      const after = (await api(page, '/api/me/resumes'))[0].data;
      const { design: _a, ...restAfter } = after;
      const { design: _b, ...restBefore } = before;
      expect(restAfter).toEqual(restBefore);
      expect(after.design.preset).toBe('academic');

      // PDF: real text, the same lines, no stray characters, one page
      const pdf = await saved(page, () => page.getByRole('button', { name: 'Download PDF' }).first().click());
      const pages = await pdfText(pdf);
      expect(pages).toHaveLength(1);
      expect(pages[0]).toMatch(/Northwind Retail\s+Hybrid-Hyderabad/);
      expect(pages[0]).toMatch(/Data Analyst Intern \(Internship\)\s+Apr 2024 – Present/);
      expect(pages[0]).not.toMatch(/\(\s*\)|\*\*/);
      // Word: the same two lines with a right tab, company bold, role italic
      const xml = strFromU8(unzipSync(new Uint8Array(await saved(page, () => page.getByRole('button', { name: /Word/ }).first().click())))['word/document.xml']);
      expect(xml).toMatch(/<w:b\/>(?:(?!<\/w:rPr>).)*<\/w:rPr><w:t xml:space="preserve">Northwind Retail<\/w:t><\/w:r><w:r><w:tab\/><\/w:r>/);
      expect(xml).toMatch(/<w:i\/>(?:(?!<\/w:rPr>).)*<\/w:rPr><w:t xml:space="preserve">Data Analyst Intern \(Internship\)<\/w:t>/);
      expect(csp).toEqual([]);
    });
  });
}
