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
