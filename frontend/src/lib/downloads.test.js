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
const { DownloadBlocked, exportFile, getEntitlement, onGate, closeGate, rememberDownload, pendingDownload, notePage, mayFinishDownload } = await import('./downloads');

describe('download gating (preview build: no payments)', () => {
  beforeEach(() => { sessionStorage.m.clear(); closeGate(); });

  it('guests need an account: no file is made and the sign-up pop-up opens', async () => {
    expect(await getEntitlement()).toMatchObject({ canDownload: false, reason: 'guest' });
    let gate = null;
    const off = onGate((g) => { gate = g; });
    await expect(exportFile({ data: { personal: { name: 'A' } }, design: {}, format: 'docx' })).rejects.toBeInstanceOf(DownloadBlocked);
    expect(gate).toMatchObject({ reason: 'guest', format: 'docx', what: 'resume' });
    off();
  });

  it('remembers the clicked download for after sign-up, once, for an hour', () => {
    rememberDownload('pdf', 'cover');
    expect(pendingDownload()).toMatchObject({ format: 'pdf', what: 'cover' });
    expect(pendingDownload(true)).toMatchObject({ format: 'pdf' });
    expect(pendingDownload()).toBeNull();
    sessionStorage.setItem('nm7-pending-download', JSON.stringify({ format: 'pdf', what: 'resume', at: Date.now() - 2 * 60 * 60 * 1000 }));
    expect(pendingDownload()).toBeNull();
  });

  it('a pending download lives only through its sign-in: any other page forgets it', () => {
    expect(mayFinishDownload()).toBe(true); // a fresh load / reload of the builder
    notePage('/builder');
    rememberDownload('pdf', 'resume');
    notePage('/login');
    notePage('/signup');
    expect(pendingDownload()).not.toBeNull(); // still on the sign-in pages
    expect(mayFinishDownload()).toBe(true); // the builder opening now comes straight from sign-up
    notePage('/builder');
    expect(pendingDownload()).not.toBeNull();
    notePage('/');
    expect(pendingDownload()).toBeNull(); // left for the home page: forgotten
    expect(mayFinishDownload()).toBe(false); // a builder opened from here may not start one
    rememberDownload('docx', 'resume');
    notePage('/me');
    expect(pendingDownload()).toBeNull();
  });
});
