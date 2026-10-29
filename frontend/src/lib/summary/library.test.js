import { describe, expect, it } from 'vitest';
import { READY, headingOf, languagesOf, orderFor, textFor } from './library';
import { INITIAL } from '../../pages/builder/schema';

const blank = { personal: { name: 'Asha', headline: '' }, skillGroups: [], langs: [], hidden: {}, pinfo: {} };
const withHeadline = (h) => ({ ...blank, personal: { ...blank.personal, headline: h } });
const byId = (id) => READY.find((s) => s.id === id);

describe('ready summaries (freshers)', () => {
  it('has the 12 summaries, each with a heading, text and tags; the texts are kept exactly', () => {
    expect(READY.map((s) => s.id)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
    for (const s of READY) { expect(s.heading).toBeTruthy(); expect(s.text.length).toBeGreaterThan(150); expect(s.tags.length).toBeGreaterThan(0); }
    expect(byId(1).text).toBe('Motivated and detail-oriented graduate with a strong willingness to learn, adapt, and contribute to organizational success. Possess good analytical, problem-solving, and communication skills, with the ability to work collaboratively in a team environment. Eager to apply academic knowledge, develop professional expertise, and contribute to business growth.');
    expect(byId(12).heading).toBe('Skills and Project Fresher (no course mentioned)');
    expect(headingOf(byId(3), 'te')).toBe('డేటా అనలిస్ట్ ఫ్రెషర్');
    expect(headingOf(byId(3), 'hi')).toBe('डेटा एनालिस्ट फ्रेशर');
    expect(headingOf(byId(3), 'xx')).toBe('Data Analyst Fresher');
  });

  it('puts the card matching the target role first, else #1; the chips filter', () => {
    expect(orderFor(withHeadline('Data Analyst · SQL · Power BI'))[0].id).toBe(3);
    expect(orderFor(withHeadline('Aspiring Data Scientist'))[0].id).toBe(4);
    expect(orderFor(withHeadline('HR Executive'))[0].id).toBe(7);
    expect(orderFor(withHeadline('Java Developer'))[0].id).toBe(2);
    expect(orderFor(withHeadline(''))[0].id).toBe(1);
    expect(orderFor(withHeadline('Pilot'))[0].id).toBe(1);
    expect(orderFor(withHeadline('Data Analyst'))).toHaveLength(12);
    expect(orderFor(blank, 'tech').map((s) => s.id)).toEqual([2, 3, 4, 5]);
    expect(orderFor(blank, 'data').every((s) => s.tags.includes('data'))).toBe(true);
    expect(orderFor(withHeadline('Data Analyst'), 'nontech').map((s) => s.id)).not.toContain(3);
  });

  it('uses the text exactly as written when the resume has no skills or languages', () => {
    for (const s of READY) expect(textFor(s, blank)).toBe(s.text);
  });

  it('swaps in the person\'s languages in #11 and their skills in #3, #4, #8 and #12', () => {
    const d = { ...blank, langs: [{ name: 'Telugu' }, { name: 'English' }, { name: 'Tamil', off: true }], skillGroups: [{ id: 'core', value: 'Tally, MS Excel, GST filing' }] };
    expect(textFor(byId(11), d)).toContain('communicates clearly in Telugu and English.');
    expect(textFor(byId(3), d)).toContain('practical skills in Tally, MS Excel, and GST filing to transform raw data');
    expect(textFor(byId(4), d)).toContain('knowledge of Tally, MS Excel, and GST filing to real-world');
    expect(textFor(byId(8), d)).toContain('documentation, Tally, MS Excel, and stakeholder communication');
    expect(textFor(byId(12), d)).toContain('hands-on practice in Tally, MS Excel and GST filing through college projects');
    expect(textFor(byId(1), d)).toBe(byId(1).text); // no swaps elsewhere
    // hidden skills section: nothing swapped
    expect(textFor(byId(3), { ...d, hidden: { skills: true } })).toBe(byId(3).text);
    // languages from Personal information when there is no Languages section
    expect(languagesOf({ ...blank, pinfo: { languages: 'Hindi, Marathi and English' } })).toEqual(['Hindi', 'Marathi', 'English']);
    expect(textFor(byId(11), INITIAL)).toContain('communicates clearly in English, Tamil and Hindi.');
  });
});
