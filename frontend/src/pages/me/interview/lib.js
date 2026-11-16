// Vetting V3 (the AI screening interview), the page's own helpers: the API paths, what the timer says out loud, the
// grade of a rubric line in words and the change in the page-leave totals since the last answer was sent.
export const API = '/api/me/interviews';
/** The role list (plain GET /api/me/interviews belongs to the org interview list, so the server serves it here). */
export const ROLES_API = `${API}/roles`;

/** When the answer timer speaks (aria-live), not every second: seconds left → message, or ''. */
export function answerAnnounce(left) {
  return [60, 30, 10].includes(left) ? `${left} seconds left for this answer` : '';
}

/** A rubric score 0–5 in words, and the bar tone. */
export function scoreWord(s) {
  if (s >= 4) return ['Strong', 'ok'];
  if (s >= 3) return ['Good', 'accent'];
  if (s >= 2) return ['Fair', 'warn'];
  return ['Needs work', 'warn'];
}

/** What changed in the page-leave totals since the last send: { blurs, blurMs } (never negative). */
export function signalDelta(now, sent) {
  return { blurs: Math.max(0, (now.blurs || 0) - (sent.blurs || 0)), blurMs: Math.max(0, Math.round((now.blurMs || 0) - (sent.blurMs || 0))) };
}

/** "4.2" for an average; "—" when there is none. */
export const avg = (n) => (n == null ? '—' : Number(n).toFixed(1));

/** 150 → "2½ minutes", 100 → "1 minute 40 seconds". */
export function timeWords(s) {
  const m = Math.floor(s / 60); const r = s % 60;
  if (r === 30) return `${m ? `${m}½` : '½'} minute${m >= 1 ? 's' : ''}`;
  const mm = m ? `${m} minute${m === 1 ? '' : 's'}` : '';
  return [mm, r ? `${r} seconds` : ''].filter(Boolean).join(' ');
}
