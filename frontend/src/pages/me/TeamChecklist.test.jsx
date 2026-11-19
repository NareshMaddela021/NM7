// Profile setup P3: the company / college checklist uses the same card. A step a member can't do says who can, members
// who can't skip get no Skip for now, the title comes from the server, and a company step opens a dashboard tab.
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { ChecklistView } from './SetupChecklist';
import { companyTab, teamBase } from './TeamChecklist';

const step = (id, status, extra = {}) => ({ id, title: `Do ${id}`, reward: `Reward of ${id}.`, minutes: 5, link: `/company#${id}`, required: true, skipped: false, testersOnly: false, canAct: true, status, ...extra });
const company = {
  role: 'company', title: 'Set up your company', next: 'job', done: 1, total: 5, complete: false, renewals: [], level: null, canSkip: true, reminders: true,
  steps: [step('basics', 'done'), step('business', 'waiting'), step('job', 'next'), step('team', 'later'), step('connect', 'later', { required: false, testersOnly: true })],
};
const draw = (c, open = false, extra = {}) => renderToStaticMarkup(<MemoryRouter><ChecklistView c={c} open={open} busy={false} onSkip={() => {}} onToggle={() => {}} {...extra} /></MemoryRouter>);

describe('the company and college checklist card', () => {
  it('a main admin: the title, the next step with its button, Skip for now and the reminder setting', () => {
    const out = draw(company, true, { onReminders: () => {} });
    expect(out).toContain('Set up your company');
    expect(out).toMatch(/<a(?=[^>]*href="\/company#job")(?=[^>]*data-testid="sc-next")[^>]*>Next step<\/a>/);
    expect(out).toContain('data-testid="sc-skip"');
    expect(out.match(/data-testid="sc-row-skip"/g)).toHaveLength(3); // next + two later ones
    expect(out).toContain('Testers only');
    expect(out).toContain('data-testid="sc-remind"');
    expect(out).toContain('checked=""');
  });
  it('a view-only member: who can do each step, no buttons, no Skip for now, no reminder setting', () => {
    const steps = company.steps.map((s) => (s.status === 'done' ? s : { ...s, canAct: false, actBy: 'A main or full admin of your team' }));
    const out = draw({ ...company, canSkip: false, steps }, true, { onReminders: () => {} });
    expect(out).not.toContain('data-testid="sc-next"');
    expect(out).toContain('data-testid="sc-next-who"');
    expect(out).toContain('A main or full admin of your team can do this.');
    expect(out).not.toContain('Skip for now');
    expect(out).not.toContain('data-testid="sc-row-open"');
    expect(out).not.toContain('data-testid="sc-remind"');
    expect(out).toContain('Hide steps');
  });
  it('a college coordinator: the steps link to the portal pages', () => {
    const c = { ...company, role: 'college', title: 'Set up your college', next: 'students',
      steps: [step('basics', 'done', { link: '/org/o1/billing' }), step('students', 'next', { link: '/org/o1#og-groups' }), step('reports', 'later', { link: '/org/o1/dashboard' })] };
    const out = draw(c, true);
    expect(out).toContain('Set up your college');
    expect(out).toContain('href="/org/o1#og-groups"');
    expect(out).toContain('href="/org/o1/dashboard"');
  });
  it('complete: shrinks to Setup complete', () => {
    const out = draw({ ...company, complete: true, next: null });
    expect(out).toContain('data-testid="sc-complete"');
    expect(out).toContain('Setup complete');
  });
  it('finds the dashboard tab of a step and the API of each team', () => {
    expect(companyTab('/company#jobs')).toBe('jobs');
    expect(companyTab('/org/o1')).toBeNull();
    expect(teamBase('company', 'c1')).toBe('/api/company/c1/checklist');
    expect(teamBase('college', 'o 1')).toBe('/api/org/o%201/checklist');
  });
  it('a person’s card is unchanged: Skip for now without canSkip / canAct', () => {
    const c = { role: 'jobseeker', next: 'resume', done: 0, total: 2, complete: false, renewals: [], steps: [{ ...step('resume', 'next'), canAct: undefined, link: '/me/ats' }] };
    const out = draw(c, true);
    expect(out).toContain('Set up your job seeker profile');
    expect(out).toContain('data-testid="sc-row-skip"');
    expect(out).not.toContain('data-testid="sc-remind"');
  });
});
