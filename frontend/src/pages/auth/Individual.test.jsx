// One account for individuals: the sign-up page (no tabs, one tick, no company / college words but the footer link),
// the role picker ("What would you like to do?") and the account menu's role switcher (preview accounts).
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { Signup } from './Auth';
import Welcome from './Welcome';
import AccountRoles from '../../components/AccountRoles';
import { DEMO_CODE, currentUser, homeFor, signUp, verifyEmail } from '../../lib/auth';
import { activeRoleOf, addRoles, afterPick, fits, roleFromLink, rolesOf, switchRole } from '../../lib/roles';

const at = (url, el) => renderToStaticMarkup(<MemoryRouter initialEntries={[url]}>{el}</MemoryRouter>);
const text = (html) => html.replace(/<[^>]+>/g, ' ').replace(/&[a-z#0-9]+;/g, ' ').replace(/\s+/g, ' ').replace(/ ([,.])/g, '$1');
const ORG_LINK = 'Hiring or placements? Go to Nm7 for companies / colleges';

describe('roles derived like the server', () => {
  it('older accounts get roles from the account type', () => {
    expect(rolesOf({ role: 'customer' })).toEqual(['jobseeker']);
    expect(rolesOf({ role: 'expert', expertStatus: 'approved' })).toEqual(['expert']);
    expect(rolesOf({ role: 'admin' })).toEqual([]);
    expect(activeRoleOf({ role: 'customer' })).toBe('jobseeker');
  });
  it('several roles: the active one follows the account type', () => {
    const u = { role: 'customer', roles: ['jobseeker', 'student', 'expert'], activeRole: 'student' };
    expect(rolesOf(u)).toEqual(['jobseeker', 'student', 'expert']);
    expect(activeRoleOf(u)).toBe('student');
    expect(activeRoleOf({ ...u, role: 'expert', activeRole: 'expert' })).toBe('expert');
    expect(fits(u, 'expert')).toBe(true);
    expect(fits({ role: 'customer' }, 'expert')).toBe(false);
  });
  it('old tab links map to a role', () => {
    expect(roleFromLink('expert')).toBe('expert');
    expect(roleFromLink('customer')).toBe('jobseeker');
    expect(roleFromLink('student')).toBe('student');
    expect(roleFromLink('admin')).toBe('');
  });
  it('each role has its own home', () => {
    expect(homeFor({ role: 'customer', activeRole: 'jobseeker' })).toBe('/me');
    expect(homeFor({ role: 'customer', activeRole: 'student' })).toBe('/me/learn');
    expect(homeFor({ role: 'expert', expertStatus: 'draft' })).toBe('/expert/profile');
    expect(homeFor({ role: 'expert', expertStatus: 'approved' })).toBe('/expert');
    expect(homeFor({ role: 'customer', rolesPending: true })).toBe('/welcome');
  });
});

describe('the sign-up page', () => {
  const page = at('/signup?role=student', <Signup />);
  it('has the new title, no tabs and one consent tick', () => {
    expect(page).toContain('Create your free Nm7 account');
    expect(page).toContain('Find jobs, build your career, or work as an expert, all in one account.');
    expect(page).not.toMatch(/Get my resume done|Work as an expert|You only pay when|role="radiogroup"|segmented/);
    expect(page.match(/type="checkbox"/g)).toHaveLength(2); // show passwords + the one tick
    expect(text(page)).toContain('I agree to the Terms and Privacy Policy, and I’m 18 or older (or my parent or guardian agrees).');
    for (const l of ['Full name', 'Email', 'Mobile (WhatsApp) — optional', 'Password', 'Re-type password']) expect(page).toContain(l);
  });
  it('names companies, colleges and hiring only in the footer link', () => {
    const t = text(page).replace(ORG_LINK, '');
    expect(text(page)).toContain(ORG_LINK);
    expect(t).not.toMatch(/hir(e|ing)|compan|college|placement|recruit/i);
  });
});

describe('the role picker and the switcher (preview accounts)', () => {
  it('a new account picks roles; the expert role needs the Expert Terms and starts the application', async () => {
    await signUp({ name: 'Asha Rao', email: 'asha-picker@example.com', phone: '', password: 'Strong-pass-1', confirm: 'Strong-pass-1', agree: true, pickRoles: true });
    const u = await verifyEmail('asha-picker@example.com', DEMO_CODE);
    expect(u.rolesPending).toBe(true);
    expect(homeFor(u)).toBe('/welcome');

    const picker = at('/welcome?role=expert', <Welcome />);
    expect(picker).toContain('What would you like to do?');
    for (const t of ['Find a job', 'I’m a student', 'Work as an expert']) expect(text(picker)).toContain(t);
    expect(picker).toMatch(/data-role="expert"[^>]*><input type="checkbox"[^>]*checked=""/); // preselected from the link
    expect(picker).not.toMatch(/data-role="jobseeker"[^>]*><input type="checkbox"[^>]*checked=""/);
    expect(text(picker)).toContain('I agree to the Expert Terms');

    await expect(addRoles({ add: ['jobseeker', 'expert'] })).rejects.toMatchObject({ code: 'expert_terms' });
    const v = await addRoles({ add: ['jobseeker', 'expert'], active: 'jobseeker', expertTerms: true });
    expect(rolesOf(v)).toEqual(['jobseeker', 'expert']);
    expect(v.rolesPending).toBe(false);
    expect(v.role).toBe('customer');
    expect(v.expertStatus).toBe('draft'); // paid work only after approval
    expect(afterPick(v)).toBe('/me/profile');

    const menu = at('/me', <AccountRoles user={currentUser()} />);
    expect(text(menu)).toContain('Now: Job seeker');
    expect(text(menu)).toContain('Switch to:');
    expect(menu).toMatch(/role="menuitem"[^>]*>Expert</);
    expect(text(menu)).toContain('Add another role');

    const w = await switchRole('expert');
    expect(w.role).toBe('expert');
    expect(homeFor(w)).toBe('/expert/profile'); // not approved: the application, never paid work
    await expect(switchRole('student')).rejects.toMatchObject({ code: 'no_such_role' });

    const adding = at('/welcome?add=1', <Welcome />);
    expect(adding).toContain('Add another role');
    expect(text(adding)).toContain('already yours');
    const x = await addRoles({ add: ['student'] });
    expect(rolesOf(x)).toEqual(['jobseeker', 'student', 'expert']);
    expect(activeRoleOf(x)).toBe('student');
    expect(homeFor(x)).toBe('/me/learn');

  });
});
