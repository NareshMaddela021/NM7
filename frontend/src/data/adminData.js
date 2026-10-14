// Sample data for the admin console. Deterministic (seeded), so the preview looks the same every time.
// Replace with API calls (see services/api.js → admin section) when the backend is ready.
import { PLANS, expertPayout } from '../lib/pricing';

let seed = 42;
const rnd = () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; };
const pick = (a) => a[Math.floor(rnd() * a.length)];
const NOW = new Date('2026-10-14T10:00:00+05:30').getTime();
const H = 3600 * 1000;
export const NOW_MS = NOW;

export const DOMAINS = ['Data & analytics', 'Software engineering', 'Product', 'Finance', 'Marketing & HR', 'Operations & supply chain'];
const ROLES = { 'Data & analytics': ['Data Analyst', 'BI Analyst', 'Business Analyst'], 'Software engineering': ['SDE-1', 'Frontend Developer', 'Backend Developer'], Product: ['Product Analyst', 'Associate PM'], Finance: ['Finance Analyst', 'Banking Associate'], 'Marketing & HR': ['HR Executive', 'Marketing Associate'], 'Operations & supply chain': ['Supply Chain Analyst', 'Operations Executive'] };
const CITIES = ['Bengaluru', 'Hyderabad', 'Chennai', 'Pune', 'Mumbai', 'Delhi', 'Kolkata', 'Coimbatore', 'Vizag', 'Jaipur'];

export const EXPERTS_FULL = [
  { id: 'a', name: '[Expert A]', domains: ['Data & analytics'], cap: 8, onTime: 97, rating: 4.9, revisions: 0.6, refunds: 0, tier: 'Top expert', status: 'active', ai: true },
  { id: 'd', name: '[Expert D]', domains: ['Data & analytics', 'Product'], cap: 6, onTime: 92, rating: 4.7, revisions: 0.9, refunds: 1, tier: 'Trusted', status: 'active', ai: false },
  { id: 'b', name: '[Expert B]', domains: ['Software engineering'], cap: 8, onTime: 88, rating: 4.6, revisions: 1.1, refunds: 1, tier: 'Trusted', status: 'active', ai: true },
  { id: 'c', name: '[Expert C]', domains: ['Product'], cap: 8, onTime: 95, rating: 4.8, revisions: 0.7, refunds: 0, tier: 'Top expert', status: 'active', ai: false },
  { id: 'e', name: '[Expert E]', domains: ['Finance'], cap: 8, onTime: 90, rating: 4.5, revisions: 1.0, refunds: 0, tier: 'Trusted', status: 'active', ai: false },
  { id: 'f', name: '[Expert F]', domains: ['Marketing & HR'], cap: 6, onTime: 81, rating: 4.2, revisions: 1.6, refunds: 2, tier: 'New', status: 'active', ai: false },
  { id: 'g', name: '[Expert G]', domains: ['Operations & supply chain', 'Data & analytics'], cap: 5, onTime: 94, rating: 4.7, revisions: 0.8, refunds: 0, tier: 'New', status: 'paused', ai: true },
];

/* ---------- orders (last 30 days) ---------- */
const STAGES = ['Placed', 'Expert assigned', 'Draft 1', 'Revisions', 'Delivered', 'Approved'];
export const ORDERS = [];
for (let i = 0; i < 74; i++) {
  const r = rnd();
  const planId = r < 0.45 ? 'diy' : r < 0.86 ? 'expert' : 'launch';
  const domain = pick(DOMAINS);
  const age = i < 9 ? rnd() * 40 : 40 + rnd() * 680; // hours since placed
  const created = NOW - age * H;
  const id = `RS-${String(1120 - i).padStart(4, '0')}`;
  const custN = 20 + i;
  const base = { id, customer: `[Customer ${custN}]`, custId: `C${custN}`, planId, price: PLANS[planId].price, domain, role: pick(ROLES[domain]), createdAt: created, city: pick(CITIES), atsBefore: 40 + Math.round(rnd() * 25) };
  if (planId === 'diy') { ORDERS.push({ ...base, expert: null, stage: 'Self-serve', deadline: null, atsAfter: base.atsBefore + 18 + Math.round(rnd() * 15) }); continue; }
  const deadline = created + 48 * H;
  let stage;
  if (age > 72) stage = rnd() < 0.08 ? 'Refunded' : 'Approved';
  else if (age > 48) stage = rnd() < 0.7 ? 'Delivered' : 'Revisions';
  else stage = age < 3 ? 'Placed' : pick(['Expert assigned', 'Draft 1', 'Draft 1', 'Revisions']);
  const expert = stage === 'Placed' && rnd() < 0.8 ? null : (EXPERTS_FULL.find((x) => x.domains.includes(domain) && x.status === 'active') || EXPERTS_FULL[0]).id;
  const delivered = ['Delivered', 'Approved'].includes(stage);
  const deliveredAt = delivered ? created + (18 + rnd() * 34) * H : null;
  ORDERS.push({ ...base, expert, stage, deadline, deliveredAt, rating: stage === 'Approved' ? (rnd() < 0.12 ? 3 : rnd() < 0.3 ? 4 : 5) : null, atsAfter: delivered ? Math.min(98, base.atsBefore + 25 + Math.round(rnd() * 20)) : null });
}
// make a few orders interesting
ORDERS[1] = { ...ORDERS[1], planId: 'expert', price: 999, stage: 'Draft 1', expert: 'b', domain: 'Software engineering', role: 'Frontend Developer', deadline: NOW - 5 * H, createdAt: NOW - 53 * H };
ORDERS[2] = { ...ORDERS[2], planId: 'launch', price: 2999, stage: 'Placed', expert: null, deadline: NOW + 4 * H, createdAt: NOW - 44 * H };
ORDERS[3] = { ...ORDERS[3], planId: 'expert', price: 999, stage: 'Placed', expert: null, customer: 'Sai Varsha', custId: 'C1', domain: 'Data & analytics', role: 'Data Analyst', deadline: NOW + 30 * H, createdAt: NOW - 18 * H };

export const orderTimeline = (o) => {
  const t = [['Paid', o.createdAt]];
  if (o.expert) t.push(['Expert assigned', o.createdAt + 0.6 * H]);
  if (['Draft 1', 'Revisions', 'Delivered', 'Approved'].includes(o.stage)) t.push(['Draft 1 sent', o.createdAt + 20 * H]);
  if (['Revisions', 'Delivered', 'Approved'].includes(o.stage)) t.push(['Revision requested', o.createdAt + 26 * H]);
  if (o.deliveredAt) t.push(['Delivered', o.deliveredAt]);
  if (o.stage === 'Approved') t.push(['Auto-approved', o.deliveredAt + 36 * H]);
  if (o.stage === 'Refunded') t.push(['Refunded', o.createdAt + 60 * H]);
  return t;
};

/* ---------- customers ---------- */
export const CUSTOMERS = [];
const seen = new Set();
ORDERS.forEach((o) => {
  if (seen.has(o.custId)) return;
  seen.add(o.custId);
  const first = o.createdAt - rnd() * 200 * H;
  CUSTOMERS.push({ id: o.custId, name: o.customer, email: `${o.customer.replace(/\W+/g, '').toLowerCase() || 'user'}@example.com`, city: o.city, joined: first, scans: 1 + Math.floor(rnd() * 4), builder: rnd() < 0.6, blocked: false, notes: '' });
});
for (let i = 0; i < 18; i++) CUSTOMERS.push({ id: `C${200 + i}`, name: `[Visitor ${i + 1}]`, email: `visitor${i + 1}@example.com`, city: pick(CITIES), joined: NOW - rnd() * 700 * H, scans: 1 + Math.floor(rnd() * 2), builder: rnd() < 0.4, blocked: false, notes: '' });

/* ---------- payments (Razorpay) ---------- */
export const PAYMENTS = ORDERS.map((o, i) => ({
  id: `pay_${(0x9a3f2c + i * 7919).toString(36).toUpperCase()}${i}`, orderId: o.id, amount: o.price, at: o.createdAt - 2 * 60 * 1000,
  method: pick(['UPI', 'UPI', 'UPI', 'Card', 'Netbanking']), status: o.stage === 'Refunded' ? 'refunded' : 'captured', settled: o.createdAt < NOW - 72 * H,
}));
PAYMENTS.push({ id: 'pay_MISMATCH01', orderId: null, amount: 999, at: NOW - 30 * H, method: 'UPI', status: 'captured', settled: false, note: 'Paid but no order created (checkout closed early)' });
PAYMENTS.push({ id: 'pay_FAILED7781', orderId: null, amount: 2999, at: NOW - 8 * H, method: 'Card', status: 'failed', settled: false });

/* ---------- payout requests ---------- */
export const PAYOUTS = [
  { id: 'PO-311', expert: 'a', amount: 6416, orders: 8, at: NOW - 20 * H, status: 'pending' },
  { id: 'PO-310', expert: 'c', amount: 4812, orders: 2, at: NOW - 26 * H, status: 'pending' },
  { id: 'PO-309', expert: 'b', amount: 3208, orders: 4, at: NOW - 50 * H, status: 'approved' },
  { id: 'PO-305', expert: 'e', amount: 2406, orders: 3, at: NOW - 120 * H, status: 'paid', paidAt: NOW - 50 * H, utr: 'UTR4419920013' },
  { id: 'PO-301', expert: 'd', amount: 1604, orders: 2, at: NOW - 200 * H, status: 'paid', paidAt: NOW - 140 * H, utr: 'UTR4418810457' },
];
export const payoutGross = (net) => { const per = expertPayout(999); return Math.round((net / per.net) * 999); };

/* ---------- refunds & disputes ---------- */
export const REFUNDS = [
  { id: 'RF-41', orderId: ORDERS[1].id, type: 'late', status: 'auto-approved', amount: 999, reason: 'Delivered after the 48-hour promise.', expertSide: 'Customer sent intake answers late (system shows intake at 31h).', at: NOW - 4 * H, rp: 'processing' },
  { id: 'RF-40', orderId: ORDERS[12].id, type: 'quality', status: 'redo-offered', amount: ORDERS[12].price, reason: 'Bullets still generic, no numbers added.', expertSide: 'Customer gave no metrics in intake; I asked twice in chat.', at: NOW - 20 * H, rp: null },
  { id: 'RF-39', orderId: ORDERS[15].id, type: 'quality', status: 'review', amount: ORDERS[15].price, reason: 'Re-do also not good. Wrong job title used for my target role.', expertSide: 'Target role changed after draft 1.', at: NOW - 15 * H, rp: null },
  { id: 'RF-37', orderId: ORDERS[22].id, type: 'other', status: 'rejected', amount: ORDERS[22].price, reason: 'Changed my mind.', expertSide: '—', at: NOW - 140 * H, rp: null, note: 'Delivered on time and approved; not eligible.' },
  { id: 'RF-35', orderId: ORDERS[30].id, type: 'late', status: 'refunded', amount: ORDERS[30].price, reason: 'Late delivery.', expertSide: '—', at: NOW - 260 * H, rp: 'done' },
];

/* ---------- quality audits ---------- */
export const QA_CHECKS = ['ATS-safe layout', 'Numbers / results in bullets', 'No spelling or grammar errors', 'Matches target role', 'Clean formatting & 1 page (0–3 yrs)'];
export const AUDITS = ORDERS.filter((o) => o.stage === 'Approved' || o.stage === 'Delivered').slice(0, 7).map((o, i) => ({ orderId: o.id, expert: o.expert, scores: i < 3 ? QA_CHECKS.map(() => (rnd() < 0.8 ? 1 : 0)) : null }));

/* ---------- settings ---------- */
export const DEFAULT_SETTINGS = {
  plans: Object.values(PLANS).map((p) => ({ ...p, active: true })),
  coupons: [
    { code: 'FRESHER20', type: '%', value: 20, plans: ['expert', 'launch'], expires: '2026-12-31', limit: 500, used: 132, active: true },
    { code: 'DIWALI100', type: '₹', value: 100, plans: ['expert'], expires: '2026-11-05', limit: 300, used: 41, active: true },
    { code: 'LAUNCH50', type: '%', value: 50, plans: ['diy'], expires: '2026-09-30', limit: 1000, used: 1000, active: false },
  ],
  rules: { deliveryHours: 48, minDeliveryHours: 24, autoApproveDays: 2, redoHours: 24, refundReviewHours: 24, retentionDays: 60 },
  fees: { platformPct: 15, gstPct: 18, txPct: 2, tdsPct: null },
  templatesOff: [], templatesRecommended: ['fresher', 'kio'],
  messages: [
    { id: 'received', name: 'Order received', channel: 'WhatsApp', text: 'Hi {name}, we got your {plan} order {order}. Your expert will deliver within {hours} hours.' },
    { id: 'draft', name: 'Draft ready', channel: 'WhatsApp', text: 'Hi {name}, draft 1 of your resume is ready. Review it here: {link}' },
    { id: 'delivered', name: 'Delivered', channel: 'Email', text: 'Hi {name}, your final resume is ready to download: {link}. It auto-approves in {days} days.' },
    { id: 'refund', name: 'Refund done', channel: 'Email', text: 'Hi {name}, we refunded ₹{amount} for order {order}. It reaches your account in 3–5 business days.' },
  ],
  auditPct: 10,
};

export const DEFAULT_RULES = [
  { id: 'r1', on: true, when: 'deadline', value: 6, then: 'alert-expert-ops', label: '6 hours before the deadline and no draft yet → alert the expert and ops', runs: 3 },
  { id: 'r2', on: true, when: 'unassigned', value: 30, then: 'auto-assign', label: 'Order unassigned for 30 minutes → auto-assign the best expert', runs: 11 },
  { id: 'r3', on: true, when: 'expert-refunds', value: 2, then: 'flag-expert', label: 'Expert gets 2 refunds in a week → flag for review', runs: 1 },
  { id: 'r4', on: false, when: 'low-rating', value: 3, then: 'audit', label: 'Customer rates 3★ or less → add to quality audit', runs: 0 },
];

export const TEAM = [
  { id: 'u1', name: 'Naresh Maddela', email: 'info@nm7.si', role: 'owner', twoStep: true, lastLogin: NOW - 0.2 * H },
  { id: 'u2', name: '[Ops lead]', email: 'ops@nm7.si', role: 'ops', twoStep: true, lastLogin: NOW - 3 * H },
  { id: 'u3', name: '[Finance]', email: 'finance@nm7.si', role: 'finance', twoStep: false, lastLogin: NOW - 30 * H },
  { id: 'u4', name: '[Support]', email: 'support@nm7.si', role: 'support', twoStep: true, lastLogin: NOW - 1 * H },
  { id: 'u5', name: '[Quality reviewer]', email: 'quality@nm7.si', role: 'quality', twoStep: false, lastLogin: NOW - 70 * H },
];

export const AUDIT_SEED = [
  { at: NOW - 0.5 * H, who: '[Ops lead]', area: 'Orders', what: `Assigned ${ORDERS[5].id} to [Expert A]`, from: 'Unassigned', to: '[Expert A]' },
  { at: NOW - 2 * H, who: '[Support]', area: 'Refunds', what: 'Offered a free re-do on RF-40', from: 'review', to: 'redo-offered' },
  { at: NOW - 6 * H, who: 'Naresh Maddela', area: 'Settings', what: 'Created coupon DIWALI100', from: '—', to: '₹100 off · Expert rewrite' },
  { at: NOW - 26 * H, who: '[Finance]', area: 'Payouts', what: 'Approved payout PO-309', from: 'pending', to: 'approved' },
  { at: NOW - 50 * H, who: '[Finance]', area: 'Payouts', what: 'Marked PO-305 as paid', from: 'approved', to: 'paid · UTR4419920013' },
];

/* ---------- funnel (scans → checkout → paid) per day, for the date range ---------- */
export const FUNNEL_DAILY = Array.from({ length: 30 }, () => { const scans = 30 + Math.round(rnd() * 25); const checkouts = Math.round(scans * (0.22 + rnd() * 0.1)); return { scans, checkouts }; });
