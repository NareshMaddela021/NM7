// ?code= in a link (Admin → Codes): kept for the pay step, never used by itself. Its own file so the app's first
// script carries only this, not the rest of lib/codes.js (round L: the Easy dashboard's 150 KB budget).
export const normCode = (s) => String(s ?? '').replace(/\s+/g, '').toUpperCase().slice(0, 40);
const KEY = 'nm7.code';

/** Reads ?code= from a URL search string and keeps it for the pay step. Returns the code ('' when none). */
export function rememberCode(search) {
  const c = normCode(new URLSearchParams(search || '').get('code'));
  if (!/^[A-Z0-9][A-Z0-9-]{2,31}$/.test(c)) return '';
  try { sessionStorage.setItem(KEY, c); } catch { /* private mode: the field just starts empty */ }
  return c;
}

/** The code from a link, for filling in the "Have a code?" field. */
export const savedCode = () => { try { return sessionStorage.getItem(KEY) || ''; } catch { return ''; } };
export const forgetCode = () => { try { sessionStorage.removeItem(KEY); } catch { /* nothing kept */ } };
