import { describe, expect, it } from 'vitest';
import { aiDetail } from './aiUsageText';

describe('AI usage detail line', () => {
  it('names the fallback reasons and the dropped options', () => {
    expect(aiDetail({ fallback: 3, unusable: { too_long: 2, empty: 1 }, dropped: 4 })).toBe('fallback 3 (too_long 2, empty 1) · dropped 4');
    expect(aiDetail({ fallback: 1, unusable: { refused: 1 }, dropped: 0 })).toBe('fallback 1 (refused 1)');
    expect(aiDetail({ fallback: 0, unusable: {}, dropped: 2 })).toBe('dropped 2');
    expect(aiDetail({ fallback: 2, unusable: {} })).toBe('fallback 2'); // older counts, before reasons were noted
  });
  it('says nothing when nothing happened', () => {
    expect(aiDetail({ calls: 5, fallback: 0, failed: 0, limited: 0, capped: 0, dropped: 0, unusable: {} })).toBe('');
    expect(aiDetail(undefined)).toBe('');
  });
});
