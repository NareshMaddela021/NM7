import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RELOAD_KEY, StaleBuildError, StaleBuildPage, freshImport, isChunkError, lazyRetry, newBuildLive, reloadOnce } from './chunks';

const store = () => { const m = new Map(); return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, v), m }; };
const stale = new TypeError('Failed to fetch dynamically imported module: https://nm7.si/assets/resumePdf-CYEBoQc5.js');

describe('stale-build chunk errors', () => {
  it('recognises chunk-load failures in every browser’s words, nothing else', () => {
    expect(isChunkError(stale)).toBe(true);
    expect(isChunkError(new TypeError('Importing a module script failed.'))).toBe(true); // Safari
    expect(isChunkError(new Error('error loading dynamically imported module'))).toBe(true); // Firefox
    expect(isChunkError({ name: 'ChunkLoadError', message: 'x' })).toBe(true);
    expect(isChunkError(new Error("'text/html' is not a valid JavaScript MIME type"))).toBe(true);
    expect(isChunkError(new Error('Network down'))).toBe(false);
    expect(isChunkError(null)).toBe(false);
  });

  it('reloads at most once a minute (no loops)', () => {
    const s = store(); const reload = vi.fn();
    expect(reloadOnce({ store: s, reload, now: 1_000_000 })).toBe(true);
    expect(reloadOnce({ store: s, reload, now: 1_030_000 })).toBe(false); // 30 s later: not again
    expect(reloadOnce({ store: s, reload, now: 1_061_000 })).toBe(true); // a minute later: allowed
    expect(reload).toHaveBeenCalledTimes(2);
    expect(s.m.get(RELOAD_KEY)).toBe('1061000');
  });

  it('lazy pages reload on a stale chunk and show the "updated" page meanwhile; other errors still throw', async () => {
    const reload = vi.fn(() => true);
    const mod = await lazyRetry(() => Promise.reject(stale), reload)();
    expect(reload).toHaveBeenCalledTimes(1);
    expect(typeof mod.default).toBe('function'); // a component, never a promise that hangs the spinner
    const el = mod.default();
    expect(el.type).toBe(StaleBuildPage);
    expect(el.props.reloading).toBe(true);
    // a reload already happened a moment ago: the page says to reload by hand
    const noReload = vi.fn(() => false);
    const again = await lazyRetry(() => Promise.reject(stale), noReload)();
    expect(again.default().props.reloading).toBe(false);
    await expect(lazyRetry(() => Promise.reject(new Error('boom')), reload)()).rejects.toThrow('boom');
    expect(reload).toHaveBeenCalledTimes(1);
    await expect(lazyRetry(() => Promise.resolve('page'), reload)()).resolves.toBe('page');
  });

  it('the stale page renders a heading and a Reload button', () => {
    const el = StaleBuildPage({ reloading: false });
    const text = JSON.stringify(el);
    expect(text).toMatch(/Nm7 was just updated/);
    expect(text).toMatch(/Please reload this page/);
    expect(text).toMatch(/Reload now/);
  });
});

describe('freshImport (Print, Export, Download)', () => {
  beforeEach(() => { vi.useFakeTimers(); globalThis.window = { sessionStorage: store() }; });
  afterEach(() => { vi.useRealTimers(); delete globalThis.window; });

  it('turns a stale chunk into a friendly message, saves progress, then reloads', async () => {
    const reload = vi.fn(); const beforeReload = vi.fn();
    const err = await freshImport(() => Promise.reject(stale), { reload, beforeReload }).catch((e) => e);
    expect(err).toBeInstanceOf(StaleBuildError);
    expect(err.code).toBe('stale_build');
    expect(err.message).toMatch(/just updated/);
    expect(reload).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1500);
    expect(beforeReload).toHaveBeenCalledTimes(1);
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('just after a reload it doesn’t reload again, and says to reload by hand', async () => {
    window.sessionStorage.setItem(RELOAD_KEY, String(Date.now()));
    const reload = vi.fn();
    const err = await freshImport(() => Promise.reject(stale), { reload }).catch((e) => e);
    expect(err.message).toMatch(/Please reload this page/);
    await vi.advanceTimersByTimeAsync(5000);
    expect(reload).not.toHaveBeenCalled();
  });

  it('passes modules through and other errors untouched', async () => {
    await expect(freshImport(() => Promise.resolve({ ok: 1 }))).resolves.toEqual({ ok: 1 });
    await expect(freshImport(() => Promise.reject(new Error('real')))).rejects.toThrow('real');
  });
});

describe('newBuildLive (idle kiosk checks)', () => {
  const doc = (src) => ({ querySelectorAll: () => (src ? [{ getAttribute: () => src }] : []) });
  it('compares the hashed index file of the live site with this page’s', () => {
    expect(newBuildLive('<script type="module" src="/assets/index-DMIEPT6w.js">', doc('/assets/index-BqtyMuW-.js'))).toBe(true);
    expect(newBuildLive('<script type="module" src="/assets/index-BqtyMuW-.js">', doc('/assets/index-BqtyMuW-.js'))).toBe(false);
    expect(newBuildLive('<html>offline</html>', doc('/assets/index-BqtyMuW-.js'))).toBe(false);
    expect(newBuildLive('<script src="/assets/index-DMIEPT6w.js">', doc('/src/main.jsx'))).toBe(false); // dev server
  });
});
