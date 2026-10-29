import { describe, expect, it } from 'vitest';
import { align, compareResumes, designChanges, sectionRows, similarity, wordDiff } from './versionDiff';

const resume = (over = {}) => ({
  personal: { name: 'Asha Rao', headline: 'Data Analyst' },
  summary: 'Data analyst who builds dashboards.',
  exp: [{ id: 'e1', company: 'Acme', role: 'Intern', from: '2024-01', to: '2024-06', description: 'Built 12 Power BI dashboards for sales\nCleaned CSV files in Python' }],
  proj: [], edu: [], certs: [], ach: [], skillGroups: [{ id: 'core', label: 'Skills', value: 'SQL, Python' }], langs: [], custom: [],
  design: { preset: 'fresher', font: 'source-sans-3', accent: '#111827' },
  ...over,
});

describe('version compare', () => {
  it('aligns lines and finds the words that changed', () => {
    expect(align(['a', 'b', 'c'], ['a', 'c', 'd']).map((s) => s.op)).toEqual(['same', 'del', 'same', 'add']);
    expect(similarity('Built 12 dashboards for sales', 'Built 15 dashboards for sales')).toBeGreaterThan(0.5);
    const w = wordDiff('Built 12 dashboards', 'Built 15 dashboards');
    expect(w.a.filter((x) => x.op === 'del').map((x) => x.t)).toEqual(['12']);
    expect(w.b.filter((x) => x.op === 'add').map((x) => x.t)).toEqual(['15']);
  });

  it('pairs alike lines as changed; different lines stay added / removed', () => {
    const rows = sectionRows(['Built 12 Power BI dashboards for sales', 'Old line about nothing'], ['Built 15 Power BI dashboards for sales', 'Led a team of 4']);
    expect(rows.map((r) => r.op)).toEqual(['change', 'del', 'add']);
  });

  it('compares two resumes by section and lists design changes separately', () => {
    const a = resume();
    const b = resume({
      summary: 'Data analyst who builds dashboards and reports.',
      exp: [{ ...a.exp[0], description: 'Built 15 Power BI dashboards for sales\nCleaned CSV files in Python\nTrained 3 new interns' }],
      skillGroups: [{ id: 'core', label: 'Skills', value: 'SQL, Python, Excel' }],
      design: { preset: 'fresher', font: 'lora', accent: '#1d4ed8' },
      showPhoto: true,
    });
    const s = Object.fromEntries(compareResumes(a, b).map((x) => [x.title, x]));
    expect(s.Header.changed).toBe(false);
    const exp = Object.values(s).find((x) => x.rows.some((r) => r.op === 'change' && /15/.test(r.b)));
    expect(exp.counts).toEqual({ add: 1, del: 0, change: 1 });
    expect(designChanges(a, b)).toEqual([
      { what: 'Font', from: 'source-sans-3', to: 'lora' },
      { what: 'Accent colour', from: '#111827', to: '#1d4ed8' },
      { what: 'Photo', from: 'hidden', to: 'shown' },
    ]);
    expect(designChanges(a, a)).toEqual([]);
  });
});
