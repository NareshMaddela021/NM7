// Profile setup P1: each role's quick start and first results page, on a desktop and a 390 px phone, against the real API:
//   - a new job seeker signs up -> "What would you like to do?" -> 4 questions, one per screen (one skipped), a reload
//     half-way picks up at the same step -> "Jobs matched for you" with a matching job; the next role (student) follows;
//   - a fresher is asked college, course and passing year instead (they land in the Job Profile) and gets the
//     practice papers;
//   - a student: college, course + year, looking for, the under-18 parent step (Vetting Trust tester) ->
//     "Internships and projects for you";
//   - an expert: expertise, years, services -> "Your expert application", pending approval;
//   - an existing user with data is not asked again (answered steps passed; everything answered -> the results);
//   - "Browse jobs" leaves the quick start at any step; nothing scrolls sideways; well under 5 minutes to results.
// Desktop and phone share one database: every test uses its own people, job titles and cities.
import { expect, test } from '@playwright/test';
import { PASSWORD, email, lastCode, login, seed } from './helpers.mjs';
import { SIZES, call, json, noSideScroll } from './college.mjs';

const DESC = 'Build weekly dashboards in SQL and Power BI for our stores. Training is given; we answer every applicant.';
const yearsAgo = (n) => { const d = new Date(); d.setFullYear(d.getFullYear() - n); return d.toISOString().slice(0, 10); };
const step = (page) => page.getByTestId('qs-step');
async function atStep(page, key) {
  await expect(step(page)).toHaveAttribute('data-step', key);
  await expect(page.getByTestId('qs-reward')).toBeVisible(); // each screen says what it gives
  expect(await noSideScroll(page)).toBe(true);
}
const cont = (page) => step(page).getByTestId('qs-continue');

async function signUp(page, mail, name) {
  await page.goto('/signup');
  await page.getByLabel('Full name').fill(name);
  await page.getByLabel('Email').fill(mail);
  await page.getByLabel('Password', { exact: true }).fill(PASSWORD);
  await page.getByLabel('Re-type password').fill(PASSWORD);
  await page.getByRole('checkbox', { name: /I agree/ }).check();
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page.getByRole('heading', { name: 'Confirm your email' })).toBeVisible();
  await page.getByLabel('6-digit code').fill(lastCode(mail));
  await page.getByRole('button', { name: 'Confirm & continue' }).click();
  await page.waitForURL(/\/welcome/);
}
async function seeded(page, who, roles = []) {
  const mail = email(who);
  seed('customer', mail, 'Kiran Rao', PASSWORD);
  await login(page, mail);
  await page.waitForURL(/\/me$/);
  if (roles.length) {
    const r = await call(page, '/api/auth/roles', json('POST', { add: roles, active: roles[0], expertTerms: roles.includes('expert') }));
    expect(r.status).toBe(200);
  }
  return mail;
}

for (const [label, opts] of SIZES) {
  test.describe(label, () => {
    test.use(opts);

    test('new job seeker: picker -> 4 questions (one skipped, a reload) -> Jobs matched for you -> next role', async ({ page }) => {
      const tag = `${label}${Date.now().toString(36)}`;
      const title = `Quickstart Analyst ${tag}`;
      seed('job', JSON.stringify({ title, description: DESC, experience: '1_3', applyMethod: 'link', applyUrl: 'https://qsco.example/jobs', company: { name: `Qsco ${tag}` }, locations: ['Visakhapatnam'], skills: ['SQL'] }));
      const t0 = Date.now();
      const mail = email(`qs-new-${label}`);
      await signUp(page, mail, 'Asha Quick');
      await page.getByRole('checkbox', { name: /Find a job/ }).check();
      await page.getByRole('checkbox', { name: /I’m a student/ }).check();
      await page.getByRole('button', { name: 'Continue' }).click();
      await page.waitForURL('**/start/jobseeker');

      // Q1: the job wanted, with suggestions
      await atStep(page, 'job');
      await expect(page.getByRole('heading', { level: 1, name: 'What job do you want?' })).toBeVisible();
      await expect(page.getByTestId('qs-reward')).toHaveText(/So we show jobs that match it/);
      await expect(page.getByTestId('qs-browse')).toBeVisible();
      await expect(page.getByTestId('qs-progress')).toContainText('step 1 of 4');
      await page.getByLabel('Job title').fill(title);
      await cont(page).click();

      // Q2: saved at once — a reload picks up here
      await atStep(page, 'city');
      await expect(page.getByTestId('qs-saved')).toHaveText('Saved');
      await page.reload();
      await atStep(page, 'city');
      await expect(page.getByRole('button', { name: 'Visakhapatnam' })).toHaveAttribute('aria-pressed', 'false');
      await page.getByRole('button', { name: 'Visakhapatnam' }).click();
      await expect(page.getByRole('button', { name: 'Visakhapatnam' })).toHaveAttribute('aria-pressed', 'true');
      await cont(page).click();

      // Q3: one tap
      await atStep(page, 'experience');
      await page.getByRole('button', { name: '1–3 years' }).click();

      // Q4: fill faster — skipped
      await atStep(page, 'faster');
      await expect(step(page).getByText('Upload my LinkedIn PDF')).toBeVisible(); // the existing "Fill your profile faster"
      await page.getByTestId('qs-skip').click();

      await page.waitForURL('**/start/jobseeker/results');
      await expect(page.getByRole('heading', { level: 1, name: 'Jobs matched for you' })).toBeVisible();
      await expect(page.getByTestId('qs-jobs').getByRole('link', { name: title })).toBeVisible();
      expect(await noSideScroll(page)).toBe(true);
      expect(Date.now() - t0).toBeLessThan(5 * 60_000);
      const s = (await call(page, '/api/me/setup')).body.setup;
      expect(s.jobseeker).toMatchObject({ done: true, skipped: ['faster'] });
      expect(s.jobseeker.answers).toMatchObject({ job: title, cities: ['Visakhapatnam'], experience: '1_3' });
      const me = (await call(page, '/api/me/profile')).body;
      expect(me).toMatchObject({ targetRole: title, cities: 'Visakhapatnam', level: '1–3 years' });

      // the other role picked: its own quick start, once
      await page.getByTestId('qs-next-role').click();
      await page.waitForURL('**/start/student');
      await atStep(page, 'college');
      // a reload of the finished one goes straight to its results
      await page.goto('/start/jobseeker');
      await page.waitForURL('**/start/jobseeker/results');
    });

    test('fresher: college, course and passing year instead, into the Job Profile; practice papers', async ({ page }) => {
      await seeded(page, `qs-fresh-${label}`);
      await page.goto('/start/jobseeker');
      await atStep(page, 'job');
      await page.getByTestId('qs-skip').click();
      await atStep(page, 'city');
      await page.getByRole('button', { name: 'Remote / work from home' }).click();
      await cont(page).click();
      await atStep(page, 'experience');
      await page.getByRole('button', { name: 'Fresher' }).click();
      await atStep(page, 'college');
      await expect(page.getByTestId('qs-progress')).toContainText('step 4 of 6');
      await page.getByLabel('College name').fill(`Lakeview Institute ${label}`);
      await cont(page).click();
      await atStep(page, 'course');
      await page.getByRole('button', { name: 'B.Tech', exact: true }).click();
      await expect(page.getByRole('textbox', { name: 'Course' })).toHaveValue('B.Tech');
      const year = String(new Date().getFullYear());
      await page.getByRole('button', { name: year, exact: true }).click();
      await cont(page).click();
      await atStep(page, 'faster');
      await page.getByTestId('qs-skip').click();
      await page.waitForURL('**/start/jobseeker/results');
      await expect(page.getByTestId('qs-papers')).toContainText('Fresher practice papers');
      const jp = (await call(page, '/api/me/job-profile')).body.data;
      expect(jp.edu[0]).toMatchObject({ institution: `Lakeview Institute ${label}`, degree: 'B.Tech', to: `${year}-05` });
      await page.getByTestId('qs-papers').click();
      await page.waitForURL('**/me/practice');
    });

    test('student: college, course, looking for, the under-18 parent step -> Internships and projects', async ({ page }) => {
      const mail = await seeded(page, `qs-stu-${label}`, ['student']);
      seed('trust-tester', mail);
      await page.goto('/start/student');
      await atStep(page, 'college');
      await expect(page.getByTestId('qs-progress')).toContainText('step 1 of 5');
      await page.getByLabel('College name').fill('Govt Junior College');
      await cont(page).click();
      await atStep(page, 'course');
      await page.getByRole('textbox', { name: 'Course' }).fill('Intermediate MPC');
      await cont(page).click();
      await atStep(page, 'looking');
      await page.getByRole('button', { name: 'An internship' }).click();
      await page.getByRole('button', { name: 'A live project' }).click();
      await cont(page).click();
      await atStep(page, 'age');
      await page.getByTestId('tc-dob').fill(yearsAgo(16));
      await page.getByTestId('tc-age-save').click();
      await expect(page.getByTestId('tc-parent-state')).toContainText('under 18');
      expect(await noSideScroll(page)).toBe(true);
      await page.getByTestId('tc-parent-email').fill(email(`qs-parent-${label}`));
      await page.getByTestId('tc-parent-send').click();
      await expect(page.getByTestId('tc-parent-state')).toContainText('We sent a link');
      await cont(page).click();
      await atStep(page, 'faster');
      await page.getByTestId('qs-skip').click();
      await page.waitForURL('**/start/student/results');
      await expect(page.getByRole('heading', { level: 1, name: 'Internships and projects for you' })).toBeVisible();
      await expect(page.getByTestId('qs-parent-wait')).toBeVisible();
      await expect(page.getByTestId('qs-tile-learn')).toBeVisible();
      expect(await noSideScroll(page)).toBe(true);
      const s = (await call(page, '/api/me/setup/student')).body;
      expect(s).toMatchObject({ done: true, answers: { college: 'Govt Junior College', course: 'Intermediate MPC', looking: ['internship', 'live_project'], age: 'parent_asked' } });
    });

    test('expert: expertise, years, services -> Your expert application, pending approval', async ({ page }) => {
      await seeded(page, `qs-exp-${label}`, ['expert']);
      await page.goto('/start/expert');
      await atStep(page, 'expertise');
      await page.getByRole('button', { name: 'Finance' }).click();
      await page.getByRole('button', { name: 'Sales' }).click();
      await cont(page).click();
      await atStep(page, 'years');
      await page.getByRole('button', { name: '8–12 years' }).click();
      await atStep(page, 'services');
      await expect(page.getByRole('button', { name: /L4/ })).toHaveCount(0); // the vetting engine is off for them
      await page.getByRole('button', { name: 'Mock interview' }).click();
      await cont(page).click();
      await atStep(page, 'faster');
      await expect(page.getByTestId('qs-expert-faster')).toBeVisible();
      await page.getByTestId('qs-skip').click();
      await page.waitForURL('**/start/expert/results');
      await expect(page.getByRole('heading', { level: 1, name: 'Your expert application' })).toBeVisible();
      await expect(page.getByTestId('qs-expert-status')).toHaveText('Pending approval');
      expect(await noSideScroll(page)).toBe(true);
      await page.getByTestId('qs-expert-continue').click();
      await page.waitForURL('**/expert/profile');
      const prof = (await call(page, '/api/expert/profile')).body;
      expect(prof).toMatchObject({ status: 'draft', expertise: { domains: ['Finance', 'Sales'] } });
    });

    test('an existing user is never asked again for what they have', async ({ page }) => {
      await seeded(page, `qs-old-${label}`);
      expect((await call(page, '/api/me/profile', json('PATCH', { targetRole: 'Store manager', cities: 'Nagpur', level: '5–8 years' }))).status).toBe(200);
      await page.goto('/start/jobseeker');
      await atStep(page, 'faster'); // job, city and experience come from the profile
      await expect(page.getByTestId('qs-progress')).toContainText('step 4 of 4');
      // with work in the Job Profile too, everything is answered: straight to the results
      const cur = (await call(page, '/api/me/job-profile')).body;
      const data = { ...cur.data, exp: [{ company: 'Old Co', role: 'Store manager', from: '2018-01', to: '', current: true, pid: 'x1' }] };
      expect((await call(page, '/api/me/job-profile', json('PUT', { data, version: cur.version }))).status).toBe(200);
      await page.goto('/start/jobseeker');
      await page.waitForURL('**/start/jobseeker/results');
      await expect(page.getByRole('heading', { level: 1, name: 'Jobs matched for you' })).toBeVisible();
      // "Change my answers" goes through every step, pre-filled
      await page.getByTestId('qs-change').click();
      await atStep(page, 'job');
      await expect(page.getByLabel('Job title')).toHaveValue('Store manager');
      await expect(page.getByTestId('qs-prefilled')).toBeVisible();
      // the profile fields were never changed
      expect((await call(page, '/api/me/profile')).body).toMatchObject({ targetRole: 'Store manager', cities: 'Nagpur', level: '5–8 years' });
    });

    test('"Browse jobs" leaves the quick start at any step', async ({ page }) => {
      await seeded(page, `qs-browse-${label}`);
      await page.goto('/start/jobseeker');
      await atStep(page, 'job');
      await page.getByTestId('qs-skip').click();
      await atStep(page, 'city');
      await page.getByTestId('qs-browse').click();
      await page.waitForURL('**/jobs');
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
      expect(await noSideScroll(page)).toBe(true);
      // and back later: the same step
      await page.goto('/me');
      await expect(page.getByTestId('qs-resume-card')).toContainText('Pick up where you left off');
      await page.getByTestId('qs-resume-card').getByRole('link', { name: 'Continue' }).click();
      await page.waitForURL('**/start/jobseeker');
      await atStep(page, 'city');
    });
  });
}
