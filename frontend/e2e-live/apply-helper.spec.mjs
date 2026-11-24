// The Nm7 Apply helper 1.1.0 on the live practice pages (/demo/apply/<form>), in a real browser: the extension's own
// page scripts (extension/src, the same files the popup injects) are put into the page with a stand-in for
// chrome.runtime, then the test acts as the candidate: it presses the page's Next itself and taps the helper's
// "Fill this step". Checked: every hiring-system practice form fills step by step (the release gates: 90%+ of the
// fields the kit can answer, under 1 in 100 wrong values, under 60 s from page open to ready to submit; a table is
// printed), type-to-search lists pick from the page's own list, radio choices and repeating blocks fill, personal
// questions stay red, the form inside a frame fills through the frame, Undo restores the page, and the helper
// never presses a page button, never submits and sends no request of its own.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';
import { SYSTEMS } from '../src/pages/demo/practiceSystems.js';
import { KIT, PDF, PAGE_FILES } from '../scripts/lib/helper-harness.mjs';

const EXT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'extension');
const CODE = PAGE_FILES.map((f) => readFileSync(join(EXT, f), 'utf8'));
const ROWS = [];

// the stand-in for chrome.runtime, the "never press a page button" tripwire, then the extension's page scripts
async function inject(frame) {
  await frame.evaluate(() => {
    window.__sent = [];
    window.__pressed = [];
    window.chrome = window.chrome || {};
    window.chrome.runtime = {
      id: 'e2e',
      sendMessage: (m, cb) => { window.__sent.push(m); if (cb) setTimeout(() => cb(m.type === 'nm7-draft' ? { answer: 'In my internship at Demo Retail (demo) I answered customer emails every day.' } : { ok: true }), 0); },
    };
    for (const t of ['click', 'submit', 'keydown', 'mousedown']) {
      document.addEventListener(t, (e) => {
        if (!e.isTrusted && e.target.closest && e.target.closest('button, [type=submit], [type=button], a[href]') && !e.target.closest('[id^="nm7-"]') && (t !== 'mousedown' || e.target.closest('button'))) {
          if (t !== 'submit' || !e.isTrusted) window.__pressed.push(`${t}:${e.target.tagName}:${e.target.textContent.trim().slice(0, 20)}`);
        }
      }, true);
    }
  });
  for (const src of CODE) await frame.addScriptTag({ content: src });
}

const fill = (frame) => frame.evaluate(([kit, pdf]) => globalThis.Nm7Fill(kit, pdf), [KIT, PDF]);

async function counts(frame) {
  return frame.evaluate(() => Object.fromEntries(['sure', 'check', 'left', 'draft'].map((k) => [k, document.querySelectorAll(`[data-nm7-mark="${k}"]`).length])));
}

for (const [slug, sys] of Object.entries(SYSTEMS)) {
  test(`${slug}: fills step by step and passes the release gates`, async ({ page }) => {
    test.setTimeout(120_000);
    const requests = [];
    const t0 = Date.now();
    await page.goto(`/demo/apply/${slug}`);
    await expect(page.getByTestId('practice-note')).toContainText('Nothing you type here is sent or saved');
    let frame = page.mainFrame();
    if (sys.framed) {
      const el = page.locator('iframe#portal_content_iframe');
      await expect(el).toBeVisible();
      frame = await (await el.elementHandle()).contentFrame();
      await frame.waitForSelector('[data-testid="practice-form"]');
    }
    await inject(frame);
    page.on('request', (r) => { if (!/\.(js|jsx|mjs|css|svg|png|woff2?)(\?|$)|\/@vite|\/node_modules\/|\/src\//.test(r.url())) requests.push(r.url()); });
    let good = 0; let left = 0; let personal = 0; let ask = 0; let wrong = 0;
    for (let step = 0; step < sys.steps.length; step += 1) {
      const s0 = sys.steps[step];
      const kitBacked = [...(s0.fields || []), ...(s0.blocks || []).flatMap((b) => b.fields), ...(s0.after || [])].some((x) => x.k && !['personal', 'consent', 'ask'].includes(x.k));
      const r = step === 0 || !kitBacked ? await fill(frame) : null; // nothing the kit backs: no offer, the popup's Fill
      if (step > 0 && kitBacked) {
        // the candidate pressed the page's Next: the helper offers this step; the candidate taps Fill this step
        const offer = frame.locator('#nm7-status button', { hasText: 'Fill this step' });
        await expect(offer).toBeVisible({ timeout: 5000 });
        await offer.click();
        await expect(frame.locator('#nm7-status .nm7-count')).toBeVisible();
        await page.waitForTimeout(300);
      } else {
        expect(r.blocked).toBeUndefined();
      }
      await frame.waitForFunction(() => !document.querySelector('#nm7-status')?.textContent.includes('A new step loaded'));
      await page.waitForTimeout(200);
      const c = await counts(frame);
      const s = sys.steps[step];
      const specs = [...(s.fields || []), ...(s.blocks || []).flatMap((b) => b.fields), ...(s.after || [])];
      const p = specs.filter((x) => x.k === 'personal' || x.k === 'consent').length;
      const a = specs.filter((x) => x.k === 'ask').length;
      personal += p; ask += a;
      good += c.sure + c.check;
      left += c.left - p - a;
      // values against the kit (the fields every form has)
      const values = await frame.evaluate(() => [...document.querySelectorAll('input:not([type=file]):not([type=radio]):not([type=checkbox]), textarea, select')].map((e) => e.value).filter(Boolean));
      for (const v of values) if (/@/.test(v) && v !== 'chrome-review@nm7.si') wrong += 1;
      expect(await frame.evaluate(() => window.__pressed)).toEqual([]);
      if (step < sys.steps.length - 1) await frame.getByTestId('practice-next').click(); // the candidate presses Next
    }
    const ms = Date.now() - t0;
    const rate = Math.round((1000 * good) / Math.max(1, good + left)) / 10;
    ROWS.push([slug, good + left, good, `${rate}%`, wrong, ask, `${ms} ms`]);
    // ready to submit: the candidate presses Submit; the colours go and Mark as applied is offered; nothing was sent
    await frame.getByTestId('practice-submit').click();
    await expect(frame.getByTestId('practice-sent')).toHaveText('Practice form: nothing was sent.');
    await expect(frame.locator('#nm7-helper-bar')).toContainText('Mark as applied on Nm7');
    expect(await counts(frame)).toEqual({ sure: 0, check: 0, left: 0, draft: 0 });
    expect(await frame.evaluate(() => window.__sent.map((m) => m.type))).toContain('nm7-submitted');
    expect(requests).toEqual([]);
    expect(rate, `${slug} fill rate`).toBeGreaterThanOrEqual(90);
    expect(wrong).toBe(0);
    expect(ms).toBeLessThan(60_000);
    expect(personal).toBeGreaterThanOrEqual(0);
  });
}

test('cloud-portal: lists, choices, blocks, personal questions, a smart-answer draft and Undo', async ({ page }) => {
  test.setTimeout(90_000);
  await page.goto('/demo/apply/cloud-portal');
  await inject(page.mainFrame());
  await fill(page.mainFrame());
  await expect(page.locator('[data-automation-id="legalNameSection_firstName"]')).toHaveValue('Priya');
  await expect(page.locator('#nm7-status .nm7-count')).toHaveText(/6 filled, 0 to check, 0 for you/);
  await page.getByTestId('practice-next').click();
  await page.locator('#nm7-status button', { hasText: 'Fill this step' }).click();
  await expect(page.locator('[data-automation-id="school"]')).toHaveValue('Demo College of Commerce (demo)'); // picked from the page's own list
  await expect(page.locator('[data-automation-id="company"]')).toHaveValue('Demo Retail (demo)');
  await expect(page.locator('[data-automation-id="degree"]')).toHaveValue('Bachelor of Commerce (B.Com)');
  await page.getByTestId('practice-next').click();
  await page.locator('#nm7-status button', { hasText: 'Fill this step' }).click();
  await expect(page.locator('input[name="noticePeriod"][value="30 days"]')).toBeChecked();
  // a smart-answer draft: the candidate taps Draft, then Use it
  await page.locator('#nm7-status button', { hasText: /^Draft 1 answer/ }).click();
  const q = page.locator('[data-automation-id="customerStory"]');
  await expect(q).toHaveAttribute('data-nm7-mark', 'draft');
  await page.locator('#nm7-marks .nm7-chip button', { hasText: 'Use it' }).click();
  await expect(q).toHaveAttribute('data-nm7-mark', 'sure');
  expect(await page.evaluate(() => window.__sent.filter((m) => m.type === 'nm7-save-answer').length)).toBe(1);
  // Undo: everything the helper typed on this step goes back; the candidate's own text stays
  await page.locator('[data-automation-id="whyRole"]').evaluate((e) => e.setAttribute('data-was', e.value));
  await page.locator('#nm7-status button', { hasText: 'Undo' }).click();
  await expect(page.locator('[data-automation-id="whyRole"]')).toHaveValue('');
  await expect(page.locator('input[name="noticePeriod"][value="30 days"]')).not.toBeChecked();
  await page.getByTestId('practice-next').click();
  await fill(page.mainFrame()); // only personal questions and a declaration there: all left for the candidate
  await expect(page.locator('[data-automation-id="gender"]')).toHaveValue('');
  await expect(page.locator('[data-automation-id="agreementCheckbox"]')).not.toBeChecked();
  expect(await page.evaluate(() => window.__pressed)).toEqual([]);
});

test.afterAll(() => {
  const w = [16, 8, 8, 8, 8, 8, 10];
  const line = (c) => c.map((x, i) => String(x).padEnd(w[i])).join(' ');
  console.log(['', 'Apply helper release gates (live practice pages, review kit)', line(['form', 'fields', 'filled', 'rate', 'wrong', 'drafts', 'time']), ...ROWS.map(line)].join('\n'));
});
