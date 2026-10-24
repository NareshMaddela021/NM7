// A checkbox toggles only from the box or its own text, never from empty space in its row (Naresh's report: a click
// far to the right of "I currently work here" ticked it). Desktop and a 390 px phone:
//   builder: I currently work here (still clears To and prints Present), I'm currently studying here, Mention my
//            course, Show my photo on the resume too
//   sign-up "I agree", sign-in "Show password", the drive join form consent, and the admin Shared resumes filters
// For each: a click in the empty space to the right does nothing; a click on the box or the text toggles; Tab to it
// and Space toggles. Every page visited also has no checkbox label wider than its content (one shared CSS rule).
import { expect, test } from '@playwright/test';
import { API, PASSWORD, adminLogin, asTestPerson, seed } from './helpers.mjs';

const SIZES = [['desktop', { width: 1280, height: 900 }], ['phone', { width: 390, height: 844 }]];
const nav = (page) => page.getByRole('navigation', { name: 'Sections' });
const live = (page) => page.getByRole('region', { name: 'Live resume preview' });

/** Clicks in the row beside the label (to its right, inside the row's own box); returns false if there is no room. */
async function strayClick(page, box) {
  const at = await box.evaluate((el) => {
    const label = el.closest('label');
    const lb = label.getBoundingClientRect();
    // the nearest ancestor that is wider than the label: the row the label sits in
    let row = label.parentElement;
    while (row && row.getBoundingClientRect().right - lb.right < 24) row = row.parentElement;
    if (!row) return null;
    const right = Math.min(row.getBoundingClientRect().right, window.innerWidth) - 6;
    if (right - lb.right < 16) return null;
    const y = Math.round(lb.top + lb.height / 2);
    // the nearest empty point: not the label, and not another control
    for (let x = Math.round(lb.right) + 10; x < right; x += 12) {
      const hit = document.elementFromPoint(x, y);
      if (hit && !label.contains(hit) && !hit.closest('label, button, a, input, select, textarea')) return { x, y };
    }
    return null;
  });
  if (!at) return false;
  await page.mouse.click(at.x, at.y);
  return true;
}
/** Empty space does nothing; the box and the text toggle; Space toggles. Ends in its starting state. */
async function checkHitArea(page, box, text, { longText = false } = {}) {
  await box.scrollIntoViewIfNeeded();
  const start = await box.isChecked();
  const room = await strayClick(page, box);
  if (!longText) expect(room, 'there is empty space to the right of the label').toBe(true); // a long text may fill the row
  await page.waitForTimeout(100);
  expect(await box.isChecked()).toBe(start);
  // the label is no wider than the box and its text
  const fits = await box.evaluate((el) => {
    const label = el.closest('label');
    const range = document.createRange();
    range.selectNodeContents(label);
    return label.getBoundingClientRect().width <= range.getBoundingClientRect().width + 8;
  });
  expect(fits, 'label width = box + text').toBe(true);
  await box.click();
  await expect(box).toBeChecked({ checked: !start });
  await text.click();
  await expect(box).toBeChecked({ checked: start });
  await box.focus();
  await page.keyboard.press('Space');
  await expect(box).toBeChecked({ checked: !start });
  await page.keyboard.press('Space');
  await expect(box).toBeChecked({ checked: start });
}
/** No label around a checkbox is wider than its content (bordered .option tiles are whole cards on purpose). */
async function noWideLabels(page) {
  const wide = await page.evaluate(() => [...document.querySelectorAll('label')]
    .filter((l) => l.querySelector(':scope > input[type="checkbox"]') && !l.classList.contains('option') && l.offsetParent)
    .filter((l) => {
      const r = document.createRange();
      r.selectNodeContents(l);
      return l.getBoundingClientRect().width > r.getBoundingClientRect().width + 8;
    })
    .map((l) => l.textContent.trim().slice(0, 40)));
  expect(wide).toEqual([]);
}

for (const [label, size] of SIZES) {
  test.describe(label, () => {
    test.use({ viewport: size });

    test('builder checkboxes: only the box and its text toggle; I currently work here still prints Present', async ({ page }) => {
      await asTestPerson(page);
      await page.goto('/builder');
      await page.evaluate(() => window.history.replaceState({ usr: { open: 'build' }, key: 'x' }, ''));
      await page.reload();
      await expect(page.getByText(/Live preview ·/)).toBeVisible();

      // Personal Info: Show my photo on the resume too
      const photo = page.getByRole('checkbox', { name: 'Show my photo on the resume too' });
      await checkHitArea(page, photo, page.getByText('Show my photo on the resume too', { exact: true }));
      await noWideLabels(page);

      // Experience: I currently work here
      await nav(page).getByRole('button', { name: /^Experience/ }).click();
      const work = page.getByRole('checkbox', { name: 'I currently work here' }).first();
      await expect(work).not.toBeChecked();
      await checkHitArea(page, work, page.getByText('I currently work here', { exact: true }).first());
      await noWideLabels(page);
      await work.check();
      await expect(live(page)).toContainText('Present');

      // Education: I'm currently studying here
      await nav(page).getByRole('button', { name: /^Education/ }).click();
      const study = page.getByRole('checkbox', { name: 'I’m currently studying here' }).first();
      await checkHitArea(page, study, page.getByText('I’m currently studying here', { exact: true }).first());

      // Summary: Mention my course
      await nav(page).getByRole('button', { name: /^Summary/ }).click();
      const course = page.getByRole('checkbox', { name: 'Mention my course' });
      await checkHitArea(page, course, page.getByText('Mention my course', { exact: true }));
      await noWideLabels(page);
    });

    test('sign-up, sign-in and the drive join form consent', async ({ page, browser }) => {
      await page.goto('/signup');
      const agree = page.getByRole('checkbox', { name: /I agree/ });
      await checkHitArea(page, agree, page.getByText(/^I agree/), { longText: true });
      await noWideLabels(page);
      await page.goto('/login');
      const show = page.getByRole('checkbox', { name: 'Show password' });
      await checkHitArea(page, show, page.getByText('Show password', { exact: true }));

      // a drive's join page
      const ctx = await browser.newContext();
      const admin = await ctx.newPage();
      const owner = `owner-cb-${label}-${Date.now()}@nm7.si`;
      const { secret } = seed('admin', owner, 'owner', PASSWORD);
      await adminLogin(admin, owner, secret);
      await expect(admin).not.toHaveURL(/\/login/);
      const post = (path, body) => admin.evaluate(async ([base, p, b]) => {
        const r = await fetch(`${base}${p}`, { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b) });
        if (!r.ok) throw new Error(`${p}: ${r.status} ${await r.text()}`);
        return r.json();
      }, [API, path, body]);
      const org = await post('/api/admin/orgs', { name: 'Govt ITI Kurnool', type: 'college', city: 'Kurnool' });
      const code = `CB${Date.now().toString(36).slice(-6).toUpperCase()}`;
      await post(`/api/admin/orgs/${org.id}/groups`, { name: 'Job fair 2026', code });

      // the admin's Shared resumes filters
      await admin.goto('/admin/shared-resumes');
      for (const name of ['Incomplete only', 'Not printed yet']) {
        await checkHitArea(admin, admin.getByRole('checkbox', { name }), admin.getByText(name, { exact: true }));
      }
      await noWideLabels(admin);
      await ctx.close();

      await page.goto(`/join/${code}`);
      const consent = page.getByRole('checkbox', { name: /My resume will be shared/ });
      await checkHitArea(page, consent, page.getByText(/My resume will be shared/).first(), { longText: true });
      await noWideLabels(page);
    });
  });
}
