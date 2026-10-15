import { describe, expect, it } from 'vitest';
import { reviewToResume, toReview } from './photoImport';
import { blankResume } from './customerStore';
import { SECTION_LAYOUTS } from '../pages/builder/schema';
import { TEMPLATE_PRESETS } from '../pages/builder/design';
import { resumeToProfileParts, mergeIntoProfile, normalizeProfile } from './jobProfile';

const f = (value, fromId = false, confidence = 'high') => ({ value, confidence, fromId });
const RES = {
  photos: [{ index: 0, kind: 'id_card', readable: true }, { index: 1, kind: 'handwritten_note', readable: true }, { index: 2, kind: 'other', readable: false }],
  personal: {
    name: f('Ramesh Kumar', true), city: f('Hyderabad', true), state: f('Telangana', true), address: f('H.No 4-12, Ameerpet, Hyderabad', true),
    dob: f('12/08/1988', true), gender: f('Male', true), guardian: f('S/O Venkatesh', true), phone: f('98765 43210'), email: f(''),
  },
  headline: 'Light Commercial Vehicle Driver',
  experience: [{ role: 'Driver', company: 'Sri Sai Transports', from: '2020', to: 'Present', lines: ['Drove light commercial vehicles for 4 years across Hyderabad with no accidents'], confidence: 'high' }],
  skills: [{ value: 'LMV driving licence', confidence: 'high' }, { value: 'Basic vehicle repair', confidence: 'low' }],
  certifications: [],
  education: [],
  languages: [{ value: 'Telugu', confidence: 'high' }, { value: 'Hindi', confidence: 'high' }],
};

describe('Snap photos review', () => {
  it('ID details: name and city/state shown, address/DOB/gender/guardian kept but hidden', () => {
    const r = toReview(RES);
    const show = Object.fromEntries(r.fromId.map((x) => [x.key, x.show]));
    expect(show).toEqual({ name: true, city: true, state: true, address: false, dob: false, gender: false, guardian: false });
    expect(r.about.map((x) => x.key)).toEqual(['headline', 'phone']); // ID fields aren't repeated under "About you"
    expect(r.skills.find((s) => s.text === 'Basic vehicle repair').check).toBe(true); // low confidence → "Please check"
  });

  it('builds a resume: personal details private, education off when none was found', () => {
    const d = reviewToResume(toReview(RES), blankResume({ name: '' }));
    expect(d.personal).toMatchObject({ name: 'Ramesh Kumar', location: 'Hyderabad, Telangana', phone: '98765 43210', headline: 'Light Commercial Vehicle Driver' });
    expect(d.pinfo).toMatchObject({ address: 'H.No 4-12, Ameerpet, Hyderabad', dob: '1988-08-12', gender: 'Male', father: 'Venkatesh' });
    expect(d.hidden.pinfo).toBe(true); // the Personal Information section is off on the resume
    expect(d.hidden.edu).toBe(true);
    expect(d.edu).toEqual([]);
    expect(d.exp[0]).toMatchObject({ role: 'Driver', company: 'Sri Sai Transports', from: '2020', current: true });
    expect(d.skillGroups[0].value).toBe('LMV driving licence, Basic vehicle repair');
    expect(d.langs.map((l) => l.name)).toEqual(['Telugu', 'Hindi']);
  });

  it('respects the switches and the remove buttons', () => {
    const r = toReview(RES);
    r.fromId.find((x) => x.key === 'dob').show = true; // switch DOB on
    r.fromId.find((x) => x.key === 'name').show = false;
    r.skills[1].keep = false;
    r.about.find((x) => x.key === 'phone').value = '91234 56789';
    const d = reviewToResume(r, blankResume({ name: '' }));
    expect(d.hidden.pinfo).toBe(false);
    expect(d.pinfo.dob).toBe('1988-08-12');
    expect(d.pinfo.address).toBe(''); // still switched off, so not printed in the now-visible section
    expect(d.personal.name).toBe('');
    expect(d.skillGroups[0].value).toBe('LMV driving licence');
    expect(d.personal.phone).toBe('91234 56789');
  });

  it('husband’s name goes to the spouse field', () => {
    const res = { ...RES, personal: { ...RES.personal, guardian: f('W/O Suresh', true) } };
    const d = reviewToResume(toReview(res), blankResume({}));
    expect(d.pinfo.spouse).toBe('Suresh');
    expect(d.pinfo.father).toBe('');
  });

  it('the Work-first template: skills and work first, education last, one column', () => {
    expect(TEMPLATE_PRESETS.work.design.layout).toBe('one');
    const order = SECTION_LAYOUTS.work.order;
    expect(order.slice(0, 3)).toEqual(['summary', 'skills', 'exp']);
    expect(order.indexOf('edu')).toBeGreaterThan(order.indexOf('certs'));
  });

  it('Job Profile import only adds what is missing', () => {
    const p = normalizeProfile({ personal: { name: 'Ramesh K', headline: '', email: '', phone: '', location: 'Secunderabad' }, skillGroups: [{ id: 'core', label: 'Core', value: 'LMV driving licence' }] }, {});
    const { profile } = mergeIntoProfile(p, resumeToProfileParts(reviewToResume(toReview(RES), blankResume({}))));
    expect(profile.personal.name).toBe('Ramesh K'); // never overwritten
    expect(profile.personal.location).toBe('Secunderabad');
    expect(profile.personal.phone).toBe('98765 43210'); // was empty → added
    expect(profile.skillGroups[0].value).toBe('LMV driving licence, Basic vehicle repair');
    expect(profile.exp[0].company).toBe('Sri Sai Transports');
  });
});
