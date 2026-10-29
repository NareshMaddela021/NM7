// Bold words in resume text, on a desktop and a 390 px phone (touch): the text box shows the words without "**" and
// draws the bold ones bold (the saved value keeps the markers); the B button above the summary and the
// experience bullets bolds the selected words and unbolds them again, Ctrl+B does the same, the preview shows it at
// once, pasting from Word or a website keeps text + bold only, and a mostly-bold bullet gets a gentle tip. The PDF and
// Word downloads print the words bold and never a "**"; the org Shared resumes view, combined PDF and CSV neither.
import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { strFromU8, unzipSync } from 'fflate';
import { API, PASSWORD, adminLogin, apiMember, email, login, pdfText, seed, downloadThrough } from './helpers.mjs';

const SIZES = [['desktop', { viewport: { width: 1280, height: 900 } }], ['phone', { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true }]];
const preview = (page) => page.getByRole('article', { name: 'Resume preview' });
const api = (page, path, init = {}) => page.evaluate(async ([base, p, i]) => {
  const r = await fetch(`${base}${p}`, { credentials: 'include', headers: { 'Content-Type': 'application/json' }, ...i });
  if (!r.ok) throw new Error(`${r.status} ${await r.text()}`);
  return r.status === 204 ? null : r.json();
}, [API, path, init]);
async function saved(page, click) {
  const [file] = await downloadThrough(page, () => click(), { timeout: 30_000 });
  return readFileSync(await file.path());
}
/** The bold words the box shows (drawn behind its text). */
const boldShown = (page, id) => page.getByTestId(`${id}-shown`).locator('[data-bold]').allTextContents();
/** What was saved for the active resume. */
const savedData = async (page) => (await api(page, '/api/me/resumes')).find((r) => r.active).data;
/** Selects `word` inside a textarea (what a mouse drag or a phone's long-press does). */
const select = (box, word) => box.evaluate((el, w) => { const i = el.value.indexOf(w); el.focus(); el.setSelectionRange(i, i + w.length); el.dispatchEvent(new Event('select', { bubbles: true })); }, word);
/** Pastes clipboard HTML (as Word / Google Docs / a website put it there) into a textarea. */
const pasteHtml = (box, html, text) => box.evaluate((el, [h, t]) => {
  el.focus(); el.setSelectionRange(el.value.length, el.value.length);
  const dt = new DataTransfer(); dt.setData('text/html', h); dt.setData('text/plain', t);
  el.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
}, [html, text]);

const RESUME = (name, mail) => ({
  personal: { name, email: mail, phone: '+91 98765 43210', headline: 'Data Analyst', location: 'Hyderabad', level: 'Fresher (0–1 yr)' },
  summary: 'Data analyst who turns raw sales data into weekly dashboards.',
  exp: [{ company: 'Northwind Retail', role: 'Data Analyst Intern', employmentType: 'Internship', from: '2025-01', to: '2025-07', current: false, description: 'Built dashboards in Power BI for the sales team\nCleaned CSV files in Python every week', links: [] }],
  edu: [{ institution: 'Osmania University', degree: 'B.Com', field: '', from: '2021-06', to: '2024-05', current: false, grade: '' }],
  skillGroups: [{ id: 'core', label: 'Skills', value: 'Excel, SQL, Power BI, Python' }],
  proj: [], certs: [], ach: [], custom: [], langs: [], hobbies: '', strengths: '', pinfo: {}, links: {}, hidden: {}, titles: {}, showPhoto: false,
});

for (const [label, opts] of SIZES) {
  test.describe(label, () => {
    test.use(opts);

    test('B button, Ctrl+B, paste cleaning and the tip; PDF and Word print bold and never "**"', async ({ page }) => {
      const mail = email(`bold-${label}`);
      seed('customer', mail, 'Lakshmi Prasanna', PASSWORD);
      await login(page, mail);
      await page.waitForURL('**/me');
      const cur = await api(page, '/api/me/resumes');
      if (cur.length) await api(page, `/api/me/resumes/${cur[0].id}`, { method: 'PATCH', body: JSON.stringify({ data: RESUME('Lakshmi Prasanna', mail) }) });
      else await api(page, '/api/me/resumes', { method: 'POST', body: JSON.stringify({ id: `r${Date.now()}`, name: 'Main', data: RESUME('Lakshmi Prasanna', mail), active: true }) });
      await page.goto('/builder');
      await page.evaluate(() => window.history.replaceState({ usr: { open: 'build' }, key: 'x' }, ''));
      await page.reload();
      await expect(page.getByTestId('save-status')).toHaveText('All changes saved', { timeout: 15_000 });
      const tap = (loc) => (label === 'phone' ? loc.tap() : loc.click());

      // experience bullets: select "Power BI", B → bold (preview at once), B again → plain
      await tap(page.getByRole('navigation', { name: 'Sections' }).getByRole('button', { name: /^Experience/ }));
      const box = page.locator('#exp-0-description');
      const B = page.getByTestId('exp-0-description-bold');
      await expect(page.getByRole('toolbar', { name: 'Formatting' }).first()).toBeVisible();
      await select(box, 'Power BI');
      await tap(B);
      // the box shows the words, never the markers; "Power BI" is drawn bold behind them
      await expect(box).toHaveValue('Built dashboards in Power BI for the sales team\nCleaned CSV files in Python every week');
      await expect.poll(() => boldShown(page, 'exp-0-description')).toEqual(['Power BI']);
      await expect(page.getByTestId('exp-0-description-shown')).toHaveText('Built dashboards in Power BI for the sales team\nCleaned CSV files in Python every week\u200b');
      await expect(preview(page).locator('strong', { hasText: /^Power BI$/ })).toHaveCount(1);
      // the same words stay selected, so a second tap unbolds them
      expect(await box.evaluate((el) => el.value.slice(el.selectionStart, el.selectionEnd))).toBe('Power BI');
      await tap(B);
      await expect(box).toHaveValue('Built dashboards in Power BI for the sales team\nCleaned CSV files in Python every week');
      await expect.poll(() => boldShown(page, 'exp-0-description')).toEqual([]);
      await expect(preview(page).locator('strong', { hasText: /^Power BI$/ })).toHaveCount(0);

      // Ctrl+B (Cmd+B on a Mac) toggles too
      await select(box, 'Python');
      await page.keyboard.press('Control+b');
      await expect.poll(() => boldShown(page, 'exp-0-description')).toEqual(['Python']);
      await expect(preview(page).locator('strong', { hasText: /^Python$/ })).toHaveCount(1);
      await select(box, 'Power BI');
      await page.keyboard.press('Meta+b');
      await expect.poll(() => boldShown(page, 'exp-0-description')).toEqual(['Power BI', 'Python']);

      // a mostly-bold bullet: the gentle tip
      await expect(page.getByTestId('exp-0-description-bold-tip')).toHaveCount(0);
      await select(box, 'Built dashboards in Power BI for the sales');
      await tap(B);
      await expect(page.getByTestId('exp-0-description-bold-tip')).toHaveText('Bold a few key words, like results and tools.');
      await tap(B); // all bold → plain again
      await expect(page.getByTestId('exp-0-description-bold-tip')).toHaveCount(0);
      await select(box, 'Power BI');
      await tap(B);
      await expect.poll(() => boldShown(page, 'exp-0-description')).toEqual(['Power BI', 'Python']);
      await expect(box).not.toHaveValue(/\*\*/);
      // typing next to a bold word types plain letters; typing inside it stays bold
      await box.evaluate((el) => { const i = el.value.indexOf(' for the sales'); el.focus(); el.setSelectionRange(i, i); });
      await page.keyboard.type(' (weekly)');
      await expect.poll(() => boldShown(page, 'exp-0-description')).toEqual(['Power BI', 'Python']);
      await box.evaluate((el) => { const i = el.value.indexOf('Power BI') + 5; el.focus(); el.setSelectionRange(i, i); });
      await page.keyboard.type('X');
      await expect.poll(() => boldShown(page, 'exp-0-description')).toEqual(['PowerX BI', 'Python']);
      await page.keyboard.press('Backspace');
      await expect.poll(async () => (await savedData(page)).exp[0].description, { timeout: 15_000 })
        .toBe('Built dashboards in **Power BI** (weekly) for the sales team\nCleaned CSV files in **Python** every week');
      // the layer behind the text wraps exactly like the text (same height, same lines)
      const fit = await box.evaluate((el) => { const m = document.querySelector('[data-testid="exp-0-description-shown"]'); return [el.scrollHeight, m.scrollHeight, el.clientWidth, m.clientWidth]; });
      expect(Math.abs(fit[0] - fit[1])).toBeLessThanOrEqual(2);

      // the summary: pasting from Word / a website keeps text + bold only
      await tap(page.getByRole('navigation', { name: 'Sections' }).getByRole('button', { name: /^Summary/ }));
      const sum = page.locator('#sum');
      await sum.fill('Data analyst.');
      await pasteHtml(sum, '<meta charset="utf-8"><b style="font-weight:normal" id="docs-internal-guid-1"><p><span style="font-weight:700;color:#c00">Reduced</span> <i>reporting</i> time by <strong>40%</strong> with <a href="https://x.example">SQL</a></p></b><script>alert(1)</script><style>p{color:red}</style>', ' Reduced reporting time by 40% with SQL');
      await expect(sum).toHaveValue('Data analyst.Reduced reporting time by 40% with SQL');
      await expect.poll(() => boldShown(page, 'sum')).toEqual(['Reduced', '40%']);
      await expect(preview(page).locator('strong', { hasText: /^40%$/ })).toHaveCount(1);
      await expect(preview(page)).not.toContainText('**');
      await expect(preview(page)).not.toContainText('alert');
      await select(sum, 'analyst');
      await page.keyboard.press('Control+b');
      await expect.poll(() => boldShown(page, 'sum')).toEqual(['analyst', 'Reduced', '40%']);
      // plain text with **markers** pasted (or typed): bold, and the markers never show
      await pasteHtml(sum, '', ' Fluent in **Telugu**');
      await expect(sum).toHaveValue('Data analyst.Reduced reporting time by 40% with SQL Fluent in Telugu');
      await expect.poll(() => boldShown(page, 'sum')).toEqual(['analyst', 'Reduced', '40%', 'Telugu']);
      await sum.evaluate((el) => { el.focus(); el.setSelectionRange(el.value.length, el.value.length); });
      await page.keyboard.type(' and **Hindi');
      await expect(sum).toHaveValue(/ and \*\*Hindi$/); // a lone ** stays as typed until it pairs up
      await page.keyboard.type('**');
      await expect(sum).toHaveValue('Data analyst.Reduced reporting time by 40% with SQL Fluent in Telugu and Hindi');
      await expect.poll(() => boldShown(page, 'sum')).toEqual(['analyst', 'Reduced', '40%', 'Telugu', 'Hindi']);
      await expect(preview(page)).not.toContainText('**');
      await expect(page.getByTestId('save-status')).toHaveText('All changes saved', { timeout: 15_000 });

      // PDF: the words, never a marker
      const pdf = (await pdfText(await saved(page, () => page.getByRole('button', { name: 'Download PDF' }).first().click()))).join(' ');
      expect(pdf).toContain('Power BI');
      expect(pdf).toMatch(/reporting\s+time\s+by\s+40%/);
      expect(pdf).not.toContain('**');
      // Word: bold runs, never a marker
      const xml = strFromU8(unzipSync(new Uint8Array(await saved(page, () => page.getByRole('button', { name: /Word/ }).first().click())))['word/document.xml']);
      expect(xml).not.toContain('**');
      for (const w of ['Power BI', 'Python', '40%', 'Reduced', 'analyst', 'Telugu', 'Hindi']) expect(xml).toMatch(new RegExp(`<w:b/>(?:(?!</w:rPr>).)*</w:rPr><w:t xml:space="preserve">${w}</w:t>`));
      expect(xml).toMatch(/<w:rPr>(?:(?!<w:b\/>)(?!<\/w:rPr>).)*<\/w:rPr><w:t xml:space="preserve"> \(weekly\) for the sales team<\/w:t>/); // typed after a bold word: plain
      // what was saved keeps the markers (text + bold only)
      const saved1 = (await api(page, '/api/me/resumes')).find((r) => r.active);
      expect(saved1.data.summary).toBe('Data **analyst**.**Reduced** reporting time by **40%** with SQL Fluent in **Telugu** and **Hindi**');
    });
  });
}

for (const [label, opts] of SIZES) {
  test.describe(label, () => {
    test.use(opts);

    test('an older resume saved with **markers** opens with plain words in the box, bold drawn, nothing stray', async ({ page }) => {
      const mail = email(`bold-old-${label}`);
      seed('customer', mail, 'Old Marker', PASSWORD);
      await login(page, mail);
      await page.waitForURL('**/me');
      const data = RESUME('Old Marker', mail);
      data.summary = 'Analyst who cut report time by **40%** with **SQL**. A stray ** marker.';
      data.exp[0].description = 'Built dashboards in **Power BI** for the sales team\nCleaned CSV files in Python every week';
      const cur = await api(page, '/api/me/resumes');
      if (cur.length) await api(page, `/api/me/resumes/${cur[0].id}`, { method: 'PATCH', body: JSON.stringify({ data }) });
      else await api(page, '/api/me/resumes', { method: 'POST', body: JSON.stringify({ id: `r${Date.now()}`, name: 'Main', data, active: true }) });
      await page.goto('/builder');
      await page.evaluate(() => window.history.replaceState({ usr: { open: 'build' }, key: 'x' }, ''));
      await page.reload();
      await expect(page.getByTestId('save-status')).toHaveText('All changes saved', { timeout: 15_000 });
      const sum = page.locator('#sum');
      await page.getByRole('navigation', { name: 'Sections' }).getByRole('button', { name: /^Summary/ }).click();
      await expect(sum).toHaveValue('Analyst who cut report time by 40% with SQL. A stray marker.');
      await expect.poll(() => boldShown(page, 'sum')).toEqual(['40%', 'SQL']);
      // what you copy out of the box is the words, without markers
      expect(await sum.evaluate((el) => { el.focus(); el.select(); return el.value.slice(el.selectionStart, el.selectionEnd); })).not.toContain('*');
      await expect(preview(page)).not.toContainText('**');
      await expect(preview(page).locator('strong', { hasText: /^SQL$/ })).toHaveCount(1);
      await page.getByRole('navigation', { name: 'Sections' }).getByRole('button', { name: /^Experience/ }).click();
      await expect(page.locator('#exp-0-description')).toHaveValue('Built dashboards in Power BI for the sales team\nCleaned CSV files in Python every week');
      await expect.poll(() => boldShown(page, 'exp-0-description')).toEqual(['Power BI']);
      // opening it changes nothing that was saved (apart from the stray marker, which never printed)
      await page.getByRole('navigation', { name: 'Sections' }).getByRole('button', { name: /^Summary/ }).click();
      await sum.focus();
      await sum.blur();
      await expect(page.getByTestId('save-status')).toHaveText('All changes saved', { timeout: 15_000 });
      const back = await savedData(page);
      expect(back.exp[0].description).toBe(data.exp[0].description);
      expect(back.summary.replace(/ \*\* /, ' ')).toMatch(/\*\*40%\*\* with \*\*SQL\*\*\. A stray (\*\* )?marker\./);
    });
  });
}

test('the org Shared resumes view, combined PDF and CSV show bold words and never "**"', async ({ page, playwright }) => {
  const owner = email('bold-owner');
  const { secret } = seed('admin', owner, 'owner', PASSWORD);
  const code = `BD${Date.now().toString(36).slice(-6).toUpperCase()}`;
  await adminLogin(page, owner, secret);
  await page.getByRole('navigation', { name: 'Admin sections' }).getByRole('link', { name: 'Organizations' }).click();
  const newOrg = page.getByRole('form', { name: 'New organization' });
  await newOrg.getByLabel('Organization name').fill('Bold College');
  await newOrg.getByRole('button', { name: 'Add organization' }).click();
  await page.getByRole('button', { name: 'New group' }).click();
  const form = page.getByRole('form', { name: 'New group' });
  await form.getByLabel('Group name').fill('Placements 2026');
  await form.getByLabel('Join code').fill(code);
  await form.getByRole('button', { name: 'Save group' }).click();
  await expect(page.getByRole('region', { name: 'Group Placements 2026' })).toBeVisible();

  const mail = email('bold-member');
  const data = RESUME('**Ravi** Kumar', mail); // a marker typed in the name is just left out
  data.summary = 'Analyst who cut report time by **40%** with **SQL**.';
  data.exp[0].description = 'Built dashboards in **Power BI** for the sales team\nA stray ** marker';
  await apiMember(playwright, mail, 'Ravi Kumar', code, {}, data);

  await page.getByRole('navigation', { name: 'Admin sections' }).getByRole('link', { name: 'Shared resumes' }).click();
  const row = page.getByRole('table', { name: 'Shared resumes' }).getByRole('row').filter({ hasText: 'Ravi Kumar' });
  await expect(row).toBeVisible();
  await expect(row).not.toContainText('**');
  await row.getByRole('button', { name: 'View' }).click();
  const dlg = page.getByRole('dialog', { name: /Ravi Kumar/ });
  const view = dlg.getByRole('article', { name: 'Resume preview' });
  await expect(view.locator('strong', { hasText: /^Power BI$/ })).toHaveCount(1);
  await expect(view.locator('strong', { hasText: /^40%$/ })).toHaveCount(1);
  await expect(view).toContainText('A stray marker');
  await expect(view).not.toContainText('**');
  await dlg.getByRole('button', { name: /Close/ }).first().click();

  const pdf = (await pdfText(await saved(page, () => page.getByRole('button', { name: 'Combined PDF' }).click()))).join(' ');
  expect(pdf).toContain('Ravi Kumar');
  expect(pdf).toContain('Power BI');
  expect(pdf).not.toContain('**');
  const csv = (await saved(page, () => page.getByRole('button', { name: 'CSV' }).click())).toString('utf8');
  expect(csv).toContain(`Ravi Kumar,${mail}`);
  expect(csv).not.toContain('**');
});
