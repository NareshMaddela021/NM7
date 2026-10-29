// Shared set-up for the college feature tests: a college (organization + one group with roll number and branch) on a
// plan, its coordinator (invited by Nm7, signed in with their own account) and n students who joined with consent.
import { expect } from '@playwright/test';
import { API, PASSWORD, adminLogin, email, login, seed } from './helpers.mjs';

export const SIZES = [['desktop', { viewport: { width: 1280, height: 900 } }], ['phone', { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true }]];
export const call = (page, path, init = {}) => page.evaluate(async ([base, p, i]) => {
  const r = await fetch(`${base}${p}`, { credentials: 'include', headers: { 'Content-Type': 'application/json' }, ...i });
  const text = await r.text();
  let body = text; try { body = JSON.parse(text); } catch { /* csv */ }
  return { status: r.status, body };
}, [API, path, init]);
export const json = (method, body) => ({ method, body: JSON.stringify(body) });
export const noSideScroll = (page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
const FIELDS = [{ key: 'roll', label: 'Roll number', type: 'text', required: true }, { key: 'branch', label: 'Branch', type: 'select', options: ['CSE', 'ECE'], required: true }];

export async function college(browser, opts, label, { plan = 'campus', students = 2, shareWithRecruiters = false, prefix = 'cl' } = {}) {
  const tag = `${prefix}${label}${Date.now().toString(36)}`;
  const actx = await browser.newContext({ ...opts, acceptDownloads: true });
  const admin = await actx.newPage();
  const amail = `owner-${tag}@nm7.si`;
  const { secret } = seed('admin', amail, 'owner', PASSWORD);
  await adminLogin(admin, amail, secret);
  await expect(admin).not.toHaveURL(/\/login/);
  const org = (await call(admin, '/api/admin/orgs', json('POST', { name: `College ${tag}`, type: 'college', city: 'Guntur' }))).body;
  const code = `${prefix.toUpperCase()}${Date.now().toString(36).toUpperCase().slice(-6)}${label[0].toUpperCase()}`;
  const g = await call(admin, `/api/admin/orgs/${org.id}/groups`, json('POST', { name: 'B.Tech 2026', code, customFields: FIELDS }));
  expect(g.status).toBe(201);
  if (plan !== 'free') expect((await call(admin, `/api/admin/orgs/${org.id}/billing/plan`, json('PUT', { planId: plan }))).status).toBe(200);
  if (shareWithRecruiters) expect((await call(admin, `/api/admin/groups/${g.body.id}`, json('PATCH', { settings: { shareWithRecruiters: true } }))).status).toBe(200);
  // the coordinator
  const cmail = email(`coord-${tag}`);
  const inv = await call(admin, `/api/admin/orgs/${org.id}/staff`, json('POST', { email: cmail, role: 'coordinator' }));
  expect(inv.status).toBe(201);
  const cctx = await browser.newContext({ ...opts, acceptDownloads: true });
  const coord = await cctx.newPage();
  seed('customer', cmail, 'Coord Inator', PASSWORD);
  await login(coord, cmail);
  await coord.waitForURL('**/me');
  expect((await call(coord, `/api/org-invites/${inv.body.inviteUrl.split('/').pop()}/accept`, { method: 'POST' })).status).toBe(200);
  // students
  const people = [];
  for (let i = 0; i < students; i += 1) {
    const ctx = await browser.newContext(opts);
    const page = await ctx.newPage();
    const mail = email(`st-${tag}-${i}`);
    seed('customer', mail, `Student ${i} ${tag}`, PASSWORD);
    await login(page, mail);
    await page.waitForURL('**/me');
    await expect.poll(async () => (await call(page, '/api/me/resumes')).body.length).toBe(1);
    const [r] = (await call(page, '/api/me/resumes')).body;
    const j = await call(page, '/api/me/groups/join', json('POST', { code, consent: true, fields: { roll: `21A0${i}`, branch: i % 2 ? 'ECE' : 'CSE' }, resumeId: r.id }));
    expect(j.status).toBe(201);
    people.push({ ctx, page, mid: j.body.id, name: `Student ${i} ${tag}`, email: mail });
  }
  const close = () => Promise.all([actx.close(), cctx.close(), ...people.map((p) => p.ctx.close())]);
  return { admin, coord, org, group: g.body, code, students: people, close, tag };
}
