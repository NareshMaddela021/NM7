// The translation review list: every Telugu and Hindi string next to its English, as docs/translations-review.csv
// (columns: key, page, English, Telugu, Hindi, status). Telugu and Hindi are AI drafts, so every row says
// "needs native review" until a native speaker has checked it (docs/translations-review.md).
//   npm run i18n:review        writes the CSV (run it after changing src/i18n/*.json)
// src/lib/i18n.test.js checks that the committed CSV matches the JSON files.
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
export const FILES = ['home.json', 'pages.json'].map((f) => join(here, '..', 'src', 'i18n', f));
export const CSV_PATH = join(here, '..', '..', 'docs', 'translations-review.csv');
export const STATUS = 'needs native review';

/** Where a string is shown, for the reviewer (from its key). */
export function pageOf(key, file) {
  if (key === 'lang.label') return 'All translated pages · language switch';
  if (key.startsWith('nav.')) return 'Header (home, /for-orgs)';
  if (key === 'org.start') return 'Home + /for-orgs';
  if (file.endsWith('home.json')) return 'Home (top)';
  if (key.startsWith('pricing.')) return 'Home · pricing';
  if (key.startsWith('faq.seeker.')) return 'Home · FAQ';
  if (key.startsWith('home.')) return 'Home';
  if (key.startsWith('orgs.table.') || key.startsWith('orgs.faq.') || key === 'orgs.talk.title') return 'Home + /for-orgs';
  if (key.startsWith('orgs.')) return '/for-orgs';
  if (key.startsWith('builder.start.')) return '/builder (Start step)';
  if (key.startsWith('signin.')) return '/login (sign in)';
  return '';
}

const cell = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;

/** The CSV text (UTF-8 with a byte-order mark, so Excel shows Telugu and Hindi correctly). */
export function buildCsv(files = FILES) {
  const rows = [['key', 'page', 'English', 'Telugu', 'Hindi', 'status']];
  for (const f of files) {
    const t = JSON.parse(readFileSync(f, 'utf8'));
    for (const k of Object.keys(t.en)) rows.push([k, pageOf(k, f), t.en[k], t.te?.[k] ?? '', t.hi?.[k] ?? '', STATUS]);
  }
  return `﻿${rows.map((r) => r.map(cell).join(',')).join('\n')}\n`;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const csv = buildCsv();
  writeFileSync(CSV_PATH, csv);
  console.log(`${CSV_PATH}: ${csv.trim().split('\n').length - 1} strings, all "${STATUS}"`);
}
