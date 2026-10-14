const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "2025-01" → "Jan 2025" */
export function fmtMonth(v) {
  if (!v) return '';
  const [y, m] = v.split('-');
  if (!m) return v;
  return `${MONTHS[parseInt(m, 10) - 1] || ''} ${y}`;
}

export function fmtRange(from, to, current) {
  return [fmtMonth(from), current ? 'Present' : fmtMonth(to)].filter(Boolean).join(' – ');
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
