import { describe, expect, it } from 'vitest';
import { safeNext } from './safeNext';

describe('safeNext', () => {
  it('keeps paths on this site', () => {
    expect(safeNext('/me/jobs?tab=saved')).toBe('/me/jobs?tab=saved');
    expect(safeNext('/jobs/data-analyst-acme-1a2b3c')).toBe('/jobs/data-analyst-acme-1a2b3c');
  });
  it('refuses anything a browser would send to another site', () => {
    for (const bad of ['https://evil.com', '//evil.com', '/\\evil.com', '/\\/evil.com', '/%5Cevil.com', '/%2F/evil.com', '/\t/evil.com', ' /x', '', null, undefined, 'me']) {
      expect(safeNext(bad)).toBeNull();
    }
  });
});
