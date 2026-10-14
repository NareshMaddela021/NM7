/**
 * API layer — the ONLY file that talks to a backend.
 *
 * Right now every function returns sample data after a short delay, so the
 * whole frontend works on its own. When the FastAPI backend is ready, replace
 * each function body with the real call shown in its comment. No screen needs
 * to change.
 */
import { SAMPLE_REPORT, MATCHED_JOBS, ADMIN_ORDERS, EXPERTS, EXPERT_ORDERS, EARNINGS } from '../data/mock';

const API_BASE = import.meta.env.VITE_API_BASE || ''; // e.g. https://nm7.onrender.com
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// eslint-disable-next-line no-unused-vars
async function http(path, options = {}) {
  const res = await fetch(API_BASE + path, {
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
    credentials: 'include',
    ...options,
  });
  if (!res.ok) throw new Error((await res.text()) || res.statusText);
  return res.json();
}

/* ---------- Scan ---------- */
// Real: POST /api/resume/scan  (multipart: file, role)  → report
export async function scanResume({ file, role }) {
  await wait(300);
  return { ...SAMPLE_REPORT, file: file?.name || SAMPLE_REPORT.file, role };
}

/* ---------- Orders & payment ---------- */
// Real: POST /api/orders { planId, role, addon } → { orderId, razorpayOrderId, amount }
export async function createOrder({ planId, role, addon }) {
  await wait(400);
  return { orderId: 'RS-1051', planId, role, addon, razorpayOrderId: 'order_TEST123' };
}

/**
 * Real: load https://checkout.razorpay.com/v1/checkout.js and open
 *   new window.Razorpay({ key: VITE_RAZORPAY_KEY, order_id, amount, handler })
 * then POST /api/payments/verify { razorpay_payment_id, razorpay_order_id, razorpay_signature }
 */
export async function pay({ orderId, method, upi }) {
  await wait(1600);
  return { ok: true, orderId, method, upi };
}

// Real: GET /api/orders/:id
export async function getOrder(id) {
  await wait(200);
  return { id, plan: 'Expert rewrite', price: 999, role: 'Data Analyst', paidAt: '[date]', dueInHours: 30, overdue: false };
}

// Real: POST /api/orders/:id/intake
export async function submitIntake(id, answers) {
  await wait(500);
  return { ok: true, id, answers };
}

// Real: POST /api/orders/:id/refund { reason, details }
export async function requestRefund(id, { reason }) {
  await wait(700);
  return { ok: true, refundId: 'RF-2041', autoApproved: reason === 'late' };
}

/* ---------- Builder / profile ---------- */
// Real: PUT /api/profile  (same shape as the builder state)
export async function saveProfile(profile) {
  await wait(250);
  return { ok: true, profile };
}

export async function getMatchedJobs() {
  await wait(200);
  return MATCHED_JOBS;
}

/* ---------- Expert ---------- */
export async function getExpertOrders() { await wait(200); return EXPERT_ORDERS; }
// Real: POST /api/expert/orders/:id/draft
export async function sendDraft(id) { await wait(600); return { ok: true, id }; }
export async function getEarnings() { await wait(200); return EARNINGS; }
// Real: POST /api/expert/withdraw { amount } → Razorpay payout
export async function withdraw(amount) { await wait(1200); return { ok: true, amount }; }

/* ---------- Admin ---------- */
export async function getAdminQueue() { await wait(200); return { orders: ADMIN_ORDERS, experts: EXPERTS }; }
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
const AI_SAMPLE_PROFILES = {
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
    experience: [{ role: 'Senior Data Analyst', company: '[Company]', period: '2021–now', current: true }, { role: 'Data Analyst', company: '[Company]', period: '2019–2021', current: false }],
    links: { linkedin: 'linkedin.com/in/saivarsha-demo' }, rating: 4.9, reviews: 38,
    offerings: [{ title: 'Resume review for analysts', type: '1:1 call · 30 min', price: 499 }], maskedContact: 's••••••••@example.com',
  },
};
export const parseAiUsername = (input) => {
  const m = (input || '').trim().replace(/^https?:\/\//i, '').replace(/^www\./i, '').match(/^asuraa\.ai\/@?([a-z0-9._-]{3,40})\/?$/i);
  return m ? m[1].toLowerCase() : null;
};
export async function getAsuraaAiProfile(input) {
  await wait(700);
  const u = parseAiUsername(input);
  if (!u) throw Object.assign(new Error('bad-link'), { code: 'bad-link' });
  const p = AI_SAMPLE_PROFILES[u];
  if (!p) throw Object.assign(new Error('not-found'), { code: 'not-found' });
  return structuredClone(p);
}
export async function sendAsuraaAiCode(username) { await wait(600); return { sentTo: AI_SAMPLE_PROFILES[username]?.maskedContact || 'your email', demoCode: '246810' }; }
export async function verifyAsuraaAiCode(username, code) { await wait(500); return { ok: code === '246810' }; }

/* ---------- expert profile & applications ---------- */
// Real: PUT /api/experts/me (draft save) · POST /api/experts/me/submit · GET /api/admin/experts · POST /api/admin/experts/{id}/review
export async function submitExpertProfile(profile) { await wait(600); return { ...profile, status: 'review', submittedAt: new Date().toISOString() }; }
