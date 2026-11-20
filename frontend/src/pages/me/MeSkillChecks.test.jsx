// Skill checks (Vetting V2) role card: an older skill check (v 1, before V2) shows its score only; "See result" and
// "Carry on with the test" are for V2 attempts, which have a result page and a test runner here.
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { RoleCard } from './MeSkillChecks';

const cat = { questions: 18, retakeAttempts: 1 };
const role = (last) => ({ test: 'SQL', role: 'Data analyst', langs: ['en'], task: 'case', questions: 40, demand: 2, verified: null, canStart: false, last });
const draw = (last) => renderToStaticMarkup(<MemoryRouter><RoleCard r={role(last)} cat={cat} onStart={() => {}} onRenew={() => {}} /></MemoryRouter>);
const done = { id: 'a1', done: true, score: 62, pass: false, againAt: Date.now() + 86400000 };

describe('skill checks role card', () => {
  it('a V2 result links to its result page', () => {
    expect(draw({ ...done, v: 2 })).toContain('href="/me/skill-checks/a1"');
  });
  it('an older (v 1) result shows the score, with no link to a result page that does not exist', () => {
    const out = draw({ ...done, v: 1 });
    expect(out).toContain('Last score 62/100');
    expect(out).not.toContain('/me/skill-checks/a1');
  });
  it('an unfinished older check is not offered as "Carry on with the test"', () => {
    expect(draw({ id: 'a2', done: false, v: 1, againAt: Date.now() })).not.toContain('Carry on with the test');
    expect(draw({ id: 'a2', done: false, v: 2, againAt: Date.now() })).toContain('Carry on with the test');
  });
});
