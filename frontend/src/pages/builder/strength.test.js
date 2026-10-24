import { describe, expect, it } from 'vitest';
import { INITIAL, SCORE_WEIGHTS, completeness, strengthOf } from './schema';

const STEPS = ['personal', 'summary', 'exp', 'proj', 'edu', 'skills', 'certs', 'ach', 'langs', 'hobbies', 'strengths', 'pinfo', 'decl', 'links', 'review'];

describe('profile strength matches the ticks', () => {
  it('weights add up to 100 and only scored steps carry one', () => {
    expect(Object.values(SCORE_WEIGHTS).reduce((a, b) => a + b, 0)).toBe(100);
    expect(['hobbies', 'strengths', 'pinfo', 'decl'].some((k) => k in SCORE_WEIGHTS)).toBe(false);
  });

  it('100% only when every scored step is ticked; each unticked step costs its weight', () => {
    const all = Object.fromEntries(Object.keys(SCORE_WEIGHTS).map((k) => [k, true]));
    expect(strengthOf(all, STEPS)).toBe(100);
    for (const k of Object.keys(SCORE_WEIGHTS)) expect(strengthOf({ ...all, [k]: false }, STEPS), k).toBeLessThan(100);
    // the reported case: Achievements and Review & Submit unticked → 92, not 95 or 100
    expect(strengthOf({ ...all, ach: false, review: false }, STEPS)).toBe(92);
    expect(strengthOf({}, STEPS)).toBe(0);
    // optional steps never change the score
    expect(strengthOf({ ...all, hobbies: false, decl: false }, STEPS)).toBe(100);
    // job preferences were removed: not a step, not scored, and 100% is reachable without them
    expect('prefs' in SCORE_WEIGHTS).toBe(false);
    expect(strengthOf({ ...all, prefs: false }, STEPS)).toBe(100);
  });

  it('the sample resume: score equals the weights of its ticks; Review ticks only after submit', () => {
    const { has, score } = completeness(INITIAL);
    expect(has.review).toBe(false);
    const ticked = Object.keys(SCORE_WEIGHTS).filter((k) => has[k]);
    expect(score).toBe(ticked.reduce((n, k) => n + SCORE_WEIGHTS[k], 0));
    expect(completeness({ ...INITIAL, reviewedAt: 1 }).has.review).toBe(true);
    expect(completeness({ ...INITIAL, personal: { ...INITIAL.personal, level: '' } }).has.personal).toBe(false); // a required field
  });
});
