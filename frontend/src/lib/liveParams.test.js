import { afterEach, describe, expect, it } from 'vitest';
import { liveParams } from './liveParams';

describe('liveParams', () => {
  afterEach(() => { delete globalThis.window; });
  it('reads the address bar now, with BrowserRouter or HashRouter', () => {
    globalThis.window = { location: { search: '?city=remote&experience=1_3', hash: '' } };
    expect(liveParams().get('experience')).toBe('1_3');
    globalThis.window = { location: { search: '', hash: '#/jobs?city=Pune' } };
    expect(liveParams().get('city')).toBe('Pune');
    globalThis.window = { location: { search: '', hash: '' } };
    expect([...liveParams().keys()]).toEqual([]);
  });
});
