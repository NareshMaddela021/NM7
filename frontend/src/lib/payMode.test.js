import { beforeEach, describe, expect, it, vi } from 'vitest';

const api = vi.hoisted(() => ({ createOrder: vi.fn(), pay: vi.fn() }));
vi.mock('../services/api', () => api);

const { NOT_PAID, _forgetUnpaid, buy, payError, payErrorLine } = await import('./payMode');

beforeEach(() => { api.createOrder.mockReset(); api.pay.mockReset(); _forgetUnpaid(); });
const dismissed = () => Object.assign(new Error('closed'), { code: 'dismissed' });

describe('payError', () => {
  it('a closed window took no money; a server message is shown as it is', () => {
    expect(payError(dismissed())).toBe('Payment not completed — no money was taken.');
    expect(payErrorLine(dismissed())).toBe(`${NOT_PAID} Try again.`);
    expect(payError(Object.assign(new Error('x'), { code: 'verify_failed' }))).toMatch(/won’t be charged twice/);
    expect(payError(new Error('Payments aren’t switched on yet.'))).toBe('Payments aren’t switched on yet.');
  });
});

describe('buy: no double orders', () => {
  it('reuses the unpaid order after a closed window, and starts fresh once paid', async () => {
    api.createOrder.mockResolvedValue({ orderId: 'RS-1' });
    api.pay.mockRejectedValueOnce(dismissed()).mockResolvedValueOnce({ orderId: 'RS-1' }).mockResolvedValueOnce({ orderId: 'RS-2' });
    await expect(buy({ planId: 'expert', role: null })).rejects.toMatchObject({ code: 'dismissed' });
    await expect(buy({ role: null, planId: 'expert' })).resolves.toEqual({ orderId: 'RS-1' }); // same thing, keys in any order
    expect(api.createOrder).toHaveBeenCalledTimes(1);
    await buy({ planId: 'expert', role: null });
    expect(api.createOrder).toHaveBeenCalledTimes(2); // the first one was paid
  });
  it('never reuses an order Razorpay took money for but the server couldn’t confirm yet', async () => {
    api.createOrder.mockResolvedValue({ orderId: 'RS-3' });
    api.pay.mockRejectedValueOnce(Object.assign(new Error('x'), { code: 'verify_failed' })).mockResolvedValueOnce({});
    await expect(buy({ planId: 'diy' })).rejects.toMatchObject({ code: 'verify_failed' });
    await buy({ planId: 'diy' });
    expect(api.createOrder).toHaveBeenCalledTimes(2);
  });
});
