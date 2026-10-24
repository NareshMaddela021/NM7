import { beforeEach, describe, expect, it } from 'vitest';

class Mem {
  constructor() { this.m = new Map(); }
  get length() { return this.m.size; }
  key(i) { return [...this.m.keys()][i] ?? null; }
  getItem(k) { return this.m.has(k) ? this.m.get(k) : null; }
  setItem(k, v) { this.m.set(k, String(v)); }
  removeItem(k) { this.m.delete(k); }
}
globalThis.localStorage = new Mem();
globalThis.sessionStorage = new Mem();
const { clearUserData, onSignOut } = await import('./auth');

describe('clearUserData (sign-out / account switch)', () => {
  beforeEach(() => { localStorage.m.clear(); sessionStorage.m.clear(); });
  it('removes every personal key but keeps preferences', async () => {
    ['asuraa-me-v2:u1', 'asuraa-builder-draft-v6', 'asuraa-builder-draft-v6:u1', 'asuraa-expert-orders-v3', 'asuraa-expert-snippets-v1', 'asuraa-ws-RS-1', 'asuraa-last-user'].forEach((k) => localStorage.setItem(k, '1'));
    localStorage.setItem('asuraa-theme', 'dark');
    localStorage.setItem('other-site-key', 'x');
    sessionStorage.setItem('nm7-ref', 'ABCD');
    let forgot = 0;
    const off = onSignOut(() => { forgot += 1; });
    await clearUserData();
    off();
    expect([...localStorage.m.keys()].sort()).toEqual(['asuraa-theme', 'other-site-key']);
    expect(sessionStorage.length).toBe(0);
    expect(forgot).toBe(1);
  });
});
