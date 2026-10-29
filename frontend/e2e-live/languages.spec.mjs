// Telugu and Hindi on the main public pages, against the real API, on a desktop and a 390 px phone: the language
// switch on the home page, /for-orgs, the builder's Start step and sign-in turns the page Telugu (a translated
// heading, lang="te" on the translated part, nothing wider than the phone), the choice survives a reload and carries
// to the next page, English comes back with one tap — and the legal pages stay English.
import { expect, test } from '@playwright/test';
import { SIZES, noSideScroll } from './college.mjs';

/** Each page: where it is, its heading in English and Telugu, and the part that carries the language. */
const PAGES = [
  { path: '/', en: 'Resumes for every job seeker. Resume drives for every campus.', te: 'ఉద్యోగం వెతికే ప్రతి ఒక్కరికీ రెజ్యూమ్', part: 'section[aria-labelledby="hero-title"]' },
  { path: '/for-orgs', en: 'Every student’s resume, ready for placements', te: 'ప్రతి విద్యార్థి రెజ్యూమ్, ప్లేస్‌మెంట్లకు సిద్ధంగా', part: 'section[aria-labelledby="orgs-h"]' },
  { path: '/builder', en: 'Build a resume recruiters actually read.', te: 'రిక్రూటర్లు నిజంగా చదివే రెజ్యూమ్ తయారు చేయండి.', part: 'main#main' },
  { path: '/login', en: 'Sign in', te: 'సైన్ ఇన్', part: 'main' },
];

for (const [label, opts] of SIZES) {
  test.describe(`languages · ${label}`, () => {
    test.use(opts);

    for (const p of PAGES) {
      test(`${p.path}: Telugu with the switch, kept after a reload, English again with one tap`, async ({ page }) => {
        await page.goto(p.path);
        const h1 = page.getByRole('heading', { level: 1 });
        const part = page.locator(p.part).first();
        await expect(h1).toHaveText(p.en);
        await expect(part).toHaveAttribute('lang', 'en');
        const group = page.getByRole('group', { name: 'Language' });
        await expect(group.getByRole('button', { name: 'English' })).toHaveAttribute('aria-pressed', 'true');
        await group.getByRole('button', { name: 'తెలుగు' }).click();

        await expect(h1).toContainText(p.te);
        await expect(part).toHaveAttribute('lang', 'te');
        await expect(page.getByRole('group', { name: 'భాష' }).getByRole('button', { name: 'తెలుగు' })).toHaveAttribute('aria-pressed', 'true');
        await expect(page.locator('link[data-lang-font="te"]')).toHaveCount(1); // Noto Sans Telugu, only now
        expect(await noSideScroll(page), `${p.path} fits the screen in Telugu`).toBe(true);

        await page.reload();
        await expect(h1).toContainText(p.te);
        await expect(part).toHaveAttribute('lang', 'te');

        await page.getByRole('group', { name: 'భాష' }).getByRole('button', { name: 'English' }).click();
        await expect(h1).toHaveText(p.en);
        await expect(part).toHaveAttribute('lang', 'en');
        await page.reload();
        await expect(h1).toHaveText(p.en);
      });
    }

    test('the rest of each page follows: home pricing and FAQ, /for-orgs plans, builder options, sign-in form', async ({ page }) => {
      await page.goto('/');
      await page.getByRole('group', { name: 'Language' }).getByRole('button', { name: 'తెలుగు' }).click();
      // home, below the fold (loads just after the first paint)
      const pricing = page.locator('#pricing');
      await expect(pricing).toHaveAttribute('lang', 'te');
      await expect(pricing.getByRole('heading', { name: 'తయారు చేయడం ఉచితం. మీకు కావాల్సిన దానికే చెల్లించండి.' })).toBeVisible();
      await expect(pricing.getByText('Career Launch', { exact: true })).toBeVisible(); // plan names stay
      await expect(page.locator('#faq').getByRole('heading', { name: 'ప్రశ్నలు' })).toBeVisible();
      expect(await noSideScroll(page)).toBe(true);

      // the choice carries to the next page
      await page.goto('/for-orgs');
      await expect(page.getByRole('heading', { level: 1 })).toHaveText('ప్రతి విద్యార్థి రెజ్యూమ్, ప్లేస్‌మెంట్లకు సిద్ధంగా');
      await expect(page.getByRole('heading', { name: 'ప్లాన్లు' })).toBeVisible();
      const table = page.getByRole('table', { name: 'సంస్థల కోసం ప్లాన్లు' });
      await expect(table).toContainText('₹4,999'); // prices as the server sends them
      await expect(page.getByTestId('demo-video').getByRole('heading', { name: '2 నిమిషాల డెమో చూడండి' })).toBeVisible();
      expect(await noSideScroll(page)).toBe(true);

      await page.goto('/builder');
      await expect(page.getByRole('button', { name: /మొదటి నుంచి మొదలుపెట్టండి/ })).toBeVisible();
      await expect(page.getByRole('button', { name: /^నా పాత రెజ్యూమ్‌ను మళ్లీ తయారు చేయండి/ })).toBeVisible();
      expect(await noSideScroll(page)).toBe(true);

      await page.goto('/login');
      await expect(page.getByLabel('ఈమెయిల్')).toBeVisible();
      await page.getByRole('button', { name: 'సైన్ ఇన్ చేయండి' }).click();
      await expect(page.getByText('మీ ఈమెయిల్ ఇవ్వండి')).toBeVisible(); // the page's own error, in Telugu
      expect(await noSideScroll(page)).toBe(true);

      // Hindi too
      await page.getByRole('group', { name: 'భాష' }).getByRole('button', { name: 'हिन्दी' }).click();
      await expect(page.getByRole('heading', { level: 1 })).toHaveText('साइन इन');
      await expect(page.locator('main')).toHaveAttribute('lang', 'hi');
      expect(await noSideScroll(page)).toBe(true);
    });

    test('legal pages stay English, with no language switch, even with Telugu chosen', async ({ page }) => {
      await page.goto('/');
      await page.evaluate(() => localStorage.setItem('nm7-lang', 'te'));
      await page.goto('/terms');
      await expect(page.getByRole('heading', { level: 1 })).toHaveText('Terms of Service');
      await expect(page.locator('html')).toHaveAttribute('lang', 'en');
      await expect(page.locator('main [lang="te"]')).toHaveCount(0);
      await expect(page.getByRole('group', { name: 'భాష' })).toHaveCount(0);
      await expect(page.getByRole('group', { name: 'Language' })).toHaveCount(0);
    });
  });
}
