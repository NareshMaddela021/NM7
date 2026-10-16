// Nm7 for Organizations (Phase 1) against the real API: the super-admin creates an organization and a group, a new
// person opens the join link, agrees, signs up, answers the group's questions and builds a resume; it shows up in
// Shared resumes, prints as one combined PDF and exports as CSV; after they leave the group it's gone.
import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { PDFDocument } from 'pdf-lib';
import { API, PASSWORD, adminLogin, email, lastCode, seed } from './helpers.mjs';

const api = (page, path) => page.evaluate(async ([base, p]) => (await fetch(`${base}${p}`, { credentials: 'include' })).json(), [API, path]);
async function saved(page, click, ext) {
  const [file] = await Promise.all([page.waitForEvent('download', { timeout: 60_000 }), click()]);
  expect(file.suggestedFilename()).toMatch(new RegExp(`\\${ext}$`));
  return { name: file.suggestedFilename(), bytes: readFileSync(await file.path()) };
}

test('org + group → join link → consent, sign-up, questions, resume → Shared resumes → combined PDF + CSV → leave', async ({ page, browser }) => {
  const owner = email('owner');
  const { secret } = seed('admin', owner, 'owner', PASSWORD);
  const code = `E2E${Date.now().toString(36).slice(-6).toUpperCase()}`;

  // 1. admin: organization and group
  await adminLogin(page, owner, secret);
  await page.getByRole('navigation', { name: 'Admin sections' }).getByRole('link', { name: 'Organizations' }).click();
  await expect(page.getByRole('heading', { name: 'Organizations' })).toBeVisible();
  const newOrg = page.getByRole('form', { name: 'New organization' });
  await newOrg.getByLabel('Organization name').fill('JNTU Anantapur');
  await newOrg.getByLabel('Type').selectOption('college');
  await newOrg.getByLabel('City').fill('Anantapur');
  await newOrg.getByRole('button', { name: 'Add organization' }).click();
  await expect(page.getByRole('heading', { name: 'JNTU Anantapur' })).toBeVisible();
  await page.getByRole('button', { name: 'New group' }).click();
  const form = page.getByRole('form', { name: 'New group' });
  await form.getByLabel('Group name').fill('B.Tech 2026 placements');
  await form.getByLabel('Join code').fill(code);
  await form.getByRole('button', { name: '+ Roll number' }).click();
  await form.getByRole('button', { name: '+ Branch' }).click();
  await form.getByRole('button', { name: 'Save group' }).click();
  await expect(page.getByText('Group created')).toBeVisible();
  const card = page.getByRole('region', { name: 'Group B.Tech 2026 placements' });
  await expect(card.getByTestId('join-code')).toHaveText(code);
  const link = await card.getByTestId('join-link').textContent();
  expect(link).toBe(`http://localhost:5182/join/${code}`);
  await expect(card.getByRole('img', { name: `QR code for ${link}` })).toBeVisible();
  const qr = await saved(page, () => card.getByRole('button', { name: 'Download QR code (PNG)' }).click(), '.png');
  expect(qr.bytes.subarray(1, 4).toString('latin1')).toBe('PNG');

  // 2. a new person opens the join link
  const ctx = await browser.newContext();
  const m = await ctx.newPage();
  await m.goto(link);
  await expect(m.getByRole('heading', { name: 'JNTU Anantapur' })).toBeVisible();
  await expect(m.getByText('B.Tech 2026 placements')).toBeVisible();
  await expect(m.getByText('My resume will be shared with JNTU Anantapur and Nm7 for printing and placement support.')).toBeVisible();
  await m.getByRole('link', { name: 'Create a free account' }).click();
  await expect(m.getByText('Please tick the box to agree first.')).toBeVisible();
  await m.getByRole('checkbox', { name: /My resume will be shared/ }).check();
  await m.getByRole('link', { name: 'Create a free account' }).click();
  await m.waitForURL(`**/signup?next=%2Fjoin%2F${code}`);
  const mail = email('student');
  await m.getByLabel('Full name').fill('Asha Rao');
  await m.getByLabel('Email').fill(mail);
  await m.getByLabel('Mobile (WhatsApp)').fill('98765 43210');
  await m.getByLabel('Password', { exact: true }).fill(PASSWORD);
  await m.getByLabel('Re-type password').fill(PASSWORD);
  await m.getByRole('checkbox', { name: /I agree/ }).check();
  await m.getByRole('button', { name: 'Create account' }).click();
  await expect(m.getByRole('heading', { name: 'Confirm your email' })).toBeVisible();
  await m.getByLabel('6-digit code').fill(lastCode(mail));
  await m.getByRole('button', { name: 'Confirm & continue' }).click();
  await m.waitForURL(`**/join/${code}`);
  await expect(m.getByRole('checkbox', { name: /My resume will be shared/ })).toBeChecked(); // remembered
  await m.getByLabel('Roll number').fill('21A01');
  await m.getByLabel('Branch').selectOption('CSE');
  await m.getByLabel('Resume to share').selectOption({ label: 'Start a new resume' });
  await m.getByRole('button', { name: 'Join and build my resume' }).click();
  await m.waitForURL('**/builder');

  // 3. builds the resume
  await m.evaluate(() => window.history.replaceState({ usr: { open: 'build' }, key: 'x' }, ''));
  await m.reload();
  const preview = m.getByRole('article', { name: 'Resume preview' });
  await expect(preview).toBeVisible();
  await m.getByLabel('Full name').first().fill('Asha Rao');
  await expect(preview).toContainText('Asha Rao');
  await expect.poll(async () => (await api(m, '/api/me/resumes')).find((r) => r.active)?.data?.personal?.name, { timeout: 15_000 }).toBe('Asha Rao');
  const groups = await api(m, '/api/me/groups');
  expect(groups).toHaveLength(1);
  expect(groups[0]).toMatchObject({ code, orgName: 'JNTU Anantapur', fields: { roll_number: '21A01', branch: 'CSE' } });

  // 4. admin: it's in Shared resumes under that group
  await page.getByRole('navigation', { name: 'Admin sections' }).getByRole('link', { name: 'Shared resumes' }).click();
  const table = page.getByRole('table', { name: 'Shared resumes' });
  const row = table.getByRole('row').filter({ hasText: 'Asha Rao' });
  await expect(row).toContainText('B.Tech 2026 placements');
  await expect(row).toContainText('Roll number: 21A01');
  await expect(row).toContainText('Not yet');
  await page.getByLabel('Organization').selectOption({ label: 'JNTU Anantapur' });
  await page.getByLabel('Group').selectOption({ label: 'B.Tech 2026 placements' });
  await expect(page.getByText('1 shared resume · page 1 of 1')).toBeVisible();
  await row.getByRole('button', { name: 'View' }).click();
  const dlg = page.getByRole('dialog', { name: 'Asha Rao · B.Tech 2026 placements' });
  await expect(dlg.getByRole('article', { name: 'Resume preview' })).toContainText('Asha Rao');
  await dlg.getByRole('button', { name: /Close/ }).first().click();

  // combined PDF: cover page + the resume's pages, and the row is marked printed
  const pdf = await saved(page, () => page.getByRole('button', { name: 'Combined PDF' }).click(), '.pdf');
  expect(pdf.name).toMatch(/^Nm7_resumes_\d{4}-\d\d-\d\d\.pdf$/);
  expect((await PDFDocument.load(pdf.bytes)).getPageCount()).toBe(2);
  await expect(page.getByText(/Combined PDF ready · 1 resumes · 2 pages/)).toBeVisible();
  await expect(row).not.toContainText('Not yet');

  // CSV
  const csv = await saved(page, () => page.getByRole('button', { name: 'CSV' }).click(), '.csv');
  const text = csv.bytes.toString('utf8');
  expect(text).toContain('Name,Email,Phone,Organization,Group,Roll number,Branch,Completeness %,Approval,Review,Last updated,Printed');
  expect(text).toContain(`Asha Rao,${mail}`);
  expect(text).toContain('JNTU Anantapur,B.Tech 2026 placements,21A01,CSE');

  // audit log lists the print and the export
  await page.getByRole('navigation', { name: 'Admin sections' }).getByRole('link', { name: 'Organizations' }).click();
  const audit = page.getByRole('region', { name: 'Audit log' });
  await expect(audit.getByText('print_bulk')).toBeVisible();
  await expect(audit.getByText('export_csv')).toBeVisible();

  // 5. the member leaves the group → gone from Shared resumes
  await m.goto('/me/groups');
  await expect(m.getByRole('region', { name: 'B.Tech 2026 placements' })).toContainText('JNTU Anantapur');
  m.once('dialog', (d) => d.accept());
  await m.getByRole('button', { name: 'Leave group' }).click();
  await expect(m.getByText('You left the group')).toBeVisible();
  await expect(m.getByText('You’re not in any group yet.', { exact: false })).toBeVisible();
  await page.getByRole('navigation', { name: 'Admin sections' }).getByRole('link', { name: 'Shared resumes' }).click();
  await expect(page.getByText(/No shared resumes yet/)).toBeVisible();
  await ctx.close();
});

test('a wrong join code says so clearly', async ({ page }) => {
  await page.goto('/join/NOSUCH99');
  await expect(page.getByRole('heading', { name: 'This join link doesn’t work' })).toBeVisible();
  await expect(page.getByText('This join code doesn’t exist. Please check it with your organizer.')).toBeVisible();
});
