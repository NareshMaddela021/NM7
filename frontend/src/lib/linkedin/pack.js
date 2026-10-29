// The LinkedIn pack (Rs 149) in the browser: who owns it, buying it (only when payments are on), and its contents
// from the server (which writes them for owners only). The banner image is drawn here from the pack's text.
import { http, LIVE } from '../../services/http';
import { createOrder, pay } from '../../services/api';
import { buyOnWhatsApp } from '../waPay';
import { canvasToPng } from '../qr';
import { saveBlob } from '../fileDownload';
import { fileName, fileSlug } from '../fileName';

export const PACK_ITEMS = [
  '5 headline options',
  'About in 3 styles: simple, professional, story',
  'Each job or internship rewritten (projects for freshers)',
  'Education text',
  'Skills ranked for your target role (best 5 first, up to 50)',
  'Featured plan: what to pin',
  'Banner image 1584 × 396 in your resume colours',
  '3 custom profile URL ideas',
  'Copy buttons and a where-to-paste guide (English, తెలుగు, हिन्दी)',
];
export const COMING_SOON = 'Coming soon';
export const SECTION_TITLE = { headline: 'Headline', about: 'About', experience: 'Experience', education: 'Education', skills: 'Skills', featured: 'Featured', banner: 'Banner', urls: 'Custom URL' };
export const REGEN_SECTIONS = ['headline', 'about', 'experience', 'education'];
export const LIMITS = { headline: 220, about: 2600, experience: 2000 };

const OFF = { owned: false, source: '', orderId: null, purchasedAt: null, paymentsOn: false, onSale: false, price: 149, mode: 'off' };
/** { owned, source, orderId, purchasedAt, paymentsOn, onSale, price, mode (off | whatsapp | razorpay) }. Never throws (shows "Coming soon" on error). */
export async function packStatus() {
  if (!LIVE) return OFF;
  try { return await http('/api/me/linkedin/pack/status'); } catch { return OFF; }
}

/**
 * Pay for the pack: the server prices the order (503 while payments are off), Razorpay's window, server check.
 * WhatsApp mode: a pending order and the chat instead; resolves { whatsapp: true } (nothing unlocks until Nm7 confirms).
 */
export async function buyPack(mode, code) {
  if (mode === 'whatsapp') { const r = await buyOnWhatsApp({ planId: 'linkedin_pack', ...(code ? { code } : {}) }); return r?.unlocked ? r : { whatsapp: true }; }
  const order = await createOrder({ planId: 'linkedin_pack', code });
  return pay(order);
}

export const getPack = () => http('/api/me/linkedin/pack');
export const generatePack = (body) => http('/api/me/linkedin/pack/generate', { method: 'POST', body, timeout: 120_000 });
export const regenerateSection = (section, confirm = false) => http('/api/me/linkedin/pack/regenerate', { method: 'POST', body: { section, confirm }, timeout: 120_000 });
export const editSection = (section, value) => http('/api/me/linkedin/pack/edit', { method: 'PUT', body: { section, value } });

/* ---------- banner ---------- */

export const BANNER_W = 1584;
export const BANNER_H = 396;

/** '#2E46D8' → a light tint of it for the banner background. */
export function tint(hex, amount = 0.88) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex || '');
  const [r, g, b] = m ? [0, 2, 4].map((i) => parseInt(m[1].slice(i, i + 2), 16)) : [17, 24, 39];
  const mix = (c) => Math.round(c + (255 - c) * amount);
  return `rgb(${mix(r)}, ${mix(g)}, ${mix(b)})`;
}

/** Shrinks the font until the text fits the width. */
function fitText(ctx, text, maxW, size, weight, family) {
  let s = size;
  ctx.font = `${weight} ${s}px ${family}`;
  while (s > 18 && ctx.measureText(text).width > maxW) { s -= 2; ctx.font = `${weight} ${s}px ${family}`; }
  return s;
}

/**
 * Draws the banner: name, role and up to 3 skills on the right two-thirds (LinkedIn's profile photo covers the
 * bottom-left), in the resume's accent colour. LinkedIn's size: 1584 × 396.
 */
export function drawBanner(canvas, { name = '', role = '', line = '' }, accent = '#111827') {
  canvas.width = BANNER_W; canvas.height = BANNER_H;
  const ctx = canvas.getContext('2d');
  const family = 'Inter, "Segoe UI", Roboto, Arial, sans-serif';
  ctx.fillStyle = tint(accent);
  ctx.fillRect(0, 0, BANNER_W, BANNER_H);
  ctx.fillStyle = accent;
  ctx.fillRect(0, BANNER_H - 18, BANNER_W, 18);
  ctx.globalAlpha = 0.12;
  ctx.beginPath(); ctx.arc(BANNER_W - 120, 70, 210, 0, Math.PI * 2); ctx.fill();
  ctx.globalAlpha = 1;
  const x = 560; const maxW = BANNER_W - x - 80;
  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = '#111111';
  if (name) { fitText(ctx, name, maxW, 72, 800, family); ctx.fillText(name, x, 160); }
  ctx.fillStyle = accent;
  if (role) { fitText(ctx, role, maxW, 46, 700, family); ctx.fillText(role, x, name ? 230 : 190); }
  ctx.fillStyle = '#333333';
  if (line) { fitText(ctx, line, maxW, 34, 500, family); ctx.fillText(line, x, name ? 290 : 250); }
  return canvas;
}

export const bannerFileName = (name) => fileName([fileSlug(name || '') || 'My', 'LinkedIn', 'Banner'], 'png');

/** Draws and saves the banner as a PNG (toBlob, never a fetch of a data: URL; the same as the QR download). */
export async function downloadBanner(banner, accent) {
  const canvas = drawBanner(document.createElement('canvas'), banner, accent);
  const blob = await canvasToPng(canvas);
  saveBlob(blob, bannerFileName(banner.name));
  return blob;
}

/** The person's own words for the generator: Path 1 sections, or Path 2 details (+ the picked resume's sections). */
export function packRequest({ path, role, profile = {}, details = {}, note = '' }) {
  return { path, targetRole: (role || '').slice(0, 100), profile, details, note: (note || '').slice(0, 1000) };
}
