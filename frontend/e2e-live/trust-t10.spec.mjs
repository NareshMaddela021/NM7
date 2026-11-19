// Vetting Trust T10 (the spoken-English score from the voice interview) on a desktop and a 390 px phone, against the real
// API (no AI key here, so grammar and comprehension come from the rules; the test pronunciation provider is on):
//   - a tester candidate starts the AI interview, chooses "Speak my answers" in English and "Also measure my spoken
//     English": the voice consent text appears and is agreed to there; the 7 answers are spoken (the browser's speech
//     recognition and microphone are stand-ins here: a sentence, a tone); the result shows the band with its four
//     sub-scores; Profile & settings shows the band, "how this was measured", the retake path, and English
//     "verified (Bx)" in Work preferences;
//   - Hire now, for a "Customer Support Executive" job: each person's band as a chip ("Measured by Nm7 voice
//     interview"), English verified in the languages, and the "Spoken English: B1 or above" filter; a data analyst job
//     has no such filter;
//   - Admin → Vetting Trust → Spoken English: provider, keys set / not set, the role categories (one changed and put
//     back), counts;
//   - while the switch is off, someone who isn't a tester sees no spoken-English choice.
// Desktop and phone share one database: every test uses its own people and companies and puts any setting back.
import { expect, test } from '@playwright/test';
import { API, PASSWORD, adminLogin, email, lastCode, login, ownNetwork, seed } from './helpers.mjs';
import { SIZES, noSideScroll } from './college.mjs';

const uniq = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
const letters = () => Math.random().toString(36).replace(/[^a-z]/g, '').slice(0, 5).padEnd(5, 'x');
const phone = () => `9${String(Date.now()).slice(-6)}${String(Math.floor(Math.random() * 900) + 100)}`;
const SAY = 'I listen to the customer first, then I check the order in the system and explain the next step clearly to them.';

/** Stand-ins for the browser's speech recognition (says SAY) and the microphone (a quiet tone). */
async function fakeSpeech(page) {
  await page.addInitScript((say) => {
    class FakeRec {
      start() {
        this.t1 = setTimeout(() => this.onresult?.({ resultIndex: 0, results: [Object.assign([{ transcript: say.split(' ').slice(0, 6).join(' '), confidence: 0.9 }], { isFinal: false })] }), 200);
        this.t2 = setTimeout(() => this.onresult?.({ resultIndex: 0, results: [Object.assign([{ transcript: say, confidence: 0.9 }], { isFinal: true })] }), 900);
      }
      stop() { clearTimeout(this.t1); setTimeout(() => this.onend?.(), 30); }
      abort() { clearTimeout(this.t1); clearTimeout(this.t2); setTimeout(() => this.onend?.(), 0); }
    }
    window.SpeechRecognition = FakeRec;
    window.webkitSpeechRecognition = FakeRec;
    if (navigator.mediaDevices) {
      navigator.mediaDevices.getUserMedia = async () => {
        const ctx = new AudioContext();
        const o = ctx.createOscillator();
        const g = ctx.createGain(); g.gain.value = 0.2;
        const d = ctx.createMediaStreamDestination();
        o.connect(g); g.connect(d); o.start();
        return d.stream;
      };
    }
  }, SAY);
}

async function person(page, who, name, { trust = true } = {}) {
  const mail = email(`${who}-${uniq()}`);
  seed('customer', mail, name, PASSWORD);
  seed('vetting-tester', mail);
  seed('trust-t10-badge', mail, 'SQL');
  if (trust) { seed('trust-tester', mail); seed('trust-face', mail, 'no'); seed('trust-agent-person', mail, phone()); } // T3 done, adult age check
  await login(page, mail);
  await page.waitForURL('**/me');
  return mail;
}

async function company(request, tag) {
  const site = `t10${tag}.example`;
  const mail = `hr-t10${tag}@example.com`;
  const body = { details: { legalName: `T10${tag} Services Pvt Ltd`, website: site, category: 'startup', structure: 'private_limited', industry: 'Retail', size: '11_50', about: '' }, registration: { kind: 'llpin', number: 'AAB-1234' }, phone: '' };
  const NET = ownNetwork();
  await request.post(`${API}/api/company/signup/code`, { headers: NET, data: { email: mail, name: 'Tara' } });
  const r = await (await request.post(`${API}/api/company/signup/start`, { headers: NET, data: { email: mail, name: 'Tara', code: lastCode(mail), company: body } })).json();
  const H = { 'X-Recruiter-Account': r.session };
  await request.post(`${API}/api/company/${r.company.id}/company-email/code`, { data: { email: `jobs@${site}` }, headers: { ...H, ...NET } });
  await request.post(`${API}/api/company/${r.company.id}/company-email/verify`, { data: { code: lastCode(`jobs@${site}`) }, headers: H });
  seed('company-verify', r.company.id);
  seed('trust-tester', mail);
  return { id: r.company.id, session: r.session, H };
}

for (const [label, opts] of SIZES) {
  test.describe(label, () => {
    test.use(opts);

    test('voice interview in English: opt in with the voice consent, the band and sub-scores, profile and languages', async ({ page }) => {
      test.setTimeout(180_000);
      page.on('dialog', () => { throw new Error('no browser dialogs'); });
      await fakeSpeech(page);
      await person(page, `tt10iv-${label}`, `Asha Spoken ${label}`);
      await page.goto('/me/interviews');
      await page.getByTestId('iv-role').filter({ hasText: 'SQL' }).getByTestId('iv-start-SQL').click();
      await page.getByTestId('iv-mode-text').check();
      await expect(page.getByTestId('sp-choice-off')).toContainText('choose “Speak my answers” in English', { timeout: 20_000 });
      await page.getByTestId('iv-mode-voice').check();
      const choice = page.getByTestId('sp-choice');
      await choice.getByTestId('sp-tick').click(); // asks for the consent first: stays unticked
      const consent = choice.getByTestId('sp-consent');
      await expect(consent).toContainText('Voice recordings and transcripts');
      await expect(consent).toContainText('never used to guess your caste, religion, region');
      await expect(choice.getByTestId('sp-tick')).not.toBeChecked(); // not until they agree
      expect(await noSideScroll(page)).toBe(true);
      await consent.getByTestId('sp-agree').click();
      await expect(choice.getByTestId('sp-tick')).toBeChecked();
      await page.getByTestId('pledge-interview').getByTestId('pledge-tick').check();
      await page.getByTestId('iv-agree').check();
      await page.getByTestId('iv-go').click();

      await expect(page.getByTestId('iv-spoken-on')).toContainText('Your spoken English is being measured', { timeout: 20_000 });
      await expect(page.getByTestId('iv-sound-note')).toContainText('speech-assessment partner and is then deleted');
      for (let n = 1; n <= 7; n += 1) {
        await expect(page.getByTestId('iv-progress')).toContainText(`${n} of 7`, { timeout: 30_000 });
        await page.getByTestId('iv-mic').click();
        await expect(page.getByTestId('iv-transcript')).toContainText('explain the next step clearly', { timeout: 10_000 });
        await page.getByTestId('iv-mic').click(); // stop
        await expect(page.getByTestId('iv-mic')).toContainText('Speak more');
        if (n === 1) expect(await noSideScroll(page)).toBe(true);
        await page.getByTestId('iv-send').click();
      }
      await expect(page.getByTestId('iv-review-text')).toContainText('Our team will grade it', { timeout: 60_000 }); // no AI here
      const sp = page.getByTestId('iv-spoken');
      await expect(sp.getByTestId('sp-band')).toHaveText(/^Spoken English: (A1|A2|B1|B2|C1|C2)$/, { timeout: 20_000 });
      await expect(sp.getByTestId('sp-sub-fluency')).toContainText('words a minute');
      await expect(sp.getByTestId('sp-sub-grammar')).toContainText('Grammar');
      await expect(sp.getByTestId('sp-sub-comprehension')).toContainText('did the answer address the question');
      await expect(sp.getByTestId('sp-sub-pronunciation')).toContainText('Pronunciation');
      const band = (await sp.getByTestId('sp-band').innerText()).split(': ')[1];
      expect(await noSideScroll(page)).toBe(true);

      await page.goto('/me/settings');
      const card = page.getByTestId('sp-card');
      await expect(card.getByTestId('sp-band')).toHaveText(`Spoken English: ${band}`, { timeout: 20_000 });
      await expect(card.getByTestId('sp-band-text')).not.toBeEmpty();
      await card.getByTestId('sp-how').locator('summary').click();
      await expect(card.getByTestId('sp-how')).toContainText('Your accent never lowers it');
      await expect(card.getByTestId('sp-how')).toContainText('not an official CEFR certificate');
      await expect(card.getByTestId('sp-retake')).toContainText(/Retake: take the AI interview again \(1 attempt every 30 days for this role\)\. Next attempt opens on/);
      await expect(page.getByTestId('wp-card').getByTestId('wp-verified-English')).toHaveText(` · verified (${band})`, { timeout: 20_000 });
      expect(await noSideScroll(page)).toBe(true);
    });

    test('Hire now: the band on each person, English verified, the filter only for a customer-support job', async ({ page, request }) => {
      test.setTimeout(180_000);
      page.on('dialog', () => { throw new Error('no browser dialogs'); });
      const tag = `${label[0]}${Date.now().toString(36)}`;
      // the jobs' own place: Hire now's top 10 holds only this test's people, however many Hyderabad candidates the
      // other specs left in the shared database
      const city = `Tq${letters()}pur`;
      const co = await company(request, tag);
      const job = (title) => request.post(`${API}/api/company/${co.id}/jobs`, { headers: co.H, data: { job: { title, description: 'Talk to our customers on calls and chat, solve their order questions and keep notes. Freshers are welcome.', locations: [city], experience: 'fresher', jobType: 'full_time', workType: 'onsite', skills: ['Communication'] } } }).then((r) => r.json());
      const support = await job(`Customer Support Executive ${tag}`);
      const analyst = await job(`Junior Data Analyst ${tag}`);
      expect(support.status).toBe('active');
      const people = [[`Ravi${letters()}`, 'B2', ''], [`Mala${letters()}`, 'A2', 'none']];
      for (const [first, band, pron] of people) {
        const mail = email(`tt10h-${label}-${uniq()}`);
        seed('customer', mail, `${first} Kumar`, PASSWORD);
        seed('trust-agent-person', mail, phone());
        seed('trust-t6-ready', mail, '', city);
        seed('trust-t10-score', mail, band, ...(pron ? [pron] : []));
      }
      await page.goto('/company');
      await page.evaluate((s) => localStorage.setItem('nm7-recruiter-account', s), co.session);
      await page.reload();
      await page.getByRole('tab', { name: 'Hire now' }).click();
      await page.getByTestId('co-hire-job').selectOption(support.id);
      const filters = page.getByTestId('co-hire-nt-filters');
      await expect(filters.getByTestId('co-hire-nt-english')).toBeVisible({ timeout: 20_000 });
      await expect(filters).toContainText('Spoken English · measured by Nm7 voice interview');
      const ravi = page.getByTestId('co-hire-row').filter({ hasText: people[0][0] });
      const mala = page.getByTestId('co-hire-row').filter({ hasText: people[1][0] });
      await expect(ravi.getByTestId('co-hire-nt-english')).toContainText('Spoken English B2 (pronunciation', { timeout: 20_000 });
      await expect(ravi.getByTestId('co-hire-nt-english')).toContainText('· Measured by Nm7 voice interview');
      await expect(ravi.getByTestId('co-hire-nt-langs')).toContainText('English (verified (B2))');
      await expect(mala.getByTestId('co-hire-nt-english')).toContainText('Spoken English A2');
      await expect(mala.getByTestId('co-hire-nt-english')).toContainText('pronunciation not measured');
      expect(await noSideScroll(page)).toBe(true);
      await filters.getByTestId('co-hire-nt-english').selectOption('B1');
      await expect(mala).toHaveCount(0, { timeout: 20_000 });
      await expect(ravi).toBeVisible();
      await expect(filters).toContainText(/measured by Nm7 voice interview \([1-9]\d*\)/);
      await filters.getByTestId('co-hire-nt-clear').click();
      await expect(mala).toBeVisible({ timeout: 20_000 }); // nobody is hidden unless the company chooses the filter
      // a data analyst job: no spoken-English filter
      await page.getByTestId('co-hire-job').selectOption(analyst.id);
      await expect(page.getByTestId('co-hire-row').filter({ hasText: people[0][0] })).toBeVisible({ timeout: 20_000 });
      await expect(filters.getByTestId('co-hire-nt-english')).toHaveCount(0);
      expect(await noSideScroll(page)).toBe(true);
    });

    test('Admin: provider, keys set / not set, role categories with the filter, counts', async ({ page }) => {
      const owner = `tt10-owner-${label}-${uniq()}@nm7.si`;
      const { secret } = seed('admin', owner, 'owner', PASSWORD);
      await adminLogin(page, owner, secret);
      await expect(page).not.toHaveURL(/\/login/);
      page.on('dialog', () => { throw new Error('no browser dialogs'); });
      await page.goto('/admin/skill-tests?tab=trust');
      const card = page.getByTestId('ts-card');
      await expect(card.getByTestId('ts-provider')).toHaveValue('mock', { timeout: 20_000 });
      await expect(page.getByTestId('tt-page').getByRole('status').filter({ hasText: 'Loading' })).toHaveCount(0, { timeout: 20_000 });
      await expect(card.getByTestId('ts-state')).toContainText('Test mode');
      await expect(card.getByTestId('ts-keys-azure')).toContainText('AZURE_SPEECH_KEY: not set');
      await expect(card.getByTestId('ts-cat-customer_support')).toBeChecked();
      await expect(card.getByTestId('ts-cat-it')).not.toBeChecked();
      await expect(card.getByTestId('ts-keep')).not.toBeChecked();
      await expect(card.getByTestId('ts-counts')).toContainText(/Scores: \d+/);
      expect(await noSideScroll(page)).toBe(true);
      const saved = () => page.waitForResponse((r) => new URL(r.url()).pathname === '/api/admin/trust/spoken' && r.request().method() === 'GET');
      await card.getByTestId('ts-cat-hospitality').check();
      let back = saved();
      await card.getByTestId('ts-save').click();
      await back;
      await expect(card.getByTestId('ts-cat-hospitality')).toBeChecked();
      await card.getByTestId('ts-cat-hospitality').uncheck(); // put it back (shared database)
      back = saved();
      await card.getByTestId('ts-save').click();
      await back;
      await expect(card.getByTestId('ts-cat-hospitality')).not.toBeChecked();
      await card.getByTestId('ts-how').locator('summary').click();
      await expect(card.getByTestId('ts-how')).toContainText('Upper intermediate');
      expect(await noSideScroll(page)).toBe(true);
    });

    test('switch off: no spoken-English choice for someone who is not a tester', async ({ page }) => {
      await fakeSpeech(page);
      await person(page, `tt10off-${label}`, `Lata Off ${label}`, { trust: false });
      await page.goto('/me/interviews');
      await page.getByTestId('iv-role').filter({ hasText: 'SQL' }).getByTestId('iv-start-SQL').click();
      await page.getByTestId('iv-mode-voice').check();
      await expect(page.getByTestId('iv-consent')).toContainText('No audio is recorded, stored or sent');
      await page.waitForLoadState('networkidle');
      await expect(page.getByTestId('sp-choice')).toHaveCount(0);
      await expect(page.getByTestId('sp-choice-off')).toHaveCount(0);
      expect(await noSideScroll(page)).toBe(true);
    });
  });
}
