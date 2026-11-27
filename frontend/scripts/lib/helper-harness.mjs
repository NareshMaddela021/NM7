// Test harness for the Nm7 Apply helper's page scripts (../../extension/src): a happy-dom page with the scripts run
// in a sandbox the way Chrome runs them in a tab (the same globals they use), a fake chrome.runtime that records
// every message, and a small type-to-search list behaviour for [role="combobox"] inputs (like a hiring system's own
// script would add). Used by the extension-*.test.mjs files.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import { Window } from 'happy-dom';

export const EXT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'extension');
export const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), '..', 'fixtures', 'helper');
export const read = (p) => readFileSync(join(EXT, p), 'utf8');
export const fixture = (name) => readFileSync(join(FIXTURES, name), 'utf8');

function configFiles() {
  const box = { globalThis: null };
  box.globalThis = box;
  vm.createContext(box);
  vm.runInContext(read('src/config.js'), box);
  return box.NM7_CONFIG.pageFiles;
}
export const PAGE_FILES = configFiles();

// [role=combobox] inputs show the matching items of `lists[input id or name]` (or `fallback`) as role=option items
// in their aria-controls list box, and take an item's text when it gets a click
export function comboBehaviour(win, lists = {}, fallback = []) {
  const doc = win.document;
  for (const input of doc.querySelectorAll('input[role="combobox"]')) {
    let box = doc.getElementById(input.getAttribute('aria-controls') || '');
    if (!box) {
      box = doc.createElement('ul');
      box.id = `${input.id || input.name}-list`;
      box.setAttribute('role', 'listbox');
      input.setAttribute('aria-controls', box.id);
      input.after(box);
    }
    const items = lists[input.id] || lists[input.name] || fallback;
    input.addEventListener('input', () => {
      box.textContent = '';
      const q = input.value.trim().toLowerCase();
      if (q.length < 2) return;
      for (const text of items.filter((x) => x.toLowerCase().includes(q))) {
        const li = doc.createElement('li');
        li.setAttribute('role', 'option');
        li.textContent = text;
        li.addEventListener('click', () => { input.value = text; box.textContent = ''; input.dataset.picked = text; });
        box.appendChild(li);
      }
    });
  }
}

export function makePage(html, { url = 'https://careers.example.in/apply', lists, fallback, files = PAGE_FILES, replies = {}, top = true } = {}) {
  const win = new Window({ url, width: 1280, height: 900, settings: { disableJavaScriptEvaluation: true, disableCSSFileLoading: true, disableIframePageLoading: true } });
  const doc = win.document;
  doc.body.innerHTML = html;
  comboBehaviour(win, lists, fallback);
  const sent = [];
  const chrome = {
    runtime: {
      id: 'nm7-test',
      sendMessage: (m, cb) => {
        sent.push(m);
        const r = typeof replies[m.type] === 'function' ? replies[m.type](m) : replies[m.type];
        if (cb) setTimeout(() => cb(r || {}), 0);
      },
    },
  };
  const box = {
    window: win, document: doc, location: win.location, navigator: win.navigator, chrome, console,
    getComputedStyle: (el) => win.getComputedStyle(el),
    HTMLInputElement: win.HTMLInputElement, HTMLTextAreaElement: win.HTMLTextAreaElement, HTMLSelectElement: win.HTMLSelectElement,
    Event: win.Event, MouseEvent: win.MouseEvent, DataTransfer: win.DataTransfer, File: win.File, MutationObserver: win.MutationObserver,
    URL, setTimeout: (fn, ms) => { const t = setTimeout(fn, ms); if (ms > 5000 && t.unref) t.unref(); return t; }, clearTimeout, atob, btoa, Uint8Array, Promise, Date, Math, JSON,
    addEventListener: (...a) => win.addEventListener(...a), scrollX: 0, scrollY: 0,
  };
  box.globalThis = box;
  box.self = box;
  box.top = top ? box : {};
  vm.createContext(box);
  for (const f of files) vm.runInContext(read(f), box, { filename: f });
  return { win, doc, box, sent, close: () => win.happyDOM.close() };
}

// the review account's kit (backend/app/autoapply/reviewer.py), as GET /api/helper/kits/{id} returns it
export const KIT = {
  id: 'kit-review',
  job: { title: 'Operations Trainee', company: 'Nimbus Freight (demo)' },
  applyHost: 'nm7.si',
  coverNote: 'I build Excel and Power BI reports and answer customer emails.',
  resume: { name: 'Priya_Sharma_Resume.pdf' },
  answers: [
    { question: 'Why are you interested in this role?', answer: 'I like turning customer questions and sales data into clear answers.' },
    { question: 'What is your notice period?', answer: '30 days' },
    { question: "Are you willing to work from the job's city?", answer: 'Yes, I can work from Pune.' },
  ],
  fields: [
    { key: 'full_name', value: 'Priya Sharma (demo)' }, { key: 'first_name', value: 'Priya' }, { key: 'last_name', value: 'Sharma (demo)' },
    { key: 'email', value: 'chrome-review@nm7.si' }, { key: 'phone', value: '+91 90000 12345' }, { key: 'city', value: 'Pune' },
    { key: 'linkedin', value: 'https://linkedin.com/in/priya-sharma-demo' }, { key: 'degree', value: 'B.Com Computer Applications' },
    { key: 'college', value: 'Demo College of Commerce (demo)' }, { key: 'grad_year', value: '2024' }, { key: 'notice', value: '30 days' },
  ],
  experience: [{ company: 'Demo Retail (demo)', title: 'Customer Support and Reporting Intern', from: '2025-01', to: '2025-06', current: false, description: 'Answered 40 customer emails a day' }],
  education: [{ school: 'Demo College of Commerce (demo)', degree: 'B.Com', field: 'Computer Applications', from: '2021-07', to: '2024-05', grade: '8.1 CGPA' }],
};
export const PDF = { name: 'Priya_Sharma_Resume.pdf', base64: Buffer.from('%PDF-1.4 practice').toString('base64') };
export const CITIES = ['Pune', 'Pune Cantonment', 'Mumbai', 'Hyderabad'];
export const COLLEGES = ['Demo College of Commerce (demo)', 'Demo Institute of Technology (demo)'];

export const marks = (doc) => Object.fromEntries(['sure', 'check', 'left', 'draft'].map((k) => [k, doc.querySelectorAll(`[data-nm7-mark="${k}"]`).length]));
export const val = (doc, sel) => doc.querySelector(sel).value;
