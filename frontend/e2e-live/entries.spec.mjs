// Builder entry controls (move up/down, on/off, remove) in every kind of section, against the real API:
// the preview, the downloaded PDF and Word file, the public share link, a reload and another sign-in.
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { expect, test } from '@playwright/test';
import { unzipSync, strFromU8 } from 'fflate';
import { API, PASSWORD, email, login, seed } from './helpers.mjs';

const require = createRequire(import.meta.url);

// [list key, sidebar name, entry name, first entry text, second entry text]
const SECTIONS = [
  ['edu', 'Education', 'Education', 'Alpha University', 'Beta College'],
  ['exp', 'Experience', 'Experience', 'Acme Corp', 'Bolt Labs'],
  ['proj', 'Projects', 'Project', 'Apollo Tracker', 'Borealis App'],
  ['certs', 'Certifications', 'Certification', 'Aster Cloud Badge', 'Brightcove Basics'],
  ['ach', 'Achievements', 'Achievement', 'Aster Hackathon Winner', 'Bronze Medal Olympiad'],
  ['langs', 'Languages', 'Language', 'Assamese', 'Bengali'],
  ['c_extra', 'Extracurricular Activities', 'Extracurricular Activities', 'Astronomy Club', 'Basketball Captain'],
  ['hobbies', 'Hobbies', 'Hobby', 'Archery', 'Badminton'],
  ['strengths', 'Strengths', 'Strength', 'Analytical thinking', 'Bold decisions'],
  ['skills', 'Skills', 'Skills category', 'Ansible', 'Bazel'],
  ['links', 'Links', 'Link', 'AsterLink', 'BlueLink'],
];
// at the end these sections have their (moved-down) first entry switched off
const HIDE_AT_END = ['edu', 'c_extra', 'hobbies', 'skills'];

const RESUME = {
  personal: { name: 'Meera Nair', headline: 'Data Analyst', email: 'meera@example.com', phone: '+91 99999 11111', location: 'Kochi', level: 'Junior (1–3 yrs)' },
  summary: 'Analyst who builds dashboards people use every week.',
  edu: [{ institution: 'Alpha University', degree: 'B.Tech', field: 'CSE' }, { institution: 'Beta College', degree: 'Class 12', field: 'CBSE' }],
  exp: [{ company: 'Acme Corp', role: 'Analyst', description: 'Built 12 dashboards' }, { company: 'Bolt Labs', role: 'Intern', description: 'Cleaned data' }],
  proj: [{ title: 'Apollo Tracker', description: 'Tracks launches' }, { title: 'Borealis App', description: 'Aurora alerts' }],
  certs: [{ name: 'Aster Cloud Badge', issuer: 'Aster' }, { name: 'Brightcove Basics', issuer: 'Brightcove' }],
  ach: [{ title: 'Aster Hackathon Winner' }, { title: 'Bronze Medal Olympiad' }],
  langs: [{ name: 'Assamese', level: 'Native' }, { name: 'Bengali', level: 'Fluent' }],
  custom: [{ id: 'c_extra', title: 'Extracurricular Activities', items: [{ title: 'Astronomy Club' }, { title: 'Basketball Captain' }] }],
  hobbies: 'Archery\nBadminton',
  strengths: 'Analytical thinking\nBold decisions',
  skillGroups: [{ id: 'core', label: 'Core', value: 'Ansible' }, { id: 'g2', label: 'More', value: 'Bazel' }],
  linkExtras: [{ url: 'example.com/aster', label: 'AsterLink', icon: 'auto' }, { url: 'example.com/blue', label: 'BlueLink', icon: 'auto' }],
  links: { linkedin: '', github: '', portfolio: '', twitter: '', stackoverflow: '', medium: '', resume: '' },
  hidden: {},
  order: null,
};

const api = (page, path, opts = {}) => page.evaluate(async ([base, p, o]) => {
  const r = await fetch(`${base}${p}`, { credentials: 'include', ...o, headers: o.body ? { 'Content-Type': 'application/json' } : undefined });
  return r.status === 204 ? null : r.json();
}, [API, path, opts]);

async function signInWithResume(page) {
  const mail = email('entries');
  seed('customer', mail, 'Meera Nair', PASSWORD);
  await login(page, mail);
  await page.waitForURL('**/me');
  await expect.poll(async () => (await api(page, '/api/me/resumes')).length).toBe(1);
  const [r] = await api(page, '/api/me/resumes');
  await api(page, `/api/me/resumes/${r.id}`, { method: 'PATCH', body: JSON.stringify({ data: RESUME }) });
  return { mail, resumeId: r.id };
}

async function openBuilder(page) {
  await page.goto('/builder');
  await page.evaluate(() => window.history.replaceState({ usr: { open: 'build' }, key: 'x' }, ''));
  await page.reload();
  await expect(page.getByRole('article', { name: 'Resume preview' })).toContainText('Meera Nair');
}
const preview = (page) => page.getByRole('article', { name: 'Resume preview' });
const goTo = (page, side) => page.getByRole('button', { name: new RegExp(`^.?\\s*${side}( · \\d+ hidden)?`) }).first().click();

async function pdfText(path) {
  const pdfjs = require('pdfjs-dist/legacy/build/pdf.js');
  const doc = await pdfjs.getDocument({ data: new Uint8Array(readFileSync(path)), isEvalSupported: false, verbosity: 0 }).promise;
  let out = '';
  for (let i = 1; i <= doc.numPages; i++) out += (await (await doc.getPage(i)).getTextContent()).items.map((x) => x.str).join(' ') + '\n';
  return out;
}
const docxText = (path) => strFromU8(unzipSync(new Uint8Array(readFileSync(path)))['word/document.xml']).replace(/<[^>]+>/g, ' ');

async function download(page, name) {
  const [file] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name }).first().click()]);
  return file.path();
}

/** Checks the printed text: second entry before the first, and hidden first entries left out. */
function checkPrinted(text, where) {
  for (const [key, , , a, b] of SECTIONS) {
    if (HIDE_AT_END.includes(key)) {
      expect(text, `${where}: ${a} hidden`).not.toContain(a);
      expect(text, `${where}: ${b} shown`).toContain(b);
    } else {
      expect(text.indexOf(b), `${where}: ${b} before ${a}`).toBeGreaterThan(-1);
      expect(text.indexOf(b), `${where}: ${b} before ${a}`).toBeLessThan(text.indexOf(a));
    }
  }
}

test('move, hide and remove entries in every section; preview, PDF, Word, share link, reload and another sign-in agree', async ({ page, browser }) => {
  test.setTimeout(180_000);
  const { mail } = await signInWithResume(page);
  await openBuilder(page);

  for (const [key, side, item, a, b] of SECTIONS) {
    await goTo(page, side);
    const up2 = page.getByRole('button', { name: `Move ${item} 2 up`, exact: true });
    await expect(page.getByRole('button', { name: `Move ${item} 1 up`, exact: true }), `${side}: first can't go up`).toBeDisabled();
    await expect(page.getByRole('button', { name: `Move ${item} 2 down`, exact: true }), `${side}: last can't go down`).toBeDisabled();
    const before = await preview(page).innerText();
    expect(before.indexOf(a), `${side}: starts in typed order`).toBeLessThan(before.indexOf(b));

    // keyboard: Enter on "Move … 2 up"; focus stays on the moved card (now first, so on its title)
    await up2.focus();
    await page.keyboard.press('Enter');
    await expect(preview(page)).toContainText(b);
    await expect.poll(async () => { const t = await preview(page).innerText(); return t.indexOf(b) < t.indexOf(a); }, `${side}: moved up in the preview`).toBe(true);
    await expect.poll(() => page.evaluate(() => document.activeElement?.id), `${side}: focus follows the card`).toBe(`entry-${key}-0-title`);

    // switch the (now) first entry off: greyed card, sidebar count, gone from the preview — then back on
    await page.getByRole('switch', { name: `Hide ${item} 1 from resume`, exact: true }).click();
    await expect(page.getByText('Hidden from resume').first()).toBeVisible();
    await expect(page.getByRole('button', { name: new RegExp(`${side} · 1 hidden`) }).first()).toBeVisible();
    await expect(preview(page)).not.toContainText(b);
    await page.getByRole('switch', { name: `Show ${item} 1 on resume`, exact: true }).click();
    await expect(preview(page)).toContainText(b);

    if (HIDE_AT_END.includes(key)) await page.getByRole('switch', { name: `Hide ${item} 2 from resume`, exact: true }).click();
  }

  // Remove asks first; Cancel keeps the entry
  await goTo(page, 'Achievements');
  await page.getByRole('button', { name: /Add another achievement/ }).click();
  await page.getByRole('button', { name: 'Remove Achievement 3', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Remove Achievement 3?' })).toBeVisible();
  await page.getByRole('button', { name: 'Cancel' }).click();
  await expect(page.getByRole('button', { name: 'Remove Achievement 3', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Remove Achievement 3', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Remove' }).click();
  await expect(page.getByRole('button', { name: 'Remove Achievement 3', exact: true })).toHaveCount(0);

  checkPrinted(await preview(page).innerText(), 'preview');
  checkPrinted(await pdfText(await download(page, 'Download PDF')), 'PDF');
  checkPrinted(docxText(await download(page, /Word/)), 'Word');

  // saved on the server (with the typed data of hidden entries kept)
  await expect.poll(async () => (await api(page, '/api/me/resumes'))[0].data.edu.map((e) => `${e.institution}${e.off ? ' (off)' : ''}`), { timeout: 15_000 })
    .toEqual(['Beta College', 'Alpha University (off)']);
  const saved = (await api(page, '/api/me/resumes'))[0].data;
  expect(saved.offLines.hobbies).toEqual(['Archery']);
  expect(saved.hobbies).toBe('Badminton\nArchery');
  expect(saved.skillGroups.map((g) => [g.value, !!g.off])).toEqual([['Bazel', false], ['Ansible', true]]);

  // reload keeps it
  await page.reload();
  await expect(preview(page)).toContainText('Beta College');
  checkPrinted(await preview(page).innerText(), 'after reload');
  await goTo(page, 'Education');
  await expect(page.getByRole('button', { name: /Education · 1 hidden/ }).first()).toBeVisible();
  await expect(page.getByRole('switch', { name: 'Show Education 2 on resume', exact: true })).toBeVisible();

  // the public share link
  await api(page, '/api/me/share', { method: 'PUT', body: JSON.stringify({ on: true, slug: `meera-${Date.now().toString(36)}`, resumeId: null, hidePhone: false }) });
  const slug = (await api(page, '/api/me/share')).slug;
  const visitor = await browser.newContext();
  const v = await visitor.newPage();
  await v.goto(`/r/${slug}`);
  await expect(v.getByRole('article', { name: 'Resume preview' })).toContainText('Beta College');
  checkPrinted(await v.getByRole('article', { name: 'Resume preview' }).innerText(), 'share link');
  await visitor.close();

  // another sign-in, another browser
  const other = await browser.newContext();
  const o = await other.newPage();
  await login(o, mail);
  await o.waitForURL('**/me');
  await openBuilder(o);
  checkPrinted(await preview(o).innerText(), 'another sign-in');
  await other.close();
});

test('phone width: arrows, switch and trash icon on one row', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await signInWithResume(page);
  await openBuilder(page);
  await goTo(page, 'Education');
  const boxes = await Promise.all([
    page.getByRole('button', { name: 'Move Education 1 up', exact: true }),
    page.getByRole('button', { name: 'Move Education 1 down', exact: true }),
    page.getByRole('switch', { name: 'Hide Education 1 from resume', exact: true }),
    page.getByRole('button', { name: 'Remove Education 1', exact: true }),
  ].map(async (l) => { await expect(l).toBeVisible(); return l.boundingBox(); }));
  const ys = boxes.map((bx) => bx.y + bx.height / 2);
  expect(Math.max(...ys) - Math.min(...ys)).toBeLessThan(12); // one row
  expect(Math.max(...boxes.map((bx) => bx.x + bx.width))).toBeLessThanOrEqual(390); // no sideways scrolling
  await expect(page.getByRole('button', { name: 'Remove Education 1', exact: true }).locator('.entry-remove-text')).toHaveCSS('position', 'absolute'); // icon only
  for (const bx of boxes) expect(Math.min(bx.width, bx.height)).toBeGreaterThanOrEqual(24); // tap size
});
