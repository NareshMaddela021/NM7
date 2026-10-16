import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createIdleTimer, expiryOptions, PIN_RE, wipeDevice } from './kiosk';

describe('kiosk idle timer', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('warns after 2 minutes, counts down 20 seconds, then wipes once', () => {
    const warn = []; const idle = vi.fn();
    createIdleTimer({ onWarn: (s) => warn.push(s), onIdle: idle });
    vi.advanceTimersByTime(119_000);
    expect(warn).toEqual([]);
    vi.advanceTimersByTime(1_000);
    expect(warn).toEqual([20]);
    vi.advanceTimersByTime(10_000);
    expect(warn.at(-1)).toBe(10);
    expect(idle).not.toHaveBeenCalled();
    vi.advanceTimersByTime(10_000);
    expect(idle).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(600_000);
    expect(idle).toHaveBeenCalledTimes(1);
  });

  it('a touch restarts the 2 minutes and cancels a warning', () => {
    const warn = []; const idle = vi.fn();
    const t = createIdleTimer({ onWarn: (s) => warn.push(s), onIdle: idle });
    vi.advanceTimersByTime(100_000);
    t.poke();
    vi.advanceTimersByTime(100_000);
    expect(warn).toEqual([]);
    vi.advanceTimersByTime(25_000); // 125 s quiet: warning shown
    expect(warn.length).toBeGreaterThan(0);
    t.poke();
    expect(warn.at(-1)).toBeNull();
    vi.advanceTimersByTime(119_000);
    expect(idle).not.toHaveBeenCalled();
    t.stop();
    vi.advanceTimersByTime(600_000);
    expect(idle).not.toHaveBeenCalled();
  });
});

describe('wipeDevice', () => {
  const storage = () => { const m = new Map([['nm7-x', '1'], ['asuraa-theme', 'dark'], ['other', 'y']]); return { m, clear: () => m.clear() }; };

  it('clears local and session storage, every IndexedDB database and the caches', async () => {
    const local = storage(); const session = storage();
    const deleted = []; const cachesGone = [];
    const win = {
      localStorage: local, sessionStorage: session,
      indexedDB: {
        databases: async () => [{ name: 'pdfjs' }, { name: 'nm7-drafts' }, {}],
        deleteDatabase: (name) => { deleted.push(name); const r = {}; setTimeout(() => r.onsuccess?.(), 0); return r; },
      },
      caches: { keys: async () => ['v1'], delete: async (k) => cachesGone.push(k) },
    };
    await wipeDevice(win);
    expect(local.m.size).toBe(0);
    expect(session.m.size).toBe(0);
    expect(deleted).toEqual(['pdfjs', 'nm7-drafts']);
    expect(cachesGone).toEqual(['v1']);
  });

  it('never throws when storage is blocked or missing', async () => {
    const win = { get localStorage() { throw new Error('blocked'); }, sessionStorage: null, indexedDB: { databases: () => Promise.reject(new Error('x')) } };
    await expect(wipeDevice(win)).resolves.toBeUndefined();
  });
});

describe('kiosk set-up rules', () => {
  it('offers today and the next two days in India time (3 days at most), wherever the browser is', () => {
    // 18:35 UTC on 16 Oct is already 00:05 on 17 Oct in India: "today" must be the 17th (the server's today)
    expect(expiryOptions(new Date(Date.UTC(2026, 9, 16, 18, 35))).map((x) => x.value)).toEqual(['2026-10-17', '2026-10-18', '2026-10-19']);
    expect(expiryOptions(new Date(Date.UTC(2026, 9, 16, 18, 25)))[0].value).toBe('2026-10-16'); // 23:55 India
    const o = expiryOptions(new Date(Date.UTC(2026, 9, 31, 6)));
    expect(o.map((x) => x.value)).toEqual(['2026-10-31', '2026-11-01', '2026-11-02']);
    expect(o[0].label).toBe('End of today');
  });
  it('PINs are 4 to 6 digits', () => {
    expect(['1234', '123456'].every((p) => PIN_RE.test(p))).toBe(true);
    expect(['123', '1234567', '12a4', ''].some((p) => PIN_RE.test(p))).toBe(false);
  });
});
