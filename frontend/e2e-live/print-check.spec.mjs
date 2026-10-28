// "Check before download" on a desktop and a 390 px phone, against the real API (payments off: downloads are free):
//   the exact print preview (the PDF itself, drawn on white paper even in dark mode) and the checklist (pages,
//   missing contact, long bullets, links); "Back to editing" saves nothing; "Download anyway" saves the file; and the
//   PDF and Word files are the same in light and dark mode.
import { readFileSync } from 'node:fs';
import { unzipSync, strFromU8 } from 'fflate';
import { expect, test } from '@playwright/test';
import { API, PASSWORD, email, login, seed } from './helpers.mjs';

const SIZES = [['desktop', { viewport: { width: 1280, height: 900 } }], ['phone', { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true }]];
const post = (page, path, body) => page.evaluate(async ([base, p, b]) => {
  const r = await fetch(`${base}${p}`, { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b) });
  return { status: r.status, body: await r.json().catch(() => null) };
}, [API, path, body]);
const LONG = `Built ${'very '.repeat(40)}detailed sales reports for the regional team every week`;
const RESUME = {
  personal: { name: 'Kiran Rao', email: 'kiran@example.com', phone: '', location: 'Pune', title: 'Data Analyst' },
  links: { linkedin: 'linkedin.com/in/kiran-rao' },
  summary: 'Data analyst who builds dashboards.',
  exp: [{ id: 'e1', company: 'Acme', role: 'Intern', from: '2024-01', to: '2024-06', description: `${LONG}\nCleaned CSV files in Python` }],
  edu: [{ id: 'd1', institution: 'Pune University', degree: 'B.Sc', field: 'Statistics', from: '2020', to: '2023' }],
  skillGroups: [{ id: 'core', label: 'Skills', value: 'SQL, Python, Excel' }],
};

async function signedIn(page, who) {
  const mail = email(who);
  seed('customer', mail, 'Kiran Rao', PASSWORD);
  await login(page, mail);
  await page.waitForURL('**/me');
  const r = await post(page, '/api/me/resumes', { id: 'r1', name: 'Main', data: RESUME });
  expect(r.status).toBeLessThan(300);
}
async function openEditor(page) {
  await page.goto('/builder');
  await page.evaluate(() => window.history.replaceState({ usr: { open: 'build' }, key: 'x' }, ''));
  await page.reload();
  await expect(page.getByRole('article', { name: 'Resume preview' })).toBeVisible();
}
const dialog = (page) => page.getByRole('dialog', { name: 'Check before you download' });
/** Clicks a download button, passes the check, returns the saved file's bytes. */
async function download(page, button) {
  await page.getByRole('button', { name: button, exact: true }).first().click();
  await expect(dialog(page).getByTestId('print-page').first()).toBeVisible({ timeout: 30_000 });
  const [file] = await Promise.all([page.waitForEvent('download', { timeout: 30_000 }), dialog(page).getByTestId('check-download').click()]);
  return readFileSync(await file.path());
}
// the creation time and the document id differ on every save; everything else must match
const pdfBody = (b) => b.toString('latin1').replace(/\/(CreationDate|ModDate) *\([^)]*\)/g, '').replace(/\/ID *\[[^\]]*\]/g, '');
const docxBody = (b) => {
  const z = unzipSync(new Uint8Array(b));
  return Object.keys(z).filter((k) => !k.startsWith('docProps/')).sort().map((k) => `${k}\n${strFromU8(z[k])}`).join('\n');
};

for (const [label, opts] of SIZES) {
  test.describe(label, () => {
    test.use(opts);

    test('the preview and checklist show before a download; back saves nothing; download anyway saves', async ({ page }) => {
      await signedIn(page, `pc-${label}`);
      await openEditor(page);
      const files = [];
      page.on('download', (d) => files.push(d));
      await page.getByRole('button', { name: 'Download PDF', exact: true }).first().click();
      const dlg = dialog(page);
      await expect(dlg).toBeVisible();
      await expect(dlg.getByTestId('print-page')).toHaveCount(1, { timeout: 30_000 });
      await expect(dlg).toContainText('1 page · exactly as it prints');
      await expect(dlg.getByTestId('check-contact')).toHaveAttribute('data-ok', 'no');
      await expect(dlg.getByTestId('check-contact')).toContainText('Add your phone number');
      await expect(dlg.getByTestId('check-bullets')).toHaveAttribute('data-ok', 'no');
      await expect(dlg.getByTestId('check-bullets')).toContainText('Experience: Acme');
      await expect(dlg.getByTestId('check-pages')).toHaveAttribute('data-ok', 'yes');
      await expect(dlg.getByTestId('check-links')).toHaveAttribute('data-ok', 'yes');
      await expect(dlg.getByTestId('check-cutoff')).toHaveAttribute('data-ok', 'yes');
      await expect(dlg.getByTestId('check-download')).toHaveText('Download PDF anyway');
      // the dialog fits a phone: no sideways scrolling
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
      await dlg.getByTestId('check-back').click();
      await expect(dlg).toHaveCount(0);
      await page.waitForTimeout(500);
      expect(files).toHaveLength(0);
      const bytes = await download(page, 'Download PDF');
      expect(bytes.subarray(0, 4).toString('latin1')).toBe('%PDF');
    });

    test('dark mode: the paper stays white, and the PDF and Word files are the same as in light mode', async ({ page }) => {
      await signedIn(page, `pcdark-${label}`);
      await page.emulateMedia({ colorScheme: 'light' });
      await openEditor(page);
      const lightPdf = await download(page, 'Download PDF');
      const lightDocx = await download(page, 'Word');
      await page.emulateMedia({ colorScheme: 'dark' });
      await page.reload();
      await expect(page.getByRole('article', { name: 'Resume preview' })).toBeVisible();
      await page.getByRole('button', { name: 'Download PDF', exact: true }).first().click();
      const dlg = dialog(page);
      await expect(dlg.getByTestId('print-page').first()).toBeVisible({ timeout: 30_000 });
      const pixel = await dlg.getByTestId('print-page').first().evaluate((c) => [...c.getContext('2d').getImageData(4, 4, 1, 1).data]);
      expect(pixel).toEqual([255, 255, 255, 255]);
      expect(await dlg.getByTestId('print-paper').evaluate((el) => getComputedStyle(el).colorScheme)).toBe('light');
      await dlg.getByTestId('check-back').click();
      const darkPdf = await download(page, 'Download PDF');
      const darkDocx = await download(page, 'Word');
      expect(pdfBody(darkPdf)).toBe(pdfBody(lightPdf));
      expect(docxBody(darkDocx)).toBe(docxBody(lightDocx));
    });
  });
}
