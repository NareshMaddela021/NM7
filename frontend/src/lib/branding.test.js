import { describe, expect, it } from 'vitest';
import { BRAND_TEMPLATES, brandDesign, contrastRatio, contrastWarning, logoProblem } from './branding';
import { TEMPLATE_PRESETS } from '../pages/builder/design';

describe('brand colour contrast', () => {
  it('measures contrast like WCAG', () => {
    expect(contrastRatio('#000000')).toBeCloseTo(21, 0);
    expect(contrastRatio('#FFFFFF')).toBeCloseTo(1, 5);
    expect(contrastRatio('#767676')).toBeGreaterThanOrEqual(4.5); // the classic AA grey
    expect(contrastRatio('#777777')).toBeLessThan(4.5);
  });
  it('warns below 4.5:1 on white, and for colours that aren’t #RRGGBB', () => {
    expect(contrastWarning('#1F3A8A')).toBeNull();
    expect(contrastWarning('#FFD700')).toMatch(/hard to read on white \(contrast 1\.\d:1/);
    expect(contrastWarning('#88CCFF')).toMatch(/at least 4\.5:1/);
    expect(contrastWarning('red')).toMatch(/#1F3A8A/);
  });
});

describe('brand template and logo rules', () => {
  it('only single-column base templates, drawn as they are', () => {
    for (const k of BRAND_TEMPLATES) expect(TEMPLATE_PRESETS[k].design.layout || 'one').toBe('one');
    expect(brandDesign({ template: 'classic', color: '#FF0000' })).toMatchObject({ preset: 'classic', accent: TEMPLATE_PRESETS.classic.design.accent });
    expect(brandDesign({ template: 'twocol' }).preset).toBe('fresher');
  });
  it('checks the logo file before upload', () => {
    expect(logoProblem({ type: 'image/png', size: 1000 })).toBe('');
    expect(logoProblem({ type: 'image/svg+xml', size: 300 * 1024 })).toBe('');
    expect(logoProblem({ type: 'image/gif', size: 10 })).toMatch(/PNG, JPG or SVG/);
    expect(logoProblem({ type: 'image/png', size: 300 * 1024 + 1 })).toMatch(/over 300 KB/);
  });
});
