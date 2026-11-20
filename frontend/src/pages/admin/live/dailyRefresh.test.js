// Batch D item 38: when "Refresh now" loses its answer (a timeout on the live server), the page waits for the new
// snapshot and shows it (the setup funnel too) without a reload.
import { describe, expect, it } from 'vitest';
import { waitForNewer } from './DailyReport';

describe('waitForNewer', () => {
  it('returns the first report newer than before', async () => {
    const answers = [{ today: { at: 5 } }, { today: { at: 5 } }, { today: { at: 9, setupFunnel: { roles: [] } } }];
    const got = await waitForNewer(5, () => true, async () => answers.shift(), 0);
    expect(got.today.at).toBe(9);
  });
  it('gives up when the page moved on, or after its tries', async () => {
    expect(await waitForNewer(5, () => false, async () => ({ today: { at: 9 } }), 0)).toBe(null);
    let n = 0;
    expect(await waitForNewer(5, () => true, async () => { n += 1; throw new Error('x'); }, 0)).toBe(null);
    expect(n).toBe(12);
  });
});
