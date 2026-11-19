// Profile setup P2: the dashboard checklist card — ring + one Next step button, See all steps, the four statuses,
// Skip for now, waiting for review, and the small "Profile complete" line with renewals.
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { ChecklistView } from './SetupChecklist';
import { completeText, minutes, nextStep, showCard } from '../../lib/checklist';

const step = (id, status, extra = {}) => ({ id, title: `Do ${id}`, reward: `Reward of ${id}.`, minutes: 3, link: `/me/${id}`, required: true, skipped: false, testersOnly: false, status, ...extra });
const base = {
  role: 'jobseeker', next: 'resume', done: 1, total: 4, percent: 25, complete: false, renewals: [], level: null,
  steps: [step('preferences', 'done'), step('resume', 'next'), step('skill', 'waiting'), step('identity', 'later', { required: false }), step('autoapply', 'later', { skipped: true })],
};
const draw = (c, open = false) => renderToStaticMarkup(<MemoryRouter><ChecklistView c={c} open={open} busy={false} onSkip={() => {}} onToggle={() => {}} /></MemoryRouter>);

describe('the checklist card', () => {
  it('shows the ring, the next step and one Next step button', () => {
    const out = draw(base);
    expect(out).toContain('data-testid="sc-card"');
    expect(out).toContain('aria-label="1 of 4 steps done"');
    expect(out).toContain('Set up your job seeker profile');
    expect(out).toContain('Do resume');
    expect(out).toMatch(/<a(?=[^>]*href="\/me\/resume")(?=[^>]*data-testid="sc-next")[^>]*>Next step<\/a>/);
    expect(out).toContain('Skip for now');
    expect(out).toContain('See all steps (5)');
    expect(out).not.toContain('data-testid="sc-list"');
  });
  it('See all steps lists each step with its status, reward, time and Skip for now', () => {
    const out = draw(base, true);
    expect(out).toContain('aria-expanded="true"');
    for (const [id, s] of [['preferences', 'done'], ['resume', 'next'], ['skill', 'waiting'], ['identity', 'later']]) expect(out).toContain(`data-step="${id}" data-status="${s}"`);
    expect(out).toContain('Waiting for review');
    expect(out).toContain('Reward of skill.');
    expect(out).toContain('About 3 min');
    expect(out).toContain('Optional');
    expect(out).toContain('Skipped');
    // Skip for now on the next step and on later steps that weren't skipped; never on done or waiting ones
    expect(out.match(/data-testid="sc-row-skip"/g)).toHaveLength(2);
    expect(out).toContain('See status');
  });
  it('only waiting steps left: says so, no Next step button', () => {
    const out = draw({ ...base, role: 'expert', next: null, steps: [step('profile', 'done'), step('submit', 'waiting')] });
    expect(out).toContain('data-testid="sc-waiting"');
    expect(out).toContain('You can use your other roles while you wait.');
    expect(out).not.toContain('data-testid="sc-next"');
  });
  it('complete: shrinks to Profile complete with the level, and shows renewals only', () => {
    const c = { ...base, complete: true, next: null, level: { level: 2, label: 'Skill verified' } };
    let out = draw(c);
    expect(out).toContain('data-testid="sc-complete"');
    expect(out).toContain('Profile complete · L2 Skill verified');
    expect(out).not.toContain('Next step');
    expect(out).not.toContain('sc-renewal');
    out = draw({ ...c, renewals: [{ id: 'still_looking', title: 'Still looking? Tap to confirm', reward: 'r', minutes: 1, link: '/me/hire' }] });
    expect(out).toContain('data-testid="sc-renewal"');
    expect(out).toContain('href="/me/hire"');
  });
  it('shows nothing while loading or with no steps', () => {
    expect(draw(null)).toBe('');
    expect(showCard({ ...base, steps: [], renewals: [] })).toBe(false);
  });
  it('words', () => {
    expect(minutes(5)).toBe('About 5 min');
    expect(minutes(60)).toBe('About 1 h');
    expect(completeText({ level: null })).toBe('Profile complete');
    expect(nextStep(base).id).toBe('resume');
    expect(nextStep({ ...base, next: null })).toBe(null);
  });
});
