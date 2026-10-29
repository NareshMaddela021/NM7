import { describe, expect, it } from 'vitest';
import { BANNER_H, BANNER_W, PACK_ITEMS, bannerFileName, packRequest, tint } from './pack';
import { pasteWhere } from './guide';

describe('LinkedIn pack helpers', () => {
  it('lists the 9 items of the pack', () => {
    expect(PACK_ITEMS).toHaveLength(9);
    expect(PACK_ITEMS.join(' ')).toMatch(/Banner image 1584 × 396/);
  });
  it('banner: LinkedIn size, a light tint of the resume colour, a sensible file name', () => {
    expect([BANNER_W, BANNER_H]).toEqual([1584, 396]);
    expect(tint('#2E46D8')).toBe('rgb(230, 233, 250)');
    expect(tint('nonsense')).toBe('rgb(226, 227, 229)'); // falls back to the default ink
    expect(bannerFileName('Ravi Kumar')).toBe('Ravi_Kumar_LinkedIn_Banner.png');
    expect(bannerFileName('')).toBe('My_LinkedIn_Banner.png');
  });
  it('the request clamps the role and the note', () => {
    const r = packRequest({ path: 'create', role: 'x'.repeat(150), note: 'n'.repeat(1200), details: { name: 'A' } });
    expect(r.targetRole).toHaveLength(100);
    expect(r.note).toHaveLength(1000);
    expect(r).toMatchObject({ path: 'create', details: { name: 'A' }, profile: {} });
  });
  it('where to paste: English, Telugu and Hindi (the last two marked for review)', () => {
    for (const s of ['headline', 'about', 'experience', 'education', 'skills', 'featured', 'banner', 'urls']) {
      expect(pasteWhere(s, 'en').text).toMatch(/Profile/);
      expect(pasteWhere(s, 'te').review).toBe(true);
      expect(pasteWhere(s, 'hi').review).toBe(true);
      expect(pasteWhere(s, 'en').review).toBe(false);
    }
    expect(pasteWhere('banner', 'te').text).toMatch(/[ఀ-౿]/);
    expect(pasteWhere('banner', 'hi').text).toMatch(/[ऀ-ॿ]/);
  });
});
