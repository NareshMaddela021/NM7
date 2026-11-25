// The Nm7 Apply helper (the Chrome extension in ../extension): field mapping, the job-board list, the manifest
// (Manifest V3, minimal required permissions, everything new optional, no remote code) and the red lines: it never
// submits a form or presses a button (Submit, Next, Add, anything), never signs in, never touches a CAPTCHA, does
// nothing on job boards, reads no other tab and sends nothing but what the candidate asked for (plus counts, and the
// opt-in labels report). The extension's scripts are plain browser scripts (no build step); the page scripts run
// here in a happy-dom page (scripts/lib/helper-harness.mjs). The adapters, steps, frames and the release gates on
// the practice forms are in extension-adapters.test.mjs and extension-flows.test.mjs.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import vm from 'node:vm';
import { describe, expect, it } from 'vitest';
import { EXT, KIT, PAGE_FILES, PDF, makePage, marks, read } from './lib/helper-harness.mjs';

function load(...files) {
  const box = { globalThis: null };
  box.globalThis = box;
  vm.createContext(box);
  for (const f of files) vm.runInContext(read(f), box, { filename: f });
  return box;
}

const ADAPTERS = PAGE_FILES.filter((p) => p.startsWith('src/adapters/'));
const { Nm7FieldMap: M, Nm7Blocklist: B } = load('src/blocklist.js', ...ADAPTERS, 'src/fieldmap.js');

const OLD_KIT = {
  id: 'k1',
  job: { title: 'Data Analyst', company: 'Zeta' },
  coverNote: 'I build weekly SQL dashboards.',
  resume: { name: 'Sai_Varsha_Resume.pdf' },
  answers: [{ question: 'Why do you want this role?', answer: 'I like turning data into decisions.' }],
  fields: [
    { key: 'full_name', value: 'Sai Varsha' }, { key: 'first_name', value: 'Sai' }, { key: 'last_name', value: 'Varsha' },
    { key: 'email', value: 'sai@example.com' }, { key: 'phone', value: '+91 98765 43210' }, { key: 'city', value: 'Hyderabad' },
    { key: 'linkedin', value: 'https://linkedin.com/in/sai' }, { key: 'notice', value: '30 days' },
    { key: 'salary', value: '₹4 lakh a year or more' }, { key: 'college', value: 'JNTU Hyderabad' },
  ],
};

const f = (o) => ({ tag: 'input', type: 'text', name: '', id: '', label: '', placeholder: '', autocomplete: '', aria: '', automationId: '', ...o });
const plan = (fields, host = 'careers.zeta.in') => M.planFill(fields, OLD_KIT, host);
const byIndex = (p) => Object.fromEntries(p.fill.map((x) => [x.index, x]));

describe('field mapping', () => {
  it('maps by label, name, placeholder and autocomplete', () => {
    const fields = [
      f({ label: 'First name *' }), f({ name: 'last_name' }), f({ type: 'email', placeholder: 'Your email address' }),
      f({ autocomplete: 'tel' }), f({ label: 'Current location (city)' }), f({ label: 'LinkedIn profile URL' }),
      f({ label: 'Notice period' }), f({ label: 'Expected CTC' }), f({ label: 'College / University' }),
      f({ tag: 'textarea', type: 'textarea', label: 'Cover letter' }), f({ type: 'file', label: 'Upload your resume / CV' }),
    ];
    const got = byIndex(plan(fields));
    expect(got[0]).toMatchObject({ value: 'Sai', sure: true });
    expect(got[1].value).toBe('Varsha');
    expect(got[2].value).toBe('sai@example.com');
    expect(got[3]).toMatchObject({ value: '+91 98765 43210', how: 'autocomplete', sure: true });
    expect(got[4]).toMatchObject({ value: 'Hyderabad', sure: false }); // a softer match: yellow, please check
    expect(got[5].value).toBe('https://linkedin.com/in/sai');
    expect(got[6].value).toBe('30 days');
    expect(got[7].value).toBe('₹4 lakh a year or more');
    expect(got[8].value).toBe('JNTU Hyderabad');
    expect(got[9].value).toBe('I build weekly SQL dashboards.');
    expect(got[10]).toMatchObject({ key: 'resume', value: 'Sai_Varsha_Resume.pdf' });
  });

  it('fills a ready answer into a matching question box', () => {
    const p = plan([f({ tag: 'textarea', type: 'textarea', label: 'Why do you want this role at Zeta?' })]);
    expect(p.fill[0]).toMatchObject({ key: 'answer', value: 'I like turning data into decisions.', sure: false });
  });

  it('never fills passwords, hidden fields, consent, CAPTCHAs, sensitive or unknown questions', () => {
    const fields = [
      f({ type: 'password', label: 'Create a password' }), f({ type: 'hidden', name: 'csrf' }), f({ type: 'checkbox', label: 'I agree to the privacy policy' }),
      f({ type: 'radio', widget: 'radio', label: '', question: 'Willing to relocate?', options: ['Yes', 'No'] }), f({ tag: 'select', type: 'select', label: 'Country', options: ['Select', 'India'] }),
      f({ name: 'g-recaptcha-response', inCaptcha: true }), f({ label: 'Gender' }), f({ label: 'Date of birth' }),
      f({ label: 'Current CTC' }), f({ label: 'Aadhaar number' }), f({ label: 'Religion' }), f({ type: 'file', label: 'Photo' }),
      f({ label: 'Favourite colour' }), f({ label: 'Email', filled: true }), f({ label: 'Phone', disabled: true }),
      f({ type: 'submit', label: 'Submit application' }), f({ tag: 'select', type: 'select', label: 'Please choose', options: ['Select', 'Female', 'Male'] }),
      f({ label: 'Salary history' }), f({ label: 'Caste certificate number' }), f({ tag: 'button', widget: 'listbutton', label: 'Country' }),
      f({ tag: 'textarea', type: 'textarea', label: 'Tell us about a project you are proud of' }),
    ];
    const p = plan(fields);
    expect(p.fill).toEqual([]);
    const why = Object.fromEntries(p.skip.map((s) => [s.index, s.why]));
    expect(why).toMatchObject({
      0: 'password', 1: 'not_a_field', 2: 'consent', 3: 'choice', 4: 'choice', 5: 'captcha', 6: 'sensitive', 7: 'sensitive',
      8: 'sensitive', 9: 'sensitive', 10: 'sensitive', 11: 'other_file', 12: 'unknown', 13: 'already_filled', 14: 'locked',
      15: 'not_a_field', 16: 'sensitive', 17: 'sensitive', 18: 'sensitive', 19: 'needs_click', 20: 'question',
    });
  });

  it('leaves a field empty when the kit has no value for it (nothing is made up)', () => {
    const p = plan([f({ label: 'GitHub profile' }), f({ label: 'Current company' })]);
    expect(p.fill).toEqual([]);
    expect(p.skip.map((s) => s.why)).toEqual(['not_in_kit', 'not_in_kit']);
  });

  it('chooses drop-down options and radio buttons by their text, and yes / no from a ready answer', () => {
    const kit = { ...OLD_KIT, fields: [...OLD_KIT.fields, { key: 'degree', value: 'B.Tech Computer Science' }], answers: [{ question: 'Are you willing to relocate?', answer: 'Yes, to Hyderabad.' }] };
    const p = M.planFill([
      f({ tag: 'select', type: 'select', label: 'Highest degree', options: ['Select', 'Bachelor of Commerce (B.Com)', 'Bachelor of Technology (B.Tech)', 'MBA'] }),
      f({ type: 'radio', widget: 'radio', question: 'Notice period', options: ['Immediate', '1 month', '2 months'] }),
      f({ type: 'radio', widget: 'radio', question: 'Are you willing to relocate?', options: ['Yes', 'No'] }),
      f({ tag: 'select', type: 'select', label: 'Notice', options: ['Select', 'Less than 15 days', '90 days'] }),
      f({ type: 'checkbox', widget: 'checkbox', label: 'I am willing to relocate' }),
    ], kit, 'careers.zeta.in');
    const got = byIndex(p);
    expect(got[0]).toMatchObject({ option: 2, value: 'Bachelor of Technology (B.Tech)' });
    expect(got[1]).toMatchObject({ option: 1, value: '1 month' }); // "30 days" is "1 month"
    expect(got[2]).toMatchObject({ option: 0, key: 'answer', sure: false });
    expect(got[3]).toBeUndefined(); // no option is close enough: left for the candidate
    expect(got[4]).toMatchObject({ value: true, key: 'answer', sure: false });
    expect(M.matchOption(['Select', 'Pune', 'Pune Cantonment'], 'Pune')).toMatchObject({ index: 1, exact: true });
  });

  it('writes dates in the form’s own format', () => {
    expect(M.formatDate('2025-01', { type: 'date' })).toEqual({ value: '2025-01-01', sure: false });
    expect(M.formatDate('2025-01-15', { type: 'date' })).toEqual({ value: '2025-01-15', sure: true });
    expect(M.formatDate('2025-01', { type: 'month' })).toEqual({ value: '2025-01', sure: true });
    expect(M.formatDate('2025-01', { type: 'text', placeholder: 'DD/MM/YYYY' })).toMatchObject({ value: '01/01/2025', sure: false });
    expect(M.formatDate('2025-03', { type: 'text', placeholder: 'MM/YYYY' })).toEqual({ value: '03/2025', sure: true });
    expect(M.formatDate('2025-03', { type: 'text', placeholder: 'yyyy-mm-dd' })).toMatchObject({ value: '2025-03-01' });
    expect(M.formatDate('2025-03', { type: 'text' }, 'month')).toEqual({ value: '03', sure: true });
    expect(M.formatDate('2025-03', { type: 'text' }, 'year')).toEqual({ value: '2025', sure: true });
    expect(M.formatDate('Mar 2025', { type: 'text', placeholder: 'MM/YYYY' })).toEqual({ value: '03/2025', sure: true });
    expect(M.formatDate('not a date', { type: 'date' })).toBeNull();
    // a date of birth is never a kit value: it is a sensitive question
    expect(M.skipWhy(f({ type: 'date', widget: 'date', label: 'Date of Birth' }))).toBe('sensitive');
  });

  it('uses the per-site maps of common hiring systems’ public apply forms', () => {
    const gh = byIndex(plan([f({ id: 'first_name', label: 'Legal first' }), f({ name: 'job_application[email]' }),
      f({ type: 'file', id: 'resume', label: 'Attach' }), f({ tag: 'textarea', type: 'textarea', id: 'cover_letter_text' })], 'boards.greenhouse.io'));
    expect(gh[0]).toMatchObject({ value: 'Sai', how: 'site' });
    expect(gh[1]).toMatchObject({ value: 'sai@example.com', how: 'site' });
    expect(gh[2]).toMatchObject({ key: 'resume', how: 'site' });
    expect(gh[3]).toMatchObject({ key: 'cover', how: 'site' });
    const lever = byIndex(plan([f({ name: 'name' }), f({ name: 'urls[LinkedIn]' }), f({ tag: 'textarea', type: 'textarea', name: 'comments' }),
      f({ type: 'file', name: 'resume' })], 'jobs.lever.co'));
    expect(lever[0]).toMatchObject({ value: 'Sai Varsha', how: 'site' });
    expect(lever[1].value).toBe('https://linkedin.com/in/sai');
    expect(lever[2].key).toBe('cover');
    expect(lever[3].key).toBe('resume');
    const wd = byIndex(plan([f({ automationId: 'legalNameSection_firstName' }), f({ automationId: 'phone-number' }),
      f({ type: 'file', automationId: 'file-upload-input-ref' })], 'acme.wd3.myworkdayjobs.com'));
    expect(wd[0]).toMatchObject({ value: 'Sai', how: 'site' });
    expect(wd[1].value).toBe('+91 98765 43210');
    expect(wd[2].key).toBe('resume');
    const sr = byIndex(plan([f({ id: 'first-name-input' }), f({ id: 'confirm-email-input' }), f({ id: 'linkedin-input' })], 'jobs.smartrecruiters.com'));
    expect(sr[0].value).toBe('Sai');
    expect(sr[1].value).toBe('sai@example.com');
    expect(sr[2].value).toBe('https://linkedin.com/in/sai');
    expect(M.siteOf('example.com')).toBe('');
    for (const [h, n] of [['acme.wd3.myworkdayjobs.com', 'workday'], ['career5.successfactors.eu', 'successfactors'], ['acme.taleo.net', 'taleo'],
      ['careers-acme.icims.com', 'icims'], ['acme.darwinbox.in', 'darwinbox'], ['acme.keka.com', 'keka'], ['job-boards.greenhouse.io', 'greenhouse'],
      ['jobs.lever.co', 'lever'], ['acme.zohorecruit.in', 'zoho'], ['jobs.smartrecruiters.com', 'smartrecruiters']]) expect(M.siteOf(h), h).toBe(n);
  });

  it('the miss report carries the label and field type only, with anything value-like taken out', () => {
    const fields = [f({ label: 'Favourite colour' }), f({ label: 'Call me on 98765 43210 or sai@example.com' }), f({ label: 'See https://x.example/a?b=1 for details' }), f({ label: 'Email' })];
    const p = plan(fields);
    const m = M.misses(fields, p);
    expect(m).toEqual([{ label: 'Favourite colour', type: 'text' }, { label: 'Call me on or', type: 'text' }, { label: 'See for details', type: 'text' }]);
    for (const x of m) expect(Object.keys(x).sort()).toEqual(['label', 'type']);
  });
});

describe('job boards', () => {
  it('does nothing on job boards, with exact domain matching', () => {
    for (const h of ['www.linkedin.com', 'in.linkedin.com', 'naukri.com', 'www.indeed.co.in', 'shine.com', 'x.com', 'internshala.com', 'foundit.in', 'glassdoor.co.in', '']) {
      expect(B.isBlocked(h), h).toBe(true);
    }
    for (const h of ['careers.zeta.in', 'boards.greenhouse.io', 'jobs.lever.co', 'myshine.com', 'box.com', 'acme.wd3.myworkdayjobs.com']) {
      expect(B.isBlocked(h), h).toBe(false);
    }
  });

  it('fills nothing on a job board, also inside a frame of one', async () => {
    const p = makePage('<label for="e">Email</label><input id="e" type="email">', { url: 'https://www.naukri.com/apply' });
    expect(await p.box.Nm7Fill(KIT, null)).toMatchObject({ blocked: true });
    expect(p.doc.getElementById('e').value).toBe('');
    p.close();
  });
});

describe('manifest', () => {
  const m = JSON.parse(read('manifest.json'));
  it('is Manifest V3 with only activeTab, scripting and storage required, only the Nm7 API, and every other site optional', () => {
    expect(m.manifest_version).toBe(3);
    expect([...m.permissions].sort()).toEqual(['activeTab', 'scripting', 'storage']); // never tabs, history, webNavigation
    expect(m.host_permissions).toEqual(['https://nm7-api.onrender.com/*']);
    expect(m.optional_permissions).toBeUndefined();
    expect(m.optional_host_permissions).toEqual(['https://*/*']); // asked for one site at a time, at the moment of need
    expect(m.content_scripts).toBeUndefined(); // injected only when the candidate taps Fill (activeTab)
    expect(m.externally_connectable).toBeUndefined();
    expect(m.web_accessible_resources).toBeUndefined();
    expect(m.content_security_policy.extension_pages).toBe("script-src 'self'; object-src 'self'");
    expect(m.background).toEqual({ service_worker: 'background.js' });
    for (const p of Object.values(m.icons)) expect(statSync(join(EXT, p)).size).toBeGreaterThan(100);
  });

  const files = [];
  const walk = (d) => { for (const n of readdirSync(join(EXT, d))) { const p = d ? `${d}/${n}` : n; if (statSync(join(EXT, p)).isDirectory()) walk(p); else files.push(p); } };
  walk('');
  const code = files.filter((p) => /\.(js|html)$/.test(p));

  it('loads no remote code and sends nothing anywhere but nm7.si and its API server (no analytics)', () => {
    for (const p of code) {
      const src = read(p);
      expect(src, p).not.toMatch(/<script[^>]+src=["']https?:/i);
      expect(src, p).not.toMatch(/\beval\s*\(|new\s+Function\s*\(|importScripts\(\s*['"]https?:|import\(\s*['"`]https?:|setTimeout\(\s*['"`]|innerHTML\s*=|insertAdjacentHTML|document\.write/);
      expect(src, p).not.toMatch(/google-analytics|googletagmanager|gtag\(|segment\.|mixpanel|sentry|amplitude|hotjar/i);
      for (const url of src.match(/https?:\/\/[^\s'"`)]+/g) || []) expect(/^https:\/\/(nm7\.si|nm7-api\.onrender\.com)([/:]|$)/.test(url), `${p}: ${url}`).toBe(true);
    }
    expect(read('src/config.js')).toContain("api: 'https://nm7-api.onrender.com/api/helper'");
    // every page file in the injection list exists, and every adapter file is in it
    for (const p of PAGE_FILES) expect(files).toContain(p);
    for (const p of files.filter((x) => x.startsWith('src/adapters/'))) expect(PAGE_FILES).toContain(p);
  });

  it('reads no other tab and no history: only the active tab is ever queried', () => {
    for (const p of code) {
      const src = read(p);
      expect(src, p).not.toMatch(/chrome\.history|chrome\.webNavigation|chrome\.cookies|chrome\.bookmarks|chrome\.downloads|chrome\.tabs\.(get|update|executeScript|captureVisibleTab)\b/);
      for (const q of src.match(/chrome\.tabs\.query\([^)]*\)/g) || []) expect(q, p).toContain('active: true, currentWindow: true');
    }
  });

  it('is ready for the store: version 1.1.0, icons 16 / 32 / 48 / 128 of the right size, no emoji or icon symbols', () => {
    expect(m.version).toBe('1.1.0');
    expect(m.description.length).toBeLessThanOrEqual(132);
    for (const n of [16, 32, 48, 128]) {
      expect(m.icons[n]).toBe(`icons/icon${n}.png`);
      expect(m.action.default_icon[n]).toBe(`icons/icon${n}.png`);
      const png = readFileSync(join(EXT, m.icons[n]));
      expect([png.readUInt32BE(16), png.readUInt32BE(20)], `icon${n}`).toEqual([n, n]); // the PNG's own width and height
    }
    // the same rule as src/noEmoji.test.js: plain typography (· … ’ “ ” × and so on) is fine, icon symbols are not
    const BANNED = /[←-⇿⌀-⏿①-⓿■-◿☀-➿⤀-⥿⬀-⯿\u{1F000}-\u{1FAFF}]|️|⃣/u;
    for (const p of files.filter((x) => /\.(js|html|css|json)$/.test(x))) expect(read(p), p).not.toMatch(BANNED);
  });

  it('opens the first-run guide once, on install, from a page inside the package', () => {
    const bg = read('background.js');
    expect(bg).toMatch(/onInstalled\.addListener[\s\S]*details\.reason !== 'install'[\s\S]*chrome\.runtime\.getURL\('welcome\.html'\)/);
    const html = read('welcome.html');
    for (const words of ['Connect', 'Open a job', 'Tap Fill', 'practice form']) expect(html).toContain(words);
    expect(html).not.toMatch(/<script>|\son[a-z]+=/); // no inline script (the extension's CSP)
    expect(read('welcome.js')).toContain('NM7_CONFIG.practice');
    expect(read('src/config.js')).toMatch(/practice: 'https:\/\/nm7\.si\/demo\/apply\//);
  });
});

describe('never submits', () => {
  // every script that runs inside the company's page (and its frames)
  const page = PAGE_FILES;
  const guarded = (src) => src.replace(/function (pickOption|tickChoice)\([\s\S]*?\n {2}\}\n/g, '');

  it('has no code path that submits a form, presses a button or presses Enter (every page file, every adapter)', () => {
    expect(page.length).toBeGreaterThanOrEqual(14);
    for (const p of page) {
      const src = read(p);
      expect(src, p).not.toMatch(/\.submit\s*\(|requestSubmit|\.click\s*\(|dispatchEvent\(\s*new\s+Event\(\s*['"](submit|click)/);
      expect(src, p).not.toMatch(/['"]Enter['"]|keyCode|KeyboardEvent|[\w)\]]\.form\b(?!-)/); // no Enter key, no reaching a field's form
      expect(guarded(src), p).not.toMatch(/new\s+(Mouse|Pointer|Keyboard|Submit|Touch)Event|(?<!addEventListener\()['"](mousedown|mouseup|pointerdown|click)['"]\s*[,\]]/);
    }
    // the only two places a mouse event is sent: an option the helper's own typing opened, and one radio / check box
    const w = read('src/widgets.js');
    expect(w.match(/new MouseEvent/g)).toHaveLength(2);
    expect(w).toMatch(/function pickOption\(opt\) \{[\s\S]*if \(!listed \|\| !safeTarget\(opt\)\) return false;/);
    expect(w).toMatch(/function tickChoice\(input, on = true\) \{[\s\S]*if \(input\.closest\(PRESSABLE\) \|\| input\.disabled\) return false;/);
  });

  it('pickOption and tickChoice refuse buttons, links, submit controls and action words', () => {
    const p = makePage(`
      <ul role="listbox"><li role="option" id="ok">Pune</li><li role="option" id="next">Next</li><li role="option" id="wrap"><button type="button">Pune</button></li></ul>
      <button type="submit" role="option" id="btn">Pune</button><a href="#" role="option" id="lnk">Pune</a><div role="option" id="sub"><input type="submit"></div>
      <form><button type="button" id="inbtn"><input type="checkbox" id="cb1"></button><input type="checkbox" id="cb2"><input type="submit" id="go"></form>`);
    const W = p.box.Nm7Widgets;
    const clicks = [];
    for (const el of p.doc.querySelectorAll('*')) el.addEventListener('click', () => clicks.push(el.id));
    let submitted = false;
    p.doc.querySelector('form').addEventListener('submit', () => { submitted = true; });
    for (const id of ['next', 'wrap', 'btn', 'lnk', 'sub']) expect(W.pickOption(p.doc.getElementById(id)), id).toBe(false);
    expect(W.tickChoice(p.doc.getElementById('cb1'))).toBe(false); // inside a button
    expect(W.tickChoice(p.doc.getElementById('go'))).toBe(false); // not a radio or check box
    expect(clicks).toEqual([]);
    expect(W.pickOption(p.doc.getElementById('ok'))).toBe(true);
    expect(W.tickChoice(p.doc.getElementById('cb2'))).toBe(true);
    expect(p.doc.getElementById('cb2').checked).toBe(true);
    expect(submitted).toBe(false);
    p.close();
  });

  it('only listens to the submit event, passively, and never stops it', () => {
    const src = read('src/content.js');
    expect(src).toMatch(/addEventListener\('submit'/);
    expect(src).toMatch(/passive: true/);
    for (const p of page) expect(read(p), p).not.toMatch(/preventDefault|stopPropagation|stopImmediatePropagation|returnValue/);
  });

  it('fills a real page without pressing anything: no click, no submit, no Enter reaches the page', async () => {
    const p = makePage(`<form id="f">
      <label for="n">Full name</label><input id="n"><label for="e">Email</label><input id="e" type="email">
      <label for="g">Gender</label><input id="g"><label for="c">City</label><input id="c" role="combobox" aria-autocomplete="list">
      <fieldset><legend>Willing to relocate?</legend><label><input type="radio" name="r" value="y">Yes</label><label><input type="radio" name="r" value="n">No</label></fieldset>
      <button type="button" id="next">Next</button><button type="button" id="add">Add another</button><button type="submit" id="send">Submit application</button></form>`, { fallback: ['Pune'] });
    const seen = [];
    for (const t of ['click', 'submit', 'keydown', 'keypress', 'mousedown']) p.doc.addEventListener(t, (e) => { if (t !== 'click' && t !== 'mousedown' || e.target.closest('button, [type=submit], a') && !e.target.closest('[id^="nm7-"]')) seen.push(`${e.target.id}:${t}`); }, true);
    const r = await p.box.Nm7Fill(KIT, null);
    expect(r.filled).toBe(3);
    expect(r.sensitive).toBe(1);
    expect(p.doc.getElementById('n').value).toBe('Priya Sharma (demo)');
    expect(p.doc.getElementById('g').value).toBe('');
    expect(seen).toEqual([]);
    // the status bar and Undo are the helper's own buttons; tapping them presses nothing on the page
    const bar = p.doc.getElementById('nm7-status');
    expect(bar.textContent).toContain('filled');
    for (const b of bar.querySelectorAll('button')) if (b.textContent !== 'Hide colours') b.dispatchEvent(new p.win.MouseEvent('click', { bubbles: true }));
    expect(seen).toEqual([]);
    p.close();
  });

  it('never signs in or creates an account: a sign-in page is left alone', async () => {
    const p = makePage(`<form><h1>Create an account</h1><label for="e">Email</label><input id="e" type="email"><label for="p1">Password</label><input id="p1" type="password">
      <label for="p2">Verify password</label><input id="p2" type="password"></form>`);
    const r = await p.box.Nm7Fill(KIT, null);
    expect(r.login).toBe(true);
    expect(p.doc.getElementById('e').value).toBe('');
    expect(p.doc.getElementById('p1').value).toBe('');
    expect(p.doc.querySelector('[data-nm7-mark]')).toBeNull();
    p.close();
  });

  it('never touches a CAPTCHA: no value, no colour, no event', async () => {
    const p = makePage(`<label for="e">Email</label><input id="e" type="email">
      <div class="g-recaptcha" data-sitekey="k"><input id="cap" name="g-recaptcha-response"><input type="checkbox" id="robot"><label for="robot">I'm not a robot</label></div>`);
    const seen = [];
    for (const id of ['cap', 'robot']) for (const t of ['click', 'input', 'change', 'focus']) p.doc.getElementById(id).addEventListener(t, () => seen.push(id + t));
    const r = await p.box.Nm7Fill(KIT, null);
    expect(r.captcha).toBe(true);
    expect(p.doc.getElementById('cap').value).toBe('');
    expect(p.doc.getElementById('robot').checked).toBe(false);
    expect(p.doc.querySelector('.g-recaptcha [data-nm7-mark], .g-recaptcha[data-nm7-mark]')).toBeNull();
    expect(seen).toEqual([]);
    p.close();
  });

  it('offers Mark as applied after the candidate submits, and the colours go', async () => {
    const p = makePage('<form id="f"><label for="n">Full name</label><input id="n"></form>');
    await p.box.Nm7Fill(KIT, null);
    expect(marks(p.doc).sure).toBe(1);
    p.doc.getElementById('f').dispatchEvent(new p.win.Event('submit', { bubbles: true, cancelable: true }));
    expect(p.sent).toContainEqual({ type: 'nm7-submitted', kitId: 'kit-review' });
    expect(marks(p.doc)).toEqual({ sure: 0, check: 0, left: 0, draft: 0 });
    expect(p.doc.getElementById('nm7-helper-bar').textContent).toContain('Mark as applied on Nm7');
    p.close();
  });
});

describe('colours, status bar and Undo', () => {
  const FORM = `<form>
    <label for="n">Full name</label><input id="n">
    <label for="e">Email</label><input id="e" type="email" value="old@example.com">
    <label for="c">Current location</label><input id="c">
    <label for="x">Favourite colour</label><input id="x">
    <label for="d">Highest degree</label><select id="d"><option value="">Select</option><option>Bachelor of Commerce (B.Com)</option></select>
    <label for="t">Tell us about a project you led</label><textarea id="t"></textarea>
    <label for="g">Gender</label><select id="g"><option value="">Select</option><option>Female</option><option>Male</option></select>
    <label><input type="checkbox" id="rel"> I am willing to work from the job's city</label>
    <label for="r">Resume</label><input type="file" id="r"></form>`;

  it('marks green / yellow / red with a text badge each, and the status bar counts them', async () => {
    const p = makePage(FORM);
    const r = await p.box.Nm7Fill(KIT, PDF);
    const state = (id) => (p.doc.getElementById(id).closest('[data-nm7-mark]') || {}).getAttribute?.('data-nm7-mark');
    expect(state('n')).toBe('sure');
    expect(state('c')).toBe('check');
    expect(state('d')).toBe('check'); // B.Com Computer Applications is close to the option, not the same
    expect(state('x')).toBe('left');
    expect(state('g')).toBe('left');
    expect(state('t')).toBe('left');
    expect(state('rel')).toBe('check'); // a kit-backed yes from the ready answer
    expect(state('e')).toBeUndefined(); // already filled by the candidate: not touched
    expect(p.doc.getElementById('e').value).toBe('old@example.com');
    expect(r.attached).toBe(true);
    const badges = [...p.doc.querySelectorAll('#nm7-marks .nm7-badge')].map((b) => b.textContent);
    expect(badges).toContain('Nm7: filled');
    expect(badges).toContain('Nm7: please check');
    expect(badges).toContain('Nm7: left for you');
    expect(r.counts).toEqual({ sure: 2, check: 3, left: 3, draft: 0 });
    expect(p.doc.getElementById('nm7-status').querySelector('.nm7-count').textContent).toBe('2 filled, 3 to check, 3 for you');
    expect(r.list.find((x) => x.label === 'Gender')).toEqual({ label: 'Gender', state: 'left' });
    p.close();
  });

  it('tapping the status bar goes to the next field to check (yellow first, then red), focusing it', async () => {
    const p = makePage(FORM);
    await p.box.Nm7Fill(KIT, PDF);
    const count = p.doc.querySelector('#nm7-status .nm7-count');
    const focused = [];
    for (let i = 0; i < 4; i += 1) { count.dispatchEvent(new p.win.MouseEvent('click', { bubbles: true })); focused.push(p.doc.activeElement && p.doc.activeElement.id); }
    expect(focused[0]).toBe('c'); // the first yellow
    expect(focused).toContain('x'); // then the red ones
    expect(focused).not.toContain('n'); // never a green one
    p.close();
  });

  it('Undo puts back exactly what was there and touches nothing it didn’t type', async () => {
    const p = makePage(FORM);
    p.doc.getElementById('x').value = 'typed by the candidate later';
    await p.box.Nm7Fill(KIT, PDF);
    p.doc.getElementById('x').value = 'the candidate typed this after the fill';
    const undo = [...p.doc.querySelectorAll('#nm7-status button')].find((b) => b.textContent === 'Undo');
    undo.dispatchEvent(new p.win.MouseEvent('click', { bubbles: true }));
    expect(p.doc.getElementById('n').value).toBe('');
    expect(p.doc.getElementById('c').value).toBe('');
    expect(p.doc.getElementById('d').selectedIndex).toBe(0);
    expect(p.doc.getElementById('rel').checked).toBe(false);
    expect(p.doc.getElementById('e').value).toBe('old@example.com');
    expect(p.doc.getElementById('x').value).toBe('the candidate typed this after the fill'); // not the helper's
    expect(p.doc.querySelector('[data-nm7-mark]')).toBeNull();
    expect(p.doc.getElementById('nm7-status').textContent).toContain('Undone');
    expect(p.box.Nm7Undo()).toEqual({ undone: 0 });
    p.close();
  });

  it('the colours go away on their own after a while', async () => {
    expect(read('src/content.js')).toMatch(/CLEAR_AFTER = 20 \* 60 \* 1000[\s\S]*setTimeout\(clearMarks, CLEAR_AFTER\)/);
  });
});

// The Chrome Web Store review: the practice pages on nm7.si (src/pages/demo/PracticeApply.jsx) that the review
// account's kits link to. The helper must work there: nm7.si is no job board, the kit's applyHost matches the page,
// every field of the practice form is filled from the kit, and the submit listener offers "Mark as applied on Nm7".
describe('the practice pages for the Chrome Web Store review', () => {
  it('nm7.si is never blocked and the manifest needs no new required permission', () => {
    for (const h of ['nm7.si', 'www.nm7.si']) expect(B.isBlocked(h)).toBe(false);
    const m = JSON.parse(read('manifest.json'));
    expect(m.permissions).toEqual(['activeTab', 'scripting', 'storage']);
    expect(m.content_scripts).toBeUndefined();
  });

  it('fills every field of the plain practice form from the kit', async () => {
    const { FIELDS } = await import('../src/pages/demo/practiceForm.js');
    const html = FIELDS.map(([name, label, type, ac, req]) => `<div><label for="pa-${name}">${label}${req ? ' *' : ''}</label>${type === 'textarea' ? `<textarea id="pa-${name}" name="${name}"></textarea>` : `<input id="pa-${name}" name="${name}" type="${type}" autocomplete="${ac}">`}</div>`).join('');
    const p = makePage(`<form>${html}</form>`, { url: 'https://nm7.si/demo/apply/customer-support-executive' });
    const r = await p.box.Nm7Fill(KIT, PDF);
    expect(r.blocked).toBeUndefined();
    expect(r.filled).toBe(8);
    expect(r.attached).toBe(true);
    expect(r.counts.left).toBe(0);
    const got = Object.fromEntries(FIELDS.filter(([, , t]) => t !== 'file').map(([n]) => [n, p.doc.getElementById(`pa-${n}`).value]));
    expect(got).toEqual({
      full_name: 'Priya Sharma (demo)', email: 'chrome-review@nm7.si', phone: '+91 90000 12345', city: 'Pune',
      linkedin: 'https://linkedin.com/in/priya-sharma-demo', notice_period: '30 days', degree: 'B.Com Computer Applications',
      cover_note: KIT.coverNote,
    });
    p.close();
  });
});

describe('the Chrome Web Store test instructions (docs/extension/test-instructions.md)', () => {
  const doc = readFileSync(join(EXT, '..', 'docs', 'extension', 'test-instructions.md'), 'utf8');
  const box = doc.match(/```\n([\s\S]*?)\n```/)[1];
  const code = (p) => readFileSync(join(EXT, '..', p), 'utf8');

  it('fit the 1,000-character box with the password added, and say how long they are', () => {
    expect(box.length + 1 + 27).toBeLessThan(1000);
    expect(doc).toContain(`${box.length} characters without the password`);
    expect(box).toContain('Username: chrome-review@nm7.si');
    expect(box).toContain('Password: see below');
  });

  it('use the real words on the screens and the real links', () => {
    const popup = read('popup.js'); const content = read('src/content.js');
    for (const [words, where] of [
      ['Make a pairing code', code('frontend/src/pages/me/AutoApplyOneTap.jsx')], ['Nm7 Apply helper', code('frontend/src/pages/me/AutoApplyOneTap.jsx')],
      ['Jobs ready', code('frontend/src/pages/me/AutoApplyV2.jsx')], ['Pairing code from Nm7', popup], ['Connect', popup],
      ['Fill this page', popup], ['Fill this step', content], ['Next', code('frontend/src/pages/demo/PracticeSystem.jsx')],
      ['Mark as applied on Nm7', content], ['Submit application', code('frontend/src/pages/demo/PracticeSystem.jsx')],
      ['Practice form: nothing was sent', code('frontend/src/pages/demo/practiceForm.js')],
    ]) {
      expect(box, words).toContain(words);
      expect(where, words).toContain(words);
    }
    expect(box).toContain('https://nm7.si/login');
    expect(box).toContain('https://nm7.si/me/auto-apply/v2?tab=ready');
    expect(box).toContain('https://nm7.si/demo/apply/cloud-portal');
    expect(code('backend/app/core/reviewer.py')).toMatch(/PRACTICE = \(\n\s+\("cloud-portal"/); // its kit comes first
  });
});

describe('popup', () => {
  // A tiny DOM that behaves like the real one: anything that is not a node (null, false, a string) becomes text,
  // so a stray null would show up as the word "null" in the popup.
  function fakeDom() {
    const mk = (tag) => {
      const n = {
        isNode: true, tag, kids: [], attrs: {}, className: '', value: '', listeners: {},
        append(...k) { for (const x of k) { const c = x && x.isNode ? x : { isNode: true, text: String(x), kids: [] }; c.parent = n; n.kids.push(c); } },
        replaceChildren(...k) { n.kids = []; n.append(...k); },
        setAttribute(a, v) { n.attrs[a] = v; }, addEventListener(t, fn) { n.listeners[t] = fn; }, focus() {}, remove() { if (n.parent) n.parent.kids = n.parent.kids.filter((x) => x !== n); },
      };
      return n;
    };
    const app = mk('main');
    const text = (n) => (n.text ?? '') + n.kids.map(text).join('');
    const find = (n, pred) => (pred(n) ? n : n.kids.map((k) => find(k, pred)).find(Boolean));
    return { app, text, find, document: { getElementById: () => app, createElement: mk } };
  }

  async function render({ kits, url = 'https://careers.zeta.in/apply/1', submitted = null, state = null, permissions = {}, results = null }) {
    const dom = fakeDom();
    const sent = [];
    const replies = {
      status: { paired: true, me: { firstName: 'Sai', missReports: false }, submitted },
      kits: { items: kits },
      'tab-state': { state },
      kit: { ...kits[0], fields: [] },
      remember: { state: {} },
      'fill-done': { ok: true },
      applied: { ok: true, askRating: true, storeUrl: 'https://nm7.si/store-placeholder' },
    };
    const box = {
      document: dom.document, URL, navigator: { userAgent: 'Chrome' },
      chrome: {
        runtime: { sendMessage: (m, cb) => { sent.push(m); cb(replies[m.type] || {}); }, lastError: null },
        tabs: { query: async (q) => { expect(q).toEqual({ active: true, currentWindow: true }); return [{ id: 7, url }]; }, create(o) { sent.push({ type: 'open', ...o }); } },
        scripting: { executeScript: async (o) => (o.func ? (results || []).map((result) => ({ result })) : []) },
        permissions: {
          contains: async ({ origins }) => !!permissions[origins[0]],
          request: async ({ origins }) => { sent.push({ type: 'ask', origins }); return !!permissions.grant; },
        },
      },
    };
    box.globalThis = box;
    vm.createContext(box);
    for (const file of ['src/config.js', 'src/blocklist.js', 'popup.js']) vm.runInContext(read(file), box, { filename: file });
    const tick = async () => { for (let i = 0; i < 30; i += 1) await new Promise((r) => setTimeout(r, 0)); };
    await tick();
    return { dom, sent, tick, text: () => dom.text(dom.app), click: async (label) => { const sel = dom.find(dom.app, (n) => n.tag === 'select'); if (sel && !sel.value) sel.value = (sel.kids.find((o) => 'selected' in o.attrs) || sel.kids[0]).attrs.value; const b = dom.find(dom.app, (n) => n.tag === 'button' && dom.text(n) === label); b.listeners.click({ target: b }); await tick(); } };
  }

  const kit = (id, applyHost, applyUrl, title = 'Data Analyst') => ({ id, applyHost, applyUrl, job: { title, company: 'Zeta' } });

  it('never shows the word "null", whether or not the page matches the job', async () => {
    const matched = await render({ kits: [kit('k1', 'careers.zeta.in', 'https://careers.zeta.in/apply/1')] });
    const other = await render({ kits: [kit('k1', 'jobs.other.com', 'https://jobs.other.com/x')] });
    const pending = await render({ kits: [kit('k1', 'careers.zeta.in', 'https://careers.zeta.in/apply/1')], submitted: { tabId: 7, kitId: 'k1' } });
    for (const t of [matched.text(), other.text(), pending.text()]) {
      expect(t).toContain('Fill this page');
      expect(t).not.toMatch(/null|undefined|false/);
    }
    expect(other.text()).toContain('isn’t the job’s apply link');
    expect(pending.text()).toContain('You pressed Submit for Data Analyst');
  });

  it('picks the right job from the page address, by path where several kits share a site', async () => {
    const popup = read('popup.js');
    const pickKit = new Function(`${popup.match(/function sameSite\([\s\S]*?\n\}/)[0]}\n${popup.match(/function pickKit\([\s\S]*?\n\}/)[0]}; return pickKit;`)();
    const kits = [kit('a', 'nm7.si', 'https://nm7.si/demo/apply/junior-data-analyst'), kit('b', 'nm7.si', 'https://nm7.si/demo/apply/cloud-portal'),
      kit('c', 'acme.wd3.myworkdayjobs.com', 'https://acme.wd3.myworkdayjobs.com/en-US/careers/job/Pune/Analyst_R123')];
    expect(pickKit(kits, 'https://nm7.si/demo/apply/cloud-portal').id).toBe('b');
    expect(pickKit(kits, 'https://www.nm7.si/demo/apply/junior-data-analyst?x=1').id).toBe('a');
    expect(pickKit(kits, 'https://acme.wd3.myworkdayjobs.com/en-US/careers/job/Pune/Analyst_R123/apply/applyManually').id).toBe('c');
    expect(pickKit(kits, 'https://other.example.com/')).toBeNull();
    const r = await render({ kits, url: 'https://nm7.si/demo/apply/cloud-portal' });
    const select = r.dom.find(r.dom.app, (n) => n.tag === 'select');
    expect(select.kids.find((o) => 'selected' in o.attrs).attrs.value).toBe('b');
  });

  it('remembers the kit and step for the tab and offers Fill this step', async () => {
    const r = await render({ kits: [kit('k1', 'careers.zeta.in', 'https://careers.zeta.in/apply/1'), kit('k2', 'careers.zeta.in', 'https://careers.zeta.in/apply/2')], state: { kitId: 'k2', host: 'careers.zeta.in', step: 2 } });
    expect(r.text()).toContain('Step 2 done on this page');
    expect(r.text()).toContain('Fill this step');
    const select = r.dom.find(r.dom.app, (n) => n.tag === 'select');
    expect(select.kids.find((o) => 'selected' in o.attrs).attrs.value).toBe('k2');
    expect(read('background.js')).toMatch(/chrome\.tabs\.onRemoved\.addListener\(\(tabId\) => \{ chrome\.storage\.session\.remove\(tabKey\(tabId\)\); \}\)/);
  });

  it('a form in a frame from another site: asks for that one site at the moment of need, and offers to open it if declined', async () => {
    const results = [{ top: true, host: 'careers.lotus.example', filled: 0, total: 0, counts: { sure: 0, check: 0, left: 0, draft: 0 }, list: [], more: {}, frames: [{ origin: 'https://lotus.icims.com', host: 'lotus.icims.com', src: 'https://lotus.icims.com/jobs/1/apply' }] }];
    const no = await render({ kits: [kit('k1', 'careers.lotus.example', 'https://careers.lotus.example/x')], url: 'https://careers.lotus.example/x', results });
    await no.click('Fill this page');
    expect(no.text()).toContain('Part of this form is inside a box from lotus.icims.com. To fill it, Chrome will ask you to let the helper read and change that one site.');
    await no.click('Allow and fill');
    expect(no.sent).toContainEqual({ type: 'ask', origins: ['https://lotus.icims.com/*'] }); // one site, not every site
    expect(no.text()).toContain('OK, nothing changed.');
    await no.click('Open the form on its own page');
    expect(no.sent).toContainEqual({ type: 'open', url: 'https://lotus.icims.com/jobs/1/apply' });
    // already allowed and filled there: nothing is asked
    const filledThere = [{ ...results[0] }, { top: false, host: 'lotus.icims.com', filled: 5, total: 6, counts: { sure: 5, check: 0, left: 1, draft: 0 }, list: [], more: {} }];
    const yes = await render({ kits: [kit('k1', 'careers.lotus.example', 'https://careers.lotus.example/x')], url: 'https://careers.lotus.example/x', results: filledThere, permissions: { 'https://lotus.icims.com/*': true } });
    await yes.click('Fill this page');
    expect(yes.text()).toContain('Filled 5 fields');
    expect(yes.text()).not.toContain('inside a box');
    expect(yes.sent.filter((m) => m.type === 'ask')).toEqual([]);
    // a frame from a job board: never asked for
    const board = [{ ...results[0], frames: [{ origin: 'https://www.naukri.com', host: 'www.naukri.com', src: 'https://www.naukri.com/x' }] }];
    const nb = await render({ kits: [kit('k1', 'careers.lotus.example', 'https://careers.lotus.example/x')], url: 'https://careers.lotus.example/x', results: board });
    await nb.click('Fill this page');
    expect(nb.text()).not.toContain('inside a box');
  });

  it('sends counts after a fill (and the miss labels only through the service worker’s opt-in check), and asks for a rating once after Mark as applied', async () => {
    const results = [{ top: true, host: 'careers.zeta.in', filled: 7, attached: true, total: 10, counts: { sure: 5, check: 2, left: 3, draft: 0 }, list: [{ label: 'Gender', state: 'left' }], questions: 0, more: {}, frames: [], misses: [{ label: 'Favourite colour', type: 'text' }], adapter: '' }];
    const r = await render({ kits: [kit('k1', 'careers.zeta.in', 'https://careers.zeta.in/apply/1')], results });
    await r.click('Fill this page');
    expect(r.text()).toContain('5 filled, 2 to check, 3 for you');
    const done = r.sent.find((m) => m.type === 'fill-done');
    expect(done).toEqual({ type: 'fill-done', kitId: 'k1', filled: 8, total: 10, misses: [{ label: 'Favourite colour', type: 'text' }], host: 'careers.zeta.in', adapter: '' });
    await r.click('Mark as applied on Nm7');
    expect(r.text()).toContain('A rating helps others find it');
    await r.click('No thanks');
    expect(r.sent).toContainEqual({ type: 'rating-dismiss' });
    expect(r.text()).not.toContain('A rating helps');
  });
});
