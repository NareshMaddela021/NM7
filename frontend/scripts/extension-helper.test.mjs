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
    expect(m.host_permissions).toEqual(['https://nm7.si/*']);
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

  it('loads no remote code and sends nothing anywhere but nm7.si (no analytics)', () => {
    for (const p of code) {
      const src = read(p);
      expect(src, p).not.toMatch(/<script[^>]+src=["']https?:/i);
      expect(src, p).not.toMatch(/\beval\s*\(|new\s+Function\s*\(|importScripts\(\s*['"]https?:/);
      expect(src, p).not.toMatch(/google-analytics|googletagmanager|gtag\(|segment\.|mixpanel|sentry|amplitude|hotjar/i);
      for (const url of src.match(/https?:\/\/[^\s'"`)]+/g) || []) expect(url.startsWith('https://nm7.si'), `${p}: ${url}`).toBe(true);
    }
    expect(read('src/config.js')).toContain("api: 'https://nm7.si/api/helper'");
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
