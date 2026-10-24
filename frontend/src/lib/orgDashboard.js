// Nm7 for Organizations: small pure helpers behind the group dashboard, the export bar and the reminder results.
// Shared by the admin console and the coordinator portal (/org).

/** The API base for a page: the admin console sees every organization; the portal one organization. */
export const apiBase = (orgId) => (orgId ? `/api/org/${encodeURIComponent(orgId)}` : '/api/admin');

const DAY_FMT = { day: 'numeric', month: 'short' };
/** joinsPerDay from the server → the bar chart's rows ({ label, joins }), oldest first. */
export function joinBars(joinsPerDay = []) {
  return joinsPerDay.map((d) => ({ label: new Date(`${d.day}T00:00:00`).toLocaleDateString('en-IN', DAY_FMT), joins: d.n }));
}

/** The dashboard tiles: [label, value, table filters to open when clicked (null = not a filter)]. */
export function countTiles(c = {}) {
  return [
    ['Joined', c.joined ?? 0, { approval: 'all' }],
    ['Pending approval', c.pending ?? 0, { approval: 'pending' }],
    ['Approved', c.approved ?? 0, {}],
    ['≥ 80% complete', c.complete ?? 0, null],
    ['Incomplete', c.incomplete ?? 0, { incomplete: true }],
    ['Needs changes', c.needsChanges ?? 0, { review: 'needs_changes' }],
    ['Ready', c.ready ?? 0, { review: 'ready' }],
    ['Printed', c.printed ?? 0, null],
    ['Ready & not printed', c.readyNotPrinted ?? 0, { readyNotPrinted: true }],
  ];
}

/** Completeness buckets for the horizontal bars. */
export const bucketRows = (b = {}) => [['0–39%', b.low], ['40–79%', b.mid], ['80–100%', b.high]].map(([label, value]) => ({ label, value: value ?? 0 }));

/**
 * The body an export (combined PDF / ZIP / CSV) sends: the table's filters without the view-only ones. The server
 * exports approved members only whatever the table shows, so the approval filter isn't sent; "Export only Ready" adds
 * onlyReady.
 */
export function exportFilters(filters = {}, { onlyReady = false } = {}) {
  const out = {};
  for (const [k, v] of Object.entries(filters)) {
    if (['approval', 'page', 'sort', 'dir', 'perPage'].includes(k) || v === '' || v == null || v === false) continue;
    out[k] = v;
  }
  if (onlyReady) out.onlyReady = true;
  return out;
}

const REASONS = [['recent', 'reminded in the last 24 h'], ['optedOut', 'opted out'], ['overLimit', 'over the 500 limit'], ['failed', 'email failed']];
/** "Sent 41, skipped 6: 4 reminded in the last 24 h, 2 opted out" */
export function remindSummary(r, verb = 'Sent') {
  const sent = r?.sent ?? r?.emailed ?? 0;
  const parts = REASONS.filter(([k]) => r?.reasons?.[k]).map(([k, t]) => `${r.reasons[k]} ${t}`);
  return `${verb} ${sent}${r?.skipped ? `, skipped ${r.skipped}: ${parts.join(', ')}` : ''}`;
}

export const APPROVAL_LABEL = { approved: 'Approved', pending: 'Pending', rejected: 'Rejected' };
export const REVIEW_LABEL = { none: '', needs_changes: 'Needs changes', ready: 'Ready' };
/** What a member sees for a group: Pending / Approved / Needs changes / Ready / Not approved. */
export function memberStatus(m) {
  if (m.approval === 'pending') return { label: 'Pending approval', tone: 'b-warning' };
  if (m.approval === 'rejected') return { label: 'Not approved', tone: 'b-neutral' };
  if (m.reviewStatus === 'needs_changes') return { label: 'Needs changes', tone: 'b-warning' };
  if (m.reviewStatus === 'ready') return { label: 'Ready', tone: 'b-success' };
  return { label: 'Approved', tone: 'b-success' };
}

/** "You help run <Org>": what this person can do there (the server enforces it; this only says it right). */
export function staffSummary({ role, allGroups = true } = {}) {
  const what = role === 'viewer' ? 'Viewer · view and print' : 'Coordinator · groups, approvals, reminders and printing';
  return allGroups ? what : `${what} · some groups`;
}

/** The line under the export bar, by what this person's buttons can do. */
export function exportNote(role, showsUnapproved = false) {
  const left = showsUnapproved ? ' — the pending / rejected rows shown here are left out' : '';
  const marks = role === 'viewer' ? 'Combined PDF marks those resumes as printed.' : 'Combined PDF and ZIP mark those resumes as printed.';
  return `Exports include approved members only${left}. ${marks} Exports never include ID numbers.`;
}
