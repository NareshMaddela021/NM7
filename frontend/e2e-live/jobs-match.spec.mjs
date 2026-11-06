// The match score on the job board (J4) on a desktop and a 390 px phone: signed out and without a resume people are
// told how to see it; with a resume every card shows "N% match" and plain reasons (skills, experience, city), the job
// page shows what's on the resume and what's missing, "Best match" sorts by score, and a changed resume changes the
// score. No sideways scrolling.
import { expect, test } from '@playwright/test';
import { API, PASSWORD, email, login, seed } from './helpers.mjs';

const SIZES = [['desktop', { viewport: { width: 1280, height: 900 } }], ['phone', { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true }]];
const DESC = 'Work with our team on real projects. Freshers and final-year students are welcome to apply.';
const RESUME = {
  personal: { name: 'Sai Varsha', headline: 'Data Analyst', email: 'sai@example.com', location: 'Hyderabad, Telangana' },
  summary: 'Final-year student who builds dashboards.',
  skillGroups: [{ id: 'core', label: 'Core', value: 'SQL, Power BI, Python' }],
  proj: [{ title: 'Sales dashboard', tech: 'Power BI, SQL', description: 'Built a sales dashboard in Power BI' }],
  edu: [{ institution: 'Lakeview Institute', degree: 'B.Tech', field: 'Computer Science', from: '2022-08', to: '2026-05' }],
};
const call = (page, path, init = {}) => page.evaluate(async ([base, p, i]) => {
  const r = await fetch(`${base}${p}`, { credentials: 'include', headers: { 'Content-Type': 'application/json' }, ...i });
  return { status: r.status, body: await r.json().catch(() => null) };
}, [API, path, init]);

for (const [label, opts] of SIZES) {
  test.describe(label, () => {
    test.use(opts);

    test('signed out and no-resume prompts; scores with reasons; best match; a new resume rescored', async ({ page }) => {
      test.setTimeout(120_000);
      const tag = `${label}m${Date.now().toString(36)}`;
      const job = (body) => seed('job', JSON.stringify({ description: DESC, company: { name: `Kite ${tag}` }, applyMethod: 'link', ...body }));
      const analyst = job({ title: `BI Analyst ${tag}`, locations: ['Hyderabad'], experience: 'fresher', skills: ['SQL', 'Power BI', 'Snowflake'], applyUrl: `https://kite.example/${tag}/1` });
      job({ title: `Java Engineer ${tag}`, locations: ['Pune'], experience: '3_plus', skills: ['Java', 'Spring'], applyUrl: `https://kite.example/${tag}/2` });
      const wide = async () => expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(opts.viewport.width);

      // signed out: no scores, a prompt to sign in
      await page.goto(`/jobs?q=${tag}`);
      await expect(page.getByTestId('job-card')).toHaveCount(2);
      await expect(page.getByTestId('match-prompt')).toContainText('See how well your resume matches each job.');
      await expect(page.getByTestId('match')).toHaveCount(0);
      await expect(page.getByLabel('Sort')).toHaveCount(0);

      // signed in, no resume yet: a prompt to add one
      const me = email('jm');
      seed('customer', me, 'Sai Varsha', PASSWORD);
      await login(page, me);
      await expect(page).not.toHaveURL(/\/login/);
      await page.goto(`/jobs?q=${tag}`);
      await expect(page.getByTestId('match-prompt')).toContainText('Add your resume to see your match on every job.');

      // with a resume: a score and plain reasons on every card
      expect((await call(page, '/api/me/resumes', { method: 'POST', body: JSON.stringify({ id: 'r1', name: 'Main', data: RESUME, active: true }) })).status).toBe(201);
      await page.reload();
      await expect(page.getByTestId('match-prompt')).toHaveCount(0);
      const bi = page.getByTestId('job-card').filter({ hasText: `BI Analyst ${tag}` });
      await expect(bi.getByTestId('match')).toContainText('80% match');
      await expect(bi.getByTestId('match')).toContainText('Matches 2 of 3 skills · Fresher OK · In Hyderabad');
      await expect(bi.getByTestId('match')).toContainText('Missing: Snowflake');
      const java = page.getByTestId('job-card').filter({ hasText: `Java Engineer ${tag}` });
      await expect(java.getByTestId('match')).toContainText('Asks for 3+ years · Not in your city');
      await expect(page.getByTestId('job-card').first()).toContainText(`Java Engineer ${tag}`); // newest first
      await wide();

      // Best match puts the better fit first
      await page.getByLabel('Sort').selectOption('match');
      await expect(page).toHaveURL(/sort=match/);
      await expect(page.getByTestId('job-card').first()).toContainText(`BI Analyst ${tag}`);

      // the job page: what's on the resume and what's missing
      await page.goto(`/jobs/${analyst.slug}`);
      const box = page.getByTestId('job-match');
      await expect(box).toContainText('Your match: 80% match');
      await expect(box).toContainText('On your resume: SQL, Power BI');
      await expect(box).toContainText('Missing: Snowflake');
      await expect(box).toContainText('No AI guesswork');
      await wide();

      // a changed resume is scored again
      const changed = { ...RESUME, skillGroups: [{ id: 'core', label: 'Core', value: 'SQL, Power BI, Snowflake' }] };
      expect((await call(page, '/api/me/resumes/r1', { method: 'PATCH', body: JSON.stringify({ data: changed }) })).status).toBe(200);
      await page.reload();
      await expect(page.getByTestId('job-match')).toContainText('Your match: 100% match');
      await expect(page.getByTestId('job-match')).not.toContainText('Missing');
    });
  });
}
