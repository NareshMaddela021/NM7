// Vetting Trust T14 (coding tasks for tech roles) on a desktop and a 390 px phone, against the real API and the test
// sandbox (it runs nothing: code with the starter's TODO fails, MOCK:PASSN=1 passes only the first sample, MOCK:DOWN is
// an unreachable sandbox, other code passes):
//   - a Python candidate (a Trust tester): the task start shows the honesty pledge and the optional "Coding replay"
//     consent line; the coding task opens with the problem, starter code and 2 samples; Run shows the failing sample
//     with expected vs actual; Submit gives "5 of 5 hidden tests passed" and the badge. No skill-check or code response
//     the browser got carries a hidden test, its name or the reference solution;
//   - the sandbox down: Submit keeps the code in the queue ("nothing is lost"), the result says it is waiting, and a
//     reload still has it;
//   - Admin → Vetting Trust → Coding tasks: the sandbox, keys set / not set, limits, the problems, and a result's replay
//     played at 16x with its big paste marked;
//   - the demo company: an applicant's profile shows "5 of 5 hidden tests passed" and the editor replay;
//   - while the switch is off, a candidate who is not a tester gets the written tech task as before.
// Desktop and phone share one database: every test uses its own people; no global setting is changed.
import { expect, test } from '@playwright/test';
import { API, PASSWORD, adminLogin, email, login, seed } from './helpers.mjs';
import { SIZES, call, fitsPhone, json } from './college.mjs';

const GOOD = 'import sys\n\nd = sys.stdin.read().split()\nprint(sum(x for x in map(int, d[1:]) if x % 2 == 0))\n';
const SECRETS = ['1000000000 1000000000 1000000000', '3000000000', 'needs 64-bit', 'negative numbers', '"reference"', '"hidden":'];

test.beforeAll(async ({ request }) => {
  for (let i = 0; i < 20; i += 1) {
    const r = await request.get(`${API}/api/public/prices`).catch(() => null);
    if (r && r.ok()) break;
    await new Promise((ok) => { setTimeout(ok, 1500); });
  }
});

async function person(page, who, name, { trust = true } = {}) {
  const mail = email(`${who}-${Date.now().toString(36)}`);
  seed('customer', mail, name, PASSWORD);
  seed('vetting-tester', mail);
  if (trust) { seed('trust-tester', mail); seed('trust-face', mail, 'no'); }
  await login(page, mail);
  await page.waitForURL('**/me');
  if (trust) expect((await call(page, '/api/me/trust/age', json('POST', { dob: '1999-04-12' }))).status).toBe(200); // the T1 age gate
  return mail;
}

function watchResponses(page) {
  const bodies = [];
  page.on('response', async (r) => {
    if (/\/api\/me\/(skill-checks|trust\/code)/.test(r.url())) {
      try { bodies.push(await r.text()); } catch { /* a redirect or an aborted request */ }
    }
  });
  return bodies;
}

async function startTask(page, id, { consent }) {
  await page.goto(`/me/skill-checks/${id}`);
  const card = page.getByTestId('vt-task-card');
  await expect(card).toContainText('Do the coding task', { timeout: 20_000 });
  const line = card.getByTestId('vt-replay-consent');
  await expect(line).toContainText('We record your typing in this editor only to show reviewers how the solution was written');
  await expect(card.getByTestId('vt-replay-tick')).not.toBeChecked();
  await expect(card.getByTestId('vt-task-open')).toBeDisabled(); // the pledge first
  await card.getByTestId('pledge-task').getByTestId('pledge-tick').check();
  if (consent) await card.getByTestId('vt-replay-tick').check();
  expect(await fitsPhone(page)).toBe(true);
  await card.getByTestId('vt-task-open').click();
  const task = page.getByTestId('ct-task');
  await expect(task).toBeVisible({ timeout: 20_000 });
  return task;
}

for (const [label, opts] of SIZES) {
  test.describe(label, () => {
    test.use(opts);

    test('coding task: consent line, editor, Run on samples, Submit to hidden tests, hidden tests never in the browser', async ({ page }) => {
      test.setTimeout(150_000);
      page.on('dialog', (d) => d.accept()); // "Submit your code?"
      const bodies = watchResponses(page);
      const mail = await person(page, `tt14-${label}`, `Asha Coder ${label}`);
      const { id } = seed('trust-t14-pass', mail, 'Python');
      const task = await startTask(page, id, { consent: true });
      await expect(page.getByTestId('vt-task')).toContainText('Sum of the even numbers');
      await expect(task.getByTestId('ct-recording')).toContainText('Your typing in this editor is recorded');
      await expect(task.getByTestId('ct-lang')).toHaveValue('python');
      await expect(task.getByTestId('ct-code-input')).toHaveValue(/TODO: print the sum of the even numbers/);
      await expect(task.getByTestId('ct-samples')).toContainText('2 hidden tests'.replace('2', '5'));
      expect(await fitsPhone(page)).toBe(true);

      // Run: only the first sample passes; the failing one shows the output and what was expected
      await task.getByTestId('ct-code-input').fill(`${GOOD}# MOCK:PASSN=1\n`);
      await task.getByTestId('ct-run').click();
      const results = task.getByTestId('ct-result');
      await expect(results).toHaveCount(2, { timeout: 20_000 });
      await expect(results.nth(0)).toContainText('✓ Sample 1: a mix');
      await expect(results.nth(1)).toContainText('✗ Sample 2: no even numbers');
      await expect(results.nth(1)).toContainText('Expected');
      await expect(task).toContainText('29 runs left');
      expect(await fitsPhone(page)).toBe(true);

      // another language: its starter code (the editor asks first only when the code was changed: accepted)
      await task.getByTestId('ct-lang').selectOption('java');
      await expect(task.getByTestId('ct-code-input')).toHaveValue(/public class Main/);
      await task.getByTestId('ct-lang').selectOption('python');
      await task.getByTestId('ct-code-input').fill(GOOD);
      await expect(task.getByTestId('ct-saved')).toHaveText('Saved', { timeout: 10_000 }); // saved as they type
      await task.getByTestId('ct-submit').click();

      // the result: the hidden tests decide; the badge
      const done = page.getByTestId('vt-task-done');
      await expect(done).toContainText('Coding task: 5/5', { timeout: 30_000 });
      await expect(done.getByTestId('vt-code-result')).toHaveText('5 of 5 hidden tests passed.');
      await expect(page.getByTestId('vt-verified')).toBeVisible();
      expect(await fitsPhone(page)).toBe(true);
      await page.waitForLoadState('networkidle');
      expect(bodies.length).toBeGreaterThan(4);
      for (const b of bodies) for (const s of SECRETS) expect(b).not.toContain(s);
    });

    test('sandbox down: the submission waits in the queue and nothing is lost', async ({ page }) => {
      test.setTimeout(120_000);
      page.on('dialog', (d) => d.accept());
      const mail = await person(page, `tt14q-${label}`, `Ravi Queue ${label}`);
      const { id } = seed('trust-t14-pass', mail, 'Java');
      const task = await startTask(page, id, { consent: false });
      await expect(task).toContainText('Your typing is not recorded.');
      const code = 'public class Main { public static void main(String[] a) { } } // MOCK:DOWN';
      await task.getByTestId('ct-lang').selectOption('java');
      await task.getByTestId('ct-code-input').fill(code);
      await task.getByTestId('ct-run').click();
      await expect(task.getByTestId('ct-msg')).toContainText('Your code is saved', { timeout: 20_000 });
      await task.getByTestId('ct-submit').click();
      const q = page.getByTestId('ct-queued');
      await expect(q).toContainText('Your code is saved and waiting to be checked', { timeout: 20_000 });
      await expect(q).toContainText('nothing is lost');
      expect(await fitsPhone(page)).toBe(true);
      await page.reload();
      await expect(page.getByTestId('vt-code-queued')).toContainText('Nothing is lost', { timeout: 20_000 });
      const st = await call(page, `/api/me/trust/code/${id}`);
      expect(st.body.submission.status).toBe('queued');
      expect(st.body.draft.source).toBe(code);
      expect(await fitsPhone(page)).toBe(true);
    });

    test('Admin: the Coding tasks card and a replay at 16x with its big paste', async ({ page }) => {
      test.setTimeout(150_000);
      const mail = email(`tt14r-${label}`);
      seed('customer', mail, `Meena Replay ${label}`, PASSWORD);
      seed('trust-t14-code', mail);
      const owner = `tt14-own-${label}-${Date.now().toString(36)}@nm7.si`;
      const { secret } = seed('admin', owner, 'owner', PASSWORD);
      await adminLogin(page, owner, secret);
      await expect(page).not.toHaveURL(/\/login/);
      await page.goto('/admin/skill-tests?tab=trust');
      const card = page.getByTestId('tc-card');
      await expect(card.getByTestId('tc-provider')).toHaveValue('mock', { timeout: 30_000 });
      await expect(card.getByTestId('tc-state')).toContainText('Test mode');
      await expect(card.getByTestId('tc-keys-judge0')).toContainText('JUDGE0_RAPIDAPI_KEY: not set');
      await expect(card.getByTestId('tc-cpuS')).toHaveValue('2');
      await expect(card.getByTestId('tc-memoryMb')).toHaveValue('128');
      await card.getByTestId('tc-health').click();
      await expect(card.getByTestId('tc-health-out')).toContainText('Up');
      await expect(card.getByTestId('tc-problem').filter({ hasText: 'Sum of the even numbers' })).toContainText('validated');
      expect(await fitsPhone(page)).toBe(true);
      const row = card.getByTestId('tc-result').first();
      await expect(row).toContainText('5 of 5 hidden tests');
      await expect(row).toContainText('signals: code_big_paste');
      await row.getByTestId('tc-watch').click();
      const rp = page.getByTestId('ct-replay');
      await expect(rp).toContainText('Only the code editor was recorded', { timeout: 20_000 });
      await expect(rp.getByTestId('ct-pastes')).toContainText('(large)');
      await rp.getByTestId('ct-speed-16').click();
      await expect(rp.getByTestId('ct-speed-16')).toHaveAttribute('aria-pressed', 'true');
      await rp.getByTestId('ct-play').click();
      await expect(rp.getByTestId('ct-paste-mark')).toContainText('helper pasted from my notes', { timeout: 30_000 });
      await expect(rp.getByTestId('ct-step')).toContainText('pasted');
      await rp.getByTestId('ct-end').click();
      await expect(rp.getByTestId('ct-code')).toContainText('print(sum(x for x in nums if x % 2 == 0))');
      expect(await fitsPhone(page)).toBe(true);
    });

    test('demo company: the coding result and the editor replay in an applicant profile', async ({ page }) => {
      test.setTimeout(150_000);
      const owner = `tt14-co-${label}-${Date.now().toString(36)}@nm7.si`;
      const { secret } = seed('admin', owner, 'owner', PASSWORD);
      await adminLogin(page, owner, secret);
      await expect(page).not.toHaveURL(/\/login/);
      await page.goto('/admin/companies');
      await page.getByTestId('demo-company').getByTestId('demo-as-company').click();
      await expect(page).toHaveURL(/\/company$/);
      expect(seed('trust-t14-code', '@demo-applicants').n).toBeGreaterThan(0);
      await page.reload();
      await page.getByRole('tab', { name: 'Applicants' }).click();
      await page.getByTestId('co-applicant').first().getByRole('button', { name: 'Profile', exact: true }).click();
      const code = page.getByTestId('co-code');
      await expect(code.getByTestId('co-code-line')).toContainText('5 of 5 hidden tests passed', { timeout: 20_000 });
      await code.getByTestId('co-code-watch').click();
      const rp = code.getByTestId('ct-replay');
      await expect(rp.getByTestId('ct-pastes')).toContainText('Paste of');
      await rp.getByTestId('ct-end').click();
      await expect(rp.getByTestId('ct-code')).toContainText('def evens(xs)');
      expect(await fitsPhone(page)).toBe(true);
    });

    test('switch off: a candidate who is not a tester gets the written tech task', async ({ page }) => {
      const mail = await person(page, `tt14off-${label}`, `Kiran Written ${label}`, { trust: false });
      const { id } = seed('trust-t14-pass', mail, 'Python');
      await page.goto(`/me/skill-checks/${id}`);
      const card = page.getByTestId('vt-task-card');
      await expect(card).toContainText('Do the practical task', { timeout: 20_000 });
      await expect(card.getByTestId('vt-replay-consent')).toHaveCount(0);
      await card.getByTestId('vt-task-open').click();
      await expect(page.getByTestId('vt-task-text')).toBeVisible({ timeout: 20_000 });
      await expect(page.getByTestId('ct-task')).toHaveCount(0);
      expect((await call(page, `/api/me/trust/code/${id}`)).status).toBe(404);
      expect(await fitsPhone(page)).toBe(true);
    });
  });
}
