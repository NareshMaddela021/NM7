// Certificate wallet on a desktop and a 390 px phone, against the real API:
//   Profile → Certificates shows the "no ID documents" warning; an Aadhaar upload is refused; a PNG and a PDF are
//   saved (and open for the owner); "Add to resume" puts one in the resume's Certifications; the college's Shared
//   resumes view shows no certificate until the student switches on "Share certificates", and then only the ticked one.
import { expect, test } from '@playwright/test';
import { API, PASSWORD, adminLogin, email, login, seed } from './helpers.mjs';

const SIZES = [['desktop', { viewport: { width: 1280, height: 900 } }], ['phone', { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true }]];
const call = (page, path, init = {}) => page.evaluate(async ([base, p, i]) => {
  const r = await fetch(`${base}${p}`, { credentials: 'include', headers: { 'Content-Type': 'application/json' }, ...i });
  return { status: r.status, body: r.status === 204 ? null : await r.json().catch(() => null) };
}, [API, path, init]);
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
const PDF = Buffer.from('%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n');
const noSideScroll = (page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);

for (const [label, opts] of SIZES) {
  test.describe(label, () => {
    test.use(opts);

    test('upload, no ID documents, add to resume, share only the ticked certificate with the college', async ({ browser }) => {
      const tag = `${label}${Date.now().toString(36)}`;
      // the college (admin) and its group
      const actx = await browser.newContext(opts);
      const admin = await actx.newPage();
      const amail = `owner-certs-${tag}@nm7.si`;
      const { secret } = seed('admin', amail, 'owner', PASSWORD);
      await adminLogin(admin, amail, secret);
      await expect(admin).not.toHaveURL(/\/login/);
      const org = (await call(admin, '/api/admin/orgs', { method: 'POST', body: JSON.stringify({ name: `College ${tag}`, type: 'college', city: 'Guntur' }) })).body;
      const code = `CW${Date.now().toString(36).toUpperCase().slice(-6)}${label === 'phone' ? 'P' : 'D'}`;
      const g = await call(admin, `/api/admin/orgs/${org.id}/groups`, { method: 'POST', body: JSON.stringify({ name: 'Placements 2026', code, customFields: [] }) });
      expect(g.status).toBe(201);

      // the student
      const page = await browser.newPage(opts);
      const mail = email(`cw-${label}`);
      const name = `Kiran ${tag}`;
      seed('customer', mail, name, PASSWORD);
      await login(page, mail);
      await page.waitForURL('**/me');
      await expect.poll(async () => (await call(page, '/api/me/resumes')).body.length).toBe(1);
      const [r] = (await call(page, '/api/me/resumes')).body;
      expect((await call(page, '/api/me/groups/join', { method: 'POST', body: JSON.stringify({ code, consent: true, fields: {}, resumeId: r.id }) })).status).toBe(201);

      await page.goto('/me/certificates');
      await expect(page.getByTestId('cert-id-warning')).toContainText('Don’t upload Aadhaar, PAN or other ID documents');
      // an ID document is refused before upload
      await page.getByTestId('cert-title').fill('Aadhaar card');
      await page.getByTestId('cert-file').setInputFiles({ name: 'id.png', mimeType: 'image/png', buffer: PNG });
      await page.getByTestId('cert-save').click();
      await expect(page.getByRole('alert')).toContainText('Don’t upload Aadhaar, PAN');
      // a PNG and a PDF
      await page.getByTestId('cert-title').fill('Python for Data Science');
      await page.getByTestId('cert-issuer').fill('NPTEL');
      await page.getByTestId('cert-file').setInputFiles({ name: 'python.png', mimeType: 'image/png', buffer: PNG });
      await page.getByTestId('cert-save').click();
      await expect(page.getByTestId('cert-item')).toHaveCount(1);
      await page.getByTestId('cert-title').fill('Internship letter');
      await page.getByTestId('cert-file').setInputFiles({ name: 'intern.pdf', mimeType: 'application/pdf', buffer: PDF });
      await page.getByTestId('cert-save').click();
      await expect(page.getByTestId('cert-item')).toHaveCount(2);
      const py = page.getByTestId('cert-item').filter({ hasText: 'Python for Data Science' });
      await expect(py).toContainText('NPTEL');
      // the owner can open it
      const [popup] = await Promise.all([page.waitForEvent('popup'), py.getByTestId('cert-view').click()]);
      await expect.poll(() => popup.url()).toMatch(/^blob:/);
      await popup.close();
      // one tap into the resume's Certifications
      await py.getByTestId('cert-to-resume').click();
      await expect(page.getByText(/Added to “.*” → Certifications/)).toBeVisible();
      await expect.poll(async () => ((await call(page, `/api/me/resumes/${r.id}`)).body.data.certs || []).map((c) => c.name)).toContain('Python for Data Science');
      expect(await noSideScroll(page)).toBe(true);

      // the college: nothing until "Share certificates" is on
      const shared = async () => {
        const list = (await call(admin, `/api/admin/shared-resumes?q=${encodeURIComponent(name)}`)).body.rows;
        return (await call(admin, `/api/admin/shared-resumes/${list[0].membershipId}`)).body.certificates.map((c) => c.title);
      };
      await py.getByTestId('cert-pick').click(); // saved, then shown ticked
      await expect(py.getByTestId('cert-pick')).toBeChecked();
      await expect.poll(shared).toEqual([]);
      const sw = page.getByTestId('cert-share');
      await expect(sw).not.toBeChecked();
      await sw.focus();
      await page.keyboard.press('Space');
      await expect(sw).toBeChecked();
      await expect.poll(shared).toEqual(['Python for Data Science']);
      // and in the Shared resumes view
      await admin.goto('/admin/shared-resumes');
      const row = admin.getByRole('table', { name: 'Shared resumes' }).getByRole('row').filter({ hasText: name });
      await row.getByRole('button', { name: 'View' }).click();
      const certs = admin.getByRole('dialog').getByTestId('shared-certs');
      await expect(certs.getByTestId('shared-cert')).toHaveCount(1);
      await expect(certs).toContainText('Python for Data Science');
      await expect(certs).not.toContainText('Internship letter');
      const [view] = await Promise.all([admin.waitForEvent('popup'), certs.getByRole('button', { name: 'View' }).click()]);
      await expect.poll(() => view.url()).toMatch(/^blob:/);
      await actx.close();
      await page.close();
    });
  });
}
