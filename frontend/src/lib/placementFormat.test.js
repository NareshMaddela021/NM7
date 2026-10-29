import { describe, expect, it } from 'vitest';
import { brandFor, checklist, formatData, formatDesign, formatTemplate } from './placementFormat';
import { buildSections } from '../pages/builder/resumeModel';
import { DEFAULT_DESIGN } from '../pages/builder/design';

const RULES = { order: ['edu', 'proj', 'skills'], required: ['edu', 'skills'], requireCgpa: true, optional: ['certs', 'langs'], maxPages: 1, photo: false, showRoll: true };
const BRAND = { color: '#1F3A8A', templates: ['campus', 'academic'], template: 'campus', collegeName: 'JNTU Anantapur', headerStyle: 'center', rules: RULES };
const DATA = {
  personal: { name: 'Asha Rao', email: 'a@x.in' },
  summary: 'Hello',
  exp: [{ company: 'Infosys', role: 'Intern' }, { company: 'Hidden', role: 'x', off: true }],
  proj: [{ title: 'Campus Pay' }],
  edu: [{ institution: 'JNTU', degree: 'B.Tech', grade: '' }],
  skillGroups: [{ id: 'core', value: 'Python, SQL' }],
  langs: [{ name: 'Telugu' }],
  hobbies: 'Cricket',
  hidden: { langs: true },
  order: ['skills', 'exp', 'edu'],
  custom: [], certs: [], ach: [], links: {}, titles: {}, pinfo: {}, strengths: '',
  showPhoto: true,
  design: { preset: 'academic' },
};

describe('placement format', () => {
  it('uses the member’s template when the college allows it, else its first one', () => {
    expect(formatTemplate(BRAND, DATA)).toBe('academic');
    expect(formatTemplate(BRAND, { ...DATA, design: { preset: 'twocol' } })).toBe('campus');
    expect(formatDesign(BRAND, {}).preset).toBe('campus');
    expect(formatTemplate({ template: 'classic' }, DATA)).toBe('classic'); // an older brand: one template
  });

  it('changes the layout only: the college’s order first, photo off; content and section switches untouched', () => {
    const out = formatData(DATA, BRAND);
    expect(out.order.slice(0, 3)).toEqual(['edu', 'proj', 'skills']);
    expect(out.order).toContain('exp');
    expect(out.showPhoto).toBe(false);
    const { order, showPhoto, ...rest } = out; // eslint-disable-line no-unused-vars
    const { order: o2, showPhoto: p2, ...orig } = DATA; // eslint-disable-line no-unused-vars
    expect(rest).toEqual(orig); // same content, same hidden switches, same switched-off entries
    // what prints: the same sections as before (none switched on or off), only in another order
    const ids = (d) => buildSections(d, DEFAULT_DESIGN).main.map((s) => s.id);
    expect(new Set(ids(out))).toEqual(new Set(ids(DATA)));
    expect(ids(out)).not.toContain('langs'); // the member switched it off: still off
    expect(ids(out).slice(0, 3)).toEqual(['edu', 'proj', 'skills']);
    expect(formatData(DATA, { ...BRAND, rules: null })).toBe(DATA); // no rules: nothing to do
  });

  it('roll number only when the college shows it', () => {
    expect(brandFor(BRAND, '21A01').roll).toBe('21A01');
    expect(brandFor({ ...BRAND, rules: { ...RULES, showRoll: false } }, '21A01').roll).toBe('');
  });

  it('checklist of unmet rules', () => {
    const items = Object.fromEntries(checklist(DATA, BRAND, 2).map((i) => [i.key, i]));
    expect(items['req-edu'].ok).toBe(true);
    expect(items['req-skills'].ok).toBe(true);
    expect(items.cgpa).toMatchObject({ ok: false, text: 'CGPA or percentage required in Education' });
    expect(items.pages).toMatchObject({ ok: false, text: 'Keep to 1 page (now 2)' });
    expect(items.photo.ok).toBe(false);
    // summary, experience and hobbies aren't in the format (languages is switched off, so it isn't listed)
    expect(Object.keys(items).filter((k) => k.startsWith('extra-'))).toEqual(['extra-summary', 'extra-exp', 'extra-hobbies']);
    const fixed = { ...DATA, edu: [{ ...DATA.edu[0], grade: '8.2 CGPA' }], showPhoto: false };
    expect(checklist(fixed, BRAND, 1).filter((i) => !i.ok).map((i) => i.key)).toEqual(['extra-summary', 'extra-exp', 'extra-hobbies']);
    expect(checklist(DATA, { ...BRAND, rules: null })).toEqual([]);
  });
});
