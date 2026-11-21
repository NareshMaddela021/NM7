// Polish rules checked in the CSS itself: stat cards have no blurred purple/orange glow under them.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const css = (f) => readFileSync(fileURLToPath(new URL(`./${f}`, import.meta.url)), 'utf8');

describe('stat cards', () => {
  it('no blurred glow under the glass cards or in the corner of admin stat cards', () => {
    expect(css('design.css')).not.toMatch(/\.glass::after/);
    expect(css('admin-ops.css')).not.toMatch(/\.ops-kpi::after/);
  });
});
