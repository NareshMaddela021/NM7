// The payment mode alone (no checkout code), small enough for public pages: /pricing, the home page plan cards.
//   payMode()     the active mode from GET /api/public/payment-mode: "razorpay" or "off" ("off" on any error)
//   usePayMode()  the same for a page (null while loading)
//   PAY_SOON      what every pay button says while payments are off (no Razorpay keys yet)
import { useEffect, useState } from 'react';
import { http, LIVE } from '../services/http';

/** What every pay button says while payments are off. */
export const PAY_SOON = 'Payments coming soon';

const OFF = { mode: 'off' };
const PREVIEW = { mode: 'razorpay' }; // preview builds keep their sample checkout (no money moves)
let cached = null;
/** { mode: 'off' | 'razorpay' }. Never throws ("off" on an error). */
export function payMode(fresh = false) {
  if (!LIVE) return Promise.resolve(PREVIEW);
  if (!cached || fresh) cached = http('/api/public/payment-mode').then((r) => ({ mode: r?.mode === 'razorpay' ? 'razorpay' : 'off' }), () => { cached = null; return OFF; });
  return cached;
}
/** The mode for a page: null while loading. */
export function usePayMode() {
  const [m, setM] = useState(null);
  useEffect(() => { let on = true; payMode().then((x) => on && setM(x)); return () => { on = false; }; }, []);
  return m;
}

