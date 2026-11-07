import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// LIVE is a build-time constant; the client itself works whatever it says.
const { http, ApiError, isTransient, onSlow, TIMEOUT_MS, SLOW_AFTER_MS, _forgetAwake } = await import('./http');

const json = (status, body) => ({ ok: status < 400, status, json: async () => body });
const fetchMock = vi.fn();

beforeEach(() => { vi.useFakeTimers(); globalThis.fetch = fetchMock; fetchMock.mockReset(); });
afterEach(() => { vi.useRealTimers(); delete globalThis.fetch; });

describe('http()', () => {
  it('times out after 25 s with a clear message, and retries a GET once', async () => {
    fetchMock.mockImplementation((url, { signal }) => new Promise((_, reject) => { signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' }))); }));
    const p = http('/api/me/state').catch((e) => e);
    await vi.advanceTimersByTimeAsync(TIMEOUT_MS + 10); // first try
    await vi.advanceTimersByTimeAsync(1_600); // the wait before the retry
    await vi.advanceTimersByTimeAsync(TIMEOUT_MS + 10); // second try
    const e = await p;
    expect(e).toBeInstanceOf(ApiError);
    expect(e.code).toBe('timeout');
    expect(e.message).toMatch(/taking too long/);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('retries a GET on a 5xx and a network error, never a POST', async () => {
    fetchMock.mockResolvedValueOnce(json(502, null)).mockResolvedValueOnce(json(200, { ok: 1 }));
    const p = http('/api/x');
    await vi.advanceTimersByTimeAsync(2_000);
    await expect(p).resolves.toEqual({ ok: 1 });
    expect(fetchMock).toHaveBeenCalledTimes(2);

    fetchMock.mockReset();
    fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch')).mockResolvedValueOnce(json(200, { ok: 2 }));
    const q = http('/api/y');
    await vi.advanceTimersByTimeAsync(2_000);
    await expect(q).resolves.toEqual({ ok: 2 });

    fetchMock.mockReset();
    fetchMock.mockResolvedValueOnce(json(503, { error: { code: 'ai_busy', message: 'busy' } }));
    const e = await http('/api/post', { method: 'POST', body: {} }).catch((x) => x);
    expect(e.status).toBe(503);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('says which fields to check in the form’s own words', async () => {
    fetchMock.mockResolvedValueOnce(json(422, { error: { code: 'invalid_input', message: 'x', fields: [{ field: 'passwordConfirm' }, { field: 'termsAccepted' }, { field: 'phone' }] } }));
    const e = await http('/api/auth/signup', { method: 'POST', body: {} }).catch((x) => x);
    expect(e.message).toBe('Please check the re-typed password, the terms checkbox, mobile number.');
    expect(e.message).not.toMatch(/passwordConfirm|termsAccepted/);
  });

  it('tells subscribers when a request has been slow for 3 s, and when it settled', async () => {
    _forgetAwake();
    let resolve;
    fetchMock.mockImplementation(() => new Promise((r) => { resolve = r; }));
    const seen = [];
    const off = onSlow((v) => seen.push(v));
    const p = http('/api/slow');
    await vi.advanceTimersByTimeAsync(SLOW_AFTER_MS + 10);
    expect(seen).toEqual([false, true]);
    resolve(json(200, {}));
    await p;
    expect(seen).toEqual([false, true, false]);
    off();
  });

  it('items 1 and 25: the notice goes the moment the server answers, and slow AI calls after that never show it', async () => {
    _forgetAwake();
    const pending = [];
    fetchMock.mockImplementation(() => new Promise((r) => { pending.push(r); }));
    const seen = [];
    const off = onSlow((v) => seen.push(v));
    const a = http('/api/me/state');
    const b = http('/api/public/site-flags');
    await vi.advanceTimersByTimeAsync(SLOW_AFTER_MS + 10);
    expect(seen).toEqual([false, true]); // waking up
    pending[1](json(200, {})); // the first answer: the server is awake
    await b;
    expect(seen).toEqual([false, true, false]); // gone, though the other request is still running
    pending[0](json(200, {}));
    await a;
    const ai = http('/api/me/summary/generate', { method: 'POST', body: {}, timeout: 120_000 });
    await vi.advanceTimersByTimeAsync(SLOW_AFTER_MS * 5);
    expect(seen).toEqual([false, true, false]); // a long AI answer is not "waking up"
    pending[2](json(200, {}));
    await ai;
    off();
  });

  it('isTransient: network, timeout and 5xx yes; 4xx and cancel no', () => {
    expect(isTransient(new ApiError(0, 'network', 'x'))).toBe(true);
    expect(isTransient(new ApiError(0, 'timeout', 'x'))).toBe(true);
    expect(isTransient(new ApiError(503, 'ai_busy', 'x'))).toBe(true);
    expect(isTransient(new ApiError(409, 'stale', 'x'))).toBe(false);
    expect(isTransient(new ApiError(0, 'cancelled', 'x'))).toBe(false);
    expect(isTransient(new Error('x'))).toBe(false);
  });
});
