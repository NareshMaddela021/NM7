// The AI usage card's detail line under a day's counts for one feature:
// {fallback: 3, unusable: {too_long: 2, empty: 1}, dropped: 4} → "fallback 3 (too_long 2, empty 1) · dropped 4"
// (empty string when there is nothing to say).
export function aiDetail(f) {
  if (!f) return '';
  const reasons = Object.entries(f.unusable || {}).filter(([, n]) => n > 0).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  const parts = [];
  if (f.fallback > 0 || reasons.length) {
    parts.push(`fallback ${f.fallback || 0}${reasons.length ? ` (${reasons.map(([r, n]) => `${r} ${n}`).join(', ')})` : ''}`);
  }
  if (f.dropped > 0) parts.push(`dropped ${f.dropped}`);
  return parts.join(' · ');
}
