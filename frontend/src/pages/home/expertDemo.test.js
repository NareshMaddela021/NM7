import { describe, expect, it } from 'vitest';
import { atsScore } from '../../lib/atsScore';
import { AFTER, BEFORE, DEMO_JD } from './demoData';
import { EXPERT_DEMO } from './expertDemo';

describe('home expert before/after', () => {
  it('shows the scores the real scanner gives the two sample resumes', () => {
    expect(atsScore(BEFORE, DEMO_JD).score).toBe(EXPERT_DEMO.before);
    expect(atsScore(AFTER, DEMO_JD).score).toBe(EXPERT_DEMO.after);
  });
});
