// The blog in the browser (dev server; Hygraph's Content API answered by the test posts in
// src/lib/blog/fixtures/hygraph.js). The pre-rendered static pages are checked in zz-csp.spec.mjs.
import { expect, test } from '@playwright/test';
import { CATEGORIES, POSTS } from '../src/lib/blog/fixtures/hygraph.js';
import { answer } from './hygraph-mock.mjs';

const HYGRAPH = 'https://ap-south-1.cdn.hygraph.com/**';
async function blog(page, data = {}) {
  const calls = [];
  await page.route(HYGRAPH, (route) => {
    const body = route.request().postDataJSON();
    calls.push(body);
    return route.fulfill({ json: answer(body, data) });
  });
  return calls;
}
const cards = (page) => page.locator('main .blog-card');

test('list: newest first with chip, date and reading time; category filter; header and footer links', async ({ page }) => {
  await blog(page);
  await page.goto('/');
  await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Blog' }).click();
  await expect(page).toHaveURL(/\/blog$/);
  await expect(page.getByRole('heading', { level: 1, name: 'Resume & job-search blog' })).toBeVisible();
  await expect(page).toHaveTitle('Resume & job-search blog · Nm7');
  await expect(cards(page)).toHaveCount(3);
  await expect(cards(page).locator('.blog-card-title')).toHaveText(['Your first resume as a fresher', 'How to make an ATS-friendly resume', 'Which keywords does an ATS look for?']);
  const first = cards(page).nth(1);
  await expect(first.locator('.blog-chip')).toHaveText('ATS');
  await expect(first).toContainText('Five rules that get your resume read.');
  await expect(first).toContainText('10 Oct 2026 · 2 min read');
  await expect(first.locator('img')).toHaveAttribute('src', 'https://ap-south-1.graphassets.com/abc/ats-friendly-resume.jpg');

  const filters = page.getByRole('navigation', { name: 'Categories' });
  await expect(filters.getByRole('link', { name: 'All' })).toHaveAttribute('aria-current', 'page');
  await filters.getByRole('link', { name: 'ATS' }).click();
  await expect(page).toHaveURL(/\/blog\/category\/ats$/);
  await expect(page.getByRole('heading', { level: 1, name: 'ATS' })).toBeVisible();
  await expect(cards(page)).toHaveCount(2);
  await expect(page.getByText('Your first resume as a fresher')).toHaveCount(0);
  await expect(filters.getByRole('link', { name: 'ATS' })).toHaveAttribute('aria-current', 'page');
  await filters.getByRole('link', { name: 'Interviews' }).click();
  await expect(page.getByText('No articles on interviews yet — first articles coming soon.')).toBeVisible();
  await filters.getByRole('link', { name: 'All' }).click();
  await expect(cards(page)).toHaveCount(3);
  await expect(page.locator('footer').getByRole('link', { name: 'Blog' })).toHaveAttribute('href', '/blog');
});

test('list: 12 at a time with "Load more articles"', async ({ page }) => {
  const many = Array.from({ length: 14 }, (_, i) => ({ ...POSTS[1], id: `p${i}`, slug: `post-${i}`, title: `Post number ${i}`, publishedAt: new Date(Date.UTC(2026, 8, 30 - i)).toISOString() }));
  await blog(page, { posts: many });
  await page.goto('/blog');
  await expect(cards(page)).toHaveCount(12);
  await expect(cards(page).first()).toContainText('Post number 0');
  await page.getByRole('button', { name: 'Load more articles' }).click();
  await expect(cards(page)).toHaveCount(14);
  await expect(page.getByRole('button', { name: 'Load more articles' })).toHaveCount(0);
});

test('article: content rendered safely, sticky scan CTA (side on desktop, bottom on phones), related posts', async ({ page }) => {
  await blog(page);
  await page.addInitScript(() => { window.__xss = 0; window.alert = () => { window.__xss += 1; }; });
  await page.goto('/blog');
  await page.getByRole('link', { name: /How to make an ATS-friendly resume/ }).click();
  await expect(page).toHaveURL(/\/blog\/ats-friendly-resume$/);
  await expect(page.getByRole('heading', { level: 1, name: 'How to make an ATS-friendly resume' })).toBeVisible();
  await expect(page).toHaveTitle('How to make an ATS-friendly resume · Nm7');
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute('href', 'https://nm7.si/blog/ats-friendly-resume');
  await expect(page.locator('meta[name="description"]')).toHaveAttribute('content', /^The five rules that get an ATS/);
  await expect(page.getByText('Nm7 Team · 10 Oct 2026 · 2 min read')).toBeVisible();
  const body = page.locator('.blog-content');
  await expect(body.getByRole('heading', { level: 2, name: 'Use standard headings' })).toBeVisible();
  await expect(body.getByRole('link', { name: 'outside guide' })).toHaveAttribute('rel', 'noopener noreferrer');
  await expect(body.getByRole('img', { name: 'A clean resume' })).toHaveAttribute('loading', 'lazy');
  await expect(body.locator('table th').first()).toHaveText('Section');
  await expect(body.getByText('<script>alert("x")</script>', { exact: false })).toBeVisible(); // shown as text
  await expect(body.locator('script, iframe')).toHaveCount(0);
  expect(await page.evaluate(() => window.__xss)).toBe(0);
  await expect(body.getByText('bad link')).toBeVisible();
  await expect(body.locator('a', { hasText: 'bad link' })).toHaveCount(0);

  const related = page.getByRole('region', { name: 'Related articles' });
  await expect(related.locator('.blog-card')).toHaveCount(1);
  await expect(related).toContainText('Which keywords does an ATS look for?');

  const cta = page.getByRole('complementary', { name: 'Free resume scan' });
  const box = await cta.boundingBox();
  expect(box.x).toBeGreaterThan(600); // beside the article
  await page.mouse.wheel(0, 1500);
  await expect(cta).toBeInViewport(); // sticky

  await page.setViewportSize({ width: 390, height: 800 });
  await expect(cta).toBeInViewport();
  const phone = await cta.boundingBox();
  expect(Math.round(phone.y + phone.height)).toBe(800); // fixed to the bottom of the screen
  expect(phone.width).toBeGreaterThan(380);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await cta.getByRole('link', { name: 'Scan your resume free' }).click();
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByRole('heading', { level: 1, name: /Resumes for every job seeker/ })).toBeVisible();
});

test('unknown article or category: "This page doesn’t exist" (not indexed)', async ({ page }) => {
  await blog(page);
  await page.goto('/blog/no-such-post');
  await expect(page.getByRole('heading', { name: 'This page doesn’t exist.' })).toBeVisible();
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', 'noindex, nofollow');
  await expect(page.getByRole('link', { name: 'Go to the blog' })).toHaveAttribute('href', '/blog');
  await page.goto('/blog/category/no-such-category');
  await expect(page.getByRole('heading', { name: 'This page doesn’t exist.' })).toBeVisible();
});

test('no posts yet: "First articles coming soon" and no blog strip on the home page; with posts the home shows the latest 3', async ({ page }) => {
  await blog(page, { posts: [], categories: CATEGORIES });
  await page.goto('/blog');
  await expect(page.getByText('First articles coming soon.')).toBeVisible();
  await expect(cards(page)).toHaveCount(0);
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1, name: /Resumes for every job seeker/ })).toBeVisible();
  await page.waitForTimeout(500);
  await expect(page.getByRole('heading', { name: 'From the blog' })).toHaveCount(0);

  await page.unroute(HYGRAPH);
  await blog(page);
  await page.goto('/');
  const strip = page.getByRole('region', { name: 'From the blog' });
  await expect(strip.locator('.blog-card')).toHaveCount(3);
  await expect(strip.locator('.blog-card-title').first()).toHaveText('Your first resume as a fresher');
  await strip.getByRole('link', { name: 'All articles →' }).click();
  await expect(page).toHaveURL(/\/blog$/);
});

test('a missed build never hides posts: the built list says 0 posts, Hygraph has them → the live posts are shown', async ({ page }) => {
  await blog(page);
  await page.route('**/blog/data.json', (route) => route.fulfill({ json: { builtAt: new Date().toISOString(), posts: [], categories: CATEGORIES } }));
  await page.goto('/blog');
  await expect(cards(page)).toHaveCount(3);
  await expect(page.getByText('First articles coming soon.')).toHaveCount(0);
  // and an old built list (over 10 minutes) is topped up from Hygraph: live posts are added, built ones stay
  await page.unroute('**/blog/data.json');
  await page.route('**/blog/data.json', (route) => route.fulfill({ json: { builtAt: new Date(Date.now() - 11 * 60_000).toISOString(), posts: [{ ...POSTS[1], slug: 'old-built-post', title: 'Old built post', publishedAt: '2026-10-01T05:00:00.000Z', content: undefined }], categories: CATEGORIES } }));
  await page.goto('/blog');
  await expect(cards(page)).toHaveCount(4);
  await expect(cards(page).last()).toContainText('Old built post');
  await expect(cards(page).first()).toContainText('Your first resume as a fresher');
});

test('live Hygraph answers posts: [] (stale CDN) but the build has posts → list, category page and home keep the posts', async ({ page }) => {
  const calls = await blog(page, { posts: [] }); // the CDN's stale answer
  const built = POSTS.map(({ content, ...rest }) => ({ ...rest, cover: null, category: rest.category, minutes: 1 })); // eslint-disable-line no-unused-vars
  await page.route('**/blog/data.json', (route) => route.fulfill({ json: { builtAt: new Date(Date.now() - 60 * 60_000).toISOString(), posts: built, categories: CATEGORIES } }));
  await page.goto('/blog');
  await expect(cards(page)).toHaveCount(3);
  await expect.poll(() => calls.length).toBeGreaterThan(0); // Hygraph was asked (the built list is old)…
  expect(calls[0].query).toMatch(/# nm7 cache key \d+$/); // …with a rotating cache key
  await page.waitForTimeout(500);
  await expect(cards(page)).toHaveCount(3); // …and its empty answer didn't replace the posts
  await expect(page.getByText('First articles coming soon.')).toHaveCount(0);
  await page.getByRole('navigation', { name: 'Categories' }).getByRole('link', { name: 'ATS' }).click();
  await expect(cards(page)).toHaveCount(2);
  await page.goto('/');
  await expect(page.getByRole('region', { name: 'From the blog' }).locator('.blog-card')).toHaveCount(3);
});
