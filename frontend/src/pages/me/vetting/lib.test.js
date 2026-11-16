// Vetting V2 page helpers: clocks, the polite time announcements (a few points only), the badge line, the photo size
// and the device hash (a short SHA-256, never the raw browser details).
import { webcrypto } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { badgeLine, clock, renewState, devtoolsOpen, fingerprint, fitSize, questionAnnounce, totalAnnounce, words } from './lib';

describe('vetting helpers', () => {
  it('clocks and word counts', () => {
    expect(clock(75)).toBe('1:15');
    expect(clock(0)).toBe('0:00');
    expect(clock(-3)).toBe('0:00');
    expect(clock(899.2)).toBe('15:00');
    expect(words('  one two\nthree ')).toBe(3);
    expect(words('')).toBe(0);
  });

  it('announces the time only at a few points, never every second', () => {
    const q = Array.from({ length: 76 }, (_, i) => questionAnnounce(i)).filter(Boolean);
    expect(q).toEqual(['10 seconds left for this question', '30 seconds left for this question', '60 seconds left for this question']);
    const t = Array.from({ length: 900 }, (_, i) => totalAnnounce(i)).filter(Boolean);
    expect(t).toHaveLength(3);
  });

  it('the verified badge reads as one line', () => {
    const v = { role: 'Data analyst', bandLabel: '1–3 years', score: 84, taskStars: 4.2, at: Date.UTC(2026, 10, 16) };
    expect(badgeLine(v)).toMatch(/^✓ Skill verified · Data analyst · 1–3 years · 84\/100 · task 4.2\/5 · Nov 2026$/);
    expect(badgeLine(null)).toBe('');
  });

  it('photos fit 1280 px on the long side and are never enlarged', () => {
    expect(fitSize(4000, 3000)).toEqual([1280, 960]);
    expect(fitSize(1000, 3000)).toEqual([427, 1280]);
    expect(fitSize(800, 600)).toEqual([800, 600]);
  });

  it('developer tools: a big gap between the window and the page', () => {
    expect(devtoolsOpen({ outerWidth: 1280, innerWidth: 1280, outerHeight: 900, innerHeight: 820 })).toBe(false);
    expect(devtoolsOpen({ outerWidth: 1280, innerWidth: 900, outerHeight: 900, innerHeight: 820 })).toBe(true);
  });

  it('the device check is a 32-character hash of the browser details', async () => {
    const win = { navigator: { userAgent: 'UA', language: 'en-IN', hardwareConcurrency: 4 }, screen: { width: 390, height: 844 }, crypto: webcrypto };
    const a = await fingerprint(win);
    expect(a).toMatch(/^[0-9a-f]{32}$/);
    expect(await fingerprint(win)).toBe(a);
    expect(await fingerprint({ ...win, screen: { width: 1280, height: 900 } })).not.toBe(a);
    expect(a).not.toContain('UA');
    expect(await fingerprint({ ...win, crypto: undefined })).toHaveLength(32); // not a secure page: still a hash
  });

  it('opens the badge refresher 15 days before the end and up to 30 days after', () => {
    const now = Date.UTC(2026, 10, 16);
    const d = 86_400_000;
    expect(renewState(null, now).open).toBe(false);
    expect(renewState({ expiresAt: now + 40 * d }, now)).toEqual({ open: false, daysLeft: 40, expired: false });
    expect(renewState({ expiresAt: now + 15 * d }, now)).toEqual({ open: true, daysLeft: 15, expired: false });
    expect(renewState({ expiresAt: now - 10 * d, expired: true }, now)).toEqual({ open: true, daysLeft: -10, expired: true });
    expect(renewState({ expiresAt: now - 31 * d, expired: true }, now).open).toBe(false);
    expect(renewState({ expiresAt: now + 5 * d, held: true }, now).open).toBe(false);
  });
});
