// Profile setup P2: the dashboard checklist (backend app/setup/registry.py + checklist.py). The server works out every
// step from the person's own data, so this file only fetches, skips and words things. Loaded only by the checklist
// card (its own lazy chunk), Profile & settings and (P4) the Easy dashboard's lazy setup steps chunk
// (pages/simple/SimpleChecklist.jsx) — never by the Easy dashboard's first download.
import { LIVE, http } from '../services/http';

const FRESH = 'nm7-sc-fresh';
let freshUntil = 0;

/** The active role's checklist (or `role`'s). null in the preview (no server). After the person opened a step, the
 * next read skips the server's short cache so a step they just finished is ticked at once. */
export function getChecklist(role) {
  if (!LIVE) return Promise.resolve(null);
  const fresh = takeFresh();
  const q = new URLSearchParams();
  if (role) q.set('role', role);
  if (fresh) q.set('fresh', '1');
  const s = q.toString();
  return http(`/api/me/checklist${s ? `?${s}` : ''}`);
}

/** Did the person just come back from a step's page? Then the next read skips the server's short cache. True for a
 * few seconds, so a second read at the same time (React's dev double run) agrees. */
export function takeFresh() {
  try { if (sessionStorage.getItem(FRESH) === '1') { freshUntil = Date.now() + 3000; sessionStorage.removeItem(FRESH); } } catch { /* private mode */ }
  return Date.now() < freshUntil;
}

/** Called when the person opens a step's page. */
export function markOpened() {
  try { sessionStorage.setItem(FRESH, '1'); } catch { /* private mode */ }
}

export const skipStep = (role, step, undo = false) => http(`/api/me/checklist/${role}/skip`, { method: 'POST', body: { step, undo } });
export const getReminders = () => http('/api/me/checklist/reminders');
export const setReminders = (on) => http('/api/me/checklist/reminders', { method: 'PUT', body: { on } });

export const STATUS_TEXT = { done: 'Done', next: 'Next', later: 'Later', waiting: 'Waiting for review' };
export const STATUS_TONE = { done: 'ok', next: 'accent', later: 'neutral', waiting: 'warn' };
export const ROLE_TITLE = { jobseeker: 'Set up your job seeker profile', student: 'Set up your student profile', expert: 'Set up your expert profile', company: 'Set up your company', college: 'Set up your college' };

export const minutes = (n) => (n >= 60 ? `About ${Math.round(n / 60)} h` : `About ${n} min`);

/** "Profile complete" with the level when there is one. */
export function completeText(c) {
  if (c?.role === 'company' || c?.role === 'college') return 'Setup complete'; // P3: a team's checklist
  if (!c?.level) return 'Profile complete';
  return `Profile complete · L${c.level.level} ${c.level.label}`;
}

/** The row for the next step (or null). */
export const nextStep = (c) => (c?.next ? c.steps.find((s) => s.id === c.next) || null : null);

/** Show the card at all: not while loading or failed; when complete only as the small strip. */
export const showCard = (c) => !!c && (c.steps.length > 0 || c.renewals?.length > 0);
