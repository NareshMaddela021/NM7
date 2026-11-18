// Vetting Trust T9, the page's pure helpers (tested in honestyLib.test.js): the retake limits in plain words from the
// server's `retake` block ({ attempts, days, used, left, canStart, nextAt, freeRetest, running, counts, refreshDays }),
// and the pledge text in the right language.

const DAY = 86_400_000;

/** "18 Dec 2026" */
export function dayText(ms) {
  if (!ms) return '';
  return new Date(ms).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
}

/** "in 3 days", "in 5 hours", "in 12 minutes", "now". */
export function inText(ms, now = Date.now()) {
  const left = ms - now;
  if (left <= 0) return 'now';
  if (left >= DAY) { const d = Math.ceil(left / DAY); return `in ${d} day${d === 1 ? '' : 's'}`; }
  if (left >= 3_600_000) { const h = Math.ceil(left / 3_600_000); return `in ${h} hour${h === 1 ? '' : 's'}`; }
  const m = Math.max(1, Math.ceil(left / 60_000));
  return `in ${m} minute${m === 1 ? '' : 's'}`;
}

/** The lines shown before starting and on a result: { rule, used, next, counts, refresh }. */
export function retakeLines(rk, what = 'test', now = Date.now()) {
  if (!rk) return null;
  const tries = `${rk.attempts} attempt${rk.attempts === 1 ? '' : 's'}`;
  const next = rk.running ? `You have ${what === 'interview' ? 'an interview' : `a ${what}`} in progress: carry on with it.`
    : rk.freeRetest ? 'Your free retest is open now.'
      : rk.canStart ? `You can start now${rk.left > 0 ? ` (${rk.left} left in this period)` : ''}.`
        : `Next attempt opens on ${dayText(rk.nextAt)} (${inText(rk.nextAt, now)}).`;
  return {
    rule: `Allowed: ${tries} every ${rk.days} days for this role.`,
    used: `Used: ${Math.min(rk.used, rk.attempts)} of ${rk.attempts} in the last ${rk.days} days.`,
    next,
    counts: rk.counts || '',
    refresh: rk.refreshDays ? `Badge refresher: once every ${rk.refreshDays} day${rk.refreshDays === 1 ? '' : 's'} if it doesn’t renew the badge.` : '',
  };
}

/** The pledge in `lang`, else English. */
export function pledgeText(p, lang) {
  if (!p) return { title: '', text: '', tick: '' };
  const pick = (o) => (o && (o[lang] || o.en)) || '';
  return { title: pick(p.title), text: pick(p.text), tick: pick(p.tick) };
}
