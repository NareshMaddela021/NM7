// Company accounts (Phase 2): the API under /api/company (signed in with the same emailed-code account recruiters
// use: header X-Recruiter-Account), the browser-side checks that give instant feedback (the server checks again), and
// the sign-up draft kept in this browser until the admin's email is confirmed.
import { readAccount } from './recruiterPortal';
import { API_BASE, ApiError } from '../services/http';

export const CATEGORIES = ['startup', 'sme', 'enterprise', 'ngo', 'government', 'individual'];
export const STRUCTURES = ['private_limited', 'public_limited', 'llp', 'partnership', 'proprietorship', 'opc', 'trust_society', 'government_body', 'other'];
export const SIZES = ['1_10', '11_50', '51_200', '201_1000', '1000_plus'];
export const TEAM_ROLES = ['full', 'posting', 'view'];
export const GST_PORTAL = 'https://services.gst.gov.in/services/searchtp';

/** A JSON call with the account session. Field errors (422) come back joined into one readable message. */
export async function rq(path, { method = 'GET', body } = {}) {
  let res;
  try {
    res = await fetch(API_BASE + path, {
      method,
      headers: { ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...(readAccount() ? { 'X-Recruiter-Account': readAccount() } : {}) },
      body: body !== undefined ? JSON.stringify(body) : undefined,
      cache: 'no-store',
    });
  } catch {
    throw new ApiError(0, 'network', 'We can’t reach the server. Check your internet and try again.');
  }
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    const e = data?.error || {};
    const fields = (e.fields || []).map((f) => String(f.message || '').replace(/^Value error, /, '').replace(/^[a-z][\w.]*: /, '')).filter(Boolean);
    throw new ApiError(res.status, e.code || 'error', fields.length ? fields.join(' ') : e.message || 'Something went wrong. Please try again.', e.fields);
  }
  return data;
}

/* ---------- registration numbers (the same rules as backend/app/companies/checks.py) ---------- */

const GST_CHARS = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';
export const cleanNumber = (v) => String(v || '').replace(/\s+/g, '').toUpperCase();

export function gstinCheckChar(first14) {
  let total = 0;
  for (let i = 0; i < 14; i += 1) {
    const p = GST_CHARS.indexOf(first14[i]) * (i % 2 ? 2 : 1);
    total += Math.floor(p / 36) + (p % 36);
  }
  return GST_CHARS[(36 - (total % 36)) % 36];
}

/** '' when the number looks right, else a translation key for the problem. */
export function registrationProblem(kind, number) {
  const n = cleanNumber(number);
  if (!n) return 'co.reg.err.empty';
  if (kind === 'gstin') {
    const m = /^(\d{2})([A-Z]{5}\d{4}[A-Z])([1-9A-Z])Z([0-9A-Z])$/.exec(n);
    if (!m) return 'co.reg.err.gstinFormat';
    const st = Number(m[1]);
    if (!((st >= 1 && st <= 38) || st === 97 || st === 99)) return 'co.reg.err.gstinState';
    return gstinCheckChar(n.slice(0, 14)) === n[14] ? '' : 'co.reg.err.gstinCheck';
  }
  if (kind === 'cin') return /^[LU]\d{5}[A-Z]{2}\d{4}(PLC|PTC|FTC|GOI|SGC|NPL|GAP|GAT|ULL|ULT|OPC|FLC)\d{6}$/.test(n) ? '' : 'co.reg.err.cin';
  if (kind === 'llpin') return /^[A-Z]{3}-\d{4}$/.test(n) ? '' : 'co.reg.err.llpin';
  return 'co.reg.err.kind';
}

/* ---------- the sign-up draft (this browser only) ---------- */

const DRAFT_KEY = 'nm7-company-signup';
export const BLANK = {
  step: 0,
  company: { details: { legalName: '', website: '', category: 'startup', structure: 'private_limited', industry: '', size: '1_10', about: '' }, registration: { kind: 'gstin', number: '' }, individual: { linkedin: '', declared: false }, phone: '' },
  admin: { name: '', email: '' },
  companyId: '',
};
export function readDraft() {
  try { const d = JSON.parse(localStorage.getItem(DRAFT_KEY) || 'null'); return d ? { ...BLANK, ...d, company: { ...BLANK.company, ...d.company } } : structuredClone(BLANK); } catch { return structuredClone(BLANK); }
}
export function keepDraft(d) { try { if (d) localStorage.setItem(DRAFT_KEY, JSON.stringify(d)); else localStorage.removeItem(DRAFT_KEY); } catch { /* private window */ } }

/** The body the API takes for steps 1–2 (registration for a company, LinkedIn + declaration for an individual). */
export function companyBody(c) {
  const individual = c.details.category === 'individual';
  return {
    details: { ...c.details, website: individual ? '' : c.details.website },
    registration: individual ? null : { kind: c.registration.kind, number: cleanNumber(c.registration.number) },
    individual: individual ? c.individual : null,
    phone: c.phone,
  };
}
