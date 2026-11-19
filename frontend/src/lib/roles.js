// One account for individuals: job seeker, student and expert are roles of the same account (backend:
// app/auth/roles.py). Each role keeps its own dashboard; `user.role` (what the route guards check) follows the active
// role: 'expert' while working as an expert, 'customer' as a job seeker or student. Older accounts have no stored
// roles: they are derived from the account type, the same way the server does. Loaded only by the pages that need it
// (sign-up, the role picker, the account menu's role list), so the Easy dashboard's first download stays small.
import { http, LIVE } from '../services/http';
import { currentUser, updateUser } from './auth';

export const ROLES = ['jobseeker', 'student', 'expert'];
export const ROLE_NAMES = { jobseeker: 'Job seeker', student: 'Student', expert: 'Expert' };

/** The person's roles (stored, or derived for older accounts). Admins have none. */
export function rolesOf(u) {
  if (!u || u.role === 'admin') return [];
  const have = new Set((u.roles || []).filter((r) => ROLES.includes(r)));
  if (u.role === 'expert') have.add('expert');
  else if (!have.has('jobseeker') && !have.has('student')) have.add('jobseeker');
  return ROLES.filter((r) => have.has(r));
}
/** The active role; always agrees with u.role. */
export function activeRoleOf(u) {
  const mine = rolesOf(u);
  if (!mine.length) return null;
  if (u.role === 'expert') return 'expert';
  return mine.includes(u.activeRole) && u.activeRole !== 'expert' ? u.activeRole : mine.find((r) => r !== 'expert');
}
/** Can this person open pages for the account type `need` ('customer' | 'expert'), maybe after a switch? */
export const fits = (u, need) => rolesOf(u).some((r) => (need === 'expert' ? r === 'expert' : r !== 'expert'));
/** The role to switch to for pages of the account type `need`. */
export const roleFor = (u, need) => (need === 'expert' ? 'expert' : rolesOf(u).find((r) => r !== 'expert'));
/** A role name from a link (?role=jobseeker|student|expert, and the old ?as=customer|expert tabs). */
export function roleFromLink(v) {
  const s = String(v || '').toLowerCase();
  if (ROLES.includes(s)) return s;
  if (s === 'customer' || s === 'seeker' || s === 'job') return 'jobseeker';
  return '';
}
/** The first screen after choosing a role: its quick start (pages/start/QuickStart.jsx), then its first results. */
export const SETUP = { jobseeker: '/start/jobseeker', student: '/start/student', expert: '/start/expert' };

const accountType = (r) => (r === 'expert' ? 'expert' : 'customer');
const fromApi = (u) => ({ role: u.role, roles: u.roles || [], activeRole: u.activeRole || undefined, rolesPending: !!u.rolesPending, expertStatus: u.expertStatus || undefined });

/** Adds roles (never removes). Right after sign-up the answer replaces the placeholder role. Returns the user. */
export async function addRoles({ add = [], active, expertTerms = false, termsAccepted = false }) {
  const u = currentUser();
  if (!u) throw new Error('Please sign in.');
  if (LIVE) {
    const r = await http('/api/auth/roles', { method: 'POST', body: { add, active: active || null, expertTerms, termsAccepted } });
    updateUser(u.id, fromApi(r));
    return currentUser();
  }
  const have = rolesOf(u);
  const picked = ROLES.filter((r) => add.includes(r));
  const roles = u.rolesPending && picked.length ? picked : ROLES.filter((r) => have.includes(r) || picked.includes(r));
  if (roles.includes('expert') && !have.includes('expert') && !expertTerms && !u.expertTermsAt) {
    throw Object.assign(new Error('Please agree to the Expert Terms to work as an expert.'), { code: 'expert_terms' });
  }
  const fresh = picked.filter((r) => !have.includes(r) || u.rolesPending);
  let act = roles.includes(active) ? active : fresh[0] || activeRoleOf(u);
  if (!roles.includes(act)) [act] = roles;
  const patch = { roles, activeRole: act, role: accountType(act), rolesPending: false };
  if (roles.includes('expert') && !u.expertStatus) patch.expertStatus = 'draft';
  if (roles.includes('expert')) patch.expertTermsAt = u.expertTermsAt || Date.now();
  updateUser(u.id, patch);
  return currentUser();
}

/** Switches the active role (one the person already has). Returns the user. */
export async function switchRole(role) {
  const u = currentUser();
  if (!u) throw new Error('Please sign in.');
  if (LIVE) {
    const r = await http('/api/auth/roles/switch', { method: 'POST', body: { role } });
    updateUser(u.id, fromApi(r));
    return currentUser();
  }
  if (!rolesOf(u).includes(role)) throw Object.assign(new Error('Add this role first (account menu → Add another role).'), { code: 'no_such_role' });
  updateUser(u.id, { roles: rolesOf(u), activeRole: role, role: accountType(role) });
  return currentUser();
}

/** Where the person goes after the picker: the `next` page, else the setup of the active role. */
export const afterPick = (u, next) => next || SETUP[activeRoleOf(u)] || '/me';
