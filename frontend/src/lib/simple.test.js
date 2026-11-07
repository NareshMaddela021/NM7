// The Easy dashboard (Phase 4): every word on the simple screens exists in English, Telugu and Hindi; every key the
// screens use is in the table; every next step the server can send has its words and icon; the offline cache.
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import PAGES from '../i18n/pages.json';
import { MORE, NEXT_ICONS, TILES } from '../pages/simple/SimpleApp';

const DIR = join(__dirname, '..', 'pages', 'simple');
const SOURCES = readdirSync(DIR).filter((f) => f.endsWith('.jsx')).map((f) => readFileSync(join(DIR, f), 'utf8'));
const SIMPLE_KEYS = Object.keys(PAGES.en).filter((k) => k.startsWith('simple.'));

describe('simple screen strings', () => {
  it('every simple.* string is in en, te and hi', () => {
    expect(SIMPLE_KEYS.length).toBeGreaterThan(50);
    for (const k of SIMPLE_KEYS) {
      for (const l of ['en', 'te', 'hi']) expect(PAGES[l][k], `${l} ${k}`).toBeTruthy();
      expect(PAGES.te[k], `te ${k} is still English`).not.toBe(PAGES.en[k] === 'Nm7' ? '' : PAGES.en[k]);
      // the same {values} in every language
      const vars = (s) => (s.match(/\{\w+\}/g) || []).sort().join();
      expect(vars(PAGES.te[k]), k).toBe(vars(PAGES.en[k]));
      expect(vars(PAGES.hi[k]), k).toBe(vars(PAGES.en[k]));
    }
  });

  it('every key the simple screens use is in the table', () => {
    const used = new Set();
    for (const src of SOURCES) for (const m of src.matchAll(/t\('(simple\.[\w.]+)'/g)) used.add(m[1]);
    for (const k of Object.keys(NEXT_ICONS)) for (const p of ['title', 'text', 'cta']) used.add(`simple.next.${k}.${p}`);
    for (const [k] of TILES) used.add(`simple.tile.${k}`);
    for (const [k] of MORE) used.add(`simple.more.${k}`);
    expect(used.size).toBeGreaterThan(40);
    for (const k of used) expect(PAGES.en[k], k).toBeTruthy();
  });

  it('every next step the server sends has an icon and words', () => {
    const py = readFileSync(join(__dirname, '..', '..', '..', 'backend', 'app', 'simple', 'router.py'), 'utf8');
    const block = py.match(/PATHS = \{([\s\S]*?)\n\}/)[1];
    const keys = [...block.matchAll(/"(\w+)":/g)].map((m) => m[1]);
    expect(keys.sort()).toEqual(Object.keys(NEXT_ICONS).sort());
  });

  it('every resume question has its words', () => {
    const py = readFileSync(join(__dirname, '..', '..', '..', 'backend', 'app', 'simple', 'guided.py'), 'utf8');
    const steps = [...py.match(/STEPS = \(([^)]*)\)/)[1].matchAll(/"(\w+)"/g)].map((m) => m[1]);
    expect(steps).toHaveLength(10);
    for (const st of steps) expect(PAGES.en[`simple.r.q.${st}.title`], st).toBeTruthy();
    for (const f of ['built', 'tools', 'does']) expect(PAGES.en[`simple.r.q.projects.${f}`]).toBeTruthy();
    for (const f of ['company', 'role', 'built']) expect(PAGES.en[`simple.r.q.work.${f}`]).toBeTruthy();
  });

  it('no jargon on the simple screens', () => {
    for (const k of SIMPLE_KEYS) expect(PAGES.en[k], k).not.toMatch(/\bATS\b/);
  });
});

describe('offline cache', () => {
  afterEach(() => { vi.unstubAllGlobals(); vi.resetModules(); });
  it('keeps the last data and reads it back', async () => {
    const store = {};
    const fake = (box) => ({ getItem: (k) => box[k] ?? null, setItem: (k, v) => { box[k] = String(v); }, removeItem: (k) => { delete box[k]; } });
    const local = {};
    vi.stubGlobal('localStorage', fake(local));
    vi.stubGlobal('sessionStorage', fake(store));
    vi.stubGlobal('window', { addEventListener() {}, removeEventListener() {} });
    vi.resetModules();
    vi.doMock('../services/http', () => ({ http: vi.fn(async () => ({ on: true, lang: null, next: { key: 'resume' } })) }));
    const m = await import('./simple');
    expect(m.cached()).toBe(null);
    await m.loadSimple();
    expect(m.cached().next.key).toBe('resume');
    expect(Object.keys(local)).toEqual([]); // nothing personal in localStorage
    expect(m.isOffline({ status: 0 })).toBe(true);
    expect(m.isOffline({ status: 500 })).toBe(false);
  });
});
