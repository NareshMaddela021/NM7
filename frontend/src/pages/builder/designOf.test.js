import { describe, expect, it } from 'vitest';
import { DEFAULT_DESIGN, TEMPLATE_PRESETS, designOf } from './design';
import { designOf as fromExport } from '../../lib/orgExport';

describe('designOf', () => {
  it('fills a shared resume’s design from the defaults (fresher preset when it has none)', () => {
    expect(designOf({})).toEqual({ ...DEFAULT_DESIGN, ...TEMPLATE_PRESETS.fresher.design, preset: 'fresher' });
    const d = designOf({ design: { accent: '#123456', preset: 'modern' } });
    expect(d.accent).toBe('#123456');
    expect(d.preset).toBe('modern');
    expect(d.font).toBe(DEFAULT_DESIGN.font);
  });

  it('is the same function the export module re-exports', () => {
    expect(fromExport).toBe(designOf);
  });
});
