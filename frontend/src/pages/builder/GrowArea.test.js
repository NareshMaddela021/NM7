import { describe, expect, it } from 'vitest';
import { skillCount, skillDupes, TIP_AT } from './GrowArea';

describe('skill lists', () => {
  it('counts skills and estimates printed lines', () => {
    expect(skillCount('')).toBe('');
    expect(skillCount('Python')).toBe('1 skill · about 1 line on your resume');
    const many = Array.from({ length: 14 }, (_, i) => `Skill number ${i + 1}`).join(', ');
    expect(skillCount(many)).toMatch(/^14 skills · about 3 lines on your resume$/);
    expect(TIP_AT).toBe(15);
  });
  it('flags repeated skills, ignoring case and spaces', () => {
    expect(skillDupes('SQL, Python, sql')).toEqual({ idx: [2, 0], msg: 'SQL appears twice' });
    expect(skillDupes('Excel, excel , EXCEL').msg).toBe('Excel appears 3 times');
    expect(skillDupes('A, B').msg).toBe('');
  });
});
