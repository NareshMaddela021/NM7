// Who may download a resume or cover letter (PDF / Word), and the one function that makes those files.
//
// The files are built in the browser, so `exportFile` asks the server first (POST /api/me/exports) and only then
// builds and saves the file. Every download button goes through it — the builder, the dashboard (/me, My resumes,
// Cover letters) and the share page — so there is no other path to a file.
//   guests            → 401 → "Create a free account to download your resume"
//   payments are off  → every signed-in account downloads free (no paywall shown)
//   payments are on   → 402 until the account has paid for any plan → "Unlock downloads - Rs 99 one-time"
//   admins            → always (for checking files)
// Preview builds (no server) have no payments: guests need an account, everyone signed in downloads.
import { http, LIVE } from '../services/http';
import { currentUser } from './auth';
import { PLANS } from './pricing';
import { freshImport } from './chunks';

export class DownloadBlocked extends Error {
  constructor(reason, price, message) {
    super(message || 'Downloads are locked.');
    this.code = 'download_blocked';
    this.reason = reason; // guest / unpaid / owner (a shared resume whose owner hasn't unlocked downloads)
    this.price = price;
  }
}

/** { canDownload, reason: guest|unpaid|paid|plan|admin|payments_off, paymentsOn, planId, price (rupees) } */
export async function getEntitlement() {
  if (LIVE) return http('/api/me/entitlements');
  const u = currentUser();
  const base = { paymentsOn: false, planId: 'diy', price: PLANS.diy.price };
  if (!u) return { ...base, canDownload: false, reason: 'guest' };
  return { ...base, canDownload: true, reason: u.role === 'admin' ? 'admin' : 'payments_off' };
}

/* ---------- the modal (rendered by <DownloadGateHost/>) ---------- */
let gate = null;
const subs = new Set();
const emit = () => subs.forEach((f) => f(gate));
export const onGate = (f) => { subs.add(f); f(gate); return () => subs.delete(f); };
export const closeGate = () => { gate = null; emit(); };
function openGate(g) { gate = g; emit(); }

/* ---------- a guest's download, finished after they sign up or sign in ---------- */
const PENDING = 'nm7-pending-download';
const PENDING_MAX_AGE = 60 * 60 * 1000;
export function rememberDownload(format, what) {
  try { sessionStorage.setItem(PENDING, JSON.stringify({ format, what, at: Date.now() })); } catch { /* ignore */ }
}
// It belongs to the sign-in / sign-up it started: it is kept while the person is on those pages and is finished only
// when the builder opens straight from them (or is reloaded). Any other page forgets it, so a later visit to the
// builder (e.g. from a template card) never starts a download nobody just asked for.
const SIGN_IN_PAGES = ['/login', '/signup', '/forgot-password'];
let shownPage = null; // the last page noted (null until the first one: a fresh load or a reload)
export function forgetPendingDownload() {
  try { sessionStorage.removeItem(PENDING); } catch { /* ignore */ }
}
/** Called on every page change (App). */
export function notePage(path) {
  if (!SIGN_IN_PAGES.includes(path) && path !== '/builder') forgetPendingDownload();
  shownPage = path;
}
/** Read when the builder first renders: may it finish a pending download? (opened from sign-in / sign-up, or reloaded) */
export const mayFinishDownload = () => shownPage === null || shownPage === '/builder' || SIGN_IN_PAGES.includes(shownPage);
/** The download a guest clicked before creating an account (or null). `take` also forgets it. */
export function pendingDownload(take = false) {
  try {
    const p = JSON.parse(sessionStorage.getItem(PENDING) || 'null');
    if (take) sessionStorage.removeItem(PENDING);
    return p && Date.now() - p.at < PENDING_MAX_AGE && ['pdf', 'docx'].includes(p.format) ? p : null;
  } catch { return null; }
}

/** The server's go-ahead. Throws DownloadBlocked when the file may not be made. */
async function allowed(format, what, share) {
  if (!LIVE) {
    if (share) return; // preview: no payments, so a shared resume can always be downloaded
    const e = await getEntitlement();
    if (!e.canDownload) throw new DownloadBlocked(e.reason, e.price);
    return;
  }
  try {
    if (share) await http(`/api/public/resumes/${encodeURIComponent(share)}/export`, { method: 'POST', body: {} });
    else await http('/api/me/exports', { method: 'POST', body: { format, what } });
  } catch (e) {
    if (share && e.status === 402) throw new DownloadBlocked('owner', null, e.message);
    if (e.status === 401) throw new DownloadBlocked('guest');
    if (e.status === 402) throw new DownloadBlocked('unpaid', (await getEntitlement().catch(() => null))?.price ?? PLANS.diy.price);
    throw e;
  }
}

/**
 * Builds and saves a resume or cover letter — only after the server allows it. When it doesn't, the matching
 * modal opens (create an account / unlock downloads) and DownloadBlocked is thrown; after the account or payment
 * the same download runs again.
 *   { data, design, format: 'pdf'|'docx', cover?, photo?, photoPng?, share? (a share-link slug) }
 */
export async function exportFile(opts) {
  const { data, design, format = 'pdf', cover, photo, photoPng, share } = opts;
  const what = cover ? 'cover' : 'resume';
  try {
    await allowed(format, what, share);
  } catch (e) {
    if (e instanceof DownloadBlocked && e.reason !== 'owner') openGate({ reason: e.reason, price: e.price, format, what, retry: () => exportFile(opts) });
    throw e;
  }
  // loaded on first use: the PDF / Word makers are large
  const [{ buildResumePdf, savePdf }, { buildDocx }] = await freshImport(() => Promise.all([import('../pages/builder/resumePdf'), import('../pages/builder/resumeDocx')]));
  const blob = format === 'docx' ? await buildDocx({ data, design, cover, photoPng }) : await buildResumePdf({ data, design, photo, cover });
  const name = `${(data.personal?.name || 'Resume').trim().replace(/\s+/g, '_')}_${cover ? 'Cover_Letter' : 'Resume'}.${format}`;
  await savePdf(blob, name);
  return name;
}
