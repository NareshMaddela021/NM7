import { describe, expect, it } from 'vitest';
import { normalizeProfile, sourcesFor, toResumeEntry, withProfileContact, targetRoleOf } from '../../lib/jobProfile';
import { fillSection, profileSectionOf } from './ProfileSync';
import { blankResume } from '../../lib/customerStore';

const p = normalizeProfile({
  personal: { name: 'Kiran Rao', headline: 'Data Analyst · SQL', email: 'k@example.com', phone: '98765 43210', location: 'Pune' },
  proj: [{ title: 'Apollo Tracker' }, { title: 'Borealis App' }],
  skillGroups: [{ id: 'core', label: 'Core', value: 'Python, SQL' }, { id: 'cloud', label: 'Cloud', value: 'AWS' }],
  hobbies: 'Chess\nCycling',
  summaries: [{ id: 's1', name: 'Main', text: 'Analyst summary' }],
  extra: [{ title: 'NSS volunteer' }],
  prefs: { targetRoles: 'Business Analyst, Data Analyst' },
});
const picked = (section) => sourcesFor(p, section).map(toResumeEntry);

describe('Fill a builder section from the Job Profile', () => {
  const d = { ...blankResume({ name: 'Kiran Rao' }), proj: [{ title: 'Own project' }], hobbies: 'Chess' };

  it('Add keeps what is there and skips duplicates', () => {
    const out = fillSection(d, 'proj', 'proj', picked('proj'), 'add');
    expect(out.proj.map((x) => x.title)).toEqual(['Own project', 'Apollo Tracker', 'Borealis App']);
    expect(fillSection(out, 'proj', 'proj', picked('proj'), 'add').proj).toHaveLength(3);
    expect(out.proj[1].pid).toBe(p.proj[0].pid);
  });
  it('Replace swaps the section for the chosen entries', () => {
    expect(fillSection(d, 'proj', 'proj', picked('proj').slice(1), 'replace').proj.map((x) => x.title)).toEqual(['Borealis App']);
  });
  it('drops the empty placeholder card instead of keeping it', () => {
    const e = fillSection(blankResume({}), 'edu', 'edu', [{ institution: 'Anna University' }], 'add');
    expect(e.edu.map((x) => x.institution)).toEqual(['Anna University']);
  });
  it('lines, skills and summary', () => {
    const h = fillSection(d, 'hobbies', 'hobbies', ['Chess', 'Cycling'], 'add');
    expect(h.hobbies).toBe('Chess\nCycling');
    expect(h.hidden.hobbies).toBe(false);
    const s = fillSection(d, 'skills', 'skills', picked('skills'), 'add');
    expect(s.skillGroups.find((g) => g.id === 'core').value).toBe('Python, SQL');
    expect(s.skillGroups.find((g) => g.id === 'cloud').value).toBe('AWS');
    expect(fillSection({ ...d, summary: 'Mine' }, 'summary', 'summary', ['Analyst summary'], 'replace').summary).toBe('Analyst summary');
    expect(fillSection({ ...d, summary: 'Mine' }, 'summary', 'summary', ['Analyst summary'], 'add').summary).toBe('Mine\n\nAnalyst summary');
  });
  it('extracurricular custom sections take the profile’s activities', () => {
    const c = { ...d, custom: [{ id: 'c_1', title: 'Extracurricular Activities', items: [] }, { id: 'c_2', title: 'Publications', items: [] }] };
    expect(profileSectionOf('c_1', c)).toBe('extra');
    expect(profileSectionOf('c_2', c)).toBe(null);
    expect(fillSection(c, 'c_1', 'extra', picked('extra'), 'add').custom[0].items[0].title).toBe('NSS volunteer');
  });
  it('cover letters: role and empty contact details come from the profile', () => {
    expect(targetRoleOf(p)).toBe('Business Analyst');
    const r = withProfileContact({ personal: { name: 'K. Rao', email: '', phone: '', location: '' } }, p);
    expect(r.personal).toMatchObject({ name: 'K. Rao', email: 'k@example.com', phone: '98765 43210', location: 'Pune' });
  });
});
