// Recruiter portal (colleges, Phase 3): plain logic for the recruiter's page (/recruiter/:token) and the
// coordinator's invite list. The server decides who is visible; this only shapes requests and the board.

export const STAGES = ['shortlisted', 'interview', 'selected', 'rejected'];
export const STAGE_LABEL = { none: 'Not on the board', shortlisted: 'Shortlisted', interview: 'Interview', selected: 'Selected', rejected: 'Rejected' };
export const CONTACT_LABEL = { hidden: 'Contact details hidden', shown: 'Contact details shown', after_shortlist: 'Contact details after shortlisting' };
export const INVITE_STATE = { active: 'Active', expired: 'Expired', revoked: 'Revoked' };

/** Recruiter invite tokens are 43 random characters. */
export const isInviteToken = (s) => /^[A-Za-z0-9_-]{41,100}$/.test(s || '');

/** The candidates search as a query string: only the filters that are set. */
export function searchQuery(f = {}) {
  const p = new URLSearchParams();
  const put = (k, v) => { if (v !== undefined && v !== null && String(v).trim() !== '' && v !== false) p.set(k, String(v).trim()); };
  put('skills', (f.skills || '').split(',').map((s) => s.trim()).filter(Boolean).join(','));
  put('branch', f.branch);
  put('cgpaMin', f.cgpaMin);
  put('cgpaMax', f.cgpaMax);
  put('year', f.year);
  put('location', f.location);
  put('atsMin', f.atsMin);
  put('cert', f.cert);
  put('language', f.language);
  put('q', f.q);
  if (f.internship) p.set('internship', 'true');
  if (f.projects) p.set('projects', 'true');
  const s = p.toString();
  return s ? `?${s}` : '';
}

/** How many filters are on (for the "Filters (3)" button). */
export const filterCount = (f = {}) => searchQuery(f).replace(/^\?/, '').split('&').filter(Boolean).length;

/** The shortlist board: one column per stage, names in order. */
export function boardColumns(cards) {
  const cols = Object.fromEntries(STAGES.map((s) => [s, []]));
  for (const c of cards || []) if (cols[c.stage]) cols[c.stage].push(c);
  for (const s of STAGES) cols[s].sort((a, b) => a.name.localeCompare(b.name));
  return cols;
}

/** The session after the demo link's "#s=…" (kept out of the address bar and server logs), else the stored one. */
export function sessionFromHash(hash) {
  const m = /(?:^#|&)s=([A-Za-z0-9_-]{20,100})/.exec(hash || '');
  return m ? m[1] : '';
}

/** "Bharat · CSE · 8.4 CGPA · 2026": the short line under a candidate's name. */
export function cardLine(c) {
  const grade = c.cgpa != null ? `${c.cgpa} CGPA` : c.percentage != null ? `${c.percentage}%` : '';
  return [c.branch, grade, c.year].filter(Boolean).join(' · ');
}

/** A safe file-name piece from a company name. */
export const fileSafe = (s) => String(s || '').replace(/[^\p{L}\p{N}]+/gu, '_').replace(/^_+|_+$/g, '') || 'Shortlist';
