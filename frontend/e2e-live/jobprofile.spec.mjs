// Job Profile against the real API: fill it, reload and sign in elsewhere, start a resume from it, fill builder
// sections from it (Add vs Replace), keep resume edits out of it until saved, review profile updates, privacy.
import { expect, test } from '@playwright/test';
import { strToU8, zipSync } from 'fflate';
import { API, PASSWORD, email, login, seed } from './helpers.mjs';

const api = (page, path, opts = {}) => page.evaluate(async ([base, p, o]) => {
  const r = await fetch(`${base}${p}`, { credentials: 'include', ...o, headers: o.body ? { 'Content-Type': 'application/json' } : undefined });
  return r.status === 204 ? null : r.json();
}, [API, path, opts]);

async function signIn(page, who = 'Kiran Rao') {
  const mail = email('profile');
  seed('customer', mail, who, PASSWORD);
  await login(page, mail);
  await page.waitForURL('**/me');
  return mail;
}
const saved = (page) => expect(page.getByText('All changes saved')).toBeVisible({ timeout: 10_000 });
const serverProfile = async (page) => (await api(page, '/api/me/job-profile')).data;

test('fill the Job Profile; it autosaves and survives a reload and another sign-in; phone and keyboard work', async ({ page, browser }) => {
  const mail = await signIn(page);
  // the sidebar has it between My resumes and ATS & job match
  const nav = page.getByRole('navigation', { name: 'My dashboard', exact: true });
  const around = async () => { const n = await nav.getByRole('link').allInnerTexts(); const at = n.findIndex((x) => x.includes('Job Profile')); return at > 0 ? [n[at - 1], n[at + 1]].map((x) => x.replace(/^\W+/, '').trim()) : null; };
  await expect.poll(around).toEqual(['My resumes', 'ATS & job match']);
  await nav.getByRole('link', { name: /Job Profile/ }).click();
  await expect(page).toHaveURL(/\/me\/profile$/);
  await expect(page.getByRole('heading', { name: 'Job Profile', level: 1 })).toBeVisible();
  await expect(page.getByText(/Profile complete: \d+%/)).toBeVisible();
  await expect(page.getByLabel('Full name')).toHaveValue('Kiran Rao');

  await page.locator('#pf-personal-headline').fill('Data Analyst');
  await page.locator('#pf-personal-phone').fill('98765 43210');
  await page.locator('#pf-personal-location').fill('Pune');
  await page.locator('#pf-links-linkedin').fill('linkedin.com/in/kiran');
  await page.locator('#pf-sum-0').fill('Data analyst who turns messy sales data into dashboards that managers use every week.');
  for (const [k, item, field, a, b] of [['exp', 'experience', '#pf-exp-0-company', 'Zoho', null], ['proj', 'project', '#pf-proj-0-title', 'Apollo Tracker', 'Borealis App'], ['edu', 'education', '#pf-edu-0-institution', 'Anna University', null]]) {
    await page.getByRole('button', { name: `+ Add ${item}` }).click();
    await page.locator(field).fill(a);
    if (b) { await page.getByRole('button', { name: `+ Add ${item}` }).click(); await page.locator(field.replace('-0-', '-1-')).fill(b); }
    void k;
  }
  await page.locator('#pf-exp-0-role').fill('Analyst');
  await page.locator('#pf-sg-0').fill('Python, SQL, Excel, Power BI, Statistics');
  await page.locator('#pf-personal-level').selectOption('Fresher (0–1 yr)'); // Experience level now lives in Basics
  // job preferences were removed: no card, no fields, nothing in the section list
  await expect(page.getByRole('heading', { name: 'Job preferences' })).toHaveCount(0);
  await expect(page.locator('[id^="pf-prefs-"]')).toHaveCount(0);

  // entry controls: keyboard move keeps focus on the moved card; switch off; remove asks first
  await page.getByRole('button', { name: 'Move Project 1 down', exact: true }).focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('#pf-proj-0-title')).toHaveValue('Borealis App');
  await expect(page.locator('#entry-pf-proj-1-title')).toBeFocused();
  await page.getByRole('switch', { name: 'Show this entry (Project 1)' }).click();
  await expect(page.getByRole('switch', { name: 'Show this entry (Project 1)' })).toHaveAttribute('aria-checked', 'false');
  await page.getByRole('button', { name: 'Remove Education 1' }).click();
  await expect(page.getByRole('dialog', { name: 'Remove Education 1?' })).toBeVisible();
  await page.getByRole('button', { name: 'Cancel' }).click();
  await expect(page.locator('#pf-edu-0-institution')).toHaveValue('Anna University');

  await saved(page);
  const pct = Number((await page.getByText(/Profile complete: \d+%/).innerText()).match(/(\d+)%/)[1]);
  expect(pct).toBeGreaterThanOrEqual(60);
  await expect(page.getByText(/Missing:.*Languages/)).toBeVisible();

  const p = await serverProfile(page);
  expect(p.personal).toMatchObject({ name: 'Kiran Rao', headline: 'Data Analyst', phone: '98765 43210', location: 'Pune' });
  expect(p.proj.map((x) => [x.title, !!x.off])).toEqual([['Borealis App', true], ['Apollo Tracker', false]]);
  expect(p.personal.level).toBe('Fresher (0–1 yr)');
  expect(p.prefs).toBeUndefined(); // nothing saved for job preferences any more

  await page.reload();
  await expect(page.locator('#pf-proj-1-title')).toHaveValue('Apollo Tracker');
  await expect(page.locator('#pf-personal-level')).toHaveValue('Fresher (0–1 yr)');

  // another browser (another sign-in) sees the same profile
  const other = await browser.newContext({ viewport: { width: 375, height: 800 } });
  const phone = await other.newPage();
  await login(phone, mail);
  await phone.waitForURL('**/me');
  await phone.goto('/me/profile');
  await expect(phone.locator('#pf-sum-0')).toHaveValue(/turns messy sales data/);
  await expect(phone.locator('#pf-exp-0-company')).toHaveValue('Zoho');
  // phone width: no sideways scrolling, entry controls in one row and tappable
  expect(await phone.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(375);
  const up = await phone.getByRole('button', { name: 'Move Project 2 up', exact: true }).boundingBox();
  const rm = await phone.getByRole('button', { name: 'Remove Project 2' }).boundingBox();
  expect(Math.abs(up.y - rm.y)).toBeLessThan(12);
  expect(up.height).toBeGreaterThanOrEqual(24);
  // editing on the phone shows up in the first browser after a reload
  await phone.locator('#pf-personal-location').fill('Pune, Maharashtra');
  await expect(phone.getByText('All changes saved')).toBeVisible({ timeout: 10_000 });
  await other.close();
  await page.reload();
  await expect(page.locator('#pf-personal-location')).toHaveValue('Pune, Maharashtra');

  // Settings keeps account details only
  await page.goto('/me/settings');
  await expect(page.getByLabel('Target role')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Fill these into my resume' })).toHaveCount(0);
  await expect(page.getByRole('link', { name: /Job Profile/ }).last()).toBeVisible();
});

/* ---------- a full profile, saved through the API ---------- */
const NOW = Date.now();
const e = (x, i) => ({ ...x, pid: `p${i}`, pu: NOW });
const PROFILE = {
  personal: { name: 'Kiran Rao', headline: 'Data Analyst', email: 'kiran@example.com', phone: '98765 43210', location: 'Pune' },
  links: { linkedin: 'linkedin.com/in/kiran-rao', github: 'github.com/kiranrao', portfolio: 'kiran.dev' },
  summaries: [{ id: 's1', name: 'Data roles', text: 'Data analyst who turns messy sales data into dashboards that managers use every week.' }, { id: 's2', name: 'Short', text: 'Analyst who ships dashboards.' }],
  exp: [e({ company: 'Zoho', role: 'Analyst', from: '2024-01', to: '', current: true, description: 'Built 12 dashboards' }, 1)],
  intern: [e({ company: 'TCS', role: 'Data Intern', from: '2023-01', to: '2023-06', description: 'Cleaned 1M rows' }, 2)],
  proj: [e({ title: 'Apollo Tracker', description: 'Tracks launches' }, 3), e({ title: 'Borealis App', description: 'Aurora alerts' }, 4)],
  edu: [e({ institution: 'Anna University', degree: 'B.Tech', field: 'CSE' }, 5)],
  certs: [e({ name: 'Google Data Analytics', issuer: 'Google' }, 6)],
  ach: [e({ title: 'Hackathon winner' }, 7)],
  langs: [e({ name: 'Marathi', level: 'Native' }, 8)],
  extra: [e({ title: 'NSS volunteer', description: 'Ran blood donation camps' }, 9)],
  skillGroups: [e({ id: 'core', label: 'Core', value: 'Python, SQL, Excel, Power BI, Statistics' }, 10)],
  hobbies: 'Chess\nCycling', strengths: 'Quick learner', offLines: {},
  pinfo: { father: 'R. Rao', mother: '', dob: '2001-02-03', gender: '', marital: '', nationality: 'Indian', languages: '', address: '' },
  decl: { text: 'I hereby declare that the above is true.', place: 'Pune', date: '', name: '' },
  prefs: { targetRoles: 'Data Analyst', cities: 'Pune, Remote', level: 'Junior (1–3 yrs)', notice: '1 month', salaryMin: '6', salaryMax: '9' },
};
const putProfile = async (page, data, version) => api(page, '/api/me/job-profile', { method: 'PUT', body: JSON.stringify({ data, version }) });
const activeResume = async (page) => (await api(page, '/api/me/resumes')).find((r) => r.active);
const preview = (page) => page.getByRole('article', { name: 'Resume preview' });
const goTo = (page, side) => page.getByRole('button', { name: new RegExp(`^.?\\s*${side}( · \\d+ hidden)?`) }).first().click();

test('start a resume from the Job Profile: every section copied, old job preferences never; fill sections (Add vs Replace); hints', async ({ page }) => {
  await signIn(page);
  await expect.poll(async () => (await api(page, '/api/me/resumes')).length).toBe(1);
  await putProfile(page, PROFILE, 0);

  await page.goto('/builder');
  const card = page.getByRole('button', { name: /Start from my Job Profile/ });
  await expect(card).toContainText('Recommended');
  await expect(page.getByRole('button', { name: /Start from scratch/ })).not.toContainText('Recommended');
  await card.click();
  await expect(page.getByTestId('tp-use-top')).toBeVisible(); // the Template step
  await page.getByTestId('tp-use-top').click();

  // the new account's untouched first resume is used (no empty copy left behind); it holds every profile section
  await expect.poll(async () => (await activeResume(page)).name).toContain('from Job Profile');
  expect((await api(page, '/api/me/resumes')).length).toBe(1);
  await expect.poll(async () => (await activeResume(page)).data.exp?.length).toBe(2);
  const { data: d, name } = await activeResume(page);
  expect(name).toContain('from Job Profile');
  expect(d.personal).toMatchObject({ name: 'Kiran Rao', headline: 'Data Analyst', email: 'kiran@example.com', phone: '98765 43210', location: 'Pune', level: 'Junior (1–3 yrs)' });
  expect(d.summary).toBe(PROFILE.summaries[0].text);
  expect(d.exp.map((x) => [x.company, x.employmentType || ''])).toEqual([['Zoho', ''], ['TCS', 'Internship']]);
  expect(d.proj.map((x) => x.title)).toEqual(['Apollo Tracker', 'Borealis App']);
  expect(d.edu.map((x) => x.institution)).toEqual(['Anna University']);
  expect(d.certs[0].name).toBe('Google Data Analytics');
  expect(d.ach[0].title).toBe('Hackathon winner');
  expect(d.langs.map((x) => x.name)).toEqual(['Marathi']);
  expect(d.custom[0]).toMatchObject({ title: 'Extracurricular Activities', items: [expect.objectContaining({ title: 'NSS volunteer' })] });
  expect(d.skillGroups[0].value).toBe('Python, SQL, Excel, Power BI, Statistics');
  expect(d.hobbies).toBe('Chess\nCycling');
  expect(d.strengths).toBe('Quick learner');
  expect(d.pinfo).toMatchObject({ father: 'R. Rao', dob: '2001-02-03' });
  expect(d.decl.place).toBe('Pune');
  expect(d.links).toMatchObject({ linkedin: 'linkedin.com/in/kiran-rao', github: 'github.com/kiranrao', portfolio: 'kiran.dev' });
  // PROFILE is an older record that still holds job preferences: only its experience level carries over (it moved
  // to Personal info); cities, notice period and salary are never copied
  expect(d.prefs).toBeUndefined();
  expect(JSON.stringify(d)).not.toMatch(/salaryMin|salaryMax|Pune, Remote|1 month/);
  for (const t of ['Kiran Rao', 'Zoho', 'TCS', 'Apollo Tracker', 'Anna University', 'Google Data Analytics', 'Hackathon winner', 'Marathi', 'NSS volunteer', 'Power BI', 'Chess']) await expect(preview(page)).toContainText(t);
  // the profile's job preferences (salary) are never printed
  await expect(preview(page)).not.toContainText('LPA');

  // Projects already has content: Fill from profile asks Add or Replace
  await goTo(page, 'Projects');
  await page.getByRole('button', { name: 'Fill from profile' }).click();
  let dlg = page.getByRole('dialog', { name: 'Fill Projects from my Job Profile' });
  await expect(dlg.getByText('Projects already has content on this resume')).toBeVisible();
  await dlg.getByRole('checkbox', { name: 'Apollo Tracker' }).check();
  await dlg.getByRole('checkbox', { name: 'Borealis App' }).uncheck();
  await dlg.getByRole('radio', { name: /Replace it/ }).check();
  await dlg.getByRole('button', { name: 'Replace with 1' }).click();
  await expect(page.locator('#proj-0-title')).toHaveValue('Apollo Tracker');
  await expect(page.locator('#proj-1-title')).toHaveCount(0);
  await page.getByRole('button', { name: 'Fill from profile' }).click();
  dlg = page.getByRole('dialog', { name: 'Fill Projects from my Job Profile' });
  await expect(dlg.getByRole('checkbox', { name: 'Apollo Tracker' })).not.toBeChecked(); // already on the resume
  await expect(dlg.getByRole('checkbox', { name: 'Borealis App' })).toBeChecked();
  await expect(dlg.getByRole('radio', { name: /Add to it/ })).toBeChecked(); // never overwrites unless asked
  await dlg.getByRole('button', { name: 'Add 1' }).click();
  await expect(page.locator('#proj-1-title')).toHaveValue('Borealis App');
  await expect(page.locator('#proj-2-title')).toHaveCount(0);

  // an empty section is just filled (no question)
  await goTo(page, 'Achievements');
  await page.getByRole('button', { name: 'Remove Achievement 1' }).click();
  await page.getByRole('dialog', { name: 'Remove Achievement 1?' }).getByRole('button', { name: 'Remove' }).click();
  await page.getByRole('button', { name: 'Fill from profile' }).click();
  dlg = page.getByRole('dialog', { name: 'Fill Achievements from my Job Profile' });
  await expect(dlg.getByRole('radio', { name: /Replace it/ })).toHaveCount(0);
  await dlg.getByRole('button', { name: 'Add 1' }).click();
  await expect(page.locator('#ach-0-title')).toHaveValue('Hackathon winner');

  // an empty field shows its profile value; one click (or keyboard) fills it
  await goTo(page, 'Personal');
  await page.locator('#personal-phone').fill('');
  const hint = page.getByRole('button', { name: 'Use Phone from my Job Profile: 98765 43210' });
  await expect(hint).toContainText('From profile: 98765 43210');
  await hint.focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('#personal-phone')).toHaveValue('98765 43210');
  await expect(hint).toHaveCount(0);
});

test('a resume is a copy: edits stay out of the profile until saved; profile updates are offered for review', async ({ page }) => {
  await signIn(page);
  await expect.poll(async () => (await api(page, '/api/me/resumes')).length).toBe(1);
  await putProfile(page, PROFILE, 0);
  await page.goto('/builder');
  await page.getByRole('button', { name: /Start from my Job Profile/ }).click();
  await page.getByTestId('tp-use-top').click();
  await expect.poll(async () => (await activeResume(page))?.data.exp?.length).toBe(2);

  // edit a project on the resume: the profile is unchanged until "Save this change to my Job Profile"
  await goTo(page, 'Projects');
  await page.locator('#proj-0-title').fill('Apollo Tracker v2');
  const saveBtn = page.getByRole('button', { name: 'Save this change to my Job Profile' });
  await expect(saveBtn).toBeVisible();
  await expect(page.getByText('All changes saved')).toBeVisible({ timeout: 10_000 });
  await expect.poll(async () => (await activeResume(page)).data.proj[0].title).toBe('Apollo Tracker v2');
  expect((await serverProfile(page)).proj[0].title).toBe('Apollo Tracker');
  await saveBtn.click();
  await expect(saveBtn).toHaveCount(0);
  await expect.poll(async () => (await serverProfile(page)).proj[0].title).toBe('Apollo Tracker v2');
  // a brand-new entry can be added to the profile too
  await page.getByRole('button', { name: '+ Add another project' }).click();
  await page.locator('#proj-2-title').fill('Comet Notes');
  await page.getByRole('button', { name: 'Save this to my Job Profile' }).click();
  await expect.poll(async () => (await serverProfile(page)).proj.map((x) => x.title)).toEqual(['Apollo Tracker v2', 'Borealis App', 'Comet Notes']);

  // the profile changes elsewhere (Job Profile page in another tab): the resume offers the updates
  const cur = await api(page, '/api/me/job-profile');
  const next = structuredClone(cur.data);
  next.edu[0] = { ...next.edu[0], institution: 'Anna University, Chennai', pu: Date.now() + 5000 };
  next.certs[0] = { ...next.certs[0], name: 'Google Data Analytics (2025)', pu: Date.now() + 5000 };
  next.personal.location = 'Mumbai';
  await putProfile(page, next, cur.version);
  await page.reload();
  await page.evaluate(() => window.history.replaceState({ usr: { open: 'build' }, key: 'x' }, ''));
  await page.reload();
  const review = page.getByRole('button', { name: 'Review 3 updates' });
  await expect(review).toBeVisible();
  await review.click();
  const dlg = page.getByRole('dialog', { name: 'Updates from your Job Profile' });
  await dlg.getByRole('button', { name: /Accept update: .*Anna University, Chennai/ }).click();
  await dlg.getByRole('button', { name: /Skip update: Google Data Analytics/ }).click();
  await dlg.getByRole('button', { name: 'Accept update: Location' }).click();
  await expect(page.getByRole('button', { name: /^Review \d+ update/ })).toHaveCount(0);
  await expect.poll(async () => { const r = (await activeResume(page)).data; return [r.edu[0].institution, r.certs[0].name, r.personal.location]; }).toEqual(['Anna University, Chennai', 'Google Data Analytics', 'Mumbai']);
  // skipped updates aren't offered again after a reload
  await page.reload();
  await expect(preview(page)).toContainText('Anna University, Chennai');
  await expect(page.getByRole('button', { name: /^Review \d+ update/ })).toHaveCount(0);
});

test('new users are pointed at the Job Profile; scans and cover letters use it; older API: profile features step aside', async ({ page }) => {
  await signIn(page, 'Neha Joshi');
  await expect(page.getByText('Set up your Job Profile (3 min)')).toBeVisible();
  await page.getByRole('link', { name: 'Set up my Job Profile' }).click();
  await expect(page).toHaveURL(/\/me\/profile$/);
  await expect(page.locator('#pf-personal-name')).toHaveValue('Neha Joshi');

  // a scan of their old resume can be saved into the profile
  await page.goto('/');
  await page.locator('#role').fill('Data Analyst');
  await page.locator('input[type=file]').first().setInputFiles({ name: 'Neha_Joshi.docx', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', buffer: docxOf(['Neha Joshi', 'neha@example.com · +91 99887 66554', 'Skills', 'SQL, Excel, Power BI', 'Education', 'B.Sc Statistics · Loyola College · 2024']) });
  await page.getByRole('button', { name: 'Save this to my Job Profile' }).click();
  await expect(page.getByRole('link', { name: 'Open my Job Profile' })).toBeVisible();
  await expect.poll(async () => (await serverProfile(page))?.personal?.phone).toMatch(/99887/);
  const p = await serverProfile(page);
  expect(p.personal.name).toBe('Neha Joshi');
  expect(JSON.stringify(p.skillGroups)).toContain('Power BI');

  // cover letters start with the role from the headline (old stored target roles are ignored)
  const cur = await api(page, '/api/me/job-profile');
  await putProfile(page, { ...cur.data, personal: { ...cur.data.personal, headline: 'Business Analyst · SQL' }, prefs: { targetRoles: 'Product Manager' } }, cur.version);
  await page.goto('/me/covers');
  await page.getByRole('button', { name: 'New cover letter' }).click();
  await expect(page.locator('#cv-ro')).toHaveValue('Business Analyst');

  // an older server without the Job Profile: the page says so, the builder start and section fill stay hidden
  await page.route('**/api/me/job-profile', (r) => r.fulfill({ status: 404, contentType: 'application/json', body: '{"detail":"Not Found"}' }));
  await page.goto('/me/profile');
  await expect(page.getByText('Your Job Profile is being switched on.')).toBeVisible();
  await page.goto('/me');
  await expect(page.getByText('Set up your Job Profile (3 min)')).toHaveCount(0);
  await page.goto('/builder');
  await expect(page.getByRole('button', { name: /Start from scratch/ })).toContainText('Recommended');
  await expect(page.getByRole('button', { name: /Start from my Job Profile/ })).toHaveCount(0);
  await page.getByRole('button', { name: /Start from scratch/ }).click();
  await page.getByTestId('tp-use-top').click();
  await expect(page.getByRole('button', { name: 'Fill from profile' })).toHaveCount(0);
});

function docxOf(paragraphs) {
  const body = paragraphs.map((t) => `<w:p><w:r><w:t xml:space="preserve">${t}</w:t></w:r></w:p>`).join('');
  const doc = `<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}</w:body></w:document>`;
  return Buffer.from(zipSync({ 'word/document.xml': strToU8(doc), 'word/_rels/document.xml.rels': strToU8('<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"></Relationships>') }));
}
