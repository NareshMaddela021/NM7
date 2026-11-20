// Profile setup P4: the Daily report's "Profile setup" section renders the snapshot's funnel (got this far, drop-off,
// optional steps, capped / partial notes, roles as tabs).
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import SetupFunnel, { lookedText } from './SetupFunnel';

const role = (over = {}) => ({
  role: 'jobseeker', label: 'Job seekers with experience', start: 'Signed up with this role', total: 4, looked: 4, capped: false, partial: false, quickStart: 1, complete: 1,
  steps: [
    { id: 'preferences', title: 'Add your job preferences', required: true, shown: 4, done: 3, waiting: 0, skipped: 1, reached: 3, dropOff: 1, dropPct: 25 },
    { id: 'resume', title: 'Get your resume to an ATS score of 60+', required: true, shown: 4, done: 3, waiting: 0, skipped: 0, reached: 2, dropOff: 1, dropPct: 33 },
    { id: 'papers', title: 'Try the fresher practice papers', required: false, shown: 2, done: 1, waiting: 0, skipped: 0, reached: null, dropOff: null, dropPct: null },
    { id: 'autoapply', title: 'Turn on Auto Apply', required: true, shown: 4, done: 2, waiting: 1, skipped: 0, reached: 2, dropOff: 0, dropPct: 0 },
  ],
  ...over,
});
const f = { at: 1, cap: 200, hidden: ['Take the AI interview (Vetting is off)'], roles: [role(), role({ role: 'company', label: 'Companies', start: 'Signed up', total: 0, looked: 0, quickStart: null, complete: 0, steps: [] })] };

describe('profile setup funnel on the Daily report', () => {
  it('shows each step with how many got this far, the drop-off and the extras', () => {
    const out = renderToStaticMarkup(<SetupFunnel f={f} />);
    expect(out).toContain('Job seekers with experience (4)');
    expect(out).toContain('Companies (0)');
    expect(out).toContain('Signed up with this role');
    expect(out).toContain('1 dropped off (25%)');
    expect(out).toContain('1 dropped off (33%)');
    expect(out).toContain('3 did it in any order');
    expect(out).toContain('No drop-off');
    expect(out).toContain('(optional)');
    expect(out).toContain('1 waiting for review');
    expect(out).toContain('1 skipped for now');
    expect(out).toContain('shown to 2');
    expect(out).toContain('1 profile complete');
    expect(out).toContain('1 finished the quick start');
    expect(out).toContain('Take the AI interview (Vetting is off)');
    expect(out).not.toMatch(/@|example\.com/);
  });
  it('says when capped or stopped early, and when the snapshot has nothing', () => {
    expect(lookedText(role({ total: 900, looked: 200, capped: true }))).toBe('900 people in all; the steps are worked out for the newest 200.');
    expect(lookedText(role({ role: 'college', total: 1, looked: 1 }))).toBe('1 college in all.');
    expect(lookedText(role({ partial: true }))).toContain('stopped early');
    expect(renderToStaticMarkup(<SetupFunnel f={null} />)).toContain('Press Refresh now');
  });
});
