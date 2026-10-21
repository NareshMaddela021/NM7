// Draws the home page's sample resumes and template thumbnails with the real templates and saves them as WebP in
// public/home/ (each under 38 KB, inside the 40 KB budget). Run from frontend/: node scripts/home-images/make.mjs   (needs Playwright's Chromium
// and Python with Pillow, e.g. the backend's .venv)
import { spawn, execFileSync } from 'node:child_process';
import { mkdirSync, statSync, writeFileSync } from 'node:fs';
import { chromium } from 'playwright';
import { IMAGES } from './samples.mjs';
import { TEMPLATE_PRESETS } from '../../src/pages/builder/design.js';

const PORT = 5199;
const OUT = 'public/home';
const PY = process.env.PYTHON || '../backend/.venv/bin/python';
mkdirSync(OUT, { recursive: true });
const dev = spawn('npx', ['vite', '--port', String(PORT), '--strictPort'], { stdio: 'ignore', detached: true });
await new Promise((r) => setTimeout(r, 4000));
const browser = await chromium.launch({ executablePath: process.env.PW_CHROMIUM || undefined });
const page = await browser.newPage({ viewport: { width: 700, height: 1000 }, deviceScaleFactor: 2 });

async function shot(query, name, cssWidth, crop = 1) {
  await page.goto(`http://localhost:${PORT}/scripts/home-images/harness.html?${query}`);
  await page.waitForFunction(() => window.__ready, null, { timeout: 30000 });
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(400);
  const el = page.locator('#shot');
  const box = await el.boundingBox();
  const png = `/tmp/nm7-${name}.png`;
  await page.screenshot({ path: png, clip: { x: box.x, y: box.y, width: 595, height: Math.round(842 * crop) } });
  const out = `${OUT}/${name}.webp`;
  // 2x the displayed width for sharp text on phones; quality stepped down until the file is under 40 KB
  execFileSync(PY, ['-c', `
import sys
from PIL import Image
src, out, w = sys.argv[1], sys.argv[2], int(sys.argv[3])
im = Image.open(src).convert('RGB')
im = im.resize((w, round(im.height * w / im.width)), Image.LANCZOS)
for q in (80, 72, 64, 56, 48, 40):
    im.save(out, 'WEBP', quality=q, method=6)
    import os
    if os.path.getsize(out) < 38 * 1024: break
`, png, out, String(cssWidth * 2)]);
  return [out, (statSync(out).size / 1024).toFixed(1)];
}

const sizes = [];
for (const [name, sample, w] of IMAGES) sizes.push(await shot(`sample=${sample}`, name, w));
for (const k of ['before', 'after']) sizes.push(await shot(`demo=${k}`, `expert-${k}`, 300));
for (const k of Object.keys(TEMPLATE_PRESETS)) sizes.push(await shot(`tpl=${k}`, `tpl-${k}`, 200));
writeFileSync(`${OUT}/README.txt`, 'Made by scripts/home-images/make.mjs from scripts/home-images/samples.mjs (invented people). Re-run it after a template changes.\n');
await browser.close();
process.kill(-dev.pid); // the dev server and its children
for (const [f, kb] of sizes) console.log(kb.padStart(6), 'KB', f);
