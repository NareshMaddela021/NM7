import { describe, expect, it } from 'vitest';
import { addCourses, coursesLine, coursesOf, splitCourses, suggestCourses } from './courses';
import { resumeText, jobMatch } from './atsScore';
import { writeFromResume } from './summary/fromResume';
import { INITIAL } from '../pages/builder/schema';
import { parseResume } from './import/resume';

describe('relevant courses', () => {
  it('splits comma lists, trims, cuts to 60 characters, ignores duplicates (case and bold), stops at 12', () => {
    expect(splitCourses('Data Structures, DBMS;  Operating   Systems\nOOP,,')).toEqual(['Data Structures', 'DBMS', 'Operating Systems', 'OOP']);
    expect(addCourses(['DBMS'], ['dbms', '**DBMS**', 'Data Structures'])).toEqual(['DBMS', 'Data Structures']);
    expect(addCourses([], ['x'.repeat(80)])[0]).toHaveLength(60);
    const many = addCourses([], Array.from({ length: 20 }, (_, i) => `Course ${i + 1}`));
    expect(many).toHaveLength(12);
    expect(many[11]).toBe('Course 12');
    expect(coursesOf({ courses: 'A, B, a' })).toEqual(['A', 'B']);
    expect(coursesOf({})).toEqual([]);
  });
  it('suggests courses from the field of study, without the ones already added', () => {
    expect(suggestCourses({ degree: 'B.Tech', field: 'Computer Science' })).toEqual(['Data Structures', 'DBMS', 'Operating Systems', 'Computer Networks', 'OOP', 'AI/ML']);
    expect(suggestCourses({ field: 'Computer Science', courses: ['DBMS', 'OOP'] })).not.toContain('DBMS');
    expect(suggestCourses({ degree: 'B.Com', field: '' })).toContain('Financial Accounting');
    expect(suggestCourses({ degree: 'Class 10', field: 'CBSE' })).toEqual([]);
  });
  it('reads "Courses: …" / "Relevant coursework - …" lines', () => {
    expect(coursesLine('Relevant Coursework: Data Structures, DBMS, OS')).toEqual(['Data Structures', 'DBMS', 'OS']);
    expect(coursesLine('• Courses - Thermodynamics; Machine Design')).toEqual(['Thermodynamics', 'Machine Design']);
    expect(coursesLine('B.Tech, Computer Science')).toBeNull();
  });
  it('counts for the ATS keywords and the job match', () => {
    const d = { ...structuredClone(INITIAL), hidden: {}, edu: [{ ...INITIAL.edu[0], courses: ['Computer Networks', '**Machine Learning**'] }] };
    expect(resumeText(d)).toContain('computer networks');
    expect(resumeText(d)).toContain('machine learning');
    expect(jobMatch(d, 'We need machine learning and SQL').found).toContain('machine learning');
  });
  it('"Write it from my resume" mentions up to 2 courses for a fresher without experience', () => {
    const base = { ...structuredClone(INITIAL), hidden: {}, exp: [], proj: [], certs: [], personal: { ...INITIAL.personal, headline: 'Software Developer', level: 'Fresher (0–1 yr)' } };
    const d = { ...base, edu: [{ ...INITIAL.edu[0], courses: ['Data Structures', 'DBMS', 'Operating Systems'] }] };
    const text = writeFromResume(d, 'role_first');
    expect(text).toContain('Coursework includes Data Structures and DBMS');
    expect(text).not.toContain('Operating Systems');
    const withJob = { ...d, exp: [{ company: 'Zoho', role: 'Developer Intern', from: '2024-01', to: '2024-06', description: '' }] };
    expect(writeFromResume(withJob, 'role_first')).not.toContain('Coursework');
  });
  it('an imported resume fills the courses from a Coursework line', () => {
    const rows = ['Ravi Kumar', 'ravi@example.com', '#Education', 'B.Tech, Computer Science', 'JNTU Hyderabad 2020 - 2024', 'Relevant coursework: Data Structures, DBMS, Computer Networks', '#Skills', 'Python, SQL'];
    const lines = rows.map((t, i) => ({ text: t.replace('#', ''), size: t.startsWith('#') ? 12 : 10, bold: t.startsWith('#'), x: 50, y: 40 + i * 14, page: 1, parts: [t.replace('#', '')] }));
    const r = parseResume(lines);
    const edu = r.data.edu[0];
    expect(edu.courses).toEqual(['Data Structures', 'DBMS', 'Computer Networks']);
    expect(JSON.stringify(edu)).not.toMatch(/coursework/i);
  });
});
