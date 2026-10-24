// Contact-line icons, on a desktop and a 390 px phone: the Academic template now follows the resume's
// "Contact details and links" setting like every other template — Icon + text (default), Text only, Icon only (links
// only; phone and email keep their text). Each item is one link in the preview, the PDF and the Word file, and the PDF
// keeps the full phone, email and profile names as real text.
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

for (const [label, size] of SIZES) {
  test.describe(label, () => {
    test.use({ viewport: size });

    test('Academic: icon + text by default, Text only, Icon only; one link per item in preview, PDF and Word', async ({ page }) => {
      const mail = email(`icons-${label}`);
      seed('customer', mail, 'Anjali Verma', PASSWORD);
      await login(page, mail);
      await page.waitForURL('**/me');
      await expect.poll(async () => (await api(page, '/api/me/resumes')).length).toBe(1);
      const [cur] = await api(page, '/api/me/resumes');
      const data = {
        ...structuredClone(TEST_PERSON),
        personal: { ...TEST_PERSON.personal, name: 'Anjali Verma', email: mail, phone: '+91 98765 43210', location: 'Hyderabad' },
        links: { ...TEST_PERSON.links, linkedin: 'linkedin.com/in/anjali-verma', github: 'github.com/anjaliv' },
        design: { ...TEST_PERSON.design, preset: 'academic', font: 'cmu-serif', entryStyle: 'academic', icons: false, contactSep: '|', contactOrder: 'phone-first', headerAlign: 'center', headerStyle: 'none', logoColor: 'mono' },
      };
      await api(page, `/api/me/resumes/${cur.id}`, { method: 'PATCH', body: JSON.stringify({ data }) }); // an Academic resume saved before this change
      await page.goto('/builder');
      await page.evaluate(() => window.history.replaceState({ usr: { open: 'build' }, key: 'x' }, ''));
      await page.reload();
      await expect(page.getByTestId('save-status')).toHaveText('All changes saved', { timeout: 15_000 });

      // default: icon + text, | between items, each item one link
      const header = live(page).locator('header');
      const li = header.locator('a[data-contact="linkedin"]');
      await expect(li).toHaveAttribute('href', 'https://linkedin.com/in/anjali-verma');
      await expect(li.locator('svg')).toHaveCount(1);
      await expect(li).toContainText('anjali-verma');
      await expect(header.locator('a[data-contact="phone"]')).toHaveAttribute('href', 'tel:+919876543210');
      await expect(header.locator('a[data-contact="email"]')).toHaveAttribute('href', `mailto:${mail}`);
      await expect(header).toContainText('|');
      const box = await li.locator('svg').boundingBox();
      const textBox = await li.locator('span', { hasText: 'anjali-verma' }).last().boundingBox();
      expect(box.height).toBeLessThan(textBox.height); // a small icon, about the cap height
      expect(Math.abs((box.y + box.height) - (textBox.y + textBox.height * 0.8))).toBeLessThan(textBox.height * 0.35); // on the baseline

      const pdfOf = async () => (await pdfText(await saved(page, () => page.getByRole('button', { name: 'Download PDF' }).first().click()))).join(' ');
      let pdf = await pdfOf();
      for (const t of ['+91 98765 43210', mail, 'anjali-verma', 'anjaliv', 'Hyderabad']) expect(pdf).toContain(t);
      expect(pdf).not.toMatch(/�/);

      // the setting in Design: Text only (the old look), then Icon only
      const choose = async (name) => {
        await page.getByRole('tab', { name: /^Design/ }).click();
        const details = page.getByRole('button', { name: /^Style details/ });
        if ((await details.getAttribute('aria-expanded')) === 'false') await details.click();
        const group = page.getByRole('radiogroup', { name: 'Contact details and links' });
        await group.getByRole('radio', { name }).click();
        await expect(group.getByRole('radio', { name })).toHaveAttribute('aria-checked', 'true');
        await expect(page.getByTestId('save-status')).toHaveText('All changes saved', { timeout: 15_000 });
      };
      await choose('Text only');
      await expect(header.locator('svg')).toHaveCount(0);
      await expect(header).toContainText('anjali-verma');
      await choose('Icon only (links)');
      await expect(li.locator('svg')).toHaveCount(1);
      await expect(li).not.toContainText('anjali-verma');
      await expect(li).toHaveAttribute('aria-label', 'anjali-verma');
      await expect(header.locator('a[data-contact="email"]')).toContainText(mail); // phone and email keep their text
      pdf = await pdfOf();
      expect(pdf).toContain(mail);
      expect(pdf).not.toContain('anjali-verma');
      expect((await api(page, '/api/me/resumes'))[0].data.contactIcons).toBe('icon');

      // Word: the links work
      await choose('Icon + text');
      const docx = unzipSync(new Uint8Array(await saved(page, () => page.getByRole('button', { name: /Word/ }).first().click())));
      const rels = strFromU8(docx['word/_rels/document.xml.rels']);
      for (const u of ['tel:+919876543210', `mailto:${mail}`, 'https://linkedin.com/in/anjali-verma', 'https://github.com/anjaliv']) expect(rels).toContain(`Target="${u}"`);
    });
  });
}
