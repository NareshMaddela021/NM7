import { LEGAL } from './legal';
// Single source of truth for prices, fees and promises.
// Change a number here and every screen updates.

export const PLANS = {
  diy: { id: 'diy', name: 'Fix it yourself', price: 99, blurb: 'AI rewrites, ATS-safe templates, PDF & DOCX export' },
  expert: { id: 'expert', name: 'Expert rewrite', price: 999, blurb: 'A verified expert from your field rewrites it' },
  launch: { id: 'launch', name: 'Career Launch', price: 2999, blurb: 'Expert rewrite + LinkedIn makeover, cover letters and a 1:1 mentor call' },
  // self-serve, unlocked at once (not an expert plan); Career Launch includes it
  linkedin_pack: { id: 'linkedin_pack', name: 'LinkedIn pack', price: 149, blurb: 'Headline, About, experience, skills, banner and more, written from your own details' },
  // job search, self-serve: the Rs 99 plan includes the Tailor pack; Career Launch includes the Interview pack
  tailor_pack: { id: 'tailor_pack', name: 'Tailor pack', price: 49, blurb: 'Unlimited job matches, tailored resume copies, AI rewrites and cover letters' },
  interview_pack: { id: 'interview_pack', name: 'Interview pack', price: 99, blurb: '10 questions with answers from your resume, and practice with feedback' },
};
/** The resume plans (expert / DIY), without the LinkedIn pack. */
export const RESUME_PLANS = ['diy', 'expert', 'launch'];

export const PROMISES = {
  delivery: '24–48 hours',
  deliveryHours: 48,
  refund: 'Full refund if we don’t fulfil the service',
  refundDays: '3–5 business days',
  retentionDays: 60,
  autoApproveDays: '1–2 days',
  withdrawalDays: '3–5 business days',
  paymentProvider: 'Razorpay',
};

// Platform keeps 15% + GST on that fee + payment transaction charges.
export const FEES = {
  platformPct: 15,
  gstPct: 18, // GST on the platform fee — confirm with your CA
  txPct: 2, // Razorpay transaction charge — confirm on your Razorpay plan
  tdsPct: null, // TODO: add once your CA confirms
};

export function expertPayout(price, fees = FEES) {
  const platform = price * fees.platformPct / 100;
  const gst = platform * fees.gstPct / 100;
  const tx = price * fees.txPct / 100;
  return { price, platform, gst, tx, net: price - platform - gst - tx };
}

export const inr = (n) => '₹' + (Math.round(n) || 0).toLocaleString('en-IN'); // `|| 0`: never “₹-0”

// Customer add-ons (sample prices — change here).
export const ADDONS = {
  revision: { id: 'revision', name: 'Extra revision round', price: 199, blurb: 'One more round of changes after the final.' },
  express: { id: 'express', name: 'Express delivery (24h)', price: 299, blurb: 'Your first draft within 24 hours of buying this.' },
  linkedin: { id: 'linkedin', name: 'LinkedIn makeover', price: 499, blurb: 'Headline, About and top role rewritten by your expert.' },
};

// Upgrades: pay only the difference.
export const upgradePrice = (from, to) => Math.max(0, PLANS[to].price - PLANS[from].price);

// Referral reward — not decided yet. Set a number (₹) to show it everywhere; null = "rewards coming soon".
export const REFERRAL = { reward: null, friendOff: null };

// Customer invoices. Prices are shown as GST-inclusive — confirm the GST treatment and GSTIN with your CA.
export const INVOICE = { gstPct: 18, inclusive: true, gstin: LEGAL.gstin, company: LEGAL.company, brand: 'Nm7 · nm7.si', sacCode: LEGAL.sacCode }; // GSTIN & SAC: src/lib/legal.js
export function gstSplit(amount, inv = INVOICE) {
  const taxable = inv.inclusive ? amount / (1 + inv.gstPct / 100) : amount;
  const gst = inv.inclusive ? amount - taxable : amount * inv.gstPct / 100;
  return { taxable, gst, total: taxable + gst };
}

/** Live: the owner sets prices in the admin console; load them into PLANS / ADDONS (rupees) at start-up. */
export async function syncPrices(http) {
  const r = await http('/api/public/prices');
  Object.entries(r.plans || {}).forEach(([k, v]) => { if (PLANS[k]) Object.assign(PLANS[k], { price: v.price, active: v.active }); });
  Object.entries(r.addons || {}).forEach(([k, v]) => { if (ADDONS[k]) Object.assign(ADDONS[k], { price: v.price, active: v.active }); });
  if (r.deliveryHours && PROMISES.deliveryHours !== undefined) PROMISES.deliveryHours = r.deliveryHours;
}
