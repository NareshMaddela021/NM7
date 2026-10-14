import { describe, expect, it } from 'vitest';
import { analyzeResume, WEIGHTS } from './analyze';
import { keywordsFor } from './keywords';
import { GOOD_DATA_ANALYST, GOOD_SOFTWARE, WEAK } from './fixtures/resumes';

const scan = (lines, role = 'Data Analyst', extra = {}) => analyzeResume({ lines, role, pages: 1, ...extra });
const lineText = (r, id) => r.sections.flatMap((s) => s.lines).find((l) => l.id === id)?.text ?? r.sections.find((s) => s.titleId === id)?.title;

describe('analyzeResume', () => {
  it('weights add up to 100 and the score is the sum of the checks', () => {
    expect(Object.values(WEIGHTS).reduce((a, b) => a + b, 0)).toBe(100);
    const r = scan(GOOD_DATA_ANALYST);
    expect(r.score).toBe(r.checks.reduce((s, c) => s + c.score, 0));
    r.checks.forEach((c) => expect(c.score).toBeLessThanOrEqual(c.max));
  });

  it('scores a strong resume well above a weak one', () => {
    const good = scan(GOOD_DATA_ANALYST);
    const weak = scan(WEAK);
    expect(good.score).toBeGreaterThanOrEqual(80);
    expect(weak.score).toBeLessThan(50);
    expect(good.score - weak.score).toBeGreaterThan(30);
    expect(good.targetScore).toBeGreaterThanOrEqual(good.score);
  });

  it('every issue points at a line or title the report shows', () => {
    [scan(WEAK), scan(GOOD_SOFTWARE, 'Data Analyst'), scan(GOOD_DATA_ANALYST, 'Data Analyst', { layout: { multiColumn: true, tables: 1 } })]
      .forEach((r) => r.issues.forEach((i) => expect(lineText(r, i.line), i.title).toBeTruthy()));
  });

  it('is deterministic: the same input gives the same report', () => {
    expect(scan(WEAK)).toEqual(scan(WEAK));
    expect(scan(GOOD_SOFTWARE, 'Software Engineer')).toEqual(scan(GOOD_SOFTWARE, 'Software Engineer'));
  });

  it('gives two different resumes different results, each showing its own lines', () => {
    const a = scan(GOOD_DATA_ANALYST);
    const b = scan(WEAK);
    expect(a.sections[0].title).toBe('Asha Kumar');
    expect(b.sections[0].title).toBe('Ravi Shankar');
    expect(a.score).not.toBe(b.score);
    expect(a.issues.map((i) => i.title)).not.toEqual(b.issues.map((i) => i.title));
  });

  it('keyword match changes with the role', () => {
    const asData = scan(GOOD_SOFTWARE, 'Data Analyst');
    const asSoftware = scan(GOOD_SOFTWARE, 'Software Engineer');
    expect(asSoftware.keywords.found.length).toBeGreaterThan(asData.keywords.found.length);
    expect(asSoftware.score).toBeGreaterThan(asData.score);
    expect(asSoftware.keywords.found).toContain('React');
    expect(asData.keywords.missing).toContain('Power BI');
    expect(asData.issues.some((i) => i.kind === 'keywords' && i.why.includes('Power BI'))).toBe(true);
  });

  it('adds the words of an unusual role as a keyword', () => {
    const { keywords } = keywordsFor('Supply Chain Analyst');
    expect(keywords[0][0]).toBe('Supply Chain');
    expect(keywordsFor('Data Analyst').keywords.map((k) => k[0])).not.toContain('Data');
    const r = scan([...WEAK, { text: 'Skills' }, { text: 'Supply chain planning, Excel' }], 'Supply Chain Analyst');
    expect(r.keywords.found).toContain('Supply Chain');
  });

  it('flags weak openers and bullets without numbers on the user’s own lines', () => {
    const r = scan(WEAK);
    const bullets = r.issues.filter((i) => i.kind === 'bullet');
    expect(bullets).toHaveLength(3);
    expect(lineText(r, bullets[0].line)).toMatch(/^• (Responsible for|Helped with|Worked on)/);
    const helped = bullets.find((i) => lineText(r, i.line).includes('Helped with'));
    expect(helped.title).toBe('Weak opener and no result');
    expect(helped.suggest).toMatch(/^Supported data entry for the sales team, \[result/);
    expect(helped.suggest).not.toMatch(/AI/);
  });

  it('notices contact, objective, personal details and mixed dates', () => {
    const r = scan(WEAK);
    const titles = r.issues.map((i) => i.title);
    expect(titles).toContain('Add your phone number and LinkedIn link');
    expect(titles).toContain('Generic objective wastes the top of the page');
    expect(titles).toContain('Remove personal details');
    expect(titles).toContain('Mixed date formats');
    expect(titles).toContain('No Skills section found');
    expect(scan(GOOD_DATA_ANALYST).issues.find((i) => i.kind === 'contact')).toBeUndefined();
  });

  it('treats a two-column layout, tables and a photo as ATS problems', () => {
    const plain = scan(GOOD_DATA_ANALYST);
    const fancy = scan(GOOD_DATA_ANALYST, 'Data Analyst', { layout: { multiColumn: true, tables: 1, images: 1 } });
    expect(plain.score - fancy.score).toBe(8 + 4 + 2);
    expect(fancy.issues.slice(0, 2).map((i) => i.sev)).toEqual(['Blocks ATS', 'Blocks ATS']);
    expect(fancy.issues.map((i) => i.title)).toEqual(expect.arrayContaining(['Two-column layout', 'Content inside a table', 'Remove the photo and personal details']));
  });

  it('checks length and reversed date ranges', () => {
    const short = scan(GOOD_DATA_ANALYST.slice(0, 8));
    expect(short.issues.some((i) => i.title === 'Too short')).toBe(true);
    const reversed = scan([...GOOD_DATA_ANALYST, { text: 'Volunteer · NSS · 2024 – 2022' }]);
    expect(reversed.issues.some((i) => i.title === 'A date range runs backwards')).toBe(true);
    expect(scan(GOOD_DATA_ANALYST, 'Data Analyst', { pages: 3 }).issues.some((i) => i.title === 'Longer than two pages')).toBe(true);
  });

  it('keeps the role to 60 characters', () => {
    const r = scan(WEAK, `  ${'x'.repeat(300)}  `);
    expect(r.role).toHaveLength(60);
  });
});
