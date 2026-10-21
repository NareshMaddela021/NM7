// Draws public/og-image.png (1200×630, the link preview for nm7.si) from the home page headline.
// Run from frontend/: node scripts/home-images/og.mjs   (Playwright's Chromium; fonts from Google Fonts)
import { execFileSync } from 'node:child_process';
import { chromium } from 'playwright';

const html = `<!doctype html><html><head><meta charset="utf-8">
<link href="https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,700&family=Instrument+Sans:wght@500;600&display=block" rel="stylesheet">
<style>
  body { margin: 0; width: 1200px; height: 630px; background: #F7F6F2; font-family: 'Instrument Sans', sans-serif; color: #121316; position: relative; overflow: hidden; }
  .glow { position: absolute; inset: 0; background: radial-gradient(40% 60% at 88% 10%, #D9F45A99, transparent 70%), radial-gradient(35% 50% at 5% 0%, #2E46D833, transparent 70%); }
  .logo { position: absolute; left: 72px; top: 56px; font: 800 44px 'Bricolage Grotesque'; letter-spacing: -0.04em; }
  .logo mark { background: #D9F45A; padding: 0 6px; border-radius: 4px; }
  h1 { position: absolute; left: 72px; top: 150px; width: 760px; margin: 0; font: 700 64px/1.02 'Bricolage Grotesque'; letter-spacing: -0.035em; }
  .pills { position: absolute; left: 72px; bottom: 64px; display: flex; gap: 12px; }
  .pills span { font-size: 22px; font-weight: 600; padding: 10px 18px; border-radius: 999px; background: #fff; border: 1px solid #E2E0D8; }
  img { position: absolute; right: 64px; top: 70px; width: 300px; border-radius: 10px; box-shadow: 0 24px 60px rgba(0,0,0,.18); border: 1px solid #E2E0D8; }
</style></head><body><div class="glow"></div>
<div class="logo">Nm<mark>7</mark></div>
<h1>Resumes for every job seeker. Resume drives for every campus.</h1>
<div class="pills"><span>Free resume builder</span><span>8 Indian languages</span><span>For colleges &amp; job fairs</span></div>
<img src="IMG"></body></html>`;

const img = `data:image/webp;base64,${execFileSync('base64', ['-w0', 'public/home/hero-btech.webp']).toString()}`;
const args = process.env.HTTPS_PROXY ? [`--proxy-server=https=${process.env.HTTPS_PROXY.replace(/^https?:\/\//, '')}`] : [];
const browser = await chromium.launch({ executablePath: process.env.PW_CHROMIUM || undefined, args });
const page = await browser.newPage({ viewport: { width: 1200, height: 630 }, ignoreHTTPSErrors: true });
await page.setContent(html.replace('IMG', img), { waitUntil: 'networkidle' });
await page.evaluate(() => document.fonts.ready);
await page.screenshot({ path: 'public/og-image.png' });
await browser.close();
execFileSync(process.env.PYTHON || '../backend/.venv/bin/python', ['-c', "from PIL import Image; im=Image.open('public/og-image.png').convert('RGB'); im.save('public/og-image.png', optimize=True)"]);
console.log('public/og-image.png written');
