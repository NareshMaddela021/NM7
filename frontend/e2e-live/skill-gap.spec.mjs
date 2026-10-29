// Skill gap courses on a desktop and a 390 px phone, against the real API:
//   Admin → Courses: the Owner adds a free course (a link with tracking parameters is refused);
//   the student's job match shows "N of M must-have skills missing" with free links per missing skill (seeded list
//   plus the new one), and "I learned this" asks for a project or certificate — the resume is not changed.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';
import { API, PASSWORD, adminLogin, email, login, seed } from './helpers.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const POST = readFileSync(join(here, 'fixtures', 'job-data-analyst.txt'), 'utf8');
const SIZES = [['desktop', { viewport: { width: 1280, height: 900 } }], ['phone', { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true }]];
const call = (page, path, init = {}) => page.evaluate(async ([base, p, i]) => {
  const r = await fetch(`${base}${p}`, { credentials: 'include', headers: { 'Content-Type': 'application/json' }, ...i });
  return { status: r.status, body: r.status === 204 ? null : await r.json().catch(() => null) };
}, [API, path, init]);
const RESUME = {
  personal: { name: 'Divya Teja', email: 'divya@example.com', phone: '+91 90000 44444', location: 'Chennai', title: 'B.Sc Statistics student' },
  summary: 'Statistics student who enjoys presenting findings to people.',
  edu: [{ institution: 'Loyola College', degree: 'B.Sc', field: 'Statistics', from: '2022', to: '2025' }],
  skills: [{ name: 'Communication' }],
};

for (const [label, opts] of SIZES) {
  test.describe(label, () => {
    test.use(opts);

    test('Owner adds a free course; the student sees free links per missing skill; "I learned this" only asks for proof', async ({ browser }) => {
      // Admin → Courses
      const actx = await browser.newContext(opts);
      const admin = await actx.newPage();
      const amail = `owner-courses-${label}-${Date.now()}@nm7.si`;
      const { secret } = seed('admin', amail, 'owner', PASSWORD);
      await adminLogin(admin, amail, secret);
      await expect(admin).not.toHaveURL(/\/login/);
      await admin.goto('/admin/courses');
      const title = `SQL basics ${label} ${Date.now().toString(36)}`;
      await admin.getByTestId('course-new').click();
      await admin.getByTestId('course-skill').fill('SQL');
      await admin.getByTestId('course-title').fill(title);
      await admin.getByTestId('course-provider').fill('NPTEL');
      await admin.getByTestId('course-url').fill('https://example.org/sql?utm_source=nm7');
      await admin.getByTestId('course-save').click();
      await expect(admin.getByText(/tracking|affiliate/i).first()).toBeVisible();
      await admin.getByTestId('course-url').fill('https://nptel.ac.in/courses');
      await admin.getByTestId('course-save').click();
      await expect(admin.getByText(title)).toBeVisible();
      expect(await admin.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);

      // the student
      const page = await browser.newPage(opts);
      const mail = email(`sg-${label}`);
      seed('customer', mail, 'Divya Teja', PASSWORD);
      await login(page, mail);
      await page.waitForURL('**/me');
      await expect.poll(async () => (await call(page, '/api/me/resumes')).body.length).toBe(1);
      const [r] = (await call(page, '/api/me/resumes')).body;
      await call(page, `/api/me/resumes/${r.id}`, { method: 'PATCH', body: JSON.stringify({ data: RESUME, name: 'Main' }) });
      await page.goto('/me/ats');
      await page.getByLabel('Job post', { exact: true }).fill(POST);
      await page.getByTestId('jm-go').click();
      const gap = page.getByTestId('jm-result').getByTestId('skill-gap');
      await expect(gap).toContainText(/\d+ of \d+ must-have skills? missing/);
      await expect(gap).toContainText('Free courses only');
      const sql = gap.getByTestId('gap-SQL');
      await expect(sql.getByTestId('gap-course').first()).toBeVisible();
      await expect(sql).toContainText(title);
      await expect(gap.getByTestId('gap-Python').getByTestId('gap-course').first()).toHaveAttribute('href', /^https:\/\//);
      const hrefs = await gap.getByTestId('gap-course').evaluateAll((as) => as.map((a) => a.getAttribute('href')));
      expect(hrefs.length).toBeGreaterThan(1);
      for (const h of hrefs) expect(h).not.toMatch(/utm_|[?&](ref|aff)/i);
      // "I learned this" never touches the resume
      const before = (await call(page, `/api/me/resumes/${r.id}`)).body.data.skills;
      await sql.getByTestId('gap-learned').click();
      const prove = sql.getByTestId('gap-prove');
      await expect(prove).toContainText('We don’t add SQL to your resume by itself');
      await expect(prove.getByRole('link', { name: 'Add a project that uses it' })).toHaveAttribute('href', '/builder?start=section&sec=proj');
      await expect(sql).toContainText('Learned');
      expect((await call(page, `/api/me/resumes/${r.id}`)).body.data.skills).toEqual(before);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
      await page.close();
      // clean up (3 links per skill at most: the next run's course must have room)
      const mine = (await call(admin, '/api/admin/courses')).body.find((c) => c.title === title);
      expect((await call(admin, `/api/admin/courses/${mine.id}`, { method: 'DELETE' })).status).toBeLessThan(300);
      await actx.close();
    });
  });
}
