import { describe, expect, it } from 'vitest';
import { answered, jobQueries, nextRole, nextStep, prevStep, resumeStep, stepsFor, withAnswer } from './quickStart';

describe('quick start steps', () => {
  it('job seeker: four questions; a fresher is asked college and course instead of more experience', () => {
    expect(stepsFor('jobseeker', {})).toEqual(['job', 'city', 'experience', 'faster']);
    expect(stepsFor('jobseeker', { experience: 'fresher' })).toEqual(['job', 'city', 'experience', 'college', 'course', 'faster']);
    expect(stepsFor('jobseeker', { experience: '3_5' })).toEqual(['job', 'city', 'experience', 'faster']);
  });
  it('student: the under-18 step only where Vetting Trust is on', () => {
    expect(stepsFor('student', {}, { trust: false })).toEqual(['college', 'course', 'looking', 'faster']);
    expect(stepsFor('student', {}, { trust: true })).toEqual(['college', 'course', 'looking', 'age', 'faster']);
  });
  it('expert: expertise, years, services, fill faster', () => {
    expect(stepsFor('expert', {})).toEqual(['expertise', 'years', 'services', 'faster']);
  });
  it('answered: lists need an item, a city or Remote counts, the age step needs a result', () => {
    expect(answered('city', { remote: true })).toBe(true);
    expect(answered('city', { cities: [] })).toBe(false);
    expect(answered('looking', { looking: ['internship'] })).toBe(true);
    expect(answered('age', { age: 'minor' })).toBe(false);
    expect(answered('age', { age: 'parent_asked' })).toBe(true);
    expect(answered('job', { job: 'Driver' })).toBe(true);
  });
});

describe('resume and next', () => {
  const steps = stepsFor('jobseeker', {});
  it('starts at the first question and picks up at the saved step', () => {
    expect(resumeStep(steps, {}, [], null, false)).toBe('job');
    expect(resumeStep(steps, { job: 'Driver' }, [], 'city', false)).toBe('city');
  });
  it('passes steps already answered from existing data, and skipped ones', () => {
    expect(resumeStep(steps, { job: 'Nurse', cities: ['Chennai'] }, [], null, false)).toBe('experience');
    expect(resumeStep(steps, { experience: '1_3' }, ['job', 'city'], null, false)).toBe('faster');
  });
  it('everything answered: straight to the results; done stays done', () => {
    expect(resumeStep(steps, { job: 'a', remote: true, experience: '1_3', faster: 'used' }, [], null, false)).toBe('results');
    expect(resumeStep(steps, {}, [], 'job', true)).toBe('results');
  });
  it('"Change my answers" goes through every step from the first', () => {
    expect(resumeStep(steps, { job: 'a' }, [], 'faster', true, true)).toBe('job');
    expect(nextStep(steps, { job: 'a', remote: true }, [], 'job', true)).toBe('city');
    expect(nextStep(steps, {}, [], 'faster', true)).toBe('results');
  });
  it('next passes answered and skipped steps; back goes one step back', () => {
    expect(nextStep(steps, { experience: '1_3' }, ['city'], 'job')).toBe('faster');
    expect(nextStep(steps, {}, [], 'faster')).toBe('results');
    expect(prevStep(steps, 'city')).toBe('job');
    expect(prevStep(steps, 'job')).toBe(null);
    // the fresher branch appears as soon as Fresher is picked
    const a = { experience: 'fresher' };
    expect(nextStep(stepsFor('jobseeker', a), a, [], 'experience')).toBe('college');
  });
  it('withAnswer clears with null or an empty list', () => {
    expect(withAnswer({ job: 'a', cities: ['Pune'] }, { cities: [], remote: true })).toEqual({ job: 'a', remote: true });
    expect(withAnswer({ job: 'a' }, { job: null })).toEqual({});
  });
});

describe('results', () => {
  it('job board searches go from the closest match to the widest', () => {
    const q = jobQueries({ job: 'Data analyst', cities: ['Pune', 'Delhi'], experience: 'fresher' });
    expect(q[0]).toEqual({ q: 'Data analyst', experience: 'fresher,0_1', places: ['Pune', 'Delhi'] });
    expect(q[1]).toEqual({ q: 'Data analyst', experience: '', places: ['Pune', 'Delhi'] });
    expect(q.at(-1)).toEqual({ q: '', experience: 'fresher,0_1', places: [''] });
    expect(jobQueries({ remote: true })[0].places).toEqual(['remote']);
    expect(new Set(jobQueries({}).map((x) => JSON.stringify(x))).size).toBe(jobQueries({}).length);
  });
  it('the next role to set up, in the picker’s order', () => {
    const all = { roles: ['jobseeker', 'student', 'expert'], setup: { jobseeker: { done: true }, student: { done: false }, expert: { done: false } } };
    expect(nextRole(all, 'jobseeker')).toBe('student');
    expect(nextRole(all, 'student')).toBe('expert');
    expect(nextRole({ roles: ['jobseeker'], setup: { jobseeker: { done: true } } }, 'jobseeker')).toBe(null);
  });
});
