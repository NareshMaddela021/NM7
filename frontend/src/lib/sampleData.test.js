import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { INITIAL, emptyResume, completeResume } from '../pages/builder/schema';
import { DRAFTS_CLEARED, hasSample, isEmptyResume, sampleMarkers, scrubSampleDrafts, stripSample } from './sampleData';
import { blankResume } from './customerStore';
import { emptyProfile, profileToResume, resumeToProfileParts } from './jobProfile';

const SAMPLE_TEXT = ['sai-varsha-example', 'R. Raman', 'S. Lakshmi', '2003-05-15', 'Lakeview Institute', 'Northwind', 'Sai Varsha', 'saivarsha@example.com', 'Volunteering at NSS', 'Quick learner', 'Python, SQL, Statistics', 'Power BI, Excel, Git'];
const leaks = (d) => SAMPLE_TEXT.filter((t) => JSON.stringify(d).includes(t));

describe('sample data', () => {
  it('the backend list (sample_values.json) matches the sample person exactly', () => {
    const v = JSON.parse(readFileSync(new URL('../../../backend/app/maintenance/sample_values.json', import.meta.url), 'utf8'));
    const pick = (o, keys) => Object.fromEntries(keys.map((k) => [k, o[k]]));
    expect(v.personal).toEqual(pick(INITIAL.personal, Object.keys(v.personal)));
    expect(v.pinfo).toEqual(pick(INITIAL.pinfo, ['father', 'mother', 'dob', 'languages']));
    expect(v.links).toEqual(pick(INITIAL.links, ['linkedin', 'github']));
    expect([v.hobbies, v.strengths]).toEqual([INITIAL.hobbies, INITIAL.strengths]);
    expect(v.edu).toEqual(pick(INITIAL.edu[0], ['institution', 'degree', 'field', 'from', 'to', 'grade']));
    expect(v.exp).toEqual(pick(INITIAL.exp[0], ['company', 'role', 'from', 'to']));
    expect(v.proj).toEqual(pick(INITIAL.proj[0], ['title', 'tagline']));
    expect(v.cert).toEqual(pick(INITIAL.certs[0], ['name', 'issuer', 'issueDate']));
    expect(v.langs).toEqual(INITIAL.langs.map((l) => pick(l, ['name', 'level'])));
    expect(v.skillGroups).toEqual(Object.fromEntries(INITIAL.skillGroups.filter((g) => g.value).map((g) => [g.id, g.value])));
    expect(v.prefs).toEqual(INITIAL.prefs);
  });

  it('a new blank resume is empty apart from the account name, email and phone', () => {
    const d = blankResume({ name: 'Anjali K', email: 'anjali@example.com', phone: '+91 90000 00001' });
    expect(leaks(d)).toEqual([]);
    expect(d.personal).toMatchObject({ name: 'Anjali K', email: 'anjali@example.com', phone: '+91 90000 00001', headline: '', location: '' });
    expect([d.exp, d.edu, d.proj, d.certs, d.langs]).toEqual([[], [], [], [], []]);
    expect(d.skillGroups.every((g) => !g.value) && !d.hobbies && !d.strengths && !d.pinfo.father && !d.links.linkedin).toBe(true);
    expect(leaks(emptyResume())).toEqual([]);
  });

  it('completing a saved resume never fills gaps with the sample', () => {
    const d = completeResume({ personal: { name: 'Ravi' } });
    expect(leaks(d)).toEqual([]);
    expect(d.exp).toEqual([]);
  });

  it('strip removes exactly the sample values and keeps the person’s own', () => {
    const seeded = { ...structuredClone(INITIAL), personal: { ...INITIAL.personal, name: 'Anjali K', email: 'anjali@example.com' }, summary: 'Mine.',
      edu: [...structuredClone(INITIAL.edu), { institution: 'Lakeview Institute of Technology', degree: 'M.Tech', field: 'AI', from: '2025-08', to: '', grade: '' }],
      skillGroups: INITIAL.skillGroups.map((g) => (g.id === 'frameworks' ? { ...g, value: 'React' } : g)) };
    expect(sampleMarkers(seeded)).toEqual(expect.arrayContaining(['links.linkedin', 'pinfo.parents', 'edu', 'exp']));
    const out = stripSample(seeded);
    expect(hasSample(out)).toBe(false);
    expect(out.personal.name).toBe('Anjali K');
    expect(out.summary).toBe('Mine.');
    expect(out.edu.map((e) => e.degree)).toEqual(['M.Tech']); // a real Lakeview entry stays
    expect(out.skillGroups.find((g) => g.id === 'frameworks').value).toBe('React');
    expect(leaks(out).filter((t) => t !== 'Lakeview Institute')).toEqual([]);
  });

  it('a real "Lakeview" college alone is kept (no sample marker: nothing changes)', () => {
    const d = { personal: { name: 'Ravi' }, edu: [{ institution: 'Lakeview Institute of Technology', degree: 'B.Tech', field: 'Civil' }], hobbies: INITIAL.hobbies, langs: structuredClone(INITIAL.langs) };
    expect(hasSample(d)).toBe(false);
    expect(stripSample(d)).toBe(d);
  });

  it('the Job Profile never takes the sample in', () => {
    const parts = resumeToProfileParts(structuredClone(INITIAL));
    expect(leaks(parts)).toEqual([]);
    expect(leaks(profileToResume(emptyProfile({ name: 'X', email: 'x@example.com' })))).toEqual([]);
  });

  it('old browser drafts: cleaned once; a draft with nothing of the person’s own is removed', () => {
    const mem = new Map([
      ['asuraa-builder-draft-v6', JSON.stringify(INITIAL)],
      ['asuraa-builder-draft-v6:u1', JSON.stringify({ ...INITIAL, personal: { ...INITIAL.personal, name: 'Anjali K' } })],
      ['asuraa-builder-draft-v6:u2', JSON.stringify({ personal: { name: 'Ravi' } })],
      ['other', 'x'],
    ]);
    const store = { getItem: (k) => mem.get(k) ?? null, setItem: (k, v) => mem.set(k, v), removeItem: (k) => mem.delete(k), key: (i) => [...mem.keys()][i] ?? null, get length() { return mem.size; } };
    expect(scrubSampleDrafts(store)).toBe(2);
    expect(mem.has('asuraa-builder-draft-v6')).toBe(false);
    const kept = JSON.parse(mem.get('asuraa-builder-draft-v6:u1'));
    expect(kept.personal.name).toBe('Anjali K');
    expect(leaks(kept).filter((t) => t !== 'Sai Varsha')).toEqual([]);
    expect(isEmptyResume(kept)).toBe(false);
    expect(JSON.parse(mem.get('asuraa-builder-draft-v6:u2'))).toEqual({ personal: { name: 'Ravi' } });
    expect(mem.get(DRAFTS_CLEARED)).toBe('1');
  });
});
