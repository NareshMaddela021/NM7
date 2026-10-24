// Pay via WhatsApp (Admin → Settings → Payments: Off | WhatsApp | Razorpay).
//   payMode()       the active mode from GET /api/public/payment-mode ("off" on any error)
//   buyOnWhatsApp() makes a pending order on the server (status awaiting_payment), then opens wa.me with only the item,
//                   the price and the order number. The order number and a tappable link are always shown too
//                   (<WaPlacedHost/>), in case WhatsApp didn't open.
// Nothing is unlocked here: Nm7 confirms the payment in Admin → WhatsApp payments, and the server unlocks it then.
import { useEffect, useState } from 'react';
import { http, LIVE } from '../services/http';

export const WA_PAY_TEXT = 'Pay by UPI through WhatsApp. Your order starts as soon as we confirm payment.';
export const WA_SAFETY = 'Pay only to the UPI ID we send in the Nm7 WhatsApp chat. We never ask for your OTP, PIN or card number.';
export const WA_DELIVERY = 'Delivery time starts after payment is confirmed.';
export const WA_WAITING = 'Waiting for payment confirmation';
export const BUY_WA = 'Buy on WhatsApp';

const OFF = { mode: 'off', replyHours: '' };
const PREVIEW = { mode: 'razorpay', replyHours: '' }; // preview builds keep their sample checkout (no money moves)
let cached = null;
/** { mode: 'off' | 'whatsapp' | 'razorpay', replyHours }. Never throws ("off" on an error). */
export function payMode(fresh = false) {
  if (!LIVE) return Promise.resolve(PREVIEW);
  if (!cached || fresh) cached = http('/api/public/payment-mode').catch(() => { cached = null; return OFF; });
  return cached;
}
/** The mode for a page: null while loading. */
export function usePayMode() {
  const [m, setM] = useState(null);
  useEffect(() => { let on = true; payMode().then((x) => on && setM(x)); return () => { on = false; }; }, []);
  return m;
}

/* ---------- the "order placed" box (rendered by <WaPlacedHost/>) ---------- */
let placed = null;
const subs = new Set();
export const onPlaced = (f) => { subs.add(f); f(placed); return () => subs.delete(f); };
export const closePlaced = () => { placed = null; subs.forEach((f) => f(null)); };

/**
 * Call straight from the click (before any other await): the WhatsApp tab is opened at once so the browser doesn't
 * block it, then pointed at the chat once the server has made the order. `path` is the endpoint that makes the order:
 * POST /api/orders/whatsapp { planId, role, addons } or POST /api/org/:id/billing/whatsapp { plan }.
 * `orderLink`: show "See my order" (customer orders; an organization's order is on its billing page).
 * Resolves with { orderId, item, amount (paise), waUrl, replyHours, opened }.
 */
export async function buyOnWhatsApp(body, path = '/api/orders/whatsapp', { orderLink = true } = {}) {
  let win = null;
  try { win = window.open('', '_blank'); } catch { win = null; }
  try {
    const r = await http(path, { method: 'POST', body });
    let opened = false;
    if (win && !win.closed) {
      try { win.opener = null; win.location.href = r.waUrl; opened = true; } catch { opened = false; }
    }
    placed = { ...r, opened, orderLink: orderLink ? `/me/orders/${r.orderId}` : null };
    subs.forEach((f) => f(placed));
    return placed;
  } catch (e) {
    try { win?.close(); } catch { /* ignore */ }
    throw e;
  }
}
