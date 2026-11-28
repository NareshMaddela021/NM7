// Phone boxes never show a real-looking number as their placeholder ("98765 43210" looks like someone's number):
// they use the mask "XXXXX XXXXX" (components/PhoneInput.jsx). This scans every page, component and helper in
// frontend/src and the extension's own pages for a placeholder with 5 or more digits near a phone / mobile /
// WhatsApp / tel field. Demo people and tests that use example numbers on purpose are data, not placeholders.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const here = dirname(fileURLToPath(import.meta.url));
const SRC = join(here, '..');
const EXT = join(SRC, '..', '..', 'extension');

function files(dir, out = []) {
  for (const f of readdirSync(dir)) {
    const p = join(dir, f);
    if (f === 'node_modules' || f === 'fixtures') continue;
    if (statSync(p).isDirectory()) files(p, out);
    else if (/\.(jsx?|html)$/.test(f) && !/\.test\./.test(f)) out.push(p);
  }
  return out;
}

const PLACEHOLDER = /(?:placeholder|ph)\s*[:=]\s*\{?\s*(['"`])((?:\\.|(?!\1).)*)\1/gs;
const PHONEY = /phone|mobile|whats\s?app|\btel\b|contact/i;
const digits = (s) => (s.match(/\d[\d\s-]*\d/g) || []).some((run) => run.replace(/\D/g, '').length >= 5);

export function offenders(text) {
  const out = [];
  for (const m of text.matchAll(PLACEHOLDER)) {
    const value = m[2];
    const near = text.slice(Math.max(0, m.index - 300), m.index + m[0].length + 100);
    if (digits(value) && (PHONEY.test(near) || /98765|\+91/.test(value))) out.push(value.slice(0, 60));
  }
  return out;
}

describe('no real-looking numbers as phone placeholders', () => {
  it('the scanner catches the old one and accepts the mask', () => {
    expect(offenders('<Field id="su-p" label="Mobile (WhatsApp)" type="tel" placeholder="98765 43210" />')).toHaveLength(1);
    expect(offenders("f('tel', 'Phone', { placeholder: '+91 9876543210' })")).toHaveLength(1);
    expect(offenders('<input type="tel" placeholder="XXXXX XXXXX" />')).toEqual([]);
    expect(offenders('<input aria-label="Year" placeholder="2025" />')).toEqual([]);
  });
  for (const dir of [SRC, EXT]) {
    it(relative(join(SRC, '..', '..'), dir), () => {
      const bad = files(dir).flatMap((f) => offenders(readFileSync(f, 'utf8')).map((v) => `${relative(dir, f)}: ${v}`));
      expect(bad).toEqual([]);
    });
  }
});
