// Vetting fix batch: the honesty pledge (before a test, a practical task or the AI interview), "Show this score to
// companies hiring now" and the other ticks on the skill check pages have a name of their own, so a screen reader
// never reads them as "on" (the label wraps long text with notes; the name is the short promise or choice).
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const FILES = ['pages/me/trust/Honesty.jsx', 'pages/me/vetting/Result.jsx', 'pages/me/MeSkillChecks.jsx', 'pages/me/MeInterviews.jsx', 'pages/me/trust/Snapshots.jsx', 'pages/me/trust/Spoken.jsx'];
const read = (f) => readFileSync(join(__dirname, '..', f), 'utf8');

describe('skill check ticks have names (vetting fix batch)', () => {
  it.each(FILES)('%s: every checkbox has aria-label or aria-labelledby', (f) => {
    const inputs = read(f).match(/<input type="checkbox"[^\n]*?\/>/g) || [];
    expect(inputs.length).toBeGreaterThan(0);
    for (const x of inputs) expect(x, f).toMatch(/\baria-(label|labelledby)=/);
  });
  it('the pledge tick is named by its promise line and described by the note', () => {
    const src = read('pages/me/trust/Honesty.jsx');
    expect(src).toMatch(/data-testid="pledge-tick"/);
    expect(src).toMatch(/aria-labelledby=\{`\$\{id\}-tick`\}/);
    expect(src).toMatch(/<strong lang=\{lang\} id=\{`\$\{id\}-tick`\}>\{t\.tick\}<\/strong>/);
    expect(src).toMatch(/aria-describedby=\{`\$\{id\}-note`\}/);
  });
  it('"Show this score to companies hiring now" says so', () => {
    expect(read('pages/me/vetting/Result.jsx')).toMatch(/aria-label="Show this score to companies hiring now" data-testid="vt-share"/);
  });
});
