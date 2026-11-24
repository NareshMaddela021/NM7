// The Nm7 Apply helper (the Chrome extension in ../extension): field mapping, the job-board list, the manifest
// (Manifest V3, minimal permissions, no remote code) and the promise that it never submits a form or presses a button.
// The extension's scripts are plain browser scripts (no build step), so they are loaded here into a sandbox.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import { describe, expect, it } from 'vitest';

const EXT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'extension');
const read = (p) => readFileSync(join(EXT, p), 'utf8');

function load(...files) {
  const box = { globalThis: null };
  box.globalThis = box;
  vm.createContext(box);
  for (const f of files) vm.runInContext(read(f), box, { filename: f });
  return box;
}

const { Nm7FieldMap: M, Nm7Blocklist: B } = load('src/blocklist.js', 'src/fieldmap.js');

const KIT = {
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
const plan = (fields, host = 'careers.zeta.in') => M.planFill(fields, KIT, host);
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
    expect(got[0].value).toBe('Sai');
    expect(got[1].value).toBe('Varsha');
    expect(got[2].value).toBe('sai@example.com');
    expect(got[3]).toMatchObject({ value: '+91 98765 43210', how: 'autocomplete' });
    expect(got[4].value).toBe('Hyderabad');
    expect(got[5].value).toBe('https://linkedin.com/in/sai');
    expect(got[6].value).toBe('30 days');
    expect(got[7].value).toBe('₹4 lakh a year or more');
    expect(got[8].value).toBe('JNTU Hyderabad');
    expect(got[9].value).toBe('I build weekly SQL dashboards.');
    expect(got[10]).toMatchObject({ key: 'resume', value: 'Sai_Varsha_Resume.pdf' });
  });

  it('fills a ready answer into a matching question box', () => {
    const p = plan([f({ tag: 'textarea', type: 'textarea', label: 'Why do you want this role at Zeta?' })]);
    expect(p.fill[0]).toMatchObject({ key: 'answer', value: 'I like turning data into decisions.' });
  });

  it('never fills passwords, hidden fields, choices, CAPTCHAs, sensitive or unknown questions', () => {
    const fields = [
      f({ type: 'password', label: 'Create a password' }), f({ type: 'hidden', name: 'csrf' }), f({ type: 'checkbox', label: 'I agree to the privacy policy' }),
      f({ type: 'radio', label: 'Willing to relocate?' }), f({ tag: 'select', type: 'select', label: 'Country' }),
      f({ name: 'g-recaptcha-response', inCaptcha: true }), f({ label: 'Gender' }), f({ label: 'Date of birth' }),
      f({ label: 'Current CTC' }), f({ label: 'Aadhaar number' }), f({ label: 'Religion' }), f({ type: 'file', label: 'Photo' }),
      f({ label: 'Favourite colour of the sky' }), f({ label: 'Email', filled: true }), f({ label: 'Phone', disabled: true }),
      f({ type: 'submit', label: 'Submit application' }),
    ];
    const p = plan(fields);
    expect(p.fill).toEqual([]);
    const why = Object.fromEntries(p.skip.map((s) => [s.index, s.why]));
    expect(why).toMatchObject({
      0: 'password', 1: 'not_a_field', 2: 'choice', 3: 'choice', 4: 'choice', 5: 'captcha', 6: 'sensitive', 7: 'sensitive',
      8: 'sensitive', 9: 'sensitive', 10: 'sensitive', 11: 'other_file', 12: 'unknown', 13: 'already_filled', 14: 'locked',
      15: 'not_a_field',
    });
  });

  it('leaves a field empty when the kit has no value for it (nothing is made up)', () => {
    const p = plan([f({ label: 'GitHub profile' }), f({ label: 'Current company' })]);
    expect(p.fill).toEqual([]);
    expect(p.skip.map((s) => s.why)).toEqual(['not_in_kit', 'not_in_kit']);
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
});

describe('manifest', () => {
  const m = JSON.parse(read('manifest.json'));
  it('is Manifest V3 with only activeTab, scripting and storage, and only nm7.si', () => {
    expect(m.manifest_version).toBe(3);
    expect([...m.permissions].sort()).toEqual(['activeTab', 'scripting', 'storage']);
    expect(m.host_permissions).toEqual(['https://nm7-api.onrender.com/*']);
    expect(m.optional_permissions).toBeUndefined();
    expect(m.optional_host_permissions).toBeUndefined();
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
      expect(src, p).not.toMatch(/\beval\s*\(|new\s+Function\s*\(|importScripts\(\s*['"]https?:/);
      expect(src, p).not.toMatch(/google-analytics|googletagmanager|gtag\(|segment\.|mixpanel|sentry|amplitude|hotjar/i);
      for (const url of src.match(/https?:\/\/[^\s'"`)]+/g) || []) expect(/^https:\/\/(nm7\.si|nm7-api\.onrender\.com)([/:]|$)/.test(url), `${p}: ${url}`).toBe(true);
    }
    expect(read('src/config.js')).toContain("api: 'https://nm7-api.onrender.com/api/helper'");
  });

  it('is ready for the store: version 1.0.0, icons 16 / 32 / 48 / 128 of the right size, no emoji or icon symbols', () => {
    expect(m.version).toBe('1.0.0');
    for (const n of [16, 32, 48, 128]) {
      expect(m.icons[n]).toBe(`icons/icon${n}.png`);
      expect(m.action.default_icon[n]).toBe(`icons/icon${n}.png`);
      const png = readFileSync(join(EXT, m.icons[n]));
      expect([png.readUInt32BE(16), png.readUInt32BE(20)], `icon${n}`).toEqual([n, n]); // the PNG's own width and height
    }
    // the same rule as src/noEmoji.test.js: plain typography (· … ’ “ ” × and so on) is fine, icon symbols are not
    const BANNED = /[\u2190-\u21FF\u2300-\u23FF\u2460-\u24FF\u25A0-\u25FF\u2600-\u27BF\u2900-\u297F\u2B00-\u2BFF\u{1F000}-\u{1FAFF}]|\uFE0F|\u20E3/u;
    for (const p of files.filter((f) => /\.(js|html|css|json)$/.test(f))) expect(read(p), p).not.toMatch(BANNED);
  });
});

describe('never submits', () => {
  // the scripts that run inside the company's page
  const page = ['src/content.js', 'src/fieldmap.js', 'src/blocklist.js'];
  it('has no code path that submits a form or clicks a button', () => {
    for (const p of page) {
      const src = read(p);
      expect(src, p).not.toMatch(/\.submit\s*\(|requestSubmit|\.click\s*\(|new\s+(Mouse|Pointer|Keyboard|Submit|Touch)Event|dispatchEvent\(\s*new\s+Event\(\s*['"](submit|click)/);
      expect(src, p).not.toMatch(/['"]Enter['"]|keyCode|[\w)\]]\.form\b(?!-)/); // no Enter key, no reaching a field's form
    }
  });

  it('only listens to the submit event, passively, and never stops it', () => {
    const src = read('src/content.js');
    expect(src).toMatch(/addEventListener\('submit'/);
    expect(src).toMatch(/passive: true/);
    expect(src).not.toMatch(/preventDefault|stopPropagation|stopImmediatePropagation|returnValue/);
  });

  it('fills a page without pressing anything, and offers Mark as applied after the candidate submits', () => {
    // a tiny fake page: inputs remember what was typed; anything that looks like pressing a button fails the test
    const typed = [];
    const listeners = {};
    const make = (attrs) => {
      const node = {
        tagName: attrs.tag || 'INPUT', type: attrs.type || 'text', id: attrs.id || '', value: '', files: null, labels: [{ textContent: attrs.label }],
        disabled: false, readOnly: false,
        getAttribute: (k) => ({ type: attrs.type, name: attrs.name || null }[k] ?? null),
        closest: () => null, getBoundingClientRect: () => ({ width: 100, height: 20 }), focus() {}, blur() {},
        dispatchEvent: (e) => { if (/submit|click/.test(e.type)) throw new Error('pressed'); return true; },
        click: () => { throw new Error('clicked'); }, submit: () => { throw new Error('submitted'); },
      };
      return node;
    };
    const inputs = [make({ label: 'Full name' }), make({ label: 'Email', type: 'email' }), make({ label: 'Gender' })];
    class Ev { constructor(type) { this.type = type; } }
    const proto = { };
    Object.defineProperty(proto, 'value', { set(v) { typed.push(v); this._v = v; }, configurable: true });
    const box = {
      location: { hostname: 'careers.zeta.in' },
      document: {
        querySelectorAll: (q) => (q.startsWith('input') ? inputs : []), querySelector: () => null, getElementById: () => null,
        addEventListener: (t, fn, o) => { listeners[t] = { fn, o }; }, createElement: () => ({ style: {}, setAttribute() {}, appendChild() {}, append() {}, addEventListener() {}, remove() {} }),
        documentElement: { appendChild() {} },
      },
      getComputedStyle: () => ({ visibility: 'visible' }),
      HTMLInputElement: { prototype: proto }, HTMLTextAreaElement: { prototype: proto },
      Event: Ev, chrome: { runtime: { sendMessage: (m) => typed.push(`msg:${m.type}`) } },
    };
    box.globalThis = box;
    vm.createContext(box);
    for (const p of ['src/blocklist.js', 'src/fieldmap.js', 'src/content.js']) vm.runInContext(read(p), box);
    const r = box.Nm7Fill(KIT, null);
    expect(r.filled).toBe(2);
    expect(r.sensitive).toBe(1);
    expect(typed).toEqual(['Sai Varsha', 'sai@example.com']);
    expect(listeners.submit.o).toMatchObject({ capture: true, passive: true });
    listeners.submit.fn({ preventDefault: () => { throw new Error('stopped the submit'); } });
    expect(typed).toContain('msg:nm7-submitted');
    box.location.hostname = 'www.naukri.com';
    expect(box.Nm7Fill(KIT, null)).toEqual({ blocked: true });
  });
});

// The Chrome Web Store review: the practice pages on nm7.si (src/pages/demo/PracticeApply.jsx) that the review
// account's kits link to. The helper must work there: nm7.si is no job board, the kit's applyHost matches the page,
// every field of the practice form is filled from the kit, and the submit listener offers "Mark as applied on Nm7".
describe('the practice pages for the Chrome Web Store review', () => {
  const REVIEW_KIT = {
    id: 'kit-review',
    job: { title: 'Junior Data Analyst', company: 'Demo Tech Solutions' },
    applyHost: 'nm7.si',
    coverNote: 'I build Excel and Power BI reports.',
    resume: { name: 'Priya_Sharma_Resume.pdf' },
    answers: [],
    fields: [
      { key: 'full_name', value: 'Priya Sharma (demo)' }, { key: 'first_name', value: 'Priya' }, { key: 'last_name', value: 'Sharma (demo)' },
      { key: 'email', value: 'chrome-review@nm7.si' }, { key: 'phone', value: '+91 90000 12345' }, { key: 'city', value: 'Pune' },
      { key: 'linkedin', value: 'https://linkedin.com/in/priya-sharma-demo' }, { key: 'degree', value: 'B.Com Computer Applications' },
      { key: 'college', value: 'Demo College of Commerce (demo)' }, { key: 'grad_year', value: '2024' }, { key: 'notice', value: '30 days' },
    ],
  };

  it('nm7.si is never blocked and the manifest needs no new permission (activeTab + scripting)', () => {
    for (const h of ['nm7.si', 'www.nm7.si']) expect(B.isBlocked(h)).toBe(false);
    const m = JSON.parse(read('manifest.json'));
    expect(m.version).toBe('1.0.0');
    expect(m.permissions).toEqual(['activeTab', 'scripting', 'storage']);
    expect(m.content_scripts).toBeUndefined();
  });

  it('fills every field of the practice form from the kit', async () => {
    const { FIELDS } = await import('../src/pages/demo/practiceForm.js');
    const fields = FIELDS.map(([name, label, type, autocomplete]) => f({
      tag: type === 'textarea' ? 'textarea' : 'input', type, name, id: `pa-${name}`, label: label + (FIELDS.find((x) => x[0] === name)[4] ? ' *' : ''),
      autocomplete,
    }));
    const p = M.planFill(fields, REVIEW_KIT, 'nm7.si');
    expect(p.skip).toEqual([]);
    const got = Object.fromEntries(p.fill.map((x) => [FIELDS[x.index][0], x.value]));
    expect(got).toEqual({
      full_name: 'Priya Sharma (demo)', email: 'chrome-review@nm7.si', phone: '+91 90000 12345', city: 'Pune',
      linkedin: 'https://linkedin.com/in/priya-sharma-demo', notice_period: '30 days', degree: 'B.Com Computer Applications',
      resume: 'Priya_Sharma_Resume.pdf', cover_note: 'I build Excel and Power BI reports.',
    });
  });

  it('the popup picks the kit for the page (applyHost nm7.si) and the submit listener marks it submitted', async () => {
    const popup = read('popup.js');
    const sameSite = new Function(`${popup.match(/function sameSite\([\s\S]*?\n\}/)[0]}; return sameSite;`)();
    expect(sameSite(REVIEW_KIT.applyHost, 'nm7.si')).toBe(true);
    expect(sameSite(REVIEW_KIT.applyHost, 'www.nm7.si')).toBe(true);
    const { FIELDS } = await import('../src/pages/demo/practiceForm.js');
    const typed = [];
    const listeners = {};
    const proto = {};
    Object.defineProperty(proto, 'value', { set(v) { typed.push(v); }, configurable: true });
    const inputs = FIELDS.filter(([, , type]) => type !== 'file').map(([name, label, type]) => ({
      tagName: type === 'textarea' ? 'TEXTAREA' : 'INPUT', type, id: `pa-${name}`, value: '', labels: [{ textContent: label }], disabled: false, readOnly: false,
      getAttribute: (k) => ({ type, name }[k] ?? null), closest: () => null, getBoundingClientRect: () => ({ width: 100, height: 20 }),
      focus() {}, blur() {}, dispatchEvent: (e) => { if (/submit|click/.test(e.type)) throw new Error('pressed'); return true; },
    }));
    const sent = [];
    const box = {
      location: { hostname: 'nm7.si' },
      document: {
        querySelectorAll: (q) => (q.startsWith('input') ? inputs : []), querySelector: () => null, getElementById: () => null,
        addEventListener: (t, fn, o) => { listeners[t] = { fn, o }; }, createElement: () => ({ style: {}, setAttribute() {}, appendChild() {}, append() {}, addEventListener() {}, remove() {} }),
        documentElement: { appendChild() {} },
      },
      getComputedStyle: () => ({ visibility: 'visible' }),
      HTMLInputElement: { prototype: proto }, HTMLTextAreaElement: { prototype: proto },
      Event: class { constructor(type) { this.type = type; } }, chrome: { runtime: { sendMessage: (m) => sent.push(m) } },
    };
    box.globalThis = box;
    vm.createContext(box);
    for (const p of ['src/blocklist.js', 'src/fieldmap.js', 'src/content.js']) vm.runInContext(read(p), box);
    const r = box.Nm7Fill(REVIEW_KIT, null);
    expect(r.blocked).toBeUndefined();
    expect(r.filled).toBe(8);
    expect(typed).toContain('chrome-review@nm7.si');
    listeners.submit.fn({});
    expect(sent).toContainEqual({ type: 'nm7-submitted', kitId: 'kit-review' });
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
      ['Fill this page', popup], ['Mark as applied on Nm7', content], ['Submit application', code('frontend/src/pages/demo/PracticeApply.jsx')],
      ['Practice form: nothing was sent', code('frontend/src/pages/demo/practiceForm.js')],
    ]) {
      expect(box, words).toContain(words);
      expect(where, words).toContain(words);
    }
    expect(box).toContain('https://nm7.si/login');
    expect(box).toContain('https://nm7.si/me/auto-apply/v2?tab=ready');
    expect(box).toContain('https://nm7.si/demo/apply/customer-support-executive');
    expect(code('backend/app/core/reviewer.py')).toMatch(/PRACTICE = \(\n\s+\("customer-support-executive"/); // its kit comes first
  });
});
