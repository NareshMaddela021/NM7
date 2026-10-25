import { describe, expect, it } from 'vitest';
import { boardColumns, cardLine, fileSafe, filterCount, isInviteToken, searchQuery, sessionFromHash } from './recruiterPortal';

describe('recruiter portal', () => {
  it('builds the search query from the filters that are set', () => {
    expect(searchQuery({})).toBe('');
    expect(searchQuery({ skills: ' python, , SQL ', cgpaMin: 7.5, internship: true, projects: false, branch: '' }))
      .toBe('?skills=python%2CSQL&cgpaMin=7.5&internship=true');
    expect(filterCount({ skills: 'x', year: 2026, language: 'Telugu' })).toBe(3);
  });

  it('groups the board by stage, names in order', () => {
    const cols = boardColumns([{ name: 'Zoya', stage: 'interview' }, { name: 'Asha', stage: 'interview' }, { name: 'Bala', stage: 'none' }, { name: 'Dev', stage: 'selected' }]);
    expect(cols.interview.map((c) => c.name)).toEqual(['Asha', 'Zoya']);
    expect(cols.selected).toHaveLength(1);
    expect(cols.shortlisted).toEqual([]);
    expect(Object.keys(cols)).toEqual(['shortlisted', 'interview', 'selected', 'rejected']);
  });

  it('reads the demo session from the hash only', () => {
    expect(sessionFromHash('#s=abcdefghijklmnopqrstuvwxyz')).toBe('abcdefghijklmnopqrstuvwxyz');
    expect(sessionFromHash('#x=1&s=abcdefghijklmnopqrstuvwxyz')).toBe('abcdefghijklmnopqrstuvwxyz');
    expect(sessionFromHash('#s=short')).toBe('');
    expect(sessionFromHash('')).toBe('');
  });

  it('card line, file names and tokens', () => {
    expect(cardLine({ branch: 'CSE', cgpa: 8.4, year: 2026 })).toBe('CSE · 8.4 CGPA · 2026');
    expect(cardLine({ percentage: 72 })).toBe('72%');
    expect(fileSafe('Acme & Co. (India)')).toBe('Acme_Co_India');
    expect(isInviteToken('a'.repeat(43))).toBe(true);
    expect(isInviteToken('my-resume')).toBe(false);
  });
});
