// The public job board (J3) on a desktop and a 390 px phone, against the real API: search and filters (in the URL),
// a job page with Google JobPosting data, apply link and WhatsApp share, a closed job (no markup, not indexed,
// similar jobs), a job that's gone, Save (sign-in first, then the Saved list), Telugu, the jobs sitemap. No sideways
// scrolling.
import { expect, test } from '@playwright/test';
import { API, PASSWORD, email, login, seed } from './helpers.mjs';

const SIZES = [['desktop', { viewport: { width: 1280, height: 900 } }], ['phone', { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true }]];
const DESC = 'Build weekly dashboards for our sales team with SQL and Power BI.\nFreshers who know Excel are welcome.';

for (const [label, opts] of SIZES) {
  test.describe(label, () => {
    test.use(opts);

    test('search, filters, job page with JobPosting data, closed job, save, Telugu, sitemap', async ({ page, request }) => {
      test.setTimeout(120_000);
      const tag = `${label}${Date.now().toString(36)}`;
      const job = (body, ...rest) => seed('job', JSON.stringify({ description: DESC, company: { name: `Acme ${tag}`, website: 'https://acme.example' }, applyMethod: 'link', ...body }), ...rest);
      const analyst = job({ title: `Data Analyst ${tag}`, locations: ['Hyderabad'], experience: 'fresher', salary: { min: 300000, max: 450000, period: 'yearly' }, skills: ['SQL', 'Power BI'], applyUrl: `https://acme.example/jobs/${tag}/1` });
      job({ title: `Java Developer ${tag}`, locations: ['Chennai'], experience: '1_3', skills: ['Java'], applyUrl: `https://acme.example/jobs/${tag}/2` }, '', '30');
      job({ title: `Support Intern ${tag}`, locations: [], workType: 'remote', jobType: 'internship', experience: 'internship', applyMethod: 'email', applyEmail: 'hr@acme.example', skills: ['Communication'] });
      const closed = job({ title: `Closed Analyst ${tag}`, locations: ['Hyderabad'], skills: ['SQL'], applyUrl: `https://acme.example/jobs/${tag}/4` }, 'closed');
      const wide = async () => expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(opts.viewport.width);

      // the list: open jobs only, newest first
      await page.goto(`/jobs?q=${tag}`);
      await expect(page.getByRole('heading', { level: 1, name: 'Jobs for students and freshers' })).toBeVisible();
      await expect(page.getByTestId('jobs-count')).toHaveText('3 jobs');
      const cards = page.getByTestId('job-card');
      await expect(cards).toHaveCount(3);
      await expect(cards.last()).toContainText(`Java Developer ${tag}`);
      await expect(cards.filter({ hasText: `Data Analyst ${tag}` })).toContainText(`Acme ${tag}`);
      await expect(cards.filter({ hasText: `Data Analyst ${tag}` })).toContainText('Hyderabad · Fresher · Full-time · ₹3,00,000 – ₹4,50,000 a year');
      await expect(cards.filter({ hasText: `Java Developer ${tag}` })).toContainText('Posted 1 day ago');
      await wide();

      // filters: each one is in the URL
      await page.getByLabel('Experience').selectOption('fresher');
      await expect(page).toHaveURL(/experience=fresher/);
      await expect(cards).toHaveCount(1);
      await expect(cards).toContainText(`Data Analyst ${tag}`);
      await page.getByLabel('Experience').selectOption('');
      await page.getByLabel('City').selectOption('remote');
      await expect(cards).toHaveCount(1);
      await expect(cards).toContainText(`Support Intern ${tag}`);
      await page.getByLabel('City').selectOption('');
      await page.getByLabel('Posted').selectOption('24h');
      await expect(cards).toHaveCount(2);
      await page.getByLabel('Salary').selectOption('300000');
      await expect(cards).toHaveCount(1);
      await page.getByRole('button', { name: 'Clear filters' }).click();
      await expect(page).toHaveURL(/\/jobs$/);
      await page.getByLabel('Role, skill or company').fill(`java developer ${tag}`);
      await page.getByRole('button', { name: 'Search', exact: true }).click();
      await expect(page.getByTestId('jobs-count')).toHaveText('1 job');

      // the job page
      await page.goto(`/jobs/${analyst.slug}`);
      const detail = page.getByTestId('job-detail');
      await expect(detail.getByRole('heading', { level: 1 })).toHaveText(`Data Analyst ${tag}`);
      await expect(page.getByTestId('job-status')).toHaveText('Hiring');
      await expect(detail).toContainText('Posted just now');
      await expect(detail).toContainText('Freshers who know Excel are welcome.');
      await expect(page).toHaveTitle(`Data Analyst ${tag} · Acme ${tag} · Nm7`);
      await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', 'index, follow');
      const ld = JSON.parse(await page.locator('script[type="application/ld+json"][data-nm7="jobposting"]').textContent());
      expect(ld).toMatchObject({ '@type': 'JobPosting', title: `Data Analyst ${tag}`, employmentType: 'FULL_TIME', hiringOrganization: { name: `Acme ${tag}` } });
      expect(ld.baseSalary).toEqual({ '@type': 'MonetaryAmount', currency: 'INR', value: { '@type': 'QuantitativeValue', minValue: 300000, maxValue: 450000, unitText: 'YEAR' } });
      expect(ld.jobLocation.address).toEqual({ '@type': 'PostalAddress', addressLocality: 'Hyderabad', addressCountry: 'IN' });
      expect(Date.parse(ld.datePosted)).toBeGreaterThan(Date.now() - 3_600_000);
      const apply = page.getByTestId('apply');
      await expect(apply).toHaveAttribute('href', `https://acme.example/jobs/${tag}/1`);
      await expect(apply).toHaveAttribute('target', '_blank');
      const wa = await page.getByTestId('share-wa').getAttribute('href');
      expect(wa.startsWith('https://wa.me/?text=')).toBe(true);
      expect(decodeURIComponent(wa)).toContain(`https://nm7.si/jobs/${analyst.slug}`);
      await wide();

      // Save asks to sign in first
      await detail.getByRole('button', { name: `Save: Data Analyst ${tag}` }).click();
      await expect(page).toHaveURL(new RegExp(`/login\\?next=%2Fjobs%2F${analyst.slug}`));

      // a closed job: said plainly, no JobPosting, not indexed, similar open jobs
      await page.goto(`/jobs/${closed.slug}`);
      await expect(page.getByTestId('job-status')).toHaveText('Closed');
      await expect(page.getByTestId('job-closed-note')).toContainText('This job is closed');
      await expect(page.getByTestId('apply')).toHaveCount(0);
      await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', 'noindex, nofollow');
      await expect(page.locator('script[type="application/ld+json"][data-nm7="jobposting"]')).toHaveCount(0);
      await expect(page.getByTestId('similar-jobs')).toContainText(`Data Analyst ${tag}`);
      await wide();

      // a job that's gone
      await page.goto('/jobs/no-such-job-000000');
      await expect(page.getByTestId('job-gone')).toContainText('This job isn’t on Nm7 any more');

      // signed in: save, then the Saved list
      const me = email('jobs');
      seed('customer', me, 'Sai Varsha', PASSWORD);
      await login(page, me);
      await expect(page).not.toHaveURL(/\/login/);
      await page.goto(`/jobs/${analyst.slug}`);
      await page.getByTestId('job-detail').getByRole('button', { name: `Save: Data Analyst ${tag}` }).click();
      await expect(page.getByTestId('job-detail').getByRole('button', { name: `Saved: Data Analyst ${tag}` })).toHaveAttribute('aria-pressed', 'true');
      await page.goto('/jobs');
      await page.getByRole('link', { name: 'Saved jobs (1)' }).click();
      await expect(page.getByRole('heading', { level: 1, name: 'Saved jobs' })).toBeVisible();
      await expect(page.getByTestId('job-card')).toHaveCount(1);
      await expect(page.getByTestId('job-card')).toContainText(`Data Analyst ${tag}`);

      // Telugu
      await page.goto(`/jobs?q=${tag}`);
      await page.getByRole('button', { name: 'తెలుగు' }).click();
      await expect(page.getByRole('heading', { level: 1 })).toHaveText('విద్యార్థులు, ఫ్రెషర్ల కోసం ఉద్యోగాలు');
      await expect(page.getByTestId('jobs-count')).toHaveText('3 ఉద్యోగాలు');
      await wide();
      await page.getByRole('button', { name: 'English' }).click();

      // the sitemap lists open jobs, not closed ones
      const xml = await (await request.get(`${API}/api/jobs/sitemap.xml`)).text();
      expect(xml).toContain(`<loc>https://nm7.si/jobs/${analyst.slug}</loc>`);
      expect(xml).not.toContain(closed.slug);
    });
  });
}
