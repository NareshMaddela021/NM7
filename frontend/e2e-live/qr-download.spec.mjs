// QR downloads, on a desktop and a 390 px phone: a group's "Download QR code (PNG)" saves a print-size PNG
// (≥ 1024 px, white quiet zone) named <org>_<group>_QR.png that decodes to the group's join link; the A4 poster PDF
// downloads; the kiosk link's QR downloads and decodes to the kiosk link. No data: URL is ever fetched (the site's
// CSP blocks that — the bug that made the button do nothing) and nothing fails in the console.
import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { PDFDocument } from 'pdf-lib';
import { PASSWORD, adminLogin, email, readQrPng, seed, watchDataFetches } from './helpers.mjs';

const SIZES = [['desktop', { width: 1280, height: 900 }], ['phone', { width: 390, height: 844 }]];
async function saved(page, click) {
  const [file] = await Promise.all([page.waitForEvent('download', { timeout: 30_000 }), click()]);
  return { name: file.suggestedFilename(), bytes: readFileSync(await file.path()) };
}

for (const [label, size] of SIZES) {
  test(`${label}: group QR PNG and poster, and the kiosk link QR`, async ({ page }) => {
    await page.setViewportSize(size);
    const dataFetches = await watchDataFetches(page);
    const errors = [];
    page.on('console', (m) => { if (m.type() === 'error' && /Failed to fetch|Content Security Policy|data:/.test(m.text())) errors.push(m.text()); });
    page.on('pageerror', (e) => errors.push(e.message));
    const owner = email(`qr-${label}`);
    const { secret } = seed('admin', owner, 'owner', PASSWORD);
    const code = `QR${Date.now().toString(36).slice(-6).toUpperCase()}`;

    await adminLogin(page, owner, secret);
    await page.getByRole('navigation', { name: 'Admin sections' }).getByRole('link', { name: 'Organizations' }).click();
    const newOrg = page.getByRole('form', { name: 'New organization' });
    await newOrg.getByLabel('Organization name').fill('AsuraaX');
    await newOrg.getByRole('button', { name: 'Add organization' }).click();
    await expect(page.getByRole('heading', { name: 'AsuraaX' })).toBeVisible();
    await page.getByRole('button', { name: 'New group' }).click();
    const form = page.getByRole('form', { name: 'New group' });
    await form.getByLabel('Group name').fill('Job Drive 2026');
    await form.getByLabel('Join code').fill(code);
    await form.getByRole('button', { name: 'Save group' }).click();
    const card = page.getByRole('region', { name: 'Group Job Drive 2026' });
    await expect(card).toBeVisible();

    // the PNG: right name, print size, white quiet zone, decodes to the join link
    const png = await saved(page, () => card.getByRole('button', { name: 'Download QR code (PNG)' }).click());
    expect(png.name).toBe('AsuraaX_Job_Drive_2026_QR.png');
    expect([...png.bytes.subarray(0, 4)]).toEqual([0x89, 0x50, 0x4e, 0x47]);
    const qr = await readQrPng(png.bytes);
    expect(qr.width).toBeGreaterThanOrEqual(1024);
    expect(qr.height).toBe(qr.width);
    expect(qr.corner).toEqual([255, 255, 255, 255]); // the quiet zone is white
    const origin = new URL(page.url()).origin;
    expect(qr.text).toBe(`${origin}/join/${code}`); // on nm7.si: https://nm7.si/join/<code>
    await expect(card.getByTestId('join-link')).toHaveText(qr.text);

    // the A4 poster
    const pdf = await saved(page, () => card.getByRole('button', { name: 'Download QR poster (PDF)' }).click());
    expect(pdf.name).toBe('AsuraaX_Job_Drive_2026_QR_poster.pdf');
    const doc = await PDFDocument.load(pdf.bytes);
    expect(doc.getPageCount()).toBe(1);
    const { width, height } = doc.getPage(0).getSize();
    expect([Math.round(width), Math.round(height)]).toEqual([595, 842]);

    // the kiosk link's QR (kiosks switched on for this organization)
    const kioskSwitch = page.getByRole('region', { name: 'Features' }).getByRole('combobox', { name: /Kiosk mode/ });
    await kioskSwitch.selectOption('on');
    const kiosks = page.getByRole('region', { name: 'Kiosks' });
    await kiosks.getByLabel('Label').fill('Stall 1');
    await kiosks.getByLabel('Exit PIN (4–6 digits)').fill('2468');
    await kiosks.getByRole('button', { name: 'Make kiosk link' }).click();
    const kioskUrl = await kiosks.getByTestId('kiosk-url').textContent();
    const kpng = await saved(page, () => kiosks.getByRole('button', { name: 'Download QR (PNG)' }).click());
    expect(kpng.name).toBe('Stall_1_kiosk_QR.png');
    const kqr = await readQrPng(kpng.bytes);
    expect(kqr.width).toBeGreaterThanOrEqual(1024);
    expect(kqr.text).toBe(kioskUrl);

    // when the browser can't make the file, it says what to do instead of doing nothing
    await page.evaluate(() => { HTMLCanvasElement.prototype.toBlob = () => { throw new Error('blocked'); }; });
    await card.getByRole('button', { name: 'Download QR code (PNG)' }).click();
    await expect(page.getByText('Couldn’t download the QR. Long-press or right-click the QR to save it.')).toBeVisible();

    expect(await dataFetches()).toEqual([]);
    expect(errors).toEqual([]);
  });
}
