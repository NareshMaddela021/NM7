// "Write with AI" (Layer B) in the builder, signed in, with the server's Claude call mocked in the browser — and once
// against the real API, which has no key here, so the templates take over with a one-line notice. Desktop and 390px.
import { expect, test } from '@playwright/test';
import { PASSWORD, email, login, seed } from './helpers.mjs';

const GENERATE = '**/api/me/summary/generate';
const AI = {
  role_first: 'Data Analyst with a B.Tech in Computer Science and hands-on Python and SQL. Turns raw data into clear dashboards and reports. Looking for a data analyst role.',
  simple: 'Data Analyst who knows Python, SQL and Excel. Good at making data easy to understand. Wants a data analyst job.',
};
const json = (status, body) => ({ status, contentType: 'application/json', body: JSON.stringify(body) });

async function openSummaryStep(page) {
  const mail = email('ai');
  seed('customer', mail, 'Angelin Rao', PASSWORD);
  await login(page, mail);
  await page.waitForURL('**/me');
  await page.goto('/builder');
  await page.evaluate(() => window.history.replaceState({ usr: { open: 'build' }, key: 'x' }, ''));
  await page.reload();
  await expect(page.getByText(/Live preview ·/)).toBeVisible();
  await page.getByRole('navigation', { name: 'Sections' }).getByRole('button', { name: /^Summary/ }).click();
  await expect(page.getByLabel(/Tell us about yourself/)).toBeVisible();
}

for (const [label, size] of [['desktop', { width: 1280, height: 900 }], ['phone', { width: 390, height: 844 }]]) {
  test.describe(label, () => {
    test.use({ viewport: size });

    test('note → Write with AI → three cards (one slot from the templates) → pick → AI quick fix → edit → saved', async ({ page }) => {
      await openSummaryStep(page);
      const sent = [];
      let release;
      const held = new Promise((r) => { release = r; });
      await page.route(GENERATE, async (route) => {
        const body = route.request().postDataJSON();
        sent.push(body);
        if (body.mode === 'generate') await held; // keep the first call open so the Cancel button can be seen
        if (body.mode === 'shorter') return route.fulfill(json(200, { options: [{ style: 'simple', text: AI.simple }], dropped: 0, model: 'claude-haiku-5-5', fallback: false }));
        if (body.mode === 'professional') return route.fulfill(json(200, { options: [{ style: 'role_first', text: AI.role_first }], dropped: 0, model: 'claude-haiku-5-5', fallback: false }));
        // generate: two options; the server dropped the third (an invented number) → the browser fills it from the templates
        return route.fulfill(json(200, { options: [{ style: 'role_first', text: AI.role_first }, { style: 'simple', text: AI.simple }], dropped: 1, model: 'claude-haiku-5-5', fallback: false }));
      });
      const writer = page.getByTestId('summary-writer');
      await page.getByLabel(/Tell us about yourself/).fill('I completed BTech, I like working with data, I want a data analyst job');
      await writer.getByTestId('sw-ai').click();
      await expect(writer.getByTestId('sw-writing')).toContainText('Writing… (about 5 seconds)');
      await expect(writer.getByTestId('sw-cancel')).toBeVisible();
      release();
      const cards = writer.getByTestId('sw-cards');
      await expect(cards.getByRole('button', { name: /tap to use/ })).toHaveCount(3);
      await expect(writer.getByTestId('sw-writing')).toHaveCount(0);
      await expect(writer.getByTestId('sw-card-role_first')).toContainText(AI.role_first);
      await expect(writer.getByTestId('sw-card-role_first')).toContainText('Role-first · AI · tap to use');
      await expect(writer.getByTestId('sw-card-simple')).toContainText(AI.simple);
      await expect(writer.getByTestId('sw-card-skills_first')).toContainText('Skills-first · quick suggestion · tap to use');
      const skillsFirst = await writer.getByTestId('sw-card-skills_first').textContent();
      expect(skillsFirst).not.toMatch(/\bI\b|\bmy\b|\{|\[|undefined/);
      // what left the browser: the writer's facts and the note, nothing personal
      expect(sent).toHaveLength(1);
      expect(sent[0].mode).toBe('generate');
      expect(sent[0].note).toContain('I like working with data');
      const facts = JSON.stringify(sent[0].facts);
      for (const k of Object.keys(sent[0].facts)) expect(['degreeFull', 'eduYear', 'years', 'role', 'company', 'target', 'skills', 'strengths', 'cert', 'achievement', 'languages', 'persona']).toContain(k);
      for (const p of ['Angelin', '@', '98765', 'Guntur']) expect(facts).not.toContain(p);
      // pick the AI card; the AI quick fixes work on the box
      await writer.getByTestId('sw-card-role_first').click();
      const box = page.getByLabel('Your summary');
      await expect(box).toHaveValue(AI.role_first);
      await writer.getByTestId('sw-shorter').click();
      await expect(box).toHaveValue(AI.simple);
      expect(sent[1]).toMatchObject({ mode: 'shorter', current: AI.role_first });
      await writer.getByTestId('sw-professional').click();
      await expect(box).toHaveValue(AI.role_first);
      expect(sent[2]).toMatchObject({ mode: 'professional', current: AI.simple });
      await expect(writer.getByTestId('sw-simpler')).toBeVisible();
      if (label === 'phone') {
        for (const id of ['sw-ai', 'sw-shorter', 'sw-professional', 'sw-simpler', 'sw-again']) expect((await writer.getByTestId(id).boundingBox()).height).toBeGreaterThanOrEqual(44);
        expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
      }
      // edit by hand; the summary is printed, the note is not; both survive a reload
      await box.fill(`${AI.role_first} Available to start immediately.`);
      const preview = page.getByRole('article', { name: 'Resume preview' });
      await expect(preview).toContainText('Available to start immediately.');
      await expect(preview).not.toContainText('I like working with data');
      await expect(page.getByText('All changes saved')).toBeVisible({ timeout: 10_000 });
      await page.reload();
      await page.getByRole('navigation', { name: 'Sections' }).getByRole('button', { name: /^Summary/ }).click();
      await expect(page.getByLabel('Your summary')).toHaveValue(`${AI.role_first} Available to start immediately.`);
      await expect(page.getByLabel(/Tell us about yourself/)).toHaveValue('I completed BTech, I like working with data, I want a data analyst job');
    });
  });
}

test('Cancel stops the wait; AI off (the real API has no key) and AI busy fall back to the templates with a notice', async ({ page }) => {
  await openSummaryStep(page);
  const writer = page.getByTestId('summary-writer');
  // the real API: 503 feature_off → the template cards and "AI is busy, here are quick suggestions"
  await writer.getByTestId('sw-ai').click();
  await expect(writer.getByTestId('sw-notice')).toHaveText('AI is busy, here are quick suggestions');
  await expect(writer.getByTestId('sw-cards').getByRole('button', { name: /tap to use/ })).toHaveCount(3);
  await expect(writer.getByTestId('sw-card-role_first')).toContainText('Role-first · tap to use'); // plain template cards
  // a 429 from the daily limit says so
  await page.route(GENERATE, (route) => route.fulfill(json(429, { error: { code: 'rate_limited', message: 'You can use AI writing 10 times a day. Try again tomorrow.' } })));
  await writer.getByTestId('sw-ai').click();
  await expect(writer.getByTestId('sw-notice')).toHaveText('You can use AI writing 10 times a day. Try again tomorrow — here are quick suggestions');
  // a call that never answers can be cancelled; nothing changes
  await page.unroute(GENERATE);
  await page.route(GENERATE, () => new Promise(() => {}));
  await writer.getByTestId('sw-ai').click();
  await expect(writer.getByTestId('sw-cancel')).toBeVisible();
  await writer.getByTestId('sw-cancel').click();
  await expect(writer.getByTestId('sw-writing')).toHaveCount(0);
  await expect(writer.getByTestId('sw-ai')).toBeVisible();
  await expect(writer.getByTestId('sw-status')).toHaveText('Cancelled.');
});

test('a guest sees no Write with AI button; Make my summary still works', async ({ page }) => {
  await page.goto('/builder');
  await page.getByRole('button', { name: /Start from scratch/ }).click();
  await page.getByTestId('tp-use-top').click();
  await page.getByRole('navigation', { name: 'Sections' }).getByRole('button', { name: /^Summary/ }).click();
  const writer = page.getByTestId('summary-writer');
  await expect(writer.getByTestId('sw-make')).toBeVisible();
  await expect(writer.getByTestId('sw-ai')).toHaveCount(0);
  await writer.getByTestId('sw-make').click();
  await expect(writer.getByTestId('sw-cards').getByRole('button', { name: /tap to use/ })).toHaveCount(3);
  await expect(writer.getByTestId('sw-professional')).toHaveCount(0);
});
