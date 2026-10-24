// Nm7 for Organizations (Phase 2) against the real API: the super-admin invites a coordinator; they accept with their
// own account and run the drive in the portal (/org): a member joins a group that needs approval, the coordinator
// approves them, reminds the incomplete ones from the group dashboard, and exports (combined PDF + CSV).
import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { PDFDocument } from 'pdf-lib';
import { PASSWORD, adminLogin, email, emailsTo, lastCode, login, readQrPng, seed } from './helpers.mjs';

async function saved(page, click, ext) {
  const [file] = await Promise.all([page.waitForEvent('download', { timeout: 60_000 }), click()]);
  expect(file.suggestedFilename()).toMatch(new RegExp(`\\${ext}$`));
  return { name: file.suggestedFilename(), bytes: readFileSync(await file.path()) };
}

test('invite → accept → coordinator portal → approve → remind → export', async ({ page, browser }) => {
  const owner = email('owner2');
  const { secret } = seed('admin', owner, 'owner', PASSWORD);
  const code = `P2${Date.now().toString(36).slice(-6).toUpperCase()}`;
  const coord = email('coord');

  // 1. admin: organization, a group that approves members, and an invite
  await adminLogin(page, owner, secret);
  const adminNav = page.getByRole('navigation', { name: 'Admin sections' });
  await adminNav.getByRole('link', { name: 'Organizations' }).click();
  const newOrg = page.getByRole('form', { name: 'New organization' });
  await newOrg.getByLabel('Organization name').fill('Govt Polytechnic Nellore');
  await newOrg.getByRole('button', { name: 'Add organization' }).click();
  await expect(page.getByRole('heading', { name: 'Govt Polytechnic Nellore' })).toBeVisible();
  await page.getByRole('button', { name: 'New group' }).click();
  const form = page.getByRole('form', { name: 'New group' });
  await form.getByLabel('Group name').fill('Diploma 2026');
  await form.getByLabel('Join code').fill(code);
  await form.getByRole('button', { name: '+ Roll number' }).click();
  await form.getByLabel('Approve members before they’re shared').check();
  await form.getByRole('button', { name: 'Save group' }).click();
  await expect(page.getByRole('region', { name: 'Group Diploma 2026' })).toContainText('approval on');
  const staff = page.getByRole('region', { name: 'Coordinators' });
  await staff.getByLabel('Invite by email').fill(coord);
  await staff.getByRole('button', { name: 'Send invite' }).click();
  await expect(staff.getByText(`Invite emailed to ${coord}`)).toBeVisible();
  const inviteUrl = await staff.getByTestId('invite-url').textContent();
  expect(emailsTo(coord).some((m) => m.includes('/org/invite/'))).toBe(true);
  await expect(staff.getByRole('cell', { name: 'Invited' })).toBeVisible();

  // 2. the coordinator accepts with a new account (same email)
  const cctx = await browser.newContext();
  const c = await cctx.newPage();
  await c.goto(new URL(inviteUrl).pathname);
  await expect(c.getByRole('heading', { name: 'Join Govt Polytechnic Nellore on Nm7' })).toBeVisible();
  await c.getByRole('link', { name: 'Create a free account' }).click();
  await c.getByLabel('Full name').fill('Placement Officer');
  await c.getByLabel('Email').fill(coord);
  await c.getByLabel('Mobile (WhatsApp)').fill('98765 43210');
  await c.getByLabel('Password', { exact: true }).fill(PASSWORD);
  await c.getByLabel('Re-type password').fill(PASSWORD);
  await c.getByRole('checkbox', { name: /I agree/ }).check();
  await c.getByRole('button', { name: 'Create account' }).click();
  await expect(c.getByRole('heading', { name: 'Confirm your email' })).toBeVisible();
  await c.getByLabel('6-digit code').fill(lastCode(coord));
  await c.getByRole('button', { name: 'Confirm & continue' }).click();
  await c.waitForURL('**/org/invite/**');
  await c.getByRole('button', { name: 'Accept the invite' }).click();
  await c.waitForURL(/\/org\/[^/]+$/);
  const portalUrl = new URL(c.url()).pathname;
  await expect(c).toHaveTitle('My groups · Govt Polytechnic Nellore · Nm7');
  // the coordinator's own dashboard says what they can do there
  await c.goto('/me/groups');
  await expect(c.getByTestId('staff-summary')).toHaveText('Coordinator · groups, approvals, reminders and printing');
  await c.goto(portalUrl);
  await expect(c.getByRole('heading', { name: 'Govt Polytechnic Nellore' })).toBeVisible();
  await expect(c.getByText('Coordinator', { exact: false }).first()).toBeVisible();
  await expect(c.getByRole('link', { name: 'Dashboard' })).toBeVisible(); // not the admin console
  await expect(c.getByRole('navigation', { name: 'Admin sections' })).toHaveCount(0);
  const card = c.getByRole('region', { name: 'Group Diploma 2026' });
  await expect(card.getByTestId('join-code')).toHaveText(code);
  await expect(card.getByRole('button', { name: 'Download QR code (PNG)' })).toBeVisible();
  // the coordinator's QR download (it once did nothing): <org>_<group>_QR.png, decodes to the join link
  const qrFile = await saved(c, () => card.getByRole('button', { name: 'Download QR code (PNG)' }).click(), '.png');
  expect(qrFile.name).toBe('Govt_Polytechnic_Nellore_Diploma_2026_QR.png');
  const qr = await readQrPng(qrFile.bytes);
  expect(qr.width).toBeGreaterThanOrEqual(1024);
  expect(qr.text).toBe(`${new URL(c.url()).origin}/join/${code}`);
  // the used invite link no longer works
  await c.goto(new URL(inviteUrl).pathname);
  await expect(c.getByRole('heading', { name: 'This invite doesn’t work' })).toBeVisible();

  // 3. a student joins the group (waits for approval)
  const student = email('student2');
  seed('customer', student, 'Ravi Teja', PASSWORD);
  const sctx = await browser.newContext();
  const s = await sctx.newPage();
  await login(s, student);
  await s.waitForURL('**/me');
  await s.goto(`/join/${code}`);
  await expect(s.getByText('checks new members before their resume is shared')).toBeVisible();
  await s.getByRole('checkbox', { name: /My resume will be shared/ }).check();
  await s.getByLabel('Roll number').fill('D26-014');
  await s.getByRole('button', { name: /Join and/ }).click();
  await s.waitForURL(/\/(builder|me\/groups)$/);
  await s.goto('/me/groups');
  await expect(s.getByTestId('group-status')).toHaveText('Pending approval');

  // 4. the coordinator approves them
  await c.goto(portalUrl);
  await c.getByRole('navigation', { name: 'Organization' }).getByRole('link', { name: 'Shared resumes' }).click();
  await expect(c).toHaveTitle('Shared resumes · Govt Polytechnic Nellore · Nm7');
  await expect(c.getByText('No shared resumes yet.', { exact: false })).toBeVisible(); // pending: hidden by default
  await c.getByLabel('Approval').selectOption('pending');
  const table = c.getByRole('table', { name: 'Shared resumes' });
  const row = table.getByRole('row').filter({ hasText: 'Ravi Teja' });
  await expect(row.getByTestId('status')).toHaveText('Pending');
  await row.getByRole('checkbox').check();
  await c.getByRole('button', { name: 'Approve', exact: true }).click();
  await expect(c.getByText('Approved · 1')).toBeVisible();
  await c.getByLabel('Approval').selectOption('approved');
  await expect(row).toContainText('D26-014');
  await s.reload();
  await expect(s.getByTestId('group-status')).toHaveText('Approved');

  // 5. remind the incomplete ones from the group dashboard
  await c.getByRole('navigation', { name: 'Organization' }).getByRole('link', { name: 'My groups' }).click();
  await card.getByRole('link', { name: 'Dashboard' }).click();
  await expect(c.getByRole('heading', { name: 'Diploma 2026' })).toBeVisible();
  await expect(c).toHaveTitle('Diploma 2026 dashboard · Nm7');
  await expect(c.getByRole('link', { name: 'Joined: 1' })).toBeVisible();
  await expect(c.getByRole('region', { name: 'Incomplete members' })).toContainText('Ravi Teja');
  await c.getByRole('button', { name: 'Remind incomplete' }).click();
  await c.getByLabel('Your note (optional)').fill('Drive on Friday — finish by Thursday.');
  await c.getByRole('button', { name: 'Send reminder' }).click();
  await expect(c.getByText('Sent 1')).toBeVisible();
  const mail = emailsTo(student).find((m) => m.includes('Reminder from Govt Polytechnic Nellore'));
  expect(mail).toContain('Drive on Friday — finish by Thursday.');
  expect(mail).toContain('/builder');
  expect(mail).toContain('/groups/stop?t=');
  // again right away: skipped (one reminder per member per day)
  await c.getByRole('button', { name: 'Remind incomplete' }).click();
  await c.getByRole('button', { name: 'Send reminder' }).click();
  await expect(c.getByText('Sent 0, skipped 1: 1 reminded in the last 24 h')).toBeVisible();

  // 6. export: combined PDF (cover + resume) and CSV
  await c.getByRole('link', { name: 'Open the table' }).click();
  await expect(c).toHaveTitle('Shared resumes · Govt Polytechnic Nellore · Nm7');
  await expect(c.getByTestId('export-note')).toHaveText('Exports include approved members only. Combined PDF and ZIP mark those resumes as printed. Exports never include ID numbers.');
  const pdf = await saved(c, () => c.getByRole('button', { name: 'Combined PDF' }).click(), '.pdf');
  expect((await PDFDocument.load(pdf.bytes)).getPageCount()).toBeGreaterThanOrEqual(2);
  const csv = await saved(c, () => c.getByRole('button', { name: 'CSV' }).click(), '.csv');
  expect(csv.bytes.toString('utf8')).toContain('Ravi Teja');
  expect(csv.bytes.toString('utf8')).toContain('D26-014');

  // 7. the activity log shows the coordinator's actions; the admin sees them too
  await c.getByRole('navigation', { name: 'Organization' }).getByRole('link', { name: 'Activity' }).click();
  await expect(c).toHaveTitle('Activity · Govt Polytechnic Nellore · Nm7');
  const log = c.getByRole('region', { name: 'Audit log' });
  for (const a of ['approve', 'remind', 'print_bulk', 'export_csv', 'staff_accept']) await expect(log.getByText(a, { exact: true }).first()).toBeVisible();
  await adminNav.getByRole('link', { name: 'Shared resumes' }).click();
  await adminNav.getByRole('link', { name: 'Organizations' }).click();
  await expect(page.getByRole('region', { name: 'Audit log' }).getByText('remind', { exact: true }).first()).toBeVisible();

  // 8. removed: access ends at once
  await page.getByRole('button', { name: 'Govt Polytechnic Nellore' }).click();
  page.once('dialog', (d) => d.accept());
  await page.getByRole('region', { name: 'Coordinators' }).getByRole('button', { name: 'Remove' }).click();
  await expect(page.getByText('Access removed')).toBeVisible();
  await c.reload();
  await expect(c.getByText('You don’t have access to this organization')).toBeVisible();
  // an account that isn't a customer gets "Different account needed" — with that tab title
  const ex = email('expert2');
  seed('expert', ex, 'Ravi Kumar', PASSWORD, 'approved');
  const ectx = await browser.newContext();
  const e = await ectx.newPage();
  await login(e, ex);
  await e.waitForURL('**/expert**');
  await e.goto('/org');
  await expect(e.getByRole('heading', { name: 'Different account needed' })).toBeVisible();
  await expect(e).toHaveTitle('Different account needed · Nm7');
  await ectx.close();
  await cctx.close(); await sctx.close();
});
