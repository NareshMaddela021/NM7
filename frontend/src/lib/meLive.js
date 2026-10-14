// Live app: the customer dashboard's data comes from the API (/api/me/*, /api/orders) and every change is saved
// there. Nothing personal is kept in this browser; the store holds it in memory for the signed-in customer only.
import { http } from '../services/http';

const PLAN_KINDS = new Set(['plan']);
const ts = (v) => (v ? Date.parse(v) : null);
const NOTIFY = { whatsapp: { order: true, draft: true, jobs: true, tips: false }, email: { order: true, draft: true, jobs: true, tips: false }, sms: { order: true, draft: false, jobs: false, tips: false } };
const withDefaults = (n = {}) => Object.fromEntries(Object.entries(NOTIFY).map(([ch, v]) => [ch, { ...v, ...(n[ch] || {}) }]));

/** What the dashboard shows before the server answers. */
export function emptyState(u) {
  return {
    loading: true, error: null,
    account: { name: u?.name || '', email: u?.email || '', phone: u?.phone || '', targetRole: '', cities: '', level: '', notify: withDefaults(), joined: u?.createdAt || Date.now(), referralCode: '' },
    orders: [], resumes: [], checks: [], covers: [], apps: [],
    share: { on: false, slug: '', resumeId: null, views: [], viewCount: 0, hidePhone: false },
    issues: [], referrals: [], calls: { picked: null, notes: '' }, seen: {},
  };
}

/** An order from GET /api/orders in the shape the dashboard pages use. */
export function orderFromApi(o, resumeId) {
  const plan = o.items.find((i) => PLAN_KINDS.has(i.kind));
  const paidAt = ts(o.paidAt);
  const refunds = o.refunds || [];
  const done = refunds.find((r) => ['approved', 'processed'].includes(r.status));
  const review = refunds.find((r) => r.status === 'review');
  const declined = !done && !review ? refunds.find((r) => r.status === 'rejected') : null;
  return {
    id: o.id, plan: o.plan, price: (plan?.amount ?? o.amount) / 100, paidAt, method: o.paymentMethod ? o.paymentMethod.toUpperCase() === 'UPI' ? 'UPI' : o.paymentMethod[0].toUpperCase() + o.paymentMethod.slice(1) : '—',
    payId: o.paymentId || '', invoice: o.invoiceNo || '',
    addons: o.items.filter((i) => i.kind === 'addon').map((i) => ({ id: i.code, price: i.amount / 100, at: paidAt, payId: o.paymentId || '' })),
    linked: o.plan !== 'diy', resumeId, serverStatus: o.status,
    status: o.status === 'refunded' || done ? 'refunded' : o.status === 'done' ? 'done' : undefined,
    ...(done ? { refund: { amount: done.amount / 100, reason: done.reason === 'late' ? 'Late delivery — automatic refund' : done.reason === 'cancel' ? 'Cancelled before an expert started' : 'Refund approved after review', at: ts(done.createdAt), done: ts(done.processedAt), ref: done.id } } : {}),
    ...(review ? { refundRequest: { status: 'review', reason: review.reason, at: ts(review.createdAt), ref: review.id } } : {}),
    ...(declined ? { refundRequest: { status: 'declined', reason: declined.reason, at: ts(declined.createdAt), ref: declined.id } } : {}),
  };
}

const ticketFromApi = (t) => ({ id: t.id, topic: t.topic, order: t.orderId || undefined, text: t.text, at: t.at, status: t.status, reply: t.reply || undefined });

/** GET everything for the dashboard and turn it into the store's shape. */
export async function fetchState() {
  const [s, orders] = await Promise.all([http('/api/me/state'), http('/api/orders')]);
  const active = s.resumes.find((r) => r.active) || s.resumes[0];
  const p = s.profile;
  return {
    loading: false, error: null,
    account: { name: p.name, email: p.email, phone: p.phone || '', targetRole: p.targetRole, cities: p.cities, level: p.level, notify: withDefaults(p.notify), joined: p.joined, referralCode: p.referralCode },
    orders: orders.filter((o) => o.paidAt).map((o) => orderFromApi(o, active?.id)),
    resumes: s.resumes,
    checks: s.checks,
    covers: s.covers,
    apps: s.apps,
    share: { on: s.share.on, slug: s.share.slug, resumeId: s.share.resumeId, views: s.share.views, viewCount: s.share.viewCount, hidePhone: s.share.hidePhone },
    issues: s.tickets.map(ticketFromApi),
    referrals: s.referral.referrals,
    calls: p.ui?.calls || { picked: null, notes: '' },
    seen: p.ui?.seen || {},
  };
}

export const createResume = (r) => http('/api/me/resumes', { method: 'POST', body: { id: r.id, name: r.name, data: r.data, jd: r.jd || '', active: !!r.active, versions: r.versions || [] } });

/* ---------- saving changes: compare before/after and send only what changed ---------- */
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const byId = (list) => new Map((list || []).map((x) => [x.id, x]));
const pending = new Map(); // debounced resume saves: id -> { timer, patch }
let onError = () => {};
/** The store passes a function that shows save errors (e.g. a toast) and reloads. */
export const setErrorHandler = (fn) => { onError = fn; };
const send = (p) => p.catch((e) => onError(e));

function saveResumeSoon(id, patch) {
  const cur = pending.get(id) || { patch: {} };
  clearTimeout(cur.timer);
  const merged = { ...cur.patch, ...patch };
  const timer = setTimeout(() => { pending.delete(id); send(http(`/api/me/resumes/${encodeURIComponent(id)}`, { method: 'PATCH', body: merged })); }, 700);
  pending.set(id, { timer, patch: merged });
}
let profilePatch = null; let profileTimer;
function saveProfileSoon(patch) {
  profilePatch = { ...(profilePatch || {}), ...patch };
  clearTimeout(profileTimer);
  profileTimer = setTimeout(() => { const body = profilePatch; profilePatch = null; send(http('/api/me/profile', { method: 'PATCH', body })); }, 600);
}
/** Sends any resume/profile saves still waiting (e.g. before signing out). */
export async function flush() {
  clearTimeout(profileTimer);
  if (profilePatch) { const body = profilePatch; profilePatch = null; await http('/api/me/profile', { method: 'PATCH', body }).catch(() => {}); }
  const jobs = [...pending.entries()].map(([id, { timer, patch }]) => { clearTimeout(timer); return http(`/api/me/resumes/${encodeURIComponent(id)}`, { method: 'PATCH', body: patch }).catch(() => {}); });
  pending.clear();
  await Promise.all(jobs);
}
export function cancelPending() { pending.forEach(({ timer }) => clearTimeout(timer)); pending.clear(); clearTimeout(profileTimer); profilePatch = null; }

function syncList(prev, next, path, toBody, { patchable = true } = {}) {
  const a = byId(prev); const b = byId(next);
  b.forEach((x, id) => {
    if (!a.has(id)) send(http(path, { method: 'POST', body: toBody(x) }));
    else if (patchable && !same(a.get(id), x)) send(http(`${path}/${encodeURIComponent(id)}`, { method: 'PATCH', body: toBody(x, true) }));
  });
  a.forEach((_, id) => { if (!b.has(id)) send(http(`${path}/${encodeURIComponent(id)}`, { method: 'DELETE' })); });
}

const coverBody = (c, patch) => ({ ...(patch ? {} : { id: c.id }), company: c.company || '', role: c.role || '', resumeId: c.resumeId || null, jd: c.jd || '', body: c.body || '' });
const appBody = (x, patch) => ({ ...(patch ? {} : { id: x.id }), company: x.company || 'Company', role: x.role || '', status: x.status, date: x.date || null, resumeId: x.resumeId || null, url: x.url || '', notes: x.notes || '', next: x.next || null });

/** Called after every change to the store (prev → next). Returns a promise for new support tickets. */
export function persist(prev, next) {
  // resumes: new ones now, edits debounced, deleted ones now
  const a = byId(prev.resumes); const b = byId(next.resumes);
  b.forEach((r, id) => {
    const old = a.get(id);
    if (!old) { send(createResume(r)); return; }
    const patch = {};
    ['name', 'data', 'jd', 'versions'].forEach((k) => { if (!same(old[k], r[k])) patch[k] = r[k]; });
    if (r.active && !old.active) patch.active = true;
    if (Object.keys(patch).length) saveResumeSoon(id, patch);
  });
  a.forEach((_, id) => { if (!b.has(id)) { const p = pending.get(id); if (p) { clearTimeout(p.timer); pending.delete(id); } send(http(`/api/me/resumes/${encodeURIComponent(id)}`, { method: 'DELETE' })); } });

  syncList(prev.covers, next.covers, '/api/me/cover-letters', coverBody);
  syncList(prev.apps, next.apps, '/api/me/applications', appBody);
  // ATS checks are only ever added
  const seenChecks = new Set((prev.checks || []).map((c) => `${c.at}:${c.resumeId}`));
  (next.checks || []).filter((c) => !seenChecks.has(`${c.at}:${c.resumeId}`)).forEach((c) => send(http('/api/me/ats-checks', { method: 'POST', body: { score: Math.round(c.score || 0), resumeId: c.resumeId || null, label: c.label || '' } })));

  // profile (account fields + small screen state)
  const acc = {};
  [['name', 'name'], ['phone', 'phone'], ['targetRole', 'targetRole'], ['cities', 'cities'], ['level', 'level'], ['notify', 'notify']].forEach(([k, api]) => { if (!same(prev.account?.[k], next.account?.[k])) acc[api] = next.account[k]; });
  if (!same(prev.calls, next.calls) || !same(prev.seen, next.seen)) acc.ui = { calls: next.calls, seen: next.seen };
  if (Object.keys(acc).length) saveProfileSoon(acc); // typing in a notes box shouldn't send one request per key

  if (!same(prev.share, next.share) && next.share?.slug && !same({ ...prev.share, views: 0, viewCount: 0 }, { ...next.share, views: 0, viewCount: 0 })) {
    const s = next.share;
    send(http('/api/me/share', { method: 'PUT', body: { on: !!s.on, slug: s.slug, resumeId: s.resumeId || null, hidePhone: !!s.hidePhone } }));
  }
}

/** A new support ticket: saved on the server (which emails our inbox). Returns the stored ticket. */
export async function sendTicket({ topic, order, text }) {
  const t = await http('/api/me/tickets', { method: 'POST', body: { topic, orderId: order || null, text } });
  return { ...ticketFromApi(t), emailed: t.emailed };
}
