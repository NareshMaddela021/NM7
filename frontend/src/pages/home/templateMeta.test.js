import { existsSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { TEMPLATE_PRESETS } from '../builder/design';
import { TEMPLATES, TEMPLATE_COUNT } from './templateMeta';

describe('home page template list', () => {
  it('matches the builder’s templates exactly, so "{n} templates" is always the real count', () => {
    expect(TEMPLATE_COUNT).toBe(Object.keys(TEMPLATE_PRESETS).length);
    for (const t of TEMPLATES) {
      const p = TEMPLATE_PRESETS[t.id];
      expect(p, t.id).toBeTruthy();
      expect({ name: t.name, level: t.level, ind: t.ind, photo: t.photo }).toEqual({ name: p.name, level: p.level, ind: p.ind || [], photo: !!p.photo });
    }
  });
  it('every template has its thumbnail image', () => {
    for (const t of TEMPLATES) expect(existsSync(`public/home/tpl-${t.id}.webp`), t.id).toBe(true);
  });
});
