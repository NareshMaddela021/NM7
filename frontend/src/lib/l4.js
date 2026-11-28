// Vetting V4, the Nm7 human check (L4): status words and small helpers shared by the company control, the candidate's
// /me/verification, the reviewer workspace and the Admin "L4 checks" tab. Only those pages import this.
import { isPhone, phoneDigits } from './phone';

/** status -> [words, chip tone] */
export const L4_STATUS = {
  requested: ['Requested', 'info'],
  booked: ['Call booked', 'accent'],
  checked: ['Checked · waiting for a reference', 'accent'],
  verified: ['Nm7 verified', 'ok'],
  failed: ['Not passed', 'bad'],
};
export const l4Status = (s) => L4_STATUS[s] || [s || '—', 'neutral'];

/** The steps a check goes through, for a small progress row. */
export const L4_STEPS = [['requested', 'Requested'], ['booked', 'Call booked'], ['checked', 'Checked'], ['verified', 'Verified']];
export const stepIndex = (s) => Math.max(0, L4_STEPS.findIndex(([k]) => k === s));

export const RELATIONS = ['past manager', 'HR contact', 'college teacher', 'senior colleague'];

export const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
export const HOURS = Array.from({ length: 13 }, (_, i) => 8 + i); // 8 … 20 (India time)
export const hourText = (h) => `${((h + 11) % 12) + 1} ${h < 12 ? 'am' : 'pm'}`;

/** "Tue 18 Nov" and "10:00 am" in the person's own time zone. */
export const dayText = (ms) => new Date(ms).toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' });
export const timeText = (ms) => new Date(ms).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' });
export const whenText = (ms) => (ms ? `${dayText(ms)}, ${timeText(ms)}` : '—');

/** Slots [{at}] grouped by local day: [[dayLabel, [slot…]]]. */
export function byDay(slots) {
  const out = new Map();
  for (const s of slots || []) {
    const k = dayText(s.at);
    if (!out.has(k)) out.set(k, []);
    out.get(k).push(s);
  }
  return [...out.entries()];
}

/** A referee row from the form: problems as a list of words (empty = fine). */
export function refereeProblems(r) {
  const out = [];
  if ((r.name || '').trim().length < 2) out.push('their name');
  if (!RELATIONS.includes(r.relation)) out.push('how you know them');
  const email = (r.email || '').trim();
  const phone = phoneDigits(r.phone);
  if (!email && !phone) out.push('an email or a phone number');
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) out.push('a valid email');
  if (phone && !isPhone(r.phone)) out.push('a 10-digit phone number');
  return out;
}

/** Up to 3 non-empty lines (the reviewer's note). */
export const noteLines = (s) => String(s || '').split('\n').filter((x) => x.trim()).length;

/** Admin settings come back in snake_case; read either spelling. */
export const settingsOf = (s = {}) => ({
  priceInr: Number(s.priceInr ?? s.price_inr ?? 0),
  payoutInr: Number(s.payoutInr ?? s.payout_inr ?? 0),
  paymentsOn: !!(s.paymentsOn ?? s.payments_on),
});
