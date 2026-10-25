// Nm7 for Organizations, Phase 4: plan, usage and billing helpers shared by /for-orgs, the organization portal
// (banners, Billing, Team) and the admin console. Money is in paise everywhere; the server computes every amount
// (price − discount + GST) — these helpers only format what it sends.

export const LIMITS = [
  ['members', 'Members', 'members'],
  ['groups', 'Groups', 'groups'],
  ['coordinators', 'Coordinators', 'coordinators'],
  ['kiosks', 'Kiosk stalls', 'kiosk stalls'],
];

export const PLAN_FEATURES = [
  ['kiosk', 'Event kiosks'],
  ['branding', 'Your logo on prints and exports'],
  ['recruiterLinks', 'Recruiter links'],
  ['membersDownloadFree', 'Members download their resume free'],
  ['placementInsights', 'Placement dashboard: charts, who’s missing, reminders, roll list'],
];

/** ₹4,999 · ₹4,499.10 (paise shown only when there are any). */
export function rupees(paise) {
  const p = Math.round(Number(paise) || 0);
  const r = Math.trunc(p / 100);
  const f = Math.abs(p % 100);
  return `₹${r.toLocaleString('en-IN')}${f ? `.${String(f).padStart(2, '0')}` : ''}`;
}

export const limitText = (v) => (v === null || v === undefined ? 'Unlimited' : Number(v).toLocaleString('en-IN'));

export function periodText(plan) {
  if (plan.periodMonths) return plan.periodMonths === 12 ? 'per 12 months' : `per ${plan.periodMonths} months`;
  if (plan.periodDays) return `per ${plan.periodDays} days`;
  return '';
}

/** 0–100, or null for an unlimited limit. */
export function usagePct(used, limit) {
  if (limit === null || limit === undefined) return null;
  if (!limit) return used > 0 ? 100 : 0;
  return Math.min(100, Math.round((used / limit) * 100));
}

const niceDay = (iso) => (iso ? new Date(`${iso}T00:00:00`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '');

/**
 * The banners for the portal (everyone in the organization sees them; only the Owner gets the button).
 * Returns [{ tone: 'warning' | 'danger' | 'info', text }].
 */
export function planBanners(billing, isOwner) {
  if (!billing) return [];
  const ask = isOwner ? 'Upgrade in Billing.' : 'Ask your Owner to upgrade.';
  const renew = isOwner ? 'Renew in Billing.' : 'Ask your Owner to renew.';
  const out = [];
  for (const w of billing.warnings || []) {
    if (w.kind === 'usage') {
      const [, , words] = LIMITS.find(([k]) => k === w.key) || [w.key, w.key, w.key];
      out.push(w.full
        ? { tone: 'danger', text: `Your plan’s ${w.limit.toLocaleString('en-IN')} ${words} are all used — new ones are paused (nothing is deleted). ${ask}` }
        : { tone: 'warning', text: `${w.used.toLocaleString('en-IN')} of ${w.limit.toLocaleString('en-IN')} ${words} used. ${ask}` });
    } else if (w.kind === 'ends_soon') {
      out.push({ tone: 'warning', text: `Your ${billing.planName} plan ends ${w.daysLeft <= 0 ? 'today' : `in ${w.daysLeft} day${w.daysLeft === 1 ? '' : 's'}`} (${niceDay(w.endsOn)}). ${renew}` });
    } else if (w.kind === 'grace') {
      out.push({ tone: 'danger', text: `Your ${billing.planName} plan ended on ${niceDay(w.endsOn)}. Everything keeps working until ${niceDay(w.graceUntil)}, then the Free limits apply. ${renew}` });
    } else if (w.kind === 'expired') {
      out.push({ tone: 'danger', text: `Your ${billing.lastPlan || 'paid'} plan has ended, so the Free limits apply. Your groups and resumes are all still here. ${renew}` });
    }
  }
  return out;
}

const CHARS = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';
const GSTIN = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;

/** Same checks as the server (format, state code, check digit): a message, or '' when it looks right. */
export function gstinProblem(value, stateCode) {
  const g = String(value || '').trim().toUpperCase();
  if (!g) return '';
  if (!GSTIN.test(g)) return 'A GSTIN has 15 characters, like 29ABCDE1234F1Z5.';
  let total = 0;
  for (let i = 0; i < 14; i += 1) {
    const v = CHARS.indexOf(g[i]) * (i % 2 ? 2 : 1);
    total += Math.floor(v / 36) + (v % 36);
  }
  if (CHARS[(36 - (total % 36)) % 36] !== g[14]) return 'This GSTIN’s last character doesn’t match — please check it for typos.';
  if (stateCode && g.slice(0, 2) !== stateCode) return 'This GSTIN is registered in a different state from the one chosen.';
  return '';
}

/** The referral code from a /for-orgs?ref=CODE link (Phase 4C keeps it for 90 days). */
export const refFromSearch = (search) => (new URLSearchParams(search).get('ref') || '').trim().toUpperCase().replace(/[^A-Z0-9-]/g, '').slice(0, 20);
