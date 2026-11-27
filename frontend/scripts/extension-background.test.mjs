// The Nm7 Apply helper's service worker (extension/background.js) with a fake chrome and fetch: it talks only to the
// Nm7 API, remembers the kit and step per tab in session storage and forgets them when the tab closes, sends fill
// counts only, sends the miss labels only when the candidate opted in (and stops when Nm7 says the consent is gone),
// says "paused" when the smart-answer limits are reached, asks for a store rating once ever, and opens the first-run
// guide on install.
import vm from 'node:vm';
import { describe, expect, it } from 'vitest';
import { read } from './lib/helper-harness.mjs';

function worker({ local = {}, respond = () => ({ status: 200, body: {} }) } = {}) {
  const store = { local: { token: 'nm7h_test', ...local }, session: {} };
  const area = (name) => ({
    get: async (keys) => { const all = store[name]; if (typeof keys === 'string') keys = [keys]; return Object.fromEntries((keys || Object.keys(all)).filter((k) => k in all).map((k) => [k, all[k]])); },
    set: async (o) => { Object.assign(store[name], o); },
    remove: async (keys) => { for (const k of [].concat(keys)) delete store[name][k]; },
  });
  const calls = [];
  const listeners = {};
  const opened = [];
  const box = {
    importScripts: () => vm.runInContext(read('src/config.js'), box),
    btoa, Uint8Array, String, JSON, Date, Math, Number, Array, Error, Promise, URL, console,
    fetch: async (url, init) => {
      calls.push({ url, method: init.method, body: init.body ? JSON.parse(init.body) : null, auth: init.headers.Authorization });
      const r = respond(url, init);
      return { ok: r.status < 400, status: r.status, json: async () => r.body, arrayBuffer: async () => new ArrayBuffer(0) };
    },
    chrome: {
      runtime: { id: 'ext', getURL: (p) => `chrome-extension://ext/${p}`, getManifest: () => ({ version: '1.1.0' }), onMessage: { addListener: (fn) => { listeners.msg = fn; } }, onInstalled: { addListener: (fn) => { listeners.installed = fn; } } },
      storage: { local: area('local'), session: area('session') },
      tabs: { onRemoved: { addListener: (fn) => { listeners.removed = fn; } }, create: (o) => opened.push(o.url) },
      action: { setBadgeText() {}, setBadgeBackgroundColor() {} },
    },
  };
  box.globalThis = box;
  vm.createContext(box);
  vm.runInContext(read('background.js'), box);
  const send = (msg, sender = { id: 'ext' }) => new Promise((resolve) => { listeners.msg(msg, sender, resolve); });
  return { store, calls, listeners, opened, send };
}

const API = 'https://nm7-api.onrender.com/api/helper';
const tab = { id: 'ext', tab: { id: 42 } };

describe('the service worker', () => {
  it('remembers the kit and step per tab, and forgets them when the tab closes', async () => {
    const w = worker();
    await w.send({ type: 'remember', tabId: 42, kitId: 'k1', host: 'acme.wd3.myworkdayjobs.com', step: 1, filled: 6 });
    await w.send({ type: 'nm7-step', kitId: 'k1', step: 2 }, tab);
    expect((await w.send({ type: 'tab-state', tabId: 42 })).state).toMatchObject({ kitId: 'k1', step: 2, filled: 6 });
    expect(Object.keys(w.store.local)).not.toContain('tab:42'); // session storage only
    w.listeners.removed(42);
    await new Promise((r) => setTimeout(r, 0));
    expect((await w.send({ type: 'tab-state', tabId: 42 })).state).toBeNull();
  });

  it('sends fill counts only, and the miss labels only when the candidate opted in', async () => {
    const off = worker();
    const misses = [{ label: 'How did you hear about us?', type: 'combobox', value: 'should never go' }];
    await off.send({ type: 'fill-done', kitId: 'k1', filled: 9, total: 12, misses, host: 'acme.wd3.myworkdayjobs.com', adapter: 'workday' });
    expect(off.calls.map((c) => c.url)).toEqual([`${API}/kits/k1/filled`]);
    expect(off.calls[0].body).toEqual({ filled: 9, total: 12, adapter: 'workday' });
    const on = worker({ local: { missReports: true } });
    const r = await on.send({ type: 'fill-done', kitId: 'k1', filled: 9, total: 12, misses, host: 'acme.wd3.myworkdayjobs.com', adapter: 'workday' });
    expect(r.reported).toBe(true);
    const sentMiss = on.calls.find((c) => c.url === `${API}/misses`);
    expect(sentMiss.body).toEqual({ host: 'acme.wd3.myworkdayjobs.com', adapter: 'workday', items: [{ label: 'How did you hear about us?', type: 'combobox' }] });
    for (const c of on.calls) expect(c.url.startsWith(API), c.url).toBe(true);
    // Nm7 says the consent is gone: the switch goes off here too
    const gone = worker({ local: { missReports: true }, respond: (url) => (url.endsWith('/misses') ? { status: 403, body: { error: { code: 'consent_needed', message: 'x' } } } : { status: 200, body: {} }) });
    await gone.send({ type: 'fill-done', kitId: 'k1', filled: 1, total: 2, misses, host: 'x.example', adapter: '' });
    expect(gone.store.local.missReports).toBe(false);
  });

  it('says "paused" when the smart-answer limits are reached, and passes plain-text answers only', async () => {
    const paused = worker({ respond: () => ({ status: 429, body: { error: { code: 'answers_paused', message: 'Smart answers are paused for today, type this one yourself.' } } }) });
    expect(await paused.send({ type: 'nm7-draft', kitId: 'k1', question: 'Why us?' }, tab)).toEqual({ paused: true, message: 'Smart answers are paused for today, type this one yourself.' });
    const ok = worker({ respond: () => ({ status: 200, body: { answer: 'I like the work.', source: 'ai' } }) });
    expect(await ok.send({ type: 'nm7-draft', kitId: 'k1', question: 'Why us?' }, tab)).toEqual({ answer: 'I like the work.', note: '' });
    const odd = worker({ respond: () => ({ status: 200, body: { answer: { html: '<b>x</b>' } } }) });
    expect((await odd.send({ type: 'nm7-draft', kitId: 'k1', question: 'Why us?' }, tab)).answer).toBe('');
  });

  it('asks for a store rating once ever, only after a fill and Mark as applied, only with a store link', async () => {
    const w = worker({ local: { storeUrl: 'https://chromewebstore.google.com/detail/x' } });
    const first = await w.send({ type: 'applied', id: 'k1', tabId: 42 });
    expect(first.askRating).toBe(false); // no fill on this tab yet
    await w.send({ type: 'remember', tabId: 42, kitId: 'k1', step: 1, filled: 5 });
    const second = await w.send({ type: 'applied', id: 'k1', tabId: 42 });
    expect(second).toMatchObject({ askRating: true, storeUrl: 'https://chromewebstore.google.com/detail/x' });
    expect((await w.send({ type: 'applied', id: 'k1', tabId: 42 })).askRating).toBe(false);
    const none = worker();
    await none.send({ type: 'remember', tabId: 1, kitId: 'k1', step: 1, filled: 5 });
    expect((await none.send({ type: 'applied', id: 'k1', tabId: 1 })).askRating).toBe(false); // no link until the listing is approved
  });

  it('the miss-report switch can only be changed from the helper window, never by a page', async () => {
    const w = worker({ respond: () => ({ status: 200, body: { missReports: true } }) });
    expect(await w.send({ type: 'settings', missReports: true }, tab)).toEqual({ error: 'Unknown request.' });
    expect(await w.send({ type: 'settings', missReports: true })).toEqual({ missReports: true });
    expect(w.calls[0]).toMatchObject({ url: `${API}/settings`, body: { missReports: true } });
  });

  it('opens the first-run guide on install only, and sends the install time with pairing', async () => {
    const w = worker({ local: { token: undefined }, respond: () => ({ status: 200, body: { token: 'nm7h_new', expiresAt: 1 } }) });
    await w.listeners.installed({ reason: 'update' });
    expect(w.opened).toEqual([]);
    await w.listeners.installed({ reason: 'install' });
    expect(w.opened).toEqual(['chrome-extension://ext/welcome.html']);
    const at = w.store.local.installedAt;
    expect(at).toBeGreaterThan(0);
    await w.send({ type: 'pair', code: 'ABCD-EFGH' });
    expect(w.calls[0].body).toEqual({ code: 'ABCD-EFGH', device: 'Chrome', installedAt: at, version: '1.1.0' });
  });

  it('ignores messages from anything but this extension', async () => {
    const w = worker();
    const got = w.listeners.msg({ type: 'kits' }, { id: 'another-extension' }, () => {});
    expect(got).toBe(false);
    expect(w.calls).toEqual([]);
  });
});
