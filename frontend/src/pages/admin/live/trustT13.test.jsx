// Vetting Trust T13: the Daily report's "Time to hire" section renders the snapshot (medians, ▲/▼, funnel, slowest).
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import TimeToHireNumbers from './TimeToHireNumbers';

const STEPS = [['shortlist', 'First shortlist'], ['contact', 'First contact'], ['interview', 'First interview booked'], ['offer', 'First offer sent'], ['accepted', 'Offer accepted', true], ['joined', 'Joined', true]];
const step = (n, medianText, dir = 'down', text = '▼ 30 m faster than the period before') => ({ n, median: 1, p75: 2, medianText, p75Text: '3 h', change: { dir, text } });
const period = { jobs: 4, prevJobs: 2, steps: { shortlist: step(3, '45 m'), contact: step(3, '2 h 15 m', 'up', '▲ 1 h slower than the period before'), interview: step(1, '1 d'), offer: step(0, '—'), accepted: step(0, '—'), joined: step(0, '—') },
  funnel: [{ key: 'posted', label: 'Jobs posted', n: 4 }, { key: 'contact', label: 'First contact', n: 3 }] };
const tth = { steps: STEPS.map(([key, label, extra]) => ({ key, label, extra: !!extra })), periods: { 7: period, 30: period, 90: period },
  slowest: [{ companyId: 'c1', name: 'Slow Ltd', medianText: '11 h 40 m', contacted: 3, jobs: 4 }], companies: [], stale: { n: 1, hours: 48, jobs: [{ title: 'Cook', company: 'Slow Ltd', hours: 72 }] },
  settings: { min_jobs: 3 }, capped: false };

describe('T13 time to hire section', () => {
  it('shows medians, the change, the funnel, the slowest companies and stale jobs', () => {
    const out = renderToStaticMarkup(<TimeToHireNumbers tth={tth} http={() => Promise.resolve({})} toast={() => {}} />);
    expect(out).toContain('2 h 15 m');
    expect(out).toContain('▲ 1 h slower');
    expect(out).toContain('No data yet');
    expect(out).toContain('Slow Ltd');
    expect(out).toContain('Cook (Slow Ltd, 72 h)');
    expect(out).toContain('Jobs posted');
  });
  it('says so when the snapshot has no numbers', () => {
    expect(renderToStaticMarkup(<TimeToHireNumbers tth={null} />)).toContain('Press Refresh now');
  });
});
