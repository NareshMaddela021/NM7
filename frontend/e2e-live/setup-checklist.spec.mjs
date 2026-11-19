// Profile setup P2: the dashboard checklist, on a desktop and a 390 px phone, against the real API:
//   - a new job seeker after the quick start sees the card at the top of the dashboard with the right next step
//     (a progress ring and one "Next step" button; on the phone the card stays compact);
//   - finishing a step (job preferences in Ready to join) ticks it by itself; "Skip for now" moves on;
//   - an expert who submitted the application sees "Waiting for review";
//   - an existing user with data sees those steps ticked (nothing asked again);
//   - when every required step is done the card shrinks to "Profile complete";
//   - nothing scrolls sideways.
// Desktop and phone share one database: every test uses its own people.
import { expect, test } from '@playwright/test';
import { PASSWORD, email, login, seed } from './helpers.mjs';
import { SIZES, call, json, noSideScroll } from './college.mjs';

async function seeded(page, who, roles = []) {
  const mail = email(who);
  seed('customer', mail, 'Kiran Rao', PASSWORD);
  if (roles.length) {
    await login(page, mail);
    await page.waitForURL(/\/me$/);
    const r = await call(page, '/api/auth/roles', json('POST', { add: roles, active: roles[0], expertTerms: roles.includes('expert') }));
    expect(r.status).toBe(200);
  }
  return mail;
}
// The dashboard reads the checklist through a short server cache; after a change made through the API (not through a
// step's page, which does this itself) the next read asks for a fresh one.
const fresh = (page) => page.evaluate(() => sessionStorage.setItem('nm7-sc-fresh', '1'));
const card = (page) => page.getByTestId('sc-card');
const row = (page, id) => page.locator(`[data-testid="sc-row"][data-step="${id}"]`);
async function openAll(page) {
  const t = page.getByTestId('sc-toggle');
  if ((await t.getAttribute('aria-expanded')) !== 'true') await t.click();
  await expect(page.getByTestId('sc-list')).toBeVisible();
}
async function hirePrefs(page) {
  const r = await call(page, '/api/me/hire', json('PUT', { on: false, consent: false, cities: ['Nellore'], remote: false, salary: { amount: 25000, unit: 'month' }, noticeDays: 15, jobTypes: ['full_time'] }));
  expect(r.status).toBe(200);
}

for (const [label, opts] of SIZES) {
  test.describe(label, () => {
    test.use(opts);

    test('new job seeker after the quick start: next step, finishing it ticks it, Skip for now moves on', async ({ page }) => {
      await seeded(page, `sc-new-${label}`, ['jobseeker']);
      const r = await call(page, '/api/me/setup/jobseeker', json('PUT', { answers: { job: 'Store manager', remote: true, experience: '1_3' }, skip: ['faster'], step: 'results', done: true }));
      expect(r.status).toBe(200);
      await page.goto('/me');
      await expect(card(page)).toBeVisible();
      await expect(page.getByTestId('sc-ring')).toHaveAttribute('aria-label', /^0 of \d steps done$/);
      await expect(page.getByTestId('sc-next-title')).toHaveText('Add your job preferences');
      await expect(page.getByTestId('sc-next')).toHaveText('Next step');
      if (label === 'phone') {
        await expect(page.getByTestId('sc-skip')).toBeHidden(); // compact: the ring and one button
        const box = await page.getByTestId('sc-next').boundingBox();
        expect(box.height).toBeGreaterThanOrEqual(44);
      }
      expect(await noSideScroll(page)).toBe(true);

      // Next step → Ready to join → save salary, notice and city → back on the dashboard it is ticked
      await page.getByTestId('sc-next').click();
      await page.waitForURL('**/me/hire');
      await page.getByLabel('Notice period (days)').fill('30');
      await page.getByLabel('Cities you can work in (comma between)').fill('Nellore');
      await page.getByLabel('Expected salary').fill('22000');
      await page.getByTestId('hire-consent').check();
      await page.getByTestId('hire-save').click();
      await expect(page.getByTestId('hire-badge')).toBeVisible();
      await expect(page.getByTestId('hire-badge')).not.toHaveText('Off');
      await page.goto('/me');
      await expect(page.getByTestId('sc-next-title')).toHaveText('Get your resume to an ATS score of 60+');
      await openAll(page);
      await expect(row(page, 'preferences')).toHaveAttribute('data-status', 'done');
      await expect(row(page, 'resume')).toHaveAttribute('data-status', 'next');
      await expect(row(page, 'resume')).toContainText('About 10 min');
      expect(await noSideScroll(page)).toBe(true);

      // Skip for now: the next one is offered
      await row(page, 'resume').getByTestId('sc-row-skip').click();
      await expect(page.getByTestId('sc-next-title')).toHaveText('Turn on Auto Apply');
      await expect(row(page, 'resume')).toHaveAttribute('data-status', 'later');
      await expect(row(page, 'resume')).toContainText('Skipped');
    });

    test('expert: after submitting, the application waits for review', async ({ page }) => {
      await seeded(page, `sc-exp-${label}`, ['expert']);
      const profile = {
        about: { name: 'Kiran Rao', headline: 'Senior recruiter · 8 years', bio: 'I have hired for retail and IT teams for eight years and reviewed hundreds of resumes for freshers and early-career people across India. I explain every change in plain words.', city: 'Pune', languages: ['English'] },
        photo: 'data:image/png;base64,iVBORw0KGgo=',
        expertise: { domains: ['Sales'], roles: 'Sales executive', levels: ['fresher'] },
        proof: { experience: [{ role: 'Recruiter', company: 'Acme' }], certs: [], linkedin: '', recruiterYears: '8', resumesWritten: '300+' },
        samples: [], services: { plans: ['expert'], perWeek: 5, rush: false, paused: false },
        payout: { method: 'upi', upi: 'kiran@okhdfcbank', bankName: '', account: '', ifsc: '', pan: 'ABCDE1234F', reuseAi: false },
        agree: true,
      };
      expect((await call(page, '/api/expert/profile', json('PUT', profile))).status).toBe(200);
      await page.goto('/expert/profile');
      await expect(page.getByTestId('sc-next-title')).toHaveText('Submit your application for approval');
      expect((await call(page, '/api/expert/profile/submit', { method: 'POST' })).status).toBe(200);
      await fresh(page);
      await page.reload();
      await expect(card(page)).toBeVisible();
      await expect(page.getByTestId('sc-waiting')).toContainText('Waiting for review');
      await expect(page.getByTestId('sc-waiting')).toContainText('You can use your other roles while you wait.');
      await openAll(page);
      await expect(row(page, 'submit')).toHaveAttribute('data-status', 'waiting');
      await expect(row(page, 'profile')).toHaveAttribute('data-status', 'done');
      expect(await noSideScroll(page)).toBe(true);
    });

    test('existing user with data: those steps are ticked; all done → Profile complete', async ({ page }) => {
      const mail = await seeded(page, `sc-old-${label}`);
      seed('vetting-tester', mail);
      seed('skill-verified', mail, 'SQL', '1-3', '84', '86');
      seed('strong-resume', mail);
      await login(page, mail);
      await page.waitForURL(/\/me$/);
      await hirePrefs(page);
      await fresh(page);
      await page.reload();
      await expect(card(page)).toBeVisible();
      await openAll(page);
      for (const id of ['preferences', 'resume', 'skill']) await expect(row(page, id)).toHaveAttribute('data-status', 'done');
      await expect(page.getByTestId('sc-next-title')).toHaveText('Take the AI interview');
      expect(await noSideScroll(page)).toBe(true);

      // the rest done → the card shrinks to "Profile complete"
      const aa = await call(page, '/api/me/auto-apply', json('PUT', { roles: ['Data analyst'], consent: true }));
      expect(aa.status).toBe(200);
      seed('setup-l3', mail);
      await fresh(page);
      await page.reload();
      await expect(page.getByTestId('sc-complete')).toBeVisible();
      await expect(page.getByTestId('sc-complete-text')).toHaveText(/^Profile complete/);
      await expect(card(page)).toHaveCount(0);
      expect(await noSideScroll(page)).toBe(true);
    });
  });
}
