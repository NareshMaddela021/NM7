/**
 * API layer — the ONLY file (with src/lib/auth.js) that talks to the backend.
 *
 * With VITE_API_BASE set, orders, payments (Razorpay) and refunds go to the FastAPI backend.
 * Without it the app runs in preview mode on sample data. Functions whose backend isn't built yet
 * (scan, expert, admin queue, …) still return sample data; their comment shows the future endpoint.
 */
import { MATCHED_JOBS, ADMIN_ORDERS, EXPERTS, EXPERT_ORDERS, EARNINGS } from '../data/mock';
import { http, LIVE } from './http';

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

/* ---------- Scan ---------- */
/**
 * The free ATS scan runs in the browser: the file is read on the device (never uploaded) and checked with fixed,
 * documented rules — see src/lib/scan. `source` is a File or 'sample'.
 */
export async function scanResume(source, role, onStep) {
  const { runScan } = await import('../lib/scan');
  return runScan(source, role, onStep);
}

/* ---------- Orders & payment ---------- */
/** POST /api/orders { planId, role, addons } → { orderId, razorpayOrderId, amount (paise), currency, keyId, … } */
export async function createOrder({ planId, role, addons = [] }) {
  if (LIVE) return http('/api/orders', { method: 'POST', body: { planId, role: role || null, addons } });
  await wait(400);
  return { orderId: null, planId, role, razorpayOrderId: 'order_TEST123' };
}

let checkoutScript = null;
function loadRazorpay() {
  if (window.Razorpay) return Promise.resolve();
  checkoutScript ||= new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'https://checkout.razorpay.com/v1/checkout.js';
    s.onload = resolve;
    s.onerror = () => { checkoutScript = null; reject(new Error('We couldn’t open the payment window. Check your internet and try again.')); };
    document.body.appendChild(s);
  });
  return checkoutScript;
}
const METHOD = { upi: 'UPI', card: 'Card', netbanking: 'Netbanking', wallet: 'Wallet', emi: 'EMI' };

/**
 * Opens Razorpay's own checkout window (UPI, card, netbanking…) for an order from createOrder(),
 * then has the server confirm the payment (POST /api/payments/verify).
 * Resolves with { orderId, method, invoiceNo, paymentId }. Closing the window rejects with code 'dismissed'.
 */
export async function pay(order) {
  if (!LIVE) { await wait(1600); return { orderId: null, method: 'UPI', invoiceNo: null, paymentId: null }; }
  await loadRazorpay();
  const result = await new Promise((resolve, reject) => {
    const rzp = new window.Razorpay({
      key: order.keyId,
      order_id: order.razorpayOrderId,
      amount: order.amount,
      currency: order.currency,
      name: order.name || 'Nm7',
      description: order.description,
      prefill: { name: order.prefill?.name, email: order.prefill?.email, ...(order.prefill?.contact ? { contact: order.prefill.contact } : {}) },
      theme: { color: '#111111' },
      handler: resolve,
      modal: { ondismiss: () => reject(Object.assign(new Error('You closed the payment window. Nothing was charged.'), { code: 'dismissed' })) },
    });
    rzp.open();
  });
  const o = await http('/api/payments/verify', { method: 'POST', body: result });
  return { orderId: o.id, method: METHOD[o.paymentMethod] || 'Razorpay', invoiceNo: o.invoiceNo, paymentId: o.paymentId, order: o };
}

// GET /api/orders/:id
export async function getOrder(id) {
  if (LIVE) return http(`/api/orders/${encodeURIComponent(id)}`);
  await wait(200);
  return { id, plan: 'Expert rewrite', price: 999, role: 'Data Analyst', paidAt: '[date]', dueInHours: 30, overdue: false };
}

// Real: POST /api/orders/:id/intake
export async function submitIntake(id, answers) {
  await wait(500);
  return { ok: true, id, answers };
}

/**
 * POST /api/orders/:id/refund { reason, details } — the server decides (late → refunded at once, else reviewed).
 * Live: resolves with { ref, autoApproved, amount (₹) }. Preview: null (the browser decides, see askRefund).
 */
export async function requestRefund(id, { reason, details }) {
  if (!LIVE) { await wait(700); return null; }
  const o = await http(`/api/orders/${encodeURIComponent(id)}/refund`, { method: 'POST', body: { reason, details } });
  const r = o.refunds[o.refunds.length - 1];
  return { ref: r.id, autoApproved: r.auto, amount: r.amount / 100 };
}

/* ---------- Builder / profile ---------- */
// Real: PUT /api/profile  (same shape as the builder state)
export async function saveProfile(profile) {
  await wait(250);
  return { ok: true, profile };
}

// Live: no job feed yet, so nothing is shown (the sample jobs are only in the preview build).
export async function getMatchedJobs() {
  if (LIVE) return [];
  await wait(200);
  return MATCHED_JOBS;
}

/* ---------- Expert ---------- */
export async function getExpertOrders() { await wait(200); return LIVE ? [] : EXPERT_ORDERS; }
// Real: POST /api/expert/orders/:id/draft
export async function sendDraft(id) { await wait(600); return { ok: true, id }; }
export async function getEarnings() { await wait(200); return LIVE ? null : EARNINGS; }
// Real: POST /api/expert/withdraw { amount } → Razorpay payout
export async function withdraw(amount) { await wait(1200); return { ok: true, amount }; }

/* ---------- Admin ---------- */
export async function getAdminQueue() { await wait(200); return LIVE ? { orders: [], experts: [] } : { orders: ADMIN_ORDERS, experts: EXPERTS }; }
// Real: POST /api/admin/orders/:id/assign { expertId }
export async function assignExpert(orderId, expertId) { await wait(300); return { ok: true, orderId, expertId }; }

/**
 * Resume / LinkedIn import. In this frontend-only version the file is read in the browser
 * (src/lib/import). Real endpoint later: POST /api/resume/parse (multipart file) → same shape as
 * importResume() returns, adding OCR for scanned files and an AI check of every field.
 */
export async function parseResumeOnServer(file) {
  const { importResume } = await import('../lib/import/index');
  return importResume(file, 'resume');
}

/* ---------- asuraa.ai profile link (experts already on asuraa.ai) ---------- */
// Real (needs two small endpoints on asuraa.ai, called from the Nm7 BACKEND, never the browser):
//   GET  https://asuraa.ai/api/public/profile/{username}           → public profile fields
//   POST https://asuraa.ai/api/public/profile/{username}/verify    → sends a 6-digit code to the account's email/phone
//   POST https://asuraa.ai/api/public/profile/{username}/verify/check { code } → { ok }
// Nm7 exposes them as: GET /api/experts/asuraa-ai/{username}, POST …/send-code, POST …/check-code
/** Linking an asuraa.ai profile needs those endpoints; until they exist it only works in the preview build. */
export const ASURAA_AI_LINK = !LIVE;
const AI_SAMPLE_PROFILES = LIVE ? {} : {
  // matches what asuraa.ai/nareshmaddela shows publicly today
  nareshmaddela: {
    username: 'nareshmaddela', url: 'asuraa.ai/nareshmaddela', name: 'Naresh Maddela', headline: 'Founder & CEO', photo: null,
    bio: 'Building an AI-powered hiring, mentorship, EdTech and marketing platform. Focused on AI, startups, community building and creating opportunities for learners and professionals.',
    location: 'Bengaluru, India', languages: ['English', 'Telugu', 'Kannada', 'Hindi'],
    experience: [{ role: 'Founder & CEO', company: 'AsuraaX AI', period: '2025–now', current: true }, { role: '', company: 'Hyundai Glovis', period: '', current: false }],
    links: { linkedin: 'linkedin.com/in/naresh-maddela-54b943161' }, rating: 5, reviews: 1,
    offerings: [{ title: '10-Min Student & Job Seeker Chat', type: '1:1 call · 15 min', price: 0 }], maskedContact: 'n••••••••@gmail.com',
  },
  saivarsha: {
    username: 'saivarsha', url: 'asuraa.ai/saivarsha', name: 'Sai Varsha', headline: 'Senior Data Analyst · Resume coach', photo: null,
    bio: 'Data analyst with 6 years in e-commerce analytics. I have reviewed 300+ resumes for analyst roles and help freshers turn projects into results recruiters notice.',
    location: 'Chennai, India', languages: ['English', 'Tamil', 'Hindi'],
    experience: [{ role: 'Senior Data Analyst', company: 'Northwind Retail', period: '2021–now', current: true }, { role: 'Data Analyst', company: 'Brightpath Logistics', period: '2019–2021', current: false }],
    links: { linkedin: 'linkedin.com/in/saivarsha-demo' }, rating: 4.9, reviews: 38,
    offerings: [{ title: 'Resume review for analysts', type: '1:1 call · 30 min', price: 499 }], maskedContact: 's••••••••@example.com',
  },
};
export const parseAiUsername = (input) => {
  const m = (input || '').trim().replace(/^https?:\/\//i, '').replace(/^www\./i, '').match(/^asuraa\.ai\/@?([a-z0-9._-]{3,40})\/?$/i);
  return m ? m[1].toLowerCase() : null;
};
export async function getAsuraaAiProfile(input) {
  if (LIVE) throw Object.assign(new Error('not-available'), { code: 'not-found' });
  await wait(700);
  const u = parseAiUsername(input);
  if (!u) throw Object.assign(new Error('bad-link'), { code: 'bad-link' });
  const p = AI_SAMPLE_PROFILES[u];
  if (!p) throw Object.assign(new Error('not-found'), { code: 'not-found' });
  return structuredClone(p);
}
const AI_DEMO_CODE = LIVE ? null : '246810';
export async function sendAsuraaAiCode(username) { await wait(600); return { sentTo: AI_SAMPLE_PROFILES[username]?.maskedContact || 'your email', demoCode: AI_DEMO_CODE }; }
export async function verifyAsuraaAiCode(username, code) { await wait(500); return { ok: !!AI_DEMO_CODE && code === AI_DEMO_CODE }; }

/* ---------- expert profile & applications ---------- */
// Real: PUT /api/experts/me (draft save) · POST /api/experts/me/submit · GET /api/admin/experts · POST /api/admin/experts/{id}/review
export async function submitExpertProfile(profile) { await wait(600); return { ...profile, status: 'review', submittedAt: new Date().toISOString() }; }
