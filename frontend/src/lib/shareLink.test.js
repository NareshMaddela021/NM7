import { describe, expect, it } from 'vitest';
import { namedUrl, shareMessage, shareUrl, waShareUrl } from './shareLink';

describe('share link', () => {
  it('uses the short code when there is one and nothing when the link is off', () => {
    expect(shareUrl({ on: true, slug: 'asha-rao', short: 'k7m2qa' })).toBe('https://nm7.si/r/k7m2qa');
    expect(shareUrl({ on: true, slug: 'asha-rao' })).toBe('https://nm7.si/r/asha-rao');
    expect(shareUrl({ on: false, slug: 'asha-rao', short: 'k7m2qa' })).toBe('');
    expect(namedUrl({ slug: 'asha-rao' })).toBe('https://nm7.si/r/asha-rao');
  });
  it('wa.me carries only the message and the link', () => {
    const u = waShareUrl(shareMessage('https://nm7.si/r/k7m2qa', { role: 'Data Analyst', company: 'Zoho' }));
    expect(u.startsWith('https://wa.me/?text=')).toBe(true);
    expect(new URL(u).searchParams.get('text')).toBe('Hi, here is my resume for the Data Analyst role at Zoho: https://nm7.si/r/k7m2qa');
    expect([...new URL(u).searchParams.keys()]).toEqual(['text']);
    expect(new URL(waShareUrl(shareMessage('L'))).searchParams.get('text')).toBe('Hi, here is my resume: L');
  });
});
