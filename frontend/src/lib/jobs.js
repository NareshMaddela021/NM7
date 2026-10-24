// Job search (Phases 1-3): the API under /api/me/jobs, plus reading a job post from a screenshot or a PDF.
// Job links can't be opened: people paste the text, or add a screenshot (read on the server) or a PDF (read here).
// Everything is saved on the person's account only and never shared with an organization.
import { http, LIVE, ApiError } from '../services/http';
import { createOrder, pay } from '../services/api';
import { preparePhoto } from './photoImport';
import { buyOnWhatsApp } from './waPay';

const J = '/api/me/jobs';
const OFF = { tailor: false, interview: false, mode: 'off', onSale: { tailor: false, interview: false }, prices: { tailor_pack: 49, interview_pack: 99, diy: 99 }, free: { matchesLeft: 3, coversLeft: 1, matchesPerDay: 3, coversPerDay: 1, questions: 3 }, ai: false };

/** Packs owned, payment mode, prices, free uses left. Never throws (everything locked on an error). */
export async function jobAccess() {
  if (!LIVE) return OFF;
  try { return await http(`${J}/access`); } catch { return OFF; }
}

export const matchJob = (body) => http(`${J}/match`, { method: 'POST', body, timeout: 90_000 });
export const listMatches = () => http(`${J}/matches`);
export const getMatch = (id) => http(`${J}/matches/${encodeURIComponent(id)}`);
export const patchMatch = (id, body) => http(`${J}/matches/${encodeURIComponent(id)}`, { method: 'PATCH', body });
export const rescoreMatch = (id, resumeId) => http(`${J}/matches/${encodeURIComponent(id)}/rescore`, { method: 'POST', body: { resumeId: resumeId || null } });
export const deleteMatch = (id) => http(`${J}/matches/${encodeURIComponent(id)}`, { method: 'DELETE' });
export const deleteJobData = () => http(J, { method: 'DELETE' });

export const startTailor = (id, useAi = true) => http(`${J}/matches/${encodeURIComponent(id)}/tailor`, { method: 'POST', body: { useAi }, timeout: 90_000 });
export const getTailor = (id) => http(`${J}/matches/${encodeURIComponent(id)}/tailor`);
export const decide = (id, sid, action) => http(`${J}/matches/${encodeURIComponent(id)}/suggestions/${encodeURIComponent(sid)}`, { method: 'POST', body: { action } });

export const writeCover = (id, body) => http(`${J}/matches/${encodeURIComponent(id)}/cover`, { method: 'POST', body, timeout: 90_000 });
export const deleteCover = (id, cid) => http(`${J}/matches/${encodeURIComponent(id)}/cover/${encodeURIComponent(cid)}`, { method: 'DELETE' });

/** A screenshot of a job post → its text (read on the server; the picture isn't kept). */
export async function readScreenshot(file) {
  const p = await preparePhoto(file);
  if (p.error) throw new ApiError(400, 'bad_image', p.error);
  const r = await http(`${J}/read-image`, { method: 'POST', body: { images: [{ data: p.data }] }, timeout: 120_000 });
  return r.text;
}

/** A PDF of a job post → its text, read in this browser. */
export async function readPdfText(file) {
  if (file.size > 10 * 1024 * 1024) throw new ApiError(400, 'too_large', 'This PDF is over 10 MB. Please paste the job post text instead.');
  const { loadPdfjs } = await import('./import/index');
  const { readPdf, toLines } = await import('./import/pdfRead');
  const pdfjs = await loadPdfjs();
  const { items, doc } = await readPdf(pdfjs, new Uint8Array(await file.arrayBuffer()));
  doc?.destroy?.();
  const text = toLines(items).map((l) => l.text ?? l.items?.map((i) => i.str).join(' ') ?? '').join('\n').trim();
  if (text.length < 40) throw new ApiError(400, 'empty_pdf', 'We couldn’t find text in this PDF (it may be a scan). Add it as a screenshot or paste the text.');
  return text;
}

export const PACKS = {
  tailor: { plan: 'tailor_pack', name: 'Tailor pack', what: 'Unlimited job matches, tailored resume copies, AI rewrites and cover letters.' },
  interview: { plan: 'interview_pack', name: 'Interview pack', what: 'All 10 interview questions with answers from your resume, and practice with feedback.' },
};

/**
 * Buy a pack following the payment mode: WhatsApp → a pending order and the chat (call straight from the click);
 * Razorpay → its checkout. Resolves { whatsapp } or the paid order. Off: never called (the page shows Coming soon).
 */
export async function buyPack(kind, mode) {
  const planId = PACKS[kind].plan;
  if (mode === 'whatsapp') { await buyOnWhatsApp({ planId }); return { whatsapp: true }; }
  const order = await createOrder({ planId });
  return pay(order);
}

export const VERDICT_TONE = { strong: 'success', good: 'warning', stretch: 'danger' };
export const STATUS_TEXT = { found: 'Found', weak: 'Weak', missing: 'Missing' };
