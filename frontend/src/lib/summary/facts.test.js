import { describe, expect, it } from 'vitest';
import { factsFromNote, factsFromResume, mergeFacts, gatherFacts, findAchievement } from './facts';
import { INITIAL } from '../../pages/builder/schema';

// 30 notes as people type or speak them: English, Telugu and Hindi transliteration, misspellings, mixed language
const NOTES = [
  ['I am Angelin, I completed BSc Computer Science, I like working with data', { degree: 'B.Sc', field: 'Computer Science', eduLevel: 'degree' }],
  ['i am a fresher. i completed btech ece in 2024 and i want a software developer job', { degree: 'B.Tech', fresher: true, target: 'software developer' }],
  ['10th pass, driver with 5 years experience, want cab driver job', { eduLevel: '10th', years: 5, role: 'driver', target: 'driver' }],
  ['Nenu inter chadivanu. 2 samvatsaralu delivery boy ga pani chesanu. Driver job kavali', { eduLevel: '12th', years: 2, role: 'delivery partner', target: 'driver' }],
  ['maine 12vi pass kiya hai, 3 saal electrician ka kaam kiya, ab AC technician banna chahta hu', { eduLevel: '12th', years: 3, role: 'electrician', target: 'ac technician' }],
  ['Diplomo in mechanical, fressure, looking for production trainee', { degree: 'Diploma', field: 'Mechanical', fresher: true, target: 'production operator' }],
  ['ITI electrician completed 2023. 6 months experience in house wiring. need job', { eduLevel: 'iti', months: 6, role: 'electrician' }],
  ['housewife returning to work after 6 years break, earlier worked as receptionist for 2 years', { returning: true, role: 'receptionist', years: 2 }],
  ['I want to change my field from sales to data analyst. BCom graduate, 4 yrs sales executive', { changing: true, degree: 'B.Com', years: 4, role: 'sales executive', target: 'data analyst' }],
  ['mba hr fresher looking for hr executive role', { degree: 'MBA', fresher: true, target: 'hr executive' }],
  ['need job', {}],
  ['', {}],
  ['Worked as security guard in a mall for one year. Night shift ok.', { role: 'security guard', years: 1 }],
  ['Telecaller 3 years. Telugu Hindi English. Want customer support executive', { years: 3, role: 'telecaller', target: 'customer support executive' }],
  ['B.Com padava, Tally accounts 2 years, accountant job kavali', { degree: 'B.Com', years: 2, role: 'accountant', target: 'accountant' }],
  ['bsc nursing 2022, staff nurse 1.5 years in hospital', { degree: 'B.Sc Nursing', role: 'nurse' }],
  ['Me ek tailor hu, 8 saal se stitching ka kaam, boutique kholna chahti hu', { years: 8, role: 'tailor' }],
  ['Just passed 12th, no experience, interested in graphic design', { eduLevel: '12th', fresher: true, target: 'graphic designer' }],
  ['data entry operator 2 yrs, typing 40 wpm, excel, want back office executive job', { years: 2, role: 'data entry operator', target: 'office assistant' }],
  ['Final year btech cse student looking for internship in web development', { degree: 'B.Tech', field: 'Computer Science', target: 'intern' }],
  ['Cook in a hotel for 7 years, north indian and chinese, want chef job in good restaurant', { years: 7, role: 'cook', target: 'cook' }],
  ['mechanic 2 wheeler 4 years garage work', { years: 4, role: 'mechanic' }],
  ['pharmacy D.Pharm, 1 year medical shop', { role: 'pharmacist', years: 1 }],
  ['Teacher primary school 5 years, B.Ed, want teaching job in Hyderabad', { degree: 'B.Ed', years: 5, role: 'teacher', target: 'teacher' }],
  ['career break 3 years after kids. before that software engineer 4 years java', { returning: true, role: 'software developer', years: 4 }],
  ['delivery partner swiggy 2 years, own bike, looking for warehouse job', { years: 2, role: 'delivery partner', target: 'supply chain executive' }],
  ['Beautician course done, parlour lo 1 year pani chesanu', { role: 'beautician', years: 1 }],
  ['welder fabrication 10+ years, Gulf experience', { years: 10, role: 'welder' }],
  ['msc chemistry, QC chemist pharma 3 years, want QA role', { degree: 'M.Sc', years: 3, role: 'quality control chemist' }],
  ['PADAVA 10TH, HELPER PANI, DRIVER AVVALANI UNDI, LICENCE UNDI', { eduLevel: '10th', role: 'helper' }],
];

describe('facts from the note', () => {
  it.each(NOTES)('%s', (note, want) => {
    const got = factsFromNote(note);
    for (const [k, v] of Object.entries(want)) expect(got[k], k).toEqual(v);
  });
  it('gives the strengths of the roles found', () => {
    expect(factsFromNote('driver 5 years').strengths).toEqual(['safe driving', 'route knowledge', 'punctuality', 'vehicle care']);
    expect(factsFromNote('need job').strengths).toBeUndefined();
  });
  it('does not match everyday words as abbreviations', () => {
    const f = factsFromNote('let me be clear, i want it to get better, ma said so');
    expect(f.eduLevel).toBeUndefined();
    expect(f.role).toBeUndefined();
  });
  it('word numbers and plus signs count', () => {
    expect(factsFromNote('two years as a cashier').years).toBe(2);
    expect(factsFromNote('5+ yrs driver').years).toBe(5);
    expect(factsFromNote('rendu samvatsaralu helper').years).toBe(2);
  });
});

describe('facts from the resume', () => {
  it('reads the sample resume: education, experience, skills, headline, achievement, languages', () => {
    const f = factsFromResume(INITIAL);
    expect(f.degree).toBe('B.Tech');
    expect(f.field).toBe('Computer Science');
    expect(f.eduYear).toBe('2025');
    expect(f.role).toBe('Data Analyst Intern');
    expect(f.company).toBe('Northwind Retail');
    expect(f.months).toBe(6);
    expect(f.skills).toEqual(['Python', 'SQL', 'Statistics', 'Pandas', 'NumPy']);
    expect(f.target).toBe('Data Analyst');
    expect(f.certs).toEqual(['Google Data Analytics Certificate']);
    expect(f.languages).toEqual(['English', 'Tamil', 'Hindi']);
    expect(f.achievement).toBeUndefined(); // the sample bullets have no numbers
  });
  it('leaves out entries switched off and hidden sections', () => {
    const d = { ...INITIAL, exp: INITIAL.exp.map((e) => ({ ...e, off: true })), hidden: { ...INITIAL.hidden, skills: true } };
    const f = factsFromResume(d);
    expect(f.role).toBeUndefined();
    expect(f.hasExperience).toBe(false);
    expect(f.skills).toBeUndefined();
  });
  it('finds one achievement with a number and never an ID or a phone', () => {
    expect(findAchievement(['made dashboards\n• Cut reporting from 5 hours to 30 minutes for 12 managers'])).toBe('Cut reporting from 5 hours to 30 minutes for 12 managers');
    expect(findAchievement(['Aadhaar 4821 7365 9012 submitted', 'Call 98765 43210 for 20 orders', 'Served 300 customers a day'])).toBe('Served 300 customers a day');
    expect(findAchievement(['no numbers here'])).toBe('');
  });
});

describe('merging', () => {
  it('the resume wins over the note', () => {
    const f = mergeFacts(factsFromResume(INITIAL), factsFromNote('10th pass driver 5 years'));
    expect(f.degreeFull).toBe('B.Tech in Computer Science');
    expect(f.role).toBe('Data Analyst Intern');
    expect(f.years).toBe('6 months');
  });
  it('the note fills what the resume lacks', () => {
    const empty = { ...INITIAL, exp: [], edu: [], skillGroups: [], certs: [], langs: [], personal: { ...INITIAL.personal, headline: '' } };
    const f = gatherFacts(empty, 'driver 5 years, want cab driver job');
    expect(f.role).toBe('driver');
    expect(f.years).toBe('5 years');
    expect(f.persona).toBe('skilled');
    expect(f.strengths).toContain('safe driving');
  });
  it.each([
    ['fresher graduate', 'btech cse fresher, want software developer', 'fresher_grad'],
    ['fresher school', '10th pass fresher', 'fresher_school'],
    ['experienced', 'software developer 4 years java', 'experienced'],
    ['skilled worker', 'electrician 3 saal', 'skilled'],
    ['career changer', 'changing my field from sales to data analyst, 4 yrs sales executive', 'changer'],
    ['returning', 'housewife returning to work, earlier receptionist 2 years', 'returning'],
    ['unknown', 'need job', 'unknown'],
  ])('persona: %s', (_, note, persona) => {
    expect(gatherFacts(null, note).persona).toBe(persona);
  });
  it('a chip can set the persona', () => {
    expect(gatherFacts(null, 'B.Com, 3 years accountant', { persona: 'returning' }).persona).toBe('returning');
    expect(gatherFacts(null, 'B.Com graduate', { persona: 'fresher' }).persona).toBe('fresher_grad');
  });
});
