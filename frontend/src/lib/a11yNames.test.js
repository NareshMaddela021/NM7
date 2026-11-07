// Fix round item 35: radios and checkboxes on these screens never read as "on" to a screen reader: each has its own
// value, and the answer options and Compare ticks carry a name of their own.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const FILES = ['pages/me/AutoItems.jsx', 'pages/admin/live/JobPages.jsx', 'pages/jobs/Jobs.jsx', 'pages/company/CompanyApplicants.jsx', 'pages/company/CompanySignup.jsx'];

describe('screen-reader names (item 35)', () => {
  it.each(FILES)('%s: every radio and checkbox has a value or a name', (f) => {
    const src = readFileSync(join(__dirname, '..', f), 'utf8');
    const inputs = src.match(/<input type="(radio|checkbox)"[^>]*>/g) || [];
    expect(inputs.length).toBeGreaterThan(0);
    for (const x of inputs) expect(x, f).toMatch(/\b(value|aria-label)=/);
  });
  it('the answer options, Remember and Compare say what they are', () => {
    const items = readFileSync(join(__dirname, '..', 'pages/me/AutoItems.jsx'), 'utf8');
    expect(items).toMatch(/type="radio"[^>]*aria-label=\{l\}/);
    expect(items).toMatch(/aria-label=\{t\('aa.items.remember'\)\}/);
    expect(readFileSync(join(__dirname, '..', 'pages/company/CompanyApplicants.jsx'), 'utf8')).toMatch(/aria-label=\{`\$\{t\('co.ap.compare'\)\}: \$\{a.name\}`\}/);
  });
});
