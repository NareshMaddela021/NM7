import { describe, expect, it } from 'vitest';
import { resumeFacts, summaryBasis, versionsFromResume, writeFromResume } from './fromResume';
import { numbersCovered, problems } from './write';

const base = { personal: { name: 'Asha', headline: '', level: '' }, exp: [], proj: [], edu: [], certs: [], langs: [], skillGroups: [], hidden: {}, pinfo: {} };
const full = {
  ...base,
  personal: { ...base.personal, headline: 'Data Analyst · SQL', level: 'Fresher (0–1 yr)' },
  exp: [{ role: 'Data Analyst intern', company: 'Northwind Retail', from: '2025-01', to: '2025-06' }, { role: 'Tutor', company: 'Home', from: '2023-01', to: '2023-06' }],
  proj: [{ title: 'Sales dashboard for 3 stores' }],
  certs: [{ name: 'Google Data Analytics Certificate' }],
  edu: [{ degree: 'B.Sc', field: 'Statistics', to: '2024-05' }],
  langs: [{ name: 'English' }, { name: 'Telugu' }],
  skillGroups: [{ id: 'core', value: 'Python, SQL, Power BI, Excel' }],
};
const sentences = (t) => t.split(/(?<=\.)\s+/).filter(Boolean);
const clean = (t) => {
  expect(t).not.toMatch(/\{|\}|undefined|null|\s\.|\s,|,,|\.\.|\s{2}/);
  expect(problems(t)).toEqual([]); // no blanks, clichés, first person, contact details; ≤ 400 characters
};

describe('summary written from the resume (no AI)', () => {
  it('a full resume: three sentences — who, proof, goal', () => {
    const t = writeFromResume(full, 'role_first');
    expect(t).toBe('Data Analyst intern at Northwind Retail, skilled in Python, SQL and Power BI. Project work includes Sales dashboard for 3 stores. Looking for an entry-level Data Analyst role.');
    expect(sentences(t)).toHaveLength(3);
    clean(t);
    expect(numbersCovered(t, full)).toBe(true); // the 3 is the person's own
  });

  it('three versions to pick from, all clean', () => {
    const v = versionsFromResume(full);
    expect(v.map((x) => x.label)).toEqual(['Role-first', 'Skills-first', 'Simple']);
    expect(v[1].text).toMatch(/^Skilled in Python, SQL and Power BI, with experience as Data Analyst intern at Northwind Retail\./);
    expect(v[2].text).toBe('Data Analyst intern at Northwind Retail. Looking for an entry-level Data Analyst role.');
    v.forEach((x) => clean(x.text));
  });

  it('skills only: one or two sentences, nothing invented', () => {
    const d = { ...base, skillGroups: [{ id: 'core', value: 'Tally, GST filing' }] };
    for (const style of ['role_first', 'skills_first', 'simple']) {
      const t = writeFromResume(d, style);
      expect(sentences(t).length).toBeGreaterThanOrEqual(1);
      expect(sentences(t).length).toBeLessThanOrEqual(2);
      clean(t);
    }
    expect(writeFromResume(d)).toBe('Skilled in Tally and GST filing.');
    expect(writeFromResume({ ...d, personal: { ...d.personal, level: 'Fresher (0–1 yr)' } })).toBe('Fresher skilled in Tally and GST filing.');
  });

  it('proof is the first that exists: project, else certification, else internship', () => {
    const noProj = { ...full, proj: [] };
    expect(writeFromResume(noProj, 'role_first')).toContain('Completed Google Data Analytics Certificate.');
    const onlyIntern = { ...noProj, certs: [] };
    expect(writeFromResume(onlyIntern, 'skills_first')).not.toContain('Interned as'); // the job is already in sentence 1
    expect(writeFromResume({ ...onlyIntern, skillGroups: [] }, 'role_first')).not.toMatch(/Interned as/);
  });

  it('the course only when "Mention my course" is on', () => {
    const noJob = { ...full, exp: [] };
    expect(writeFromResume(noJob)).not.toMatch(/B\.Sc|Statistics/);
    expect(writeFromResume(noJob, 'role_first', { course: true })).toMatch(/^B\.Sc in Statistics graduate skilled in Python, SQL and Power BI\./);
  });

  it('leaves out contact details, ID numbers and switched-off entries', () => {
    const d = { ...full, exp: [{ role: 'Clerk', company: 'Call 98765 43210', from: '2024-01' }], proj: [{ title: 'Aadhaar 1234 5678 9012 drive' }, { title: 'Hidden one', off: true }], certs: [] };
    const t = writeFromResume(d);
    expect(t).not.toMatch(/98765|1234|Hidden/);
    clean(t);
    expect(resumeFacts({ ...full, hidden: { skills: true } }).skills).toEqual([]);
  });

  it('nothing to say: an empty string, never a blank sentence', () => {
    expect(writeFromResume(base)).toBe('');
    expect(versionsFromResume(base)).toEqual([]);
  });

  it('the update prompt watches skills, role and experience', () => {
    const b = summaryBasis(full);
    expect(summaryBasis({ ...full, langs: [] })).toBe(b); // languages: no prompt
    expect(summaryBasis({ ...full, skillGroups: [{ id: 'core', value: 'Python, R' }] })).not.toBe(b);
    expect(summaryBasis({ ...full, personal: { ...full.personal, headline: 'Business Analyst' } })).not.toBe(b);
    expect(summaryBasis({ ...full, personal: { ...full.personal, level: 'Junior (1–3 yrs)' } })).not.toBe(b);
  });
});
