// Profile setup P2: the dashboard checklist (backend app/setup/registry.py + checklist.py). The server works out every
// step from the person's own data, so this file only fetches, skips and words things. Loaded only by the checklist
// card (its own lazy chunk) and Profile & settings — never by the Easy dashboard.
import { LIVE, http } from '../services/http';

const FRESH = 'nm7-sc-fresh';
let freshUntil = 0;

/** The active role's checklist (or `role`'s). null in the preview (no server). After the person opened a step, the
 * next read skips the server's short cache so a step they just finished is ticked at once. */
export function getChecklist(role) {
  if (!LIVE) return Promise.resolve(null);
  try { if (sessionStorage.getItem(FRESH) === '1') { freshUntil = Date.now() + 3000; sessionStorage.removeItem(FRESH); } } catch { /* private mode */ }
  const fresh = Date.now() < freshUntil; // a few seconds, so a second read at the same time (React's dev double run) agrees
  const q = new URLSearchParams();
  if (role) q.set('role', role);
  if (fresh) q.set('fresh', '1');
  const s = q.toString();
  return http(`/api/me/checklist${s ? `?${s}` : ''}`);
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
export const ROLE_TITLE = { jobseeker: 'Set up your job seeker profile', student: 'Set up your student profile', expert: 'Set up your expert profile' };

export const minutes = (n) => (n >= 60 ? `About ${Math.round(n / 60)} h` : `About ${n} min`);

/** "Profile complete" with the level when there is one. */
export function completeText(c) {
  if (!c?.level) return 'Profile complete';
  return `Profile complete · L${c.level.level} ${c.level.label}`;
}

/** The row for the next step (or null). */
export const nextStep = (c) => (c?.next ? c.steps.find((s) => s.id === c.next) || null : null);

/** Show the card at all: not while loading or failed; when complete only as the small strip. */
export const showCard = (c) => !!c && (c.steps.length > 0 || c.renewals?.length > 0);
