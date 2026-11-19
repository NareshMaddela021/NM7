// Admin views (backend app/auth/views.py): "Switch to" a job seeker / student / expert / company / college view, a
// read-only "View as this user" for support, and "Back to Admin". The admin stays signed in the whole time: a view
// is a second, short-lived cookie on top of the admin session, and Back to Admin just drops it. Each step reloads the
// page so every screen starts fresh as the new person.
import { http } from '../services/http';
import { keepAccount } from './recruiterPortal';

export const VIEW_LABELS = { jobseeker: 'Job seeker', student: 'Student', expert: 'Expert', company: 'Company', college: 'College' };

/** The words on the banner: "You are viewing as Student (admin preview)". */
export function bannerText(view) {
  if (!view) return '';
  if (view.readOnly) return `You are viewing ${view.label}’s screens (read-only)`;
  return `You are viewing as ${VIEW_LABELS[view.role] || view.label} (admin preview)`;
}

const go = (path) => window.location.assign(path);

/** role: jobseeker | student | expert | company | college */
export async function switchTo(role) {
  const r = await http('/api/admin/views/switch', { method: 'POST', body: { role } });
  if (r.session) keepAccount(r.session); // the demo company signs in the way a company does
  go(r.path);
  return r;
}

export async function viewAsUser(userId, reason) {
  const r = await http('/api/admin/views/user', { method: 'POST', body: { userId, reason } });
  go(r.path);
  return r;
}

export async function backToAdmin(view) {
  await http('/api/admin/views/stop', { method: 'POST' });
  if (view?.role === 'company') keepAccount(null);
  go('/admin');
}
