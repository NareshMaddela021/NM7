// Phase 6 S5: compare 2–3 offers. Pure helpers (tested): the in-hand amount is shown ONLY when the person typed their
// deductions (PF, tax, insurance…); we never guess deductions.

/** "3.5" (LPA) or "300000" (₹ a year) → rupees a year; '' or bad → null. */
export function yearly(v, unit) {
  const n = Number(String(v ?? '').replace(/[,\s₹]/g, ''));
  if (!Number.isFinite(n) || n <= 0) return null;
  return unit === 'lpa' ? Math.round(n * 100000) : unit === 'month' ? Math.round(n * 12) : Math.round(n);
}

/** In hand a month = (CTC a year − deductions a year) ÷ 12, only with deductions typed in (₹ a month). */
export function inHandMonthly(ctcYear, deductionsMonth) {
  if (ctcYear == null || deductionsMonth === '' || deductionsMonth == null) return null;
  const d = Number(String(deductionsMonth).replace(/[,\s₹]/g, ''));
  if (!Number.isFinite(d) || d < 0) return null;
  return Math.max(0, Math.round(ctcYear / 12 - d));
}

/** The index of the highest number in a row (null when fewer than two can be compared). */
export function best(values) {
  const ok = values.map((v, i) => [v, i]).filter(([v]) => v != null);
  if (ok.length < 2) return null;
  return ok.reduce((a, b) => (b[0] > a[0] ? b : a))[1];
}
