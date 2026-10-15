import { describe, expect, it } from 'vitest';
import { draftCover } from './cover';
import { INITIAL, real } from './schema';
import { blankResume } from '../../lib/customerStore';

describe('placeholders never reach a generated text', () => {
  it('real() drops empty and bracket placeholder values', () => {
    expect(real('  ')).toBe('');
    expect(real('[College]')).toBe('');
    expect(real('B.Tech at [College]')).toBe('');
    expect(real(' Anna University ')).toBe('Anna University');
  });
  it('the sample resume has no bracket placeholders or real GitHub accounts', () => {
    const text = JSON.stringify(INITIAL);
    expect(text).not.toMatch(/\[[A-Z][a-z]+\]/);
    expect(text).not.toMatch(/octocat|Hello-World/);
  });
  it('the cover letter draft skips placeholder and empty fields', () => {
    const d = { ...blankResume({ name: 'Asha' }), edu: [{ institution: '[College]', degree: 'B.Tech', field: 'Computer Science' }], exp: [{ company: '[Company]', role: 'Intern' }] };
    const t = draftCover(d, { role: 'Data Analyst', company: '' });
    expect(t).not.toMatch(/\[|\]/);
    expect(t).toMatch(/B\.Tech in Computer Science, and I am keen/);
    expect(t).not.toMatch(/ at \./);
    expect(t).toContain('your company');
  });
});
