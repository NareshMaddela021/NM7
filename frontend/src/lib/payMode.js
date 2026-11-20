// How Nm7 takes payments (Admin -> Settings -> Payments -> "Payment method": Razorpay | Off).
//   payMode()      the active mode from GET /api/public/payment-mode: "razorpay" or "off" ("off" on any error)
//   usePayMode()   the same for a page (null while loading)
//   buy(body)      Razorpay checkout for a new order (POST /api/orders), reusing an unpaid order for the same thing
//   payOrder(id)   pay an unpaid / expired order again (POST /api/orders/:id/pay)
//   payAddon(id, item)  an add-on or upgrade on a paid order (POST /api/orders/:id/addon)
//   payError(e)    the calm text to show when a payment didn't finish
// Every amount is the server's. Off (no Razorpay keys yet): every pay button shows PAY_SOON ("Payments coming soon")
// and nothing calls these. As soon as the mode is "razorpay" the same buttons pay, with no code change.
import { http } from '../services/http';
import { createOrder, pay } from '../services/api';

export { PAY_SOON, payMode, usePayMode } from './payState';
export const NOT_PAID = 'Payment not completed — no money was taken.';
export const NOT_CONFIRMED = 'We couldn’t confirm your payment yet. If money was taken, your order updates in My orders within a few minutes — you won’t be charged twice.';
export const PAY_METHODS = 'UPI, card, netbanking or wallet · GST invoice emailed';

/** The message for a payment that didn't finish: closed window -> "no money was taken"; server errors -> their text. */
export function payError(e) {
  if (!e || e.code === 'dismissed') return NOT_PAID;
  if (e.code === 'verify_failed') return NOT_CONFIRMED;
  return e.message || NOT_PAID;
}

/** The same as one line for a toast (where there's no Try again button next to it). */
export const payErrorLine = (e) => (!e || e.code === 'dismissed' ? `${NOT_PAID} Try again.` : payError(e));

// orders made but not paid yet (the window was closed), reused when the same thing is bought again: no double orders
const unpaid = new Map();
const keyOf = (body) => JSON.stringify(Object.keys(body).sort().map((k) => [k, body[k]]));

async function payOnce(key, make) {
  let order = unpaid.get(key);
  if (!order) { order = await make(); unpaid.set(key, order); }
  try {
    const paid = await pay(order);
    unpaid.delete(key);
    return paid;
  } catch (e) {
    if (e?.code === 'verify_failed') unpaid.delete(key); // Razorpay took it; the webhook confirms it: never reuse it
    throw e;
  }
}

/** Razorpay checkout for a new order { planId, role?, addons?, code?, billing? }. Resolves with pay()'s result. */
export const buy = (body) => payOnce(keyOf(body), () => createOrder(body));

/** Pay an unpaid (or expired) order again: the same order and amount. */
export async function payOrder(orderId) {
  const order = await http(`/api/orders/${encodeURIComponent(orderId)}/pay`, { method: 'POST' });
  return pay(order);
}

/** An add-on ("express", "revision", "linkedin") or an upgrade ("upgrade:expert" / "upgrade:launch") on a paid order. */
export const payAddon = (orderId, item) => payOnce(`addon:${orderId}:${item}`, () => http(`/api/orders/${encodeURIComponent(orderId)}/addon`, { method: 'POST', body: { item } }));

export const _forgetUnpaid = () => unpaid.clear();
