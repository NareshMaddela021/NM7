// Shared bits of the deep journeys (journeys-*.smoke.mjs): the same read-only rules as the page checks, plus a few
// more checks on every page (nothing scrolls sideways, no emoji or icon symbol characters in the text) and a guard
// that stops any write to the live API that a journey did not ask for.
//
// Every problem is collected (not thrown at once) so one run lists them all; each page with a problem gets a
// screenshot and a line in findings.json (test-results), and the test fails at the end.
import { writeFileSync } from 'node:fs';
import { expect } from '@playwright/test';
import { API } from './common.mjs';

// The same ranges as frontend/src/noEmoji.test.js (arrows, technical symbols, enclosed alphanumerics, geometric
// shapes, misc symbols, dingbats, misc symbols and arrows, the emoji planes, VS16 and keycap).
export const BANNED_SRC = '[\\u2190-\\u21FF\\u2300-\\u23FF\\u2460-\\u24FF\\u25A0-\\u25FF\\u2600-\\u27BF\\u2900-\\u297F\\u2B00-\\u2BFF\\u{1F000}-\\u{1FAFF}]|\\uFE0F|\\u20E3';

const IGNORE = [/favicon/i, /google-analytics|googletagmanager|gtag/i, /^Failed to load resource:/i, /accounts\.google\.com/i];

/** Text written by people or other job boards (job titles, descriptions, blog posts): emoji there are reported apart. */
const UGC = '.job-description, [data-testid=job-card], [data-testid=job-detail] h1, [data-testid=job-preview], [data-testid=qs-job], [data-testid=similar-jobs], article.blog-post, .blog-body, [data-ugc]';

/**
 * Write guard. mode 'block': any POST/PUT/PATCH/DELETE to the API that does not match `allow` is stopped before it
 * leaves the browser (and listed). mode 'log': writes go through and are only listed (the plain page visits, which the
 * page checks already do the same way).
 */
export async function guard(page, { mode = 'block', allow = [] } = {}) {
  const writes = [];
  await page.route((u) => u.href.startsWith(API) || u.pathname.startsWith('/api/'), async (route) => {
    const r = route.request();
    const m = r.method();
    if (m === 'GET' || m === 'HEAD' || m === 'OPTIONS') return route.continue();
    const p = new URL(r.url()).pathname;
    const ok = allow.some((a) => (a instanceof RegExp ? a.test(`${m} ${p}`) : `${m} ${p}`.startsWith(a)));
    writes.push({ method: m, path: p, allowed: ok || mode === 'log' });
    if (ok || mode === 'log') return route.continue();
    return route.abort('blockedbyclient');
  });
  return writes;
}

/** Sideways scroll and emoji, on the page as it is now. */
export async function scan(page) {
  return page.evaluate(([src, ugcSel]) => {
    const re = new RegExp(src, 'u');
    const de = document.documentElement;
    const cw = de.clientWidth;
    const out = { overflow: null, emoji: [], ugcEmoji: [] };
    if (de.scrollWidth > cw + 1 || document.body.scrollWidth > cw + 1) {
      const wide = [];
      for (const el of document.body.querySelectorAll('*')) {
        const r = el.getBoundingClientRect();
        if (r.width === 0 || r.right <= cw + 1) continue;
        const st = getComputedStyle(el);
        if (st.position === 'fixed' || st.visibility === 'hidden') continue;
        // only the deepest: skip one whose child is also too wide
        if ([...el.children].some((c) => c.getBoundingClientRect().right > cw + 1)) continue;
        const id = el.getAttribute('data-testid');
        wide.push(`${el.tagName.toLowerCase()}${id ? `[data-testid=${id}]` : ''}${el.className && typeof el.className === 'string' ? `.${el.className.trim().split(/\s+/).slice(0, 3).join('.')}` : ''} right=${Math.round(r.right)} "${(el.innerText || '').trim().slice(0, 40)}"`);
        if (wide.length >= 5) break;
      }
      out.overflow = { scrollWidth: Math.max(de.scrollWidth, document.body.scrollWidth), clientWidth: cw, wide };
    }
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      const m = n.nodeValue.match(re);
      if (!m) continue;
      const el = n.parentElement;
      if (!el || el.closest('script,style,noscript,[aria-hidden=true]')) continue;
      const st = getComputedStyle(el);
      if (st.display === 'none' || st.visibility === 'hidden' || !el.getClientRects().length) continue;
      const near = el.closest('[data-testid]');
      const item = { char: m[0], code: `U+${m[0].codePointAt(0).toString(16).toUpperCase()}`, text: n.nodeValue.trim().slice(0, 80), where: near ? near.getAttribute('data-testid') : el.tagName.toLowerCase() };
      (el.closest(ugcSel) ? out.ugcEmoji : out.emoji).push(item);
      if (out.emoji.length + out.ugcEmoji.length > 20) break;
    }
    // icon text in labels people hear (screen readers): aria-label / title / placeholder
    for (const el of document.querySelectorAll('[aria-label],[title],[placeholder],input[value]')) {
      for (const a of ['aria-label', 'title', 'placeholder']) {
        const v = el.getAttribute(a);
        const m = v && v.match(re);
        if (m && !el.closest(ugcSel)) out.emoji.push({ char: m[0], code: `U+${m[0].codePointAt(0).toString(16).toUpperCase()}`, text: `${a}="${v.slice(0, 60)}"`, where: el.getAttribute('data-testid') || el.tagName.toLowerCase() });
      }
    }
    return out;
  }, [BANNED_SRC, UGC]);
}

/**
 * A recorder for one test: watch(page) adds console / page error / failed API listeners; visit() opens a page and
 * checks it; check() checks the page as it is now (after a click). Problems are kept with a screenshot each;
 * finish() writes findings.json and fails the test when there were problems.
 */
export function recorder(testInfo, { role, signedIn = false, allow404 = [] } = {}) {
  const device = testInfo.project.name.includes('phone') ? 'phone 390' : 'desktop';
  const findings = [];
  const notes = [];
  let live = []; // problems seen since the last check
  let shot = 0;
  const watch = (page) => {
    page.on('console', (m) => { if (m.type() === 'error' && !IGNORE.some((r) => r.test(m.text()))) live.push(`console error: ${m.text().slice(0, 240)}`); });
    page.on('pageerror', (e) => live.push(`page error: ${e.message.split('\n')[0].slice(0, 240)}`));
    page.on('requestfailed', (r) => {
      const u = r.url(); const t = r.failure()?.errorText || '';
      if (u.includes('/api/') && !/aborted|blockedbyclient|ERR_BLOCKED_BY_CLIENT/i.test(t)) live.push(`API failed: ${r.method()} ${u.replace(API, '').split('?')[0]} ${t}`);
    });
    page.on('response', (r) => {
      const u = r.url(); const s = r.status();
      if (!u.includes('/api/') || s < 400) return;
      const p = u.replace(API, '').split('?')[0];
      if (!signedIn && (s === 401 || s === 403)) return;
      if (s === 404 && allow404.some((a) => p.startsWith(a))) return;
      live.push(`API ${s}: ${r.request().method()} ${p}`);
    });
  };
  const check = async (page, label, { blankOk = false, extra = [] } = {}) => {
    await page.waitForLoadState('networkidle', { timeout: 20_000 }).catch(() => {});
    await page.waitForTimeout(400);
    const problems = [...live, ...extra];
    live = [];
    const text = (await page.locator('body').innerText().catch(() => '')).trim();
    if (!blankOk && text.length < 60) problems.push(`blank page (${text.length} characters of text)`);
    if (/Page not found/i.test(await page.title().catch(() => ''))) problems.push('shows "Page not found"');
    if (await page.getByRole('heading', { name: /^(Page not found|404)/i }).count().catch(() => 0)) problems.push('shows a not-found heading');
    if (await page.getByRole('alert').filter({ hasText: /Something went wrong|crashed|couldn.t load this page/i }).count().catch(() => 0)) problems.push('shows an error box');
    const s = await scan(page).catch((e) => ({ overflow: null, emoji: [], ugcEmoji: [], err: e.message }));
    if (s.overflow) problems.push(`scrolls sideways: page ${s.overflow.scrollWidth}px wide in a ${s.overflow.clientWidth}px window; widest: ${s.overflow.wide.join(' | ')}`);
    if (s.emoji.length) problems.push(`emoji/icon symbols in text: ${s.emoji.map((e) => `${e.char} ${e.code} in [${e.where}] "${e.text}"`).join(' | ')}`);
    const url = page.url().replace(/^https?:\/\/[^/]+/, '');
    const f = { role, device, label, url, problems, ugcEmoji: s.ugcEmoji, screenshot: null };
    if (problems.length || s.ugcEmoji.length) {
      shot += 1;
      const p = testInfo.outputPath(`${String(shot).padStart(2, '0')}-${label.replace(/[^a-z0-9]+/gi, '_').slice(0, 60)}.jpg`);
      await page.screenshot({ path: p, fullPage: false, type: 'jpeg', quality: 55 }).catch(() => {});
      f.screenshot = p.replace(/^.*test-results\//, 'test-results/');
    }
    findings.push(f);
    return problems;
  };
  const visit = async (page, path, label = path, opts = {}) => {
    live = [];
    try {
      const res = await page.goto(path, { waitUntil: 'domcontentloaded', timeout: 60_000 });
      const extra = res && res.status() >= 400 ? [`document ${res.status()}`] : [];
      return await check(page, label, { ...opts, extra });
    } catch (e) {
      findings.push({ role, device, label, url: path, problems: [`could not open: ${e.message.split('\n')[0]}`], ugcEmoji: [], screenshot: null });
      return ['could not open'];
    }
  };
  /** A failed step of a journey (an expected button missing, a wrong address): kept like a page problem. */
  const fail = async (page, label, problem) => {
    shot += 1;
    const p = testInfo.outputPath(`${String(shot).padStart(2, '0')}-${label.replace(/[^a-z0-9]+/gi, '_').slice(0, 60)}.jpg`);
    await page.screenshot({ path: p, fullPage: false, type: 'jpeg', quality: 55 }).catch(() => {});
    findings.push({ role, device, label, url: page.url().replace(/^https?:\/\/[^/]+/, ''), problems: [problem], ugcEmoji: [], screenshot: p.replace(/^.*test-results\//, 'test-results/') });
  };
  /** Runs one step; an exception becomes a finding and the journey carries on. */
  const step = async (page, label, fn) => {
    try { return await fn(); } catch (e) { await fail(page, label, `step failed: ${e.message.split('\n').filter(Boolean).slice(0, 3).join(' ').slice(0, 300)}`); return undefined; }
  };
  const note = (s) => notes.push(s);
  const finish = (writes = []) => {
    writeFileSync(testInfo.outputPath('findings.json'), JSON.stringify({ test: testInfo.title, role, device, findings, notes, writes }, null, 2));
    const bad = findings.filter((f) => f.problems.length);
    expect(bad.map((f) => `${f.label} (${f.url}): ${f.problems.join(' ;; ')}`), `${bad.length} of ${findings.length} checks had problems`).toEqual([]);
  };
  return { watch, visit, check, fail, step, note, finish, findings };
}

/** Internal links in the page's menus (header, nav, aside, footer). */
export const menuLinks = (page) => page.evaluate(() => [...document.querySelectorAll('header a[href], nav a[href], footer a[href], aside a[href], [role=menu] a[href]')]
  .map((a) => a.getAttribute('href')).filter((h) => h && h.startsWith('/') && !h.startsWith('//')).map((h) => h.split('#')[0]).filter(Boolean));

/** Links on the page that start with `prefix`. */
export const linksUnder = (page, prefix) => page.evaluate((pre) => [...new Set([...document.querySelectorAll('a[href]')].map((a) => a.getAttribute('href'))
  .filter((h) => h && h.startsWith(pre)).map((h) => h.split('#')[0]))], prefix);
