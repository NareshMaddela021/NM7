// Smaller site fixes, checked in the browser.
import { expect, test } from '@playwright/test';

test('phones: the logo and "Build free" stay in view; the other links are behind a Menu button', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 800 });
  await page.goto('/');
  await expect(page.getByRole('banner').getByRole('link', { name: 'Build free' })).toBeVisible();
  const pricing = page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Pricing' });
  await expect(pricing).toBeHidden();
  await page.getByRole('button', { name: 'Menu' }).click();
  await expect(pricing).toBeVisible();
  await expect(page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'For organizations' })).toBeVisible();
  await pricing.click();
  await expect(page).toHaveURL(/\/pricing$/); // round P: its own page
  await expect(pricing).toBeHidden(); // closes after choosing
  await expect(page.getByRole('heading', { name: 'Free to build. Pay only for what you need.' })).toBeInViewport();
});

test('home: no unbacked stats; closing the file picker asks for a file; labelled inputs; skip link', async ({ page }) => {
  await page.goto('/old-home'); // the previous home page (round P): its scan box and line fixer
  await expect(page.getByText('20,000+')).toHaveCount(0);
  await expect(page.getByText('job seekers on Nm7')).toHaveCount(0);
  await page.getByLabel('Resume file to scan', { exact: true }).dispatchEvent('cancel');
  await expect(page.getByRole('alert').filter({ hasText: 'Choose a PDF or DOCX first.' })).toBeVisible();
  await expect(page).toHaveURL(/\/old-home$/); // didn't go off and scan anything
  await expect(page.getByLabel('Your resume line')).toBeVisible();
  await page.keyboard.press('Tab');
  await expect(page.getByRole('link', { name: 'Skip to content' })).toBeFocused();
});

test('checkout names the plan and has no "Back to your report" without a scan', async ({ page }) => {
  await page.goto('/checkout');
  await expect(page.getByRole('heading', { level: 1, name: 'Expert rewrite' })).toBeVisible();
  await expect(page.getByText('Back to your report')).toHaveCount(0);
  await page.getByRole('checkbox', { name: /Upgrade to Career Launch/ }).check();
  await expect(page.getByRole('heading', { level: 1, name: 'Career Launch' })).toBeVisible();
});

test('each page has its own title and description', async ({ page }) => {
  await page.goto('/privacy');
  await expect(page).toHaveTitle('Privacy policy · Nm7');
  await expect(page.locator('meta[name="description"]')).toHaveAttribute('content', /protects your data/);
  await page.goto('/login');
  await expect(page).toHaveTitle('Sign in · Nm7');
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', /noindex/);
  await page.goto('/expert-terms');
  await expect(page).toHaveTitle('Expert terms · Nm7');
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', /index, follow/);
  await expect(page.locator('main')).not.toContainText('[brackets]');
  await page.goto('/no-such-page');
  await expect(page).toHaveTitle('Page not found · Nm7');
});

test('legal and contact pages show no [placeholders]', async ({ page }) => {
  for (const path of ['/contact', '/terms', '/privacy', '/refund-policy', '/delivery-policy', '/expert-terms']) {
    await page.goto(path);
    const text = await page.locator('main').innerText();
    expect(text, path).not.toMatch(/\[[A-Za-z][^\]]*\]/);
  }
});

test('slow server: the waking-up notice shows while it wakes and goes as soon as it answers (items 1, 25)', async ({ page }) => {
  // a sleeping server: every API request waits 4.5 s until it has answered once
  let asleep = true;
  await page.route('http://localhost:8001/**', async (route) => { if (asleep) await new Promise((r) => setTimeout(r, 4500)); await route.continue(); });
  const waking = page.getByText(/Waking up the server/);
  await page.goto('/login');
  await expect(waking).toBeVisible({ timeout: 4500 }); // after 3 s
  await expect(waking).toBeHidden({ timeout: 8000 }); // the server answered: gone at once, never stuck
  asleep = false;
  // awake now: a slow answer (a sign-in that takes 4.5 s) is not "waking up"
  await page.route('**/api/auth/login', async (route) => { await new Promise((r) => setTimeout(r, 4500)); await route.continue(); });
  await page.getByLabel('Email').fill('nobody@example.com');
  await page.getByLabel('Password', { exact: true }).fill('whatever-123');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.waitForTimeout(3500);
  await expect(waking).toBeHidden();
  await expect(page.getByText('Email or password is wrong.')).toBeVisible({ timeout: 10000 });
});
