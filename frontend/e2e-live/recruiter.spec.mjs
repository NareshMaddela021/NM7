// Recruiter share links (Phase 3C) against the real API: Nm7 switches recruiter links on and the group shares with
// recruiters; one member opts in from My groups, another never does. The admin makes a link from Shared resumes:
// only the opted-in member is on it. The recruiter (no account) views, downloads a PDF with the "Shared with …"
// footer and ticks Interested; the organization sees "Shortlisted by"; after a revoke the link says it has expired.
import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { PASSWORD, adminLogin, apiMember, email, login, pdfText, seed } from './helpers.mjs';

test('recruiter link: opt-in → create link → recruiter view, download, shortlist → revoke', async ({ page, browser, playwright }) => {
  const owner = email('owner5');
  const { secret } = seed('admin', owner, 'owner', PASSWORD);
  const code = `RL${Date.now().toString(36).slice(-6).toUpperCase()}`;
  const orgName = `Placement Cell ${code}`;

  // 1. Nm7: organization, group with a question, recruiter links on, group shares with recruiters
  await adminLogin(page, owner, secret);
  const nav = page.getByRole('navigation', { name: 'Admin sections' });
  await nav.getByRole('link', { name: 'Organizations' }).click();
  const newOrg = page.getByRole('form', { name: 'New organization' });
  await newOrg.getByLabel('Organization name').fill(orgName);
  await newOrg.getByRole('button', { name: 'Add organization' }).click();
  await page.getByRole('button', { name: 'New group' }).click();
  const form = page.getByRole('form', { name: 'New group' });
  await form.getByLabel('Group name').fill('MBA 2026');
  await form.getByLabel('Join code').fill(code);
  await form.getByRole('button', { name: '+ Roll number' }).click();
  await form.getByRole('button', { name: 'Save group' }).click();
  const group = page.getByRole('region', { name: 'Group MBA 2026' });
  await expect(group).toBeVisible();
  const sw = page.getByRole('region', { name: 'Features' }).getByRole('checkbox', { name: /Recruiter links/ });
  await sw.click();
  await expect(sw).toBeChecked();
  await group.getByRole('button', { name: 'Edit' }).click();
  await group.getByLabel(/Share with recruiters/).check();
  await group.getByRole('button', { name: 'Save group' }).click();
  await expect(group).toContainText('recruiter sharing');

  // 2. two members; only one allows sharing (from My groups), the other never ticks it
  const yes = email('rl-yes');
  const no = email('rl-no');
  const yesApi = (await apiMember(playwright, yes, 'Kavya Reddy', code, { roll_number: 'MBA-07' })).api;
  const noApi = (await apiMember(playwright, no, 'Arjun Das', code, { roll_number: 'MBA-08' })).api;
  const mctx = await browser.newContext();
  const m = await mctx.newPage();
  await login(m, yes);
  await m.waitForURL(/\/me/);
  await m.goto('/me/groups');
  const optIn = m.getByRole('checkbox', { name: `Allow ${orgName} to share my resume with recruiters` });
  await expect(optIn).not.toBeChecked(); // never assumed
  await optIn.click();
  await expect(m.getByText('Recruiters can see your resume when shared')).toBeVisible();
  await expect(optIn).toBeChecked();

  // 3. the admin makes a link from Shared resumes (for this organization)
  await nav.getByRole('link', { name: 'Shared resumes' }).click();
  await page.getByLabel('Organization').selectOption({ label: orgName });
  await expect(page.getByRole('row', { name: new RegExp(no) })).toBeVisible();
  await page.getByRole('button', { name: 'Share with a recruiter…' }).click();
  const share = page.getByRole('form', { name: 'Share with a recruiter' });
  await share.getByLabel('Company').fill('Acme Hiring');
  await share.getByLabel('Roll number').check();
  await share.getByRole('button', { name: 'Make link' }).click();
  await expect(page.getByText(/1 resume \(1 left out/)).toBeVisible();
  const url = await page.getByTestId('recruiter-url').textContent();
  await page.getByRole('button', { name: 'Done' }).click();

  // 4. the recruiter: no account, only the opted-in member, no contact details; view, download, interested
  const rctx = await browser.newContext({ acceptDownloads: true });
  const r = await rctx.newPage();
  await r.goto(new URL(url).pathname);
  await expect(r.getByRole('heading', { name: 'Resumes shared with Acme Hiring' })).toBeVisible();
  await expect(r).toHaveTitle('Resumes shared with Acme Hiring · Nm7');
  const rows = r.getByTestId('candidate');
  await expect(rows).toHaveCount(1);
  await expect(rows.first()).toContainText('Kavya Reddy');
  await expect(rows.first()).toContainText('MBA-07');
  await expect(r.getByText(yes)).toHaveCount(0); // contact details hidden by default
  await rows.first().getByRole('button', { name: 'View' }).click();
  await expect(r.getByRole('dialog').getByTestId('page-foot')).toContainText('Shared with Acme Hiring via Nm7 · expires');
  await r.getByRole('dialog').getByRole('button', { name: 'Close' }).click();
  const [file] = await Promise.all([r.waitForEvent('download', { timeout: 60_000 }), rows.first().getByRole('button', { name: 'Download' }).click()]);
  expect(file.suggestedFilename()).toBe('Kavya_Reddy_Resume.pdf');
  const text = (await pdfText(readFileSync(await file.path()))).join(' ');
  expect(text).toContain('Kavya Reddy');
  expect(text).toContain('Shared with Acme Hiring via Nm7 · expires');
  expect(text).not.toContain(yes);
  const interested = rows.first().getByRole('checkbox', { name: 'Interested in Kavya Reddy' });
  await interested.click();
  await expect(interested).toBeChecked();

  // 5. the organization sees the shortlist
  await page.reload();
  const short = page.getByLabel('Shortlisted by');
  await expect(short.locator('option', { hasText: 'Acme Hiring' })).toHaveCount(1);
  await short.selectOption({ label: 'Acme Hiring' });
  await expect(page.getByRole('row', { name: new RegExp(yes) }).getByTestId('shortlisted')).toHaveText('Shortlisted by Acme Hiring');
  await expect(page.getByRole('row', { name: new RegExp(no) })).toHaveCount(0);

  // 6. opting out removes her at once; opting back in returns her; revoke ends the link
  await optIn.click();
  await expect(m.getByText('Removed from recruiter links')).toBeVisible();
  await r.reload();
  await expect(r.getByText('No candidates on this link right now.')).toBeVisible();
  await nav.getByRole('link', { name: 'Organizations' }).click();
  await page.getByRole('button', { name: orgName }).click();
  const links = page.getByRole('region', { name: 'Recruiter links' });
  const link = links.getByTestId('recruiter-link').first();
  await expect(link).toContainText('Acme Hiring');
  await expect(link).toContainText('1 shortlisted');
  page.once('dialog', (d) => d.accept());
  await link.getByRole('button', { name: 'Revoke' }).click();
  await expect(link).toContainText('Revoked');
  await r.reload();
  await expect(r.getByRole('heading', { name: 'This link has expired' })).toBeVisible();
  await Promise.all([yesApi.dispose(), noApi.dispose(), mctx.close(), rctx.close()]);
});
