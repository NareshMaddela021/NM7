import { describe, expect, it } from 'vitest';
import { shortlistQuery } from './CompanyHire';
import { WT_NONE, workQuery } from './HireWorkTests';

describe('Vetting Trust T15 Hire now filters', () => {
  it('adds only the work-test filters that are on', () => {
    expect(workQuery(new URLSearchParams(), WT_NONE).toString()).toBe('');
    expect(workQuery(new URLSearchParams(), { typing: '35', sjt: 'strong', aptitude: 'top30' }).toString()).toBe('typing=35&sjt=strong&aptitude=top30');
    const q = new URLSearchParams(shortlistQuery('j1', {}, undefined, { typing: 25, sjt: '', aptitude: '' }));
    expect(q.get('typing')).toBe('25');
    expect(q.get('sjt')).toBeNull();
    expect(q.has('reliability')).toBe(false); // there is no reliability filter
  });
});
