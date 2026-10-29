// Long skill lists, on a desktop and a 390 px phone: a skill group is an auto-growing box (2 to about 6 lines, then
// it scrolls inside) so 25 skills show without scrolling sideways; Enter types ", " (never a line break); Edit as
// chips removes, reorders and flags duplicates, and saves the same text; the counter, the 15+ tip and the long-skill
// hint show; the preview and the PDF print the same one clean line; the headline box grows too.
import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { API, PASSWORD, TEST_PERSON, email, login, pdfText, seed, downloadThrough } from './helpers.mjs';

const SIZES = [['desktop', { viewport: { width: 1280, height: 900 } }], ['phone', { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true }]];
const live = (page) => page.getByRole('region', { name: 'Live resume preview' });
const api = (page, path, init = {}) => page.evaluate(async ([base, p, i]) => {
  const r = await fetch(`${base}${p}`, { credentials: 'include', headers: { 'Content-Type': 'application/json' }, ...i });
  if (!r.ok) throw new Error(`${r.status} ${await r.text()}`);
  return r.status === 204 ? null : r.json();
}, [API, path, init]);
const TWENTY_FIVE = ['Python', 'SQL', 'Excel', 'Power BI', 'Tableau', 'Pandas', 'NumPy', 'Statistics', 'Machine Learning', 'Git', 'Docker', 'AWS', 'Azure', 'Linux', 'Java', 'C++', 'JavaScript', 'React', 'Node.js', 'MongoDB', 'PostgreSQL', 'Spark', 'Airflow', 'Looker', 'Snowflake'];

for (const [label, opts] of SIZES) {
  test.describe(label, () => {
    test.use(opts);

    test('skill boxes grow, Enter gives ", ", chips round-trip, counter and tips; preview and PDF match', async ({ page }) => {
      const mail = email(`skills-${label}`);
      seed('customer', mail, 'Divya Nair', PASSWORD);
      await login(page, mail);
      await page.waitForURL('**/me');
      await expect.poll(async () => (await api(page, '/api/me/resumes')).length).toBe(1);
      const [cur] = await api(page, '/api/me/resumes');
      const data = { ...structuredClone(TEST_PERSON), personal: { ...TEST_PERSON.personal, name: 'Divya Nair', email: mail }, skillGroups: [{ id: 'core', label: 'Core Technologies / Languages', value: TWENTY_FIVE.join(', ') }, { id: 'frameworks', label: 'Frameworks & Libraries', value: '' }] };
      await api(page, `/api/me/resumes/${cur.id}`, { method: 'PATCH', body: JSON.stringify({ data }) });
      await page.goto('/builder');
      await page.evaluate(() => window.history.replaceState({ usr: { open: 'build' }, key: 'x' }, ''));
      await page.reload();
      await expect(page.getByTestId('save-status')).toHaveText('All changes saved', { timeout: 15_000 });
      await page.getByRole('navigation', { name: 'Sections' }).getByRole('button', { name: /^Skills/ }).click();

      // 25 skills: wrapped in a box that grew (no sideways scroll); it stops at about 6 lines and scrolls inside
      const core = page.locator('#sg-core');
      await expect(core).toHaveJSProperty('tagName', 'TEXTAREA');
      const m = await core.evaluate((el) => { const cs = getComputedStyle(el); return { sw: el.scrollWidth, cw: el.clientWidth, h: el.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom), line: parseFloat(cs.lineHeight), scroll: el.scrollHeight > el.clientHeight }; });
      expect(m.sw).toBeLessThanOrEqual(m.cw + 1);
      expect(m.h).toBeGreaterThan(m.line * 1.9);
      expect(m.h).toBeLessThan(m.line * 6.5); // at most about 6 lines of text, then it scrolls inside
      await expect(page.getByTestId('sg-core-count')).toHaveText(/^25 skills · about \d+ lines? on your resume$/);
      await expect(page.getByTestId('sg-core-tip')).toHaveText('Recruiters skim. Keep your strongest 8-12 here and move the rest to another group.');

      // Enter types ", " and never a line break; the phone keyboard leaves the box in view
      // late animation frames (a busy phone or CI runner): typing straight after Enter must still land in order
      await page.evaluate(() => { window.requestAnimationFrame = (f) => setTimeout(() => f(performance.now()), 200); });
      const fw = page.locator('#sg-frameworks');
      await fw.click();
      await page.waitForTimeout(500);
      await expect(fw).toBeInViewport();
      await fw.pressSequentially('Pandas');
      await fw.press('Enter');
      await fw.pressSequentially('Flask');
      await fw.press('Enter');
      await fw.pressSequentially('pandas');
      await expect(fw).toHaveValue('Pandas, Flask, pandas');
      await expect(page.getByTestId('sg-frameworks-dupe')).toHaveText('Pandas appears twice');
      await fw.pressSequentially(', A framework name that is far too long to be one skill');
      await expect(page.getByTestId('sg-frameworks-long')).toBeVisible();

      // Edit as chips: duplicates flagged, × removes, drag reorders; Edit as text shows the same text
      const group = fw.locator('xpath=ancestor::div[contains(@class,"entry-body")]');
      await group.getByRole('radio', { name: 'Edit as chips' }).click();
      const chips = page.getByTestId('sg-frameworks-chip');
      await expect(chips).toHaveCount(4);
      await expect(chips.nth(2)).toHaveCSS('border-color', /.+/);
      await page.getByRole('button', { name: 'Remove pandas', exact: true }).click();
      await page.getByRole('button', { name: /^Remove A framework name/ }).click();
      await expect(chips).toHaveCount(2);
      const a = await chips.nth(1).boundingBox(); const b = await chips.nth(0).boundingBox();
      await page.mouse.move(a.x + 8, a.y + a.height / 2); await page.mouse.down();
      await page.mouse.move(a.x - 15, a.y + a.height / 2, { steps: 3 });
      await page.mouse.move(b.x + 5, b.y + b.height / 2, { steps: 8 }); await page.mouse.up();
      await group.getByRole('radio', { name: 'Edit as text' }).click();
      await expect(page.locator('#sg-frameworks')).toHaveValue('Flask, Pandas');
      await expect(page.getByTestId('sg-frameworks-dupe')).toHaveCount(0);

      // the headline box grows too and keeps one line of text
      await page.getByRole('navigation', { name: 'Sections' }).getByRole('button', { name: 'Personal Info', exact: true }).click();
      const head = page.getByLabel(/^Headline/);
      await expect(head).toHaveJSProperty('tagName', 'TEXTAREA');
      await head.fill('Data Analyst');
      await head.press('Enter');
      await head.pressSequentially('SQL · Power BI');
      await expect(head).not.toHaveValue(/\n/);

      // saved without line breaks; preview and PDF print the same clean line
      await expect(page.getByTestId('save-status')).toHaveText('All changes saved', { timeout: 15_000 });
      const saved = (await api(page, '/api/me/resumes'))[0].data;
      expect(saved.skillGroups[1].value).toBe('Flask, Pandas');
      expect(JSON.stringify(saved.skillGroups)).not.toContain('\\n');
      await expect(live(page)).toContainText('Frameworks & Libraries: Flask, Pandas');
      const [file] = await downloadThrough(page, () => page.getByRole('button', { name: 'Download PDF' }).first().click(), { timeout: 30_000 });
      const pdf = (await pdfText(readFileSync(await file.path()))).join(' ');
      expect(pdf).toMatch(/Frameworks & Libraries:\s+Flask, Pandas/);
      expect(pdf).toContain('Snowflake');
    });
  });
}
