// "Snap photos" against the real API, with the photo-reading call mocked in the browser (the server has no Claude
// key in tests, so its real answer is "being switched on" — checked first).
import { expect, test } from '@playwright/test';
import { API, PASSWORD, email, login, seed } from './helpers.mjs';

// a real 40×30 PNG (the browser has to decode and shrink it)
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAACgAAAAeCAIAAADRv8uKAAAAK0lEQVR4nO3NMQ0AAAgDsMlGGCKQhQw4mvRvputExGKxWCwWi8VisVj8N14lYChIY55nyQAAAABJRU5ErkJggg==', 'base64');
const file = (name) => ({ name, mimeType: 'image/png', buffer: PNG });
const f = (value, fromId = false, confidence = 'high') => ({ value, confidence, fromId });
const READ = {
  photos: [{ index: 0, kind: 'id_card', readable: true }, { index: 1, kind: 'handwritten_note', readable: true }, { index: 2, kind: 'other', readable: false }],
  personal: {
    name: f('Ramesh Kumar', true), city: f('Hyderabad', true), state: f('Telangana', true), address: f('H.No 4-12, Ameerpet, Hyderabad', true),
    dob: f('12/08/1988', true), gender: f('Male', true), guardian: f('S/O Venkatesh', true), phone: f('98765 43210'), email: f(''),
  },
  headline: 'Light Commercial Vehicle Driver',
  experience: [{ role: 'Driver', company: 'Sri Sai Transports', from: '2020', to: 'Present', lines: ['Drove light commercial vehicles for 4 years across Hyderabad with no accidents'], confidence: 'high' }],
  skills: [{ value: 'LMV driving licence', confidence: 'high' }, { value: 'Basic vehicle repair', confidence: 'low' }],
  certifications: [],
  education: [],
  languages: [{ value: 'Telugu', confidence: 'high' }, { value: 'Hindi', confidence: 'high' }],
};
const api = (page, path) => page.evaluate(async ([base, p]) => (await fetch(`${base}${p}`, { credentials: 'include' })).json(), [API, path]);

async function signIn(page, who = 'Ramesh K') {
  const mail = email('photos');
  seed('customer', mail, who, PASSWORD);
  await login(page, mail);
  await page.waitForURL('**/me');
  return mail;
}
async function addPhotos(page, names) {
  await page.getByLabel('Choose photos from gallery').setInputFiles(names.map(file));
  await expect(page.getByRole('img', { name: `Photo ${names.length}` })).toBeVisible();
}

test('builder: Snap photos card, "being switched on" without a key, phone order', async ({ page }) => {
  await signIn(page);
  await page.goto('/builder');
  const card = page.getByRole('button', { name: /Snap photos/ });
  await expect(card).toContainText('Take photos of your Aadhaar, work papers or a handwritten note. We’ll read them and fill your resume.');
  await card.click();
  await expect(page.getByRole('heading', { name: 'Snap photos of your papers' })).toBeVisible();
  await expect(page.getByText('Aadhaar card — front and back')).toBeVisible();
  await expect(page.getByLabel('Take photo')).toHaveAttribute('capture', 'environment');
  await addPhotos(page, ['note.png']);
  await page.getByRole('button', { name: 'Read my photo' }).click();
  await expect(page.getByText('Photo reading is being switched on - try again soon.')).toBeVisible(); // the real API, no key

  // on a phone the card comes first
  await page.setViewportSize({ width: 375, height: 800 });
  await page.goto('/builder');
  await expect(page.getByRole('button', { name: /Snap photos/ })).toBeVisible();
  const cards = page.locator('main .grid-auto > button');
  const boxes = await cards.evaluateAll((els) => els.map((e) => [e.textContent, e.getBoundingClientRect().top]));
  const first = boxes.sort((a, b) => a[1] - b[1])[0][0];
  expect(first).toContain('Snap photos');
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(375);
});

test('photos → consent for the ID card → review (address/DOB hidden) → Work-first resume', async ({ page }) => {
  await signIn(page);
  const sent = [];
  await page.route('**/api/me/photo-import', async (route) => {
    const body = route.request().postDataJSON();
    sent.push(body);
    // the first time the ID card isn't marked: the server asks for consent
    if (!body.idConsent) return route.fulfill({ status: 409, contentType: 'application/json', body: JSON.stringify({ error: { code: 'id_consent_required', message: 'One of these photos looks like an ID card. Please tick the box to let Nm7 read it.', photos: [0] } }) });
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(READ) });
  });
  await page.goto('/builder');
  await page.getByRole('button', { name: /Snap photos/ }).click();
  await addPhotos(page, ['aadhaar.png', 'note.png', 'blurry.png']);
  await page.getByRole('button', { name: 'Read my photos' }).click();
  await expect(page.getByText('One of these photos looks like an ID card. Please tick the box below to let Nm7 read it.')).toBeVisible();
  const consent = page.getByRole('checkbox', { name: /I agree Nm7 reads my name, address and date of birth from this card. The ID number is not saved./ });
  await expect(page.getByRole('button', { name: 'Read my photos' })).toBeDisabled();
  await expect(page.locator('li', { hasText: 'Photo 1' }).getByRole('checkbox', { name: /This is an ID card/ })).toBeChecked();
  await consent.check();
  await page.getByRole('button', { name: 'Read my photos' }).click();

  // the review screen
  await expect(page.getByRole('heading', { name: 'Check what we read' })).toBeVisible();
  expect(sent[1].idConsent).toBe(true);
  expect(sent[1].photos).toHaveLength(3);
  expect(sent[1].photos[0].isId).toBe(true);
  expect(sent[1].photos[0].data.length).toBeGreaterThan(50); // shrunk to JPEG in the browser
  await expect(page.getByText('We couldn’t read photo 3 - try again in better light.')).toBeVisible();
  const idBox = page.getByRole('region', { name: 'From your ID' });
  await expect(idBox.getByRole('switch', { name: 'Show Name on resume' })).toBeChecked();
  await expect(idBox.getByRole('switch', { name: 'Show City on resume' })).toBeChecked();
  await expect(idBox.getByRole('switch', { name: 'Show Full address on resume' })).not.toBeChecked();
  await expect(idBox.getByRole('switch', { name: 'Show Date of birth on resume' })).not.toBeChecked();
  await expect(idBox.getByRole('switch', { name: 'Show Gender on resume' })).not.toBeChecked();
  await expect(page.getByText('Please check')).toHaveCount(1); // "Basic vehicle repair" was unsure
  // edit one thing, remove another
  await page.getByLabel('Job 1 what you did').fill('Drove light commercial vehicles for 4 years across Hyderabad with no accidents\nLoaded and delivered goods to 30 shops a day');
  await page.getByRole('button', { name: 'Remove Language 2' }).click();
  await page.getByRole('button', { name: 'Remove Phone' }).click();
  await page.getByRole('button', { name: 'Looks right' }).click();

  // a new resume in the Work-first template
  await expect(page.getByTestId('tp-use-top')).toBeVisible();
  await page.getByTestId('tp-use-top').click();
  const preview = page.getByRole('article', { name: 'Resume preview' });
  await expect(preview).toContainText('Ramesh Kumar');
  await expect(preview).toContainText('Hyderabad, Telangana');
  await expect(preview).toContainText('LMV driving licence');
  await expect(preview).toContainText('30 shops a day');
  await expect(preview).not.toContainText('Ameerpet'); // address kept private
  await expect(preview).not.toContainText('1988');
  await expect(preview).not.toContainText(/Education/i); // none found → switched off, no warning
  await expect(preview).not.toContainText('Hindi');
  await expect(page.getByText('Almost done — please add:')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Phone is required.' })).toBeVisible(); // only what's missing
  const banner = page.getByRole('status').filter({ hasText: 'Almost done' });
  await expect(banner.getByRole('button')).toHaveCount(1); // phone only — nothing about education

  // saved on the server: details kept, the Personal Information section off
  await expect.poll(async () => (await api(page, '/api/me/resumes')).find((r) => r.active)?.data?.pinfo?.address).toBe('H.No 4-12, Ameerpet, Hyderabad');
  const r = (await api(page, '/api/me/resumes')).find((x) => x.active);
  expect(r.name).toMatch(/^Ramesh · from photos · /);
  expect(r.data.hidden).toMatchObject({ pinfo: true, edu: true });
  expect(r.data.design.preset).toBe('work');
});

test('Job Profile: import from photos only adds what is missing', async ({ page }) => {
  await signIn(page, 'Ramesh K');
  await page.route('**/api/me/photo-import', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ...READ, photos: [{ index: 0, kind: 'handwritten_note', readable: true }], personal: { ...READ.personal, name: f('Ramesh Kumar'), city: f('Hyderabad'), state: f('Telangana') } }) }));
  await page.goto('/me/profile');
  await page.locator('#pf-personal-location').fill('Secunderabad');
  await page.getByRole('button', { name: 'Import from photos' }).click();
  const dlg = page.getByRole('dialog', { name: 'Import from photos' });
  await dlg.getByLabel('Choose photos from gallery').setInputFiles([file('note.png')]);
  await dlg.getByRole('button', { name: 'Read my photo' }).click();
  await dlg.getByRole('button', { name: 'Add to my Job Profile' }).click();
  await expect(page.getByText(/Added \d+ items? from your photos/)).toBeVisible();
  await expect(page.locator('#pf-personal-name')).toHaveValue('Ramesh K'); // never overwritten
  await expect(page.locator('#pf-personal-location')).toHaveValue('Secunderabad');
  await expect(page.locator('#pf-personal-phone')).toHaveValue('98765 43210'); // was empty → filled
  await expect(page.locator('#pf-exp-0-company')).toHaveValue('Sri Sai Transports');
});

test('home: "Snap my papers" opens the photo flow; guests are asked to sign in', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('link', { name: 'Snap my papers' }).click();
  await expect(page).toHaveURL(/\/builder\?start=photos$/);
  await expect(page.getByRole('heading', { name: 'Snap photos of your papers' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Sign in' }).first()).toBeVisible();
});
