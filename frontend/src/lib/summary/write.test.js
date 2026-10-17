import { describe, expect, it } from 'vitest';
import { writeSummaries, writeOne, problems, numbersCovered, shorter, fillTemplate, STYLES, MAX_CHARS } from './write';
import { article, joinList, trimTo, dropLastSentence, sentences } from './grammar';
import { gatherFacts } from './facts';
import templates from './templates.json';
import dictionary from './dictionary.json';
import { INITIAL } from '../../pages/builder/schema';

const BLANK = { ...INITIAL, exp: [], edu: [], proj: [], certs: [], ach: [], langs: [], skillGroups: [], summary: '', personal: { ...INITIAL.personal, headline: '' } };
const good = (text, facts, note) => {
  expect(problems(text), text).toEqual([]);
  expect(text.length, text).toBeLessThanOrEqual(MAX_CHARS);
  expect(sentences(text).length, text).toBeGreaterThanOrEqual(1);
  expect(text).not.toMatch(/\{|\}|\[skill\]|\bundefined\b|\bnull\b/);
  expect(numbersCovered(text, facts, note), `invented number in: ${text}`).toBe(true);
};

describe('one summary per persona, in three styles', () => {
  const CASES = [
    ['fresher graduate', INITIAL, 'I am a fresher, I completed BTech, I want a data analyst job'],
    ['fresher school / ITI', BLANK, 'ITI electrician 2023, fresher, need electrician job'],
    ['experienced professional', { ...INITIAL, personal: { ...INITIAL.personal, level: 'Mid (3–6 yrs)' }, exp: [{ company: 'Infosys', role: 'Software Engineer', from: '2020-06', to: '2024-05', description: '• Cut build time by 40% for 6 teams' }] }, ''],
    ['skilled worker', BLANK, '10th pass, driver with 5 years experience, want cab driver job'],
    ['career changer', BLANK, 'changing my field from sales to data analyst. BCom graduate, 4 yrs sales executive, excel'],
    ['returning after a break', BLANK, 'housewife returning to work after 6 years, earlier worked as receptionist for 2 years'],
    ['unknown', BLANK, 'need job'],
  ];
  it.each(CASES)('%s', (_, resume, note) => {
    const { facts, options } = writeSummaries(resume, note);
    expect(options.map((o) => o.style)).toEqual(STYLES);
    for (const o of options) good(o.text, facts, note);
    expect(new Set(options.map((o) => o.text)).size).toBeGreaterThanOrEqual(2); // the styles differ
  });
  it('uses the facts it has: the driver', () => {
    const note = '10th pass, driver with 5 years experience, want cab driver job';
    const all = [0, 1].flatMap((seed) => writeSummaries(BLANK, note, { seed }).options.map((o) => o.text)).join(' ');
    expect(all).toMatch(/driver/i);
    expect(all).toMatch(/5 years/);
    expect(all).toMatch(/safe driving|route knowledge|punctuality/);
    expect(all).toMatch(/10th class/);
  });
  it('uses the resume: the sample graduate', () => {
    const { options } = writeSummaries(INITIAL, '');
    const all = options.map((o) => o.text).join(' ');
    expect(all).toMatch(/B\.Tech in Computer Science/);
    expect(all).toMatch(/Python/);
    expect(all).toMatch(/Data Analyst/);
    expect(all).not.toMatch(/Northwind|internship/i); // the note said nothing about an internship; the company only appears as a fact
  });
});

describe('edge cases', () => {
  it('empty note and empty resume still give three usable cards with no blanks', () => {
    const { facts, options } = writeSummaries(BLANK, '');
    for (const o of options) good(o.text, facts, '');
  });
  it('note only: "need job"', () => {
    const { facts, options } = writeSummaries(null, 'need job');
    for (const o of options) good(o.text, facts, 'need job');
  });
  it('never prints an empty blank, [skill] or a cliché', () => {
    expect(fillTemplate(['Skilled in {skills}.', 'Looking for {aTarget}.', 'Ready to learn.'], { skills: '', aTarget: 'a driver' })).toEqual(['Looking for a driver.', 'Ready to learn.']);
    expect(fillTemplate(['{role} for {years}{?atCompanyComma}.'], { role: 'Driver', years: '5 years', atCompanyComma: '' })).toEqual(['Driver for 5 years.']);
    expect(problems('A hardworking team player and go-getter.')).toContain('cliche');
    expect(problems('I am a driver with my own car.')).toContain('first_person');
    expect(problems('Call 98765 43210 or mail a@b.com')).toContain('contact');
    expect(problems('Skilled in [skill].')).toContain('blank');
    expect(problems('Driver with 5 years of experience.')).toEqual([]);
  });
  it('the number check catches invented numbers', () => {
    const facts = gatherFacts(BLANK, 'driver 5 years');
    expect(numbersCovered('Driver with 5 years of experience.', facts, 'driver 5 years')).toBe(true);
    expect(numbersCovered('Driver with 12 years of experience and 300 trips.', facts, 'driver 5 years')).toBe(false);
  });
  it('keeps to 400 characters', () => {
    const long = { ...INITIAL, skillGroups: [{ id: 'core', label: 'x', value: Array.from({ length: 5 }, (_, i) => `Skill number ${i} with a very long descriptive name indeed`).join(', ') }], exp: [{ company: 'A very long company name private limited and partners', role: 'Senior principal staff engineering manager of platforms', from: '2010-01', to: '2024-01', description: '• Grew revenue 3x across 14 regions while cutting costs by 25% and hiring 40 engineers over 4 years in total' }] };
    const { options } = writeSummaries(long, '');
    for (const o of options) expect(o.text.length).toBeLessThanOrEqual(MAX_CHARS);
  });
  it('"Try again" rotates the variant; "Shorter" drops the last sentence', () => {
    const facts = gatherFacts(INITIAL, '');
    const a = writeOne(facts, 'role_first', 0);
    const b = writeOne(facts, 'role_first', 1);
    expect(a).not.toBe(b);
    expect(writeOne(facts, 'role_first', 4)).toBe(a); // a cycle over the persona's two variants plus the two generic ones
    expect(sentences(shorter(a)).length).toBe(sentences(a).length - 1);
    expect(shorter('One sentence only.')).toBe('One sentence only.');
  });
  it('templates never carry numbers, first person or clichés, and every blank is a known one', () => {
    const known = new Set(templates.blanks);
    for (const persona of Object.values(templates.personas)) {
      for (const style of Object.values(persona)) {
        for (const tpl of style) {
          for (const s of tpl) {
            expect(s.replace(/\{\??\w+\}/g, ''), s).not.toMatch(/\d/);
            expect(problems(s.replace(/\{\??\w+\}/g, 'x')), s).toEqual([]);
            for (const [, name] of s.matchAll(/\{\??(\w+)\}/g)) expect(known.has(name), `${name} in ${s}`).toBe(true);
          }
        }
      }
    }
    expect(dictionary.banned.length).toBeGreaterThan(20);
  });
});

describe('grammar helpers', () => {
  it('a/an', () => {
    expect(article('driver')).toBe('a');
    expect(article('electrician')).toBe('an');
    expect(article('MBA graduate')).toBe('an');
    expect(article('ITI')).toBe('an');
    expect(article('B.Tech')).toBe('a');
    expect(article('university job')).toBe('a');
    expect(article('hour')).toBe('an');
  });
  it('lists and trimming', () => {
    expect(joinList(['Python', 'Excel', 'SQL'])).toBe('Python, Excel and SQL');
    expect(joinList(['Python'])).toBe('Python');
    expect(joinList([])).toBe('');
    expect(trimTo('First one. Second one. Third one.', 24)).toBe('First one. Second one.');
    expect(trimTo('A'.repeat(500), 100).length).toBeLessThanOrEqual(100);
    expect(dropLastSentence('A. B. C.')).toBe('A. B.');
  });
});
