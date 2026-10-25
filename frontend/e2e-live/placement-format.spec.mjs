// Official placement template (colleges, Phase 2) on a desktop and a 390 px phone, against the real API (Campus):
//   the college sets its format (college name, centred header, footer, two allowed templates, CGPA required, 1 page,
//   roll number shown); a student of the group sees "Your college uses an official placement format" with the
//   checklist and their resume in it; the coordinator's view, combined PDF (college cover page, page numbers, roll
//   number, the college's section order) and ZIP use it; the student's own resume never changes.
import { readFileSync } from 'node:fs';
import { unzipSync } from 'fflate';
import { expect, test } from '@playwright/test';
import { API, PASSWORD, adminLogin, apiMember, email, login, pdfText, seed } from './helpers.mjs';

const SIZES = [['desktop', { viewport: { width: 1280, height: 900 } }], ['phone', { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true }]];
const call = (page, path, init = {}) => page.evaluate(async ([base, p, i]) => {
  const r = await fetch(`${base}${p}`, { credentials: 'include', headers: { 'Content-Type': 'application/json' }, ...i });
  return { status: r.status, body: r.status === 204 ? null : await r.json() };
}, [API, path, init]);
const FIELDS = [{ key: 'roll', label: 'Roll number', type: 'text', required: true }, { key: 'branch', label: 'Branch', type: 'select', options: ['CSE', 'ECE'], required: true }];
const RESUME = {
  personal: { name: 'Meena Iyer', email: 'meena@example.com', phone: '+91 90000 00002', headline: 'B.Tech CSE 2026' },
  summary: 'Final-year student who builds web apps.',
  exp: [{ company: 'Shown Co', role: 'Intern', from: '2025-05', to: '2025-07', description: 'Built 2 dashboards' }, { company: 'Hidden Co', role: 'Helper', off: true }],
  proj: [{ title: 'Campus Pay', tagline: '', description: 'Payments for 2,000 students', tech: 'React', links: [] }],
  edu: [{ institution: 'XYZ College', degree: 'B.Tech', field: 'CSE', from: '2022-08', to: '2026-05', grade: '' }],
  skillGroups: [{ id: 'core', label: 'Skills', value: 'Python, React, SQL' }],
  certs: [], ach: [], custom: [], langs: [], hobbies: '', strengths: '', pinfo: {}, links: {}, hidden: {}, titles: {},
  order: ['summary', 'exp', 'proj', 'edu', 'skills'], showPhoto: false, design: { preset: 'academic' },
};

for (const [label, opts] of SIZES) {
  test.describe(label, () => {
    test.use(opts);

    test('college format: set it, students see it with the checklist, view / PDF / ZIP use it, resume unchanged', async ({ page, browser, playwright }) => {
      const owner = email(`pf-owner-${label}`);
      const { secret } = seed('admin', owner, 'owner', PASSWORD);
      await adminLogin(page, owner, secret);
      await expect(page).not.toHaveURL(/\/login/);
      const org = (await call(page, '/api/admin/orgs', { method: 'POST', body: JSON.stringify({ name: `XYZ College ${label}`, type: 'college' }) })).body;
      expect((await call(page, `/api/admin/orgs/${org.id}/billing/plan`, { method: 'PUT', body: JSON.stringify({ planId: 'campus' }) })).status).toBe(200);
      const code = `PF${Date.now().toString(36).slice(-6).toUpperCase()}`;
      const g = await call(page, `/api/admin/orgs/${org.id}/groups`, { method: 'POST', body: JSON.stringify({ name: 'B.Tech 2026', code, customFields: FIELDS, settings: { printBranded: true } }) });
      expect(g.status).toBe(201);

      // the college's format, in the admin console's Branding section
      await page.goto(`/admin/orgs?org=${org.id}`);
      const brand = page.getByRole('region', { name: 'Branding' });
      await brand.getByLabel('College name').fill('XYZ College of Engineering');
      await brand.getByLabel('Header style').selectOption('center');
      await brand.getByLabel('Header line').fill('Training & Placement Cell');
      await brand.getByLabel('Footer line (optional)').fill('Placement resume · Batch 2026 · Verified by T&P Cell');
      await brand.getByLabel('Base template').selectOption('campus');
      await brand.getByLabel('Also allow (optional)').first().selectOption('academic');
      const rules = brand.getByTestId('rules');
      await rules.getByLabel('Use a section order and rules').check();
      await rules.getByLabel('CGPA or percentage required in Education').check();
      await rules.getByLabel('Page limit').selectOption('1');
      await rules.getByLabel('Show the roll number in the header').check();
      const preview = page.getByRole('region', { name: 'Preview' });
      await expect(preview.getByTestId('brand-college')).toHaveText('XYZ College of Engineering');
      await expect(preview.getByTestId('brand-roll')).toHaveText('Roll no. 26CS001');
      await brand.getByRole('button', { name: 'Save branding' }).click();
      await expect(page.getByText('Branding saved')).toBeVisible();

      // a student joins; in My groups they see the format, the checklist and their resume in it
      const mail = email(`pf-student-${label}`);
      const { api } = await apiMember(playwright, mail, 'Meena Iyer', code, { roll: '26CS042', branch: 'CSE' }, RESUME);
      const before = (await (await api.get('/api/me/state')).json()).resumes[0].data;
      const sctx = await browser.newContext({ ...opts, baseURL: 'http://localhost:5182' });
      const s = await sctx.newPage();
      await login(s, mail);
      await s.waitForURL('**/me');
      await s.goto('/me/groups');
      const fmt = s.getByTestId('college-format');
      await expect(fmt).toContainText('Your college uses an official placement format');
      await expect(fmt.getByTestId('format-checklist')).toContainText('CGPA or percentage required in Education');
      await expect(fmt.getByTestId('brand-college')).toHaveText('XYZ College of Engineering');
      await expect(fmt.getByTestId('brand-roll')).toHaveText('Roll no. 26CS042');
      expect(await s.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(opts.viewport.width);
      await sctx.close();

      // the coordinator side: view and combined PDF in the format, the student's content and switches as they are
      await page.goto(`/admin/shared-resumes?org=${org.id}`);
      const row = page.getByRole('row', { name: new RegExp(mail) });
      await row.getByRole('button', { name: 'View' }).click();
      const dlg = page.getByRole('dialog');
      await expect(dlg.getByTestId('brand-college')).toHaveText('XYZ College of Engineering');
      await expect(dlg.getByTestId('brand-strip')).toHaveAttribute('data-style', 'center');
      await expect(dlg).not.toContainText('Hidden Co');
      await dlg.getByRole('button', { name: 'Close' }).click();
      await row.getByRole('checkbox').check();
      const [pdf] = await Promise.all([page.waitForEvent('download', { timeout: 60_000 }), page.getByRole('button', { name: 'Combined PDF' }).click()]);
      const pages = await pdfText(readFileSync(await pdf.path()));
      expect(pages[0]).toContain('XYZ College of Engineering'); // the college cover page
      expect(pages[0]).toContain('Placement resumes');
      expect(pages[0]).toContain('B.Tech 2026');
      expect(pages[0]).toContain('CSE');
      const resume = pages.find((p) => p.includes('Meena Iyer'));
      expect(resume).toContain('Training & Placement Cell');
      expect(resume).toContain('Roll no. 26CS042');
      expect(resume).toContain('Verified by T&P Cell · Page 1 of 1');
      expect(resume).toContain('Shown Co');
      expect(resume).not.toContain('Hidden Co');
      // the college's order (Education first) instead of the student's (Experience first)
      const low = resume.toLowerCase();
      expect(low.indexOf('education')).toBeLessThan(low.indexOf('experience'));
      // ZIP: the cover first, then the resume in the format
      await row.getByRole('checkbox').check();
      const [zip] = await Promise.all([page.waitForEvent('download', { timeout: 60_000 }), page.getByRole('button', { name: /ZIP/ }).click()]);
      const names = Object.keys(unzipSync(new Uint8Array(readFileSync(await zip.path()))));
      expect(names[0]).toBe('00_Cover.pdf');
      expect(names).toHaveLength(2);

      // the student's own resume didn't change
      const after = (await (await api.get('/api/me/state')).json()).resumes[0].data;
      expect(after).toEqual(before);
      await api.dispose();
    });
  });
}
