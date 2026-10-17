// Layer B of the summary writer: "Write with AI" (POST /api/me/summary/generate, signed in; kiosk sign-ins too).
// The browser sends only the facts the templates use — never the name, phone, email, address, date of birth or an
// ID number — plus the note, which the server wraps as data. Every option is checked on the server and again here;
// a slot AI left empty is filled by Layer A. Any failure ends in Layer A's cards with a one-line notice: there is
// never an error screen.
import { ApiError, http, LIVE } from '../../services/http';
import { currentUser } from '../auth';
import { gatherFacts } from './facts';
import { trimTo } from './grammar';
import { MAX_CHARS, STYLE_LABEL, STYLES, numbersCovered, problems, writeOne } from './write';

// the same list as backend/app/summary/writer.py FACT_KEYS; anything else never leaves the browser
export const FACT_KEYS = ['degreeFull', 'eduYear', 'years', 'role', 'company', 'target', 'skills', 'strengths', 'cert', 'achievement', 'languages', 'persona'];
export const MODES = ['generate', 'shorter', 'professional', 'simpler', 'retry'];
export const NOTE_MAX = 1000;
export const WRITING_TEXT = 'Writing… (about 5 seconds)';
export const BUSY_TEXT = 'AI is busy, here are quick suggestions';
export const FIX_LABEL = { shorter: 'Shorter', professional: 'More professional', simpler: 'Simpler words', retry: 'Try again' };

/** "Write with AI" needs the live API and a signed-in person (a kiosk sign-in counts). */
export const aiAvailable = () => LIVE && currentUser()?.role === 'customer';

/** The merged facts → only the keys the writer knows, as strings or lists of strings, empties dropped. */
export function factsForAi(facts) {
  const out = {};
  for (const k of FACT_KEYS) {
    const v = facts?.[k];
    if (Array.isArray(v)) {
      const vals = v.filter((x) => typeof x === 'string' && x.trim()).map((x) => x.trim().slice(0, 80)).slice(0, 8);
      if (vals.length) out[k] = vals;
    } else if (typeof v === 'string' && v.trim()) out[k] = v.trim().slice(0, 200);
  }
  return out;
}

/** The request body: facts from the resume and the note, the note, the mode, and the current text for a quick fix. */
export function aiRequest(resume, note = '', mode = 'generate', current = '', hints) {
  return {
    facts: factsForAi(gatherFacts(resume, note, hints)),
    note: note.trim().slice(0, NOTE_MAX),
    mode: MODES.includes(mode) ? mode : 'generate',
    current: (current || '').trim().slice(0, 1200),
  };
}

/** The server's options → cards that pass the browser's own quality gate too. */
export function acceptOptions(res, body) {
  const seen = new Set();
  const options = [];
  for (const o of res?.options || []) {
    const style = String(o?.style || '');
    const text = trimTo(String(o?.text || '').trim(), MAX_CHARS);
    if (!STYLES.includes(style) || seen.has(style) || !text) continue;
    if (problems(text).length || !numbersCovered(text, body.facts, body.note)) continue;
    seen.add(style);
    options.push({ style, label: STYLE_LABEL[style], text, ai: true });
  }
  return options;
}

/**
 * Asks the server. Resolves { options (AI cards that passed every check), dropped, fallback, model }; rejects with
 * ApiError (code cancelled when `signal` aborted; sign_in when nobody is signed in; feature_off / ai_busy /
 * rate_limited / unusable / writer_unavailable / network from the server).
 */
export async function writeWithAi(resume, note, mode = 'generate', current = '', { signal, hints } = {}) {
  if (!aiAvailable()) throw new ApiError(401, 'sign_in', 'Sign in to write with AI.');
  const body = aiRequest(resume, note, mode, current, hints);
  const res = await http('/api/me/summary/generate', { method: 'POST', body, signal });
  const options = acceptOptions(res, body);
  return { options, dropped: (res.options?.length || 0) - options.length + (res.dropped || 0), fallback: !!res.fallback, model: res.model || '' };
}

/** The three cards: AI's option per style, Layer A's for a style AI left empty or that was dropped. */
export function fillSlots(aiOptions, resume, note, { seed = 0, hints } = {}) {
  const facts = gatherFacts(resume, note, hints);
  return STYLES.map((style) => aiOptions.find((o) => o.style === style) || { style, label: STYLE_LABEL[style], text: writeOne(facts, style, seed), ai: false });
}

/** The one line shown when AI couldn't answer; null when the person cancelled. */
export function fallbackNotice(err) {
  if (err?.code === 'cancelled' || err?.name === 'AbortError') return null;
  if (err?.status === 401 || err?.code === 'sign_in') return 'Sign in to write with AI — here are quick suggestions';
  if (err?.status === 429) return `${err.message || 'AI is used up for today'} — here are quick suggestions`.replace(/\.\s*—/, ' —');
  return BUSY_TEXT;
}
