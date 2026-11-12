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

  it('no key is written twice in a language block (JSON keeps the last one silently)', () => {
    const raw = readFileSync(join(__dirname, '..', 'i18n', 'pages.json'), 'utf8');
    const blocks = raw.split(/\n {2}"(?:en|te|hi)": \{/).slice(1);
    expect(blocks).toHaveLength(3);
    for (const b of blocks) {
      const keys = [...b.matchAll(/^ {4}"([^"]+)":/gm)].map((m) => m[1]);
      expect(keys.filter((k, i) => keys.indexOf(k) !== i)).toEqual([]);
    }
  });

  it('Phase 6 S1: the role finder opens inside the easy dashboard', () => {
    expect(MORE.find(([k]) => k === 'roles')?.[2]).toBe('/me/simple/roles');
    expect(PAGES.en['simple.rf.jobs.one']).toBe('1 live job now');
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

describe('fix round (7 Nov): everything stays inside the easy dashboard', () => {
  it('items 3, 4, 12: every tile opens a simple screen', async () => {
    for (const [, , to] of TILES) expect(to).toMatch(/^\/me\/simple\//);
    expect(Object.fromEntries(TILES.map(([k, , to]) => [k, to]))).toEqual({ resume: '/me/simple/myresume', jobs: '/me/simple/jobs', apps: '/me/simple/apps', practice: '/me/simple/practice' });
  });
  it('item 13: every "Things left" button opens a simple screen', async () => {
    const { READY_PATHS } = await import('../pages/simple/SimpleApp');
    for (const to of Object.values(READY_PATHS)) expect(to).toMatch(/^\/me\/simple\//);
    expect(READY_PATHS.roles).toBe('/me/simple/auto');
  });
  it('item 5: every fix has plain words; the simple ones stay inside', async () => {
    const { SIMPLE_FIX, COMMON, resumeParts } = await import('../pages/simple/SimpleMore');
    for (const k of ['contact', 'linkedin', 'summary', 'experience', 'numbers', 'verbs', 'skills', 'education', 'layout', 'length', 'resume', 'other']) expect(PAGES.en[`simple.fix.${k}`], k).toBeTruthy();
    for (const to of Object.values(SIMPLE_FIX)) expect(to).toMatch(/^\/me\/simple\//);
    for (const q of COMMON) { expect(PAGES.en[`simple.pr.${q}`]).toBeTruthy(); expect(PAGES.en[`simple.pr.${q}tip`]).toBeTruthy(); }
    // item 4: the resume in plain words
    const p = resumeParts({ personal: { name: 'Asha', email: 'a@x.in', phone: '98' }, edu: [{ degree: 'B.Tech', field: 'CSE', institution: 'JNTU', to: '2025' }], skillGroups: [{ value: 'SQL, Excel' }], proj: [{ title: 'Canteen dashboard', description: 'Built a dashboard\nShowed sales' }] });
    expect(p).toMatchObject({ name: 'Asha', contact: 'a@x.in · 98', studied: 'B.Tech CSE · JNTU · 2025', skills: ['SQL', 'Excel'], projects: [{ title: 'Canteen dashboard', lines: ['Built a dashboard', 'Showed sales'] }] });
  });
  it('item 32: Auto Apply with no job role never says "—"', () => {
    expect(PAGES.en['aa.will.noRole']).not.toContain('—');
    expect(PAGES.te['aa.will.noRole']).toBeTruthy();
  });
});
