// "Relevant courses (optional)" in Education, on a desktop and a 390 px phone (touch): Enter, comma and a pasted
// comma list make chips; × removes; dragging reorders; duplicates are ignored and 12 is the most; quick-add ideas
// from the field of study are added only when tapped; B bolds a course; the preview and the PDF print
// "Courses: …" under the entry; the Job Profile has the same field.
import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { API, PASSWORD, TEST_PERSON, email, login, pdfText, seed } from './helpers.mjs';

const SIZES = [['desktop', { viewport: { width: 1280, height: 900 } }], ['phone', { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true }]];
const live = (page) => page.getByRole('region', { name: 'Live resume preview' });
const api = (page, path, init = {}) => page.evaluate(async ([base, p, i]) => {
  const r = await fetch(`${base}${p}`, { credentials: 'include', headers: { 'Content-Type': 'application/json' }, ...i });
  if (!r.ok) throw new Error(`${r.status} ${await r.text()}`);
  return r.status === 204 ? null : r.json();
}, [API, path, init]);
const chips = (page) => page.getByTestId('edu-0-courses-chip');
const chipTexts = (page) => chips(page).evaluateAll((els) => els.map((e) => e.firstElementChild.textContent));

for (const [label, opts] of SIZES) {
  test.describe(label, () => {
    test.use(opts);

    test('courses: chips, paste, remove, reorder, limits, ideas on tap, bold, preview and PDF', async ({ page }) => {
      const mail = email(`courses-${label}`);
      seed('customer', mail, 'Ravi Kumar', PASSWORD);
      await login(page, mail);
      await page.waitForURL('**/me');
      await expect.poll(async () => (await api(page, '/api/me/resumes')).length).toBe(1);
      const [cur] = await api(page, '/api/me/resumes');
      const data = { ...structuredClone(TEST_PERSON), personal: { ...TEST_PERSON.personal, name: 'Ravi Kumar', email: mail }, edu: [{ institution: 'JNTU Hyderabad', degree: 'B.Tech', field: 'Computer Science', from: '2020-08', to: '2024-05', current: false, grade: '8.2 CGPA' }] };
      await api(page, `/api/me/resumes/${cur.id}`, { method: 'PATCH', body: JSON.stringify({ data }) });
      await page.goto('/builder');
      await page.evaluate(() => window.history.replaceState({ usr: { open: 'build' }, key: 'x' }, ''));
      await page.reload();
      await expect(page.getByTestId('save-status')).toHaveText('All changes saved', { timeout: 15_000 });
      await page.getByRole('navigation', { name: 'Sections' }).getByRole('button', { name: /^Education/ }).click();

      const box = page.locator('#edu-0-courses');
      await expect(page.getByText('Relevant courses (optional)')).toBeVisible();
      await expect(box).toHaveAttribute('placeholder', 'Data Structures, Operating Systems, DBMS, Computer Networks');
      await expect(page.getByText(/Add 4-6 courses that match the jobs you want\./)).toBeVisible();
      // ideas from the field of study are only offered, never added by themselves
      const ideas = page.getByTestId('edu-0-courses-ideas');
      await expect(ideas.getByRole('button', { name: '+ Data Structures' })).toBeVisible();
      await expect(chips(page)).toHaveCount(0);
      await expect(live(page)).not.toContainText('Courses:');

      await box.fill('Operating Systems');
      await box.press('Enter');
      await box.pressSequentially('DBMS,');
      await box.evaluate((el) => {
        const dt = new DataTransfer(); dt.setData('text/plain', 'Computer Networks, OOP, dbms');
        el.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
      });
      expect(await chipTexts(page)).toEqual(['Operating Systems', 'DBMS', 'Computer Networks', 'OOP']); // "dbms" was a duplicate
      await ideas.getByRole('button', { name: '+ Data Structures' }).click();
      expect(await chipTexts(page)).toEqual(['Operating Systems', 'DBMS', 'Computer Networks', 'OOP', 'Data Structures']);
      await expect(ideas.getByRole('button', { name: '+ Data Structures' })).toHaveCount(0);

      // × removes; dragging (mouse or finger) reorders
      await page.getByRole('button', { name: 'Remove OOP' }).click();
      const from = await chips(page).nth(3).boundingBox();
      const to = await chips(page).nth(0).boundingBox();
      await page.mouse.move(from.x + 10, from.y + from.height / 2);
      await page.mouse.down();
      await page.mouse.move(from.x - 20, from.y + from.height / 2, { steps: 4 });
      await page.mouse.move(to.x + 10, to.y + to.height / 2, { steps: 8 });
      await page.mouse.up();
      expect(await chipTexts(page)).toEqual(['Data Structures', 'Operating Systems', 'DBMS', 'Computer Networks']);

      // B bolds the picked course
      await chips(page).nth(0).click();
      await page.getByTestId('edu-0-courses-bold').click();
      await expect(chips(page).nth(0).locator('strong')).toHaveText('Data Structures');

      // the preview prints it under the entry
      const line = live(page).locator('[data-line="courses"]');
      await expect(line).toHaveText('Courses:Data Structures, Operating Systems, DBMS, Computer Networks');
      await expect(line.locator('strong').first()).toHaveText('Courses:');

      // at most 12
      await box.fill(Array.from({ length: 12 }, (_, i) => `Elective ${i + 1}`).join(', '));
      await box.press('Enter');
      await expect(chips(page)).toHaveCount(12);
      await expect(box).toBeDisabled();
      await expect(page.getByText(/12 of 12\./)).toBeVisible();

      await expect(page.getByTestId('save-status')).toHaveText('All changes saved', { timeout: 15_000 });
      const savedEdu = (await api(page, '/api/me/resumes'))[0].data.edu[0];
      expect(savedEdu.courses).toHaveLength(12);
      expect(savedEdu.courses[0]).toBe('**Data Structures**');
      const [file] = await Promise.all([page.waitForEvent('download', { timeout: 30_000 }), page.getByRole('button', { name: 'Download PDF' }).first().click()]);
      const pdf = (await pdfText(readFileSync(await file.path()))).join(' ');
      expect(pdf).toMatch(/Courses:\s+Data Structures ?, Operating Systems, DBMS, Computer Networks, Elective 1/); // pdf.js adds a space where the bold run ends
      expect(pdf).not.toContain('**');
    });
  });
}

test('the Job Profile has the same Relevant courses field', async ({ page }) => {
  const mail = email('courses-profile');
  seed('customer', mail, 'Kiran Rao', PASSWORD);
  await login(page, mail);
  await page.waitForURL('**/me');
  await page.goto('/me/profile');
  await page.getByRole('button', { name: /Add education|\+ Education/ }).first().click();
  const box = page.locator('[id^="pf-edu-0-courses"]');
  await box.fill('Financial Accounting');
  await box.press('Enter');
  await expect(page.getByTestId('pf-edu-0-courses-chip')).toHaveText(/Financial Accounting/);
});
