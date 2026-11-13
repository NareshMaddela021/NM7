const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "2025-01" → "Jan 2025" */
export function fmtMonth(v) {
  if (!v) return '';
  const [y, m] = v.split('-');
  if (!m) return v;
  return `${MONTHS[parseInt(m, 10) - 1] || ''} ${y}`;
}

/** "Jan 2025 – Mar 2025"; one month when both are the same ("Oct 2026"); "… – Present" while current. */
export function fmtRange(from, to, current) {
  const a = fmtMonth(from);
  const b = current ? 'Present' : fmtMonth(to);
  return [a, b === a ? '' : b].filter(Boolean).join(' – ');
}

/** Split a textarea into bullet lines. */
export function toBullets(text) {
  return (text || '')
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => (s.startsWith('•') ? s : `• ${s}`));
}

export const isUpi = (v) => /^[\w.-]{2,}@[a-zA-Z]{2,}$/.test((v || '').trim());

/** "2026-11-23" → "23 Nov 2026" (dates people read: offers, joining days). Anything else comes back unchanged. */
export function fmtDay(v) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v || '')) return v || '';
  return new Date(`${v}T00:00:00`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
}

/** "1 answer", "2 answers". */
export const countOf = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
