// The LinkedIn record on the person's own account (GET / PUT / DELETE /api/me/linkedin) and the AI headlines
// (POST /api/me/linkedin/headlines). AI that is off, busy, over the limit or unusable never shows an error: the
// rules-based headlines fill in, with a one-line notice.
import { ApiError, http, LIVE } from '../../services/http';
import { currentUser } from '../auth';
import { headlineOk, headlineOptions } from './headlines';

export const getLinkedIn = () => http('/api/me/linkedin');
export const saveLinkedIn = (body) => http('/api/me/linkedin', { method: 'PUT', body });
export const deleteLinkedIn = () => http('/api/me/linkedin', { method: 'DELETE' });

/** Saving and AI need the live API and a signed-in customer; the checks themselves work for anyone. */
export const canSave = () => LIVE && currentUser()?.role === 'customer';

export const FACT_KEYS = ['target', 'level', 'skills', 'degree', 'roles', 'companies', 'projects', 'certs', 'current', 'city'];
export function factsForAi(f) {
  const out = {};
  for (const k of FACT_KEYS) {
    const v = f?.[k];
    if (Array.isArray(v)) { const vals = v.filter((x) => typeof x === 'string' && x.trim()).slice(0, 12); if (vals.length) out[k] = vals; }
    else if (typeof v === 'string' && v.trim()) out[k] = v.trim().slice(0, 200);
  }
  if (f?.degree) out.degree = [f.degree, f.field, f.year].filter(Boolean).join(' ').slice(0, 200); // the year too: a headline may say it
  return out;
}

/** Why AI didn't answer, in one line; null when the person cancelled. */
export function fallbackNotice(err) {
  if (err?.code === 'cancelled' || err?.name === 'AbortError') return null;
  if (err?.status === 401 || err?.code === 'sign_in') return 'Sign in to write with AI. Here are quick suggestions.';
  if (err?.status === 429) return `${err.message || 'AI is used up for today.'}`;
  return 'AI is busy. Here are quick suggestions.';
}

/**
 * `count` headlines: AI's (each checked again here) topped up with rule-based ones. Never throws except when the
 * person cancels. → { headlines, ai (how many came from AI), notice }
 */
export async function writeHeadlines(facts, { note = '', count = 5, current = '', signal } = {}) {
  const rules = headlineOptions(facts, count + 2);
  const merge = (ai) => {
    const seen = new Set();
    const out = [];
    for (const h of [...ai, ...rules]) { const k = h.toLowerCase(); if (!seen.has(k) && out.length < count) { seen.add(k); out.push(h); } }
    return out;
  };
  if (!canSave()) return { headlines: merge([]), ai: 0, notice: '' };
  try {
    const body = { facts: factsForAi(facts), note: note.trim().slice(0, 1000), count, current: current.slice(0, 600) };
    const res = await http('/api/me/linkedin/headlines', { method: 'POST', body, signal, timeout: 90_000 });
    const src = `${JSON.stringify(body.facts)} ${body.note} ${body.current}`;
    const ai = (res?.headlines || []).filter((h) => typeof h === 'string' && headlineOk(h, src));
    return { headlines: merge(ai), ai: ai.length, notice: ai.length ? '' : 'AI is busy. Here are quick suggestions.' };
  } catch (e) {
    if (e?.code === 'cancelled' || e?.name === 'AbortError') throw e;
    return { headlines: merge([]), ai: 0, notice: fallbackNotice(e instanceof ApiError ? e : null) || '' };
  }
}
