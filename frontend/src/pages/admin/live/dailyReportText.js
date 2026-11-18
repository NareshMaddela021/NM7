// Admin → Daily report: the small formatting helpers (numbers, change vs yesterday, sparkline points and the
// sparkline's words for screen readers). No React here, so the rules are tested on their own.

export const num = (v) => (v == null ? '—' : Number(v).toLocaleString('en-IN'));
export const inr = (paise) => (paise == null ? '—' : `₹${Math.round(paise / 100).toLocaleString('en-IN')}`);
export const pct = (v) => (v == null ? '—' : `${v}%`);
export const msText = (v) => (v == null ? '—' : `${num(v)} ms`);

/** Change vs yesterday: { dir: up | down | same | none, text, tone: good | bad | neutral }. */
export function change(value, prev, { lowerIsBetter = false, fmt = num } = {}) {
  if (value == null || prev == null) return { dir: 'none', text: 'No yesterday to compare', tone: 'neutral' };
  const d = value - prev;
  if (d === 0) return { dir: 'same', text: 'Same as yesterday', tone: 'neutral' };
  const up = d > 0;
  const good = lowerIsBetter ? !up : up;
  return { dir: up ? 'up' : 'down', text: `${up ? '▲' : '▼'} ${fmt(Math.abs(d))} vs yesterday`, tone: good ? 'good' : 'bad' };
}

/** The sparkline's polyline points ("x,y x,y …") in a w×h box; days without a number leave a gap (separate runs). */
export function sparkPoints(series, w = 120, h = 32, pad = 2) {
  const vals = (series || []).map((v) => (typeof v === 'number' && Number.isFinite(v) ? v : null));
  const known = vals.filter((v) => v != null);
  if (!known.length) return [];
  const lo = Math.min(...known);
  const hi = Math.max(...known);
  const n = vals.length;
  const x = (i) => (n === 1 ? w / 2 : pad + (i * (w - 2 * pad)) / (n - 1));
  const y = (v) => (hi === lo ? h / 2 : h - pad - ((v - lo) * (h - 2 * pad)) / (hi - lo));
  const runs = [];
  let cur = [];
  vals.forEach((v, i) => {
    if (v == null) {
      if (cur.length) runs.push(cur);
      cur = [];
    } else cur.push(`${x(i).toFixed(1)},${y(v).toFixed(1)}`);
  });
  if (cur.length) runs.push(cur);
  return runs.map((r) => r.join(' '));
}

/** The trend in words, for the sparkline's aria-label. */
export function trendWords(series, fmt = num) {
  const known = (series || []).filter((v) => typeof v === 'number' && Number.isFinite(v));
  if (!known.length) return 'Last 30 days: no data yet';
  if (known.length === 1) return `Last 30 days: one day of data, ${fmt(known[0])}`;
  const first = known[0];
  const last = known[known.length - 1];
  const hi = Math.max(...known);
  const days = `${known.length} days of data`;
  if (first === last) return `Last 30 days: flat at ${fmt(last)} (${days}, highest ${fmt(hi)})`;
  return `Last 30 days: ${last > first ? 'rising' : 'falling'} from ${fmt(first)} to ${fmt(last)} (${days}, highest ${fmt(hi)})`;
}

/** "a3f9c1e" from a full commit hash; "unknown" stays. */
export const shortCommit = (c) => (c && c !== 'unknown' ? String(c).slice(0, 7) : 'unknown');

/** Reasons {reason: n} → [[label, n]] biggest first, with friendly words for the known ones. */
const REASON_WORDS = {
  no_page_text: 'No page text to summarise', summary_failed: 'Summary failed a check', summary_unavailable: 'AI summaries off', ai_error: 'AI error (sent back to the collector)',
  ai_daily_limit: 'AI allowance used up', city_not_stated: 'City not stated', experience_not_stated: 'Experience not stated',
  job_board_or_form: 'Job board or form link', staffing_agency: 'Staffing agency', not_india: 'Not in India', outside_india: 'Outside India',
  invalid: 'Missing or invalid details', duplicate: 'Duplicate',
};
export const reasonList = (obj) => Object.entries(obj || {}).sort((a, b) => b[1] - a[1]).map(([k, n]) => [REASON_WORDS[k] || k.replaceAll('_', ' '), n]);

const BAND_WORDS = { internship: 'Internship', fresher: 'Fresher', '0_1': '0–1 years', '1_3': '1–3 years', '3_5': '3–5 years', '5_8': '5–8 years', '8_12': '8–12 years', '12_15': '12–15 years', '15_plus': '15+ years', not_stated: 'Not stated', '3_plus': '3+ years' };
export const bandWord = (b) => BAND_WORDS[b] || b;
