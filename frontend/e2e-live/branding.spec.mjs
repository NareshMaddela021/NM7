// Branded templates (Phase 3B) against the real API: Nm7 switches branding on; the organization sets a logo,
// colour (with the contrast warning), header and footer lines and a base template, sees the live preview, and turns
// on "Print with organization template" for a group. The combined PDF then carries the header and footer as real,
// selectable text around the member's content (hidden entries still hidden); the member's own resume is unchanged.
import { readFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';
import { expect, test } from '@playwright/test';
import { PASSWORD, adminLogin, apiMember, email, pdfText, seed } from './helpers.mjs';

function png(w = 60, h = 20) {
  const crc = (b) => { let c = ~0; for (const x of b) { c ^= x; for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1)); } return ~c >>> 0; };
  const chunk = (t, d) => { const len = Buffer.alloc(4); len.writeUInt32BE(d.length); const td = Buffer.concat([Buffer.from(t), d]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([len, td, c]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  const raw = Buffer.concat(Array.from({ length: h }, () => Buffer.concat([Buffer.from([0]), Buffer.alloc(w * 3, 0x30)])));
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

test('branding: set brand → group prints in it → branded combined PDF; member resume unchanged', async ({ page, playwright }) => {
  const owner = email('owner4');
  const { secret } = seed('admin', owner, 'owner', PASSWORD);
  const code = `BR${Date.now().toString(36).slice(-6).toUpperCase()}`;

  await adminLogin(page, owner, secret);
  await page.getByRole('navigation', { name: 'Admin sections' }).getByRole('link', { name: 'Organizations' }).click();
  const newOrg = page.getByRole('form', { name: 'New organization' });
  await newOrg.getByLabel('Organization name').fill('XYZ College');
  await newOrg.getByRole('button', { name: 'Add organization' }).click();
  await page.getByRole('button', { name: 'New group' }).click();
  const form = page.getByRole('form', { name: 'New group' });
  await form.getByLabel('Group name').fill('Final year 2026');
  await form.getByLabel('Join code').fill(code);
  await expect(form.getByLabel('Print with organization template')).toHaveCount(0); // feature still off
  await form.getByRole('button', { name: 'Save group' }).click();
  const group = page.getByRole('region', { name: 'Group Final year 2026' });
  await expect(group).toBeVisible();

  // switch on, then set the brand
  const sw = page.getByRole('region', { name: 'Features' }).getByRole('checkbox', { name: /Branded templates/ });
  await sw.click();
  await expect(sw).toBeChecked();
  const brand = page.getByRole('region', { name: 'Branding' });
  await brand.getByLabel('Upload logo').setInputFiles({ name: 'logo.png', mimeType: 'image/png', buffer: png() });
  await expect(brand.getByRole('img', { name: 'Organization logo' })).toBeVisible();
  await brand.getByLabel('Colour code').fill('#FFD700');
  await expect(brand.getByTestId('contrast-warning')).toContainText('hard to read on white');
  await brand.getByLabel('Colour code').fill('#1F3A8A');
  await expect(brand.getByTestId('contrast-warning')).toHaveCount(0);
  await brand.getByLabel('Header line').fill('XYZ College · Placement Cell');
  await brand.getByLabel('Footer line (optional)').fill('placements@xyz.example');
  await brand.getByLabel('Base template').selectOption('classic');
  const preview = page.getByRole('region', { name: 'Preview' });
  await expect(preview.getByTestId('brand-strip')).toHaveText('XYZ College · Placement Cell');
  await expect(preview.getByTestId('page-foot')).toHaveText('placements@xyz.example');
  await brand.getByRole('button', { name: 'Save branding' }).click();
  await expect(page.getByText('Branding saved')).toBeVisible();

  // the group prints in it
  await group.getByRole('button', { name: 'Edit' }).click();
  await group.getByLabel('Print with organization template').check();
  await group.getByRole('button', { name: 'Save group' }).click();
  await expect(group).toContainText('organization template');

  // a member joins (through the API) with one hidden entry
  const mail = email('brand-member');
  const { api } = await apiMember(playwright, mail, 'Ravi Kumar', code);
  const before = (await (await api.get('/api/me/state')).json()).resumes[0].data;

  // view and combined PDF are branded; the text is real text
  await page.getByRole('navigation', { name: 'Admin sections' }).getByRole('link', { name: 'Shared resumes' }).click();
  const row = page.getByRole('row', { name: new RegExp(mail) });
  await row.getByRole('button', { name: 'View' }).click();
  await expect(page.getByRole('dialog').getByTestId('brand-strip')).toHaveText('XYZ College · Placement Cell');
  await expect(page.getByRole('dialog')).toContainText('in your organization’s template');
  await page.getByRole('dialog').getByRole('button', { name: 'Close' }).click();
  await row.getByRole('checkbox').check();
  const [file] = await Promise.all([page.waitForEvent('download', { timeout: 60_000 }), page.getByRole('button', { name: 'Combined PDF' }).click()]);
  const pages = await pdfText(readFileSync(await file.path()));
  const resumePage = pages.find((p) => p.includes('Ravi Kumar'));
  expect(resumePage).toContain('XYZ College · Placement Cell');
  expect(resumePage).toContain('placements@xyz.example');
  expect(resumePage).toContain('Shown Co');
  expect(resumePage).not.toContain('Hidden Co');

  // the member's own resume didn't change
  const after = (await (await api.get('/api/me/state')).json()).resumes[0].data;
  expect(after).toEqual(before);
  expect(JSON.stringify(after)).not.toContain('Placement Cell');
  await api.dispose();
});
