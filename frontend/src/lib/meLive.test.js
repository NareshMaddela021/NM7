import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flush, orderFromApi, persist } from './meLive';

let calls;
beforeEach(() => {
  calls = [];
  globalThis.fetch = vi.fn(async (url, opts) => {
    calls.push({ url: url.replace(/^.*?(\/api\/)/, '/api/'), method: opts.method, body: opts.body ? JSON.parse(opts.body) : undefined });
    return { ok: true, status: 200, json: async () => ({}) };
  });
});
afterEach(() => { vi.useRealTimers(); });

const base = () => ({
  account: { name: 'Asha', phone: '', targetRole: '', cities: '', level: '', notify: {} },
  resumes: [{ id: 'r1', name: 'Main', active: true, data: { a: 1 }, jd: '', versions: [] }],
  covers: [{ id: 'c1', company: 'Zoho', body: '' }],
  apps: [{ id: 'a1', company: 'Swiggy', status: 'saved' }],
  checks: [], share: { on: false, slug: 'asha', views: [] }, calls: { picked: null, notes: '' }, seen: {},
});

describe('persist: only what changed is sent, to the owner-scoped endpoints', () => {
  it('adds, edits and deletes list items', async () => {
    const prev = base();
    const next = { ...prev, covers: [{ id: 'c2', company: 'Razorpay', body: 'Dear' }], apps: [{ ...prev.apps[0], status: 'applied' }], checks: [{ at: 5, score: 61.4, resumeId: 'r1', label: 'x' }] };
    persist(prev, next);
    await Promise.resolve();
    expect(calls).toEqual(expect.arrayContaining([
      expect.objectContaining({ url: '/api/me/cover-letters', method: 'POST', body: expect.objectContaining({ id: 'c2', company: 'Razorpay' }) }),
      expect.objectContaining({ url: '/api/me/cover-letters/c1', method: 'DELETE' }),
      expect.objectContaining({ url: '/api/me/applications/a1', method: 'PATCH', body: expect.objectContaining({ status: 'applied' }) }),
      expect.objectContaining({ url: '/api/me/ats-checks', method: 'POST', body: { score: 61, resumeId: 'r1', label: 'x' } }),
    ]));
    expect(calls.some((c) => c.url.startsWith('/api/me/resumes'))).toBe(false);
  });

  it('debounces resume edits into one PATCH and sends them on flush', async () => {
    vi.useFakeTimers();
    const a = base();
    const b = { ...a, resumes: [{ ...a.resumes[0], data: { a: 2 } }] };
    const c = { ...b, resumes: [{ ...b.resumes[0], data: { a: 3 }, name: 'Renamed' }] };
    persist(a, b); persist(b, c);
    expect(calls).toEqual([]);
    await flush();
    expect(calls).toEqual([{ url: '/api/me/resumes/r1', method: 'PATCH', body: { data: { a: 3 }, name: 'Renamed' } }]);
  });

  it('saves profile fields and screen state together, and the share link with PUT', async () => {
    const a = base();
    const b = { ...a, account: { ...a.account, targetRole: 'Data Analyst' }, seen: { 'RS-1': 9 }, share: { ...a.share, on: true } };
    persist(a, b);
    await flush();
    expect(calls).toEqual(expect.arrayContaining([
      { url: '/api/me/profile', method: 'PATCH', body: { targetRole: 'Data Analyst', ui: { calls: a.calls, seen: { 'RS-1': 9 } } } },
      { url: '/api/me/share', method: 'PUT', body: { on: true, slug: 'asha', resumeId: null, hidePhone: false } },
    ]));
  });
});

describe('orderFromApi', () => {
  const api = (extra = {}) => ({
    id: 'RS-1001', plan: 'expert', status: 'offer', amount: 129800, paidAt: '2026-10-01T10:00:00Z', paymentMethod: 'upi', paymentId: 'pay_1', invoiceNo: 'NM7/26-27/0001',
    items: [{ kind: 'plan', code: 'expert', name: 'Expert rewrite', amount: 99900 }, { kind: 'addon', code: 'express', name: 'Express', amount: 29900 }], refunds: [], ...extra,
  });
  it('maps prices to rupees and add-ons', () => {
    const o = orderFromApi(api(), 'r1');
    expect(o).toMatchObject({ id: 'RS-1001', price: 999, method: 'UPI', invoice: 'NM7/26-27/0001', linked: true, resumeId: 'r1' });
    expect(o.addons).toEqual([expect.objectContaining({ id: 'express', price: 299 })]);
    expect(o.refund).toBeUndefined();
  });
  it('shows refunds and refund reviews', () => {
    const done = orderFromApi(api({ status: 'refunded', refunds: [{ id: 'RF-1', amount: 129800, reason: 'late', status: 'processed', createdAt: '2026-10-03T00:00:00Z', processedAt: '2026-10-04T00:00:00Z' }] }));
    expect(done.status).toBe('refunded');
    expect(done.refund).toMatchObject({ amount: 1298, ref: 'RF-1', reason: 'Late delivery — automatic refund' });
    const review = orderFromApi(api({ refunds: [{ id: 'RF-2', amount: 99900, reason: 'quality', status: 'review', createdAt: '2026-10-03T00:00:00Z' }] }));
    expect(review.refundRequest).toMatchObject({ status: 'review', ref: 'RF-2' });
  });
});

describe('resume saves reach the server in order, carry the stamp we last saw, and retry once', () => {
  it('a second edit waits for the first PATCH; each PATCH sends ifUpdated and learns the new stamp', async () => {
    vi.useFakeTimers();
    const { noteServerStamps } = await import('./meLive');
    noteServerStamps([{ id: 'r1', updated: 100 }]);
    let release;
    let n = 0;
    globalThis.fetch = vi.fn((url, opts) => {
      n += 1;
      calls.push({ url: url.replace(/^.*?(\/api\/)/, '/api/'), method: opts.method, body: JSON.parse(opts.body) });
      if (n === 1) return new Promise((r) => { release = () => r({ ok: true, status: 200, json: async () => ({ id: 'r1', updated: 200 }) }); });
      return Promise.resolve({ ok: true, status: 200, json: async () => ({ id: 'r1', updated: 300 }) });
    });
    const a = base();
    const b = { ...a, resumes: [{ ...a.resumes[0], data: { a: 2 } }] };
    persist(a, b);
    await vi.advanceTimersByTimeAsync(800); // the first PATCH is in flight (held)
    const c = { ...b, resumes: [{ ...b.resumes[0], data: { a: 3 } }] };
    persist(b, c);
    await vi.advanceTimersByTimeAsync(800);
    expect(calls).toHaveLength(1); // the second waits for the first
    expect(calls[0].body).toEqual({ data: { a: 2 }, ifUpdated: 100 });
    release();
    await vi.advanceTimersByTimeAsync(10);
    expect(calls).toHaveLength(2);
    expect(calls[1].body).toEqual({ data: { a: 3 }, ifUpdated: 200 }); // the stamp the first answer gave
  });

  it('a network error is retried once after 3 s; a 409 is not retried and is reported', async () => {
    vi.useFakeTimers();
    const { onSaveState } = await import('./meLive');
    const states = [];
    const off = onSaveState((s) => states.push({ ...s }));
    let n = 0;
    globalThis.fetch = vi.fn(async (url, opts) => {
      n += 1;
      calls.push({ url: url.replace(/^.*?(\/api\/)/, '/api/'), method: opts.method, body: JSON.parse(opts.body) });
      if (n === 1) throw new TypeError('Failed to fetch');
      return { ok: true, status: 200, json: async () => ({ id: 'r1', updated: 1 }) };
    });
    const a = base();
    persist(a, { ...a, resumes: [{ ...a.resumes[0], data: { a: 9 } }] });
    await vi.advanceTimersByTimeAsync(800);
    expect(calls).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(3_100);
    expect(calls).toHaveLength(2);
    expect(states[states.length - 1]).toEqual({ pending: 0, failed: null });

    calls.length = 0;
    const errors = [];
    const { setErrorHandler } = await import('./meLive');
    setErrorHandler((e) => errors.push(e));
    globalThis.fetch = vi.fn(async (url, opts) => { calls.push({ url, method: opts.method }); return { ok: false, status: 409, json: async () => ({ error: { code: 'stale', message: 'changed elsewhere' } }) }; });
    persist(a, { ...a, resumes: [{ ...a.resumes[0], data: { a: 10 } }] });
    await vi.advanceTimersByTimeAsync(800);
    await vi.advanceTimersByTimeAsync(5_000);
    expect(calls).toHaveLength(1); // no retry on a 409
    expect(errors[0]?.code).toBe('stale');
    expect(states[states.length - 1].failed?.code).toBe('stale');
    off();
  });
});
