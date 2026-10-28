// Offer tracking on a desktop and a 390 px phone, against the real API: the coordinator records offers (one pre-filled
// from a recruiter's "Selected"), the placement dashboard numbers match (placed / not placed, highest / median /
// average), CSV and the placement report PDF download; each student sees only their own offers.
import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { SIZES, call, college, json, noSideScroll } from './college.mjs';
import { lastCode } from './helpers.mjs';

for (const [label, opts] of SIZES) {
  test.describe(label, () => {
    test.use(opts);

    test('record offers, selected pre-fill, dashboard numbers, CSV and PDF, students see their own', async ({ browser }) => {
      test.setTimeout(150_000);
      const c = await college(browser, opts, label, { students: 3, shareWithRecruiters: true, prefix: 'of' });
      const [a, , d] = c.students;
      const base = `/api/org/${c.org.id}/offers`;
      // two offers by API, one through the form
      expect((await call(c.coord, base, json('POST', { membershipId: a.mid, company: 'Infosys', role: 'Systems Engineer', ctcLpa: 3.6, status: 'accepted' }))).status).toBe(201);
      expect((await call(c.coord, base, json('POST', { membershipId: a.mid, company: 'Zoho', ctcLpa: 7.2, status: 'offered' }))).status).toBe(201);
      // a recruiter selects student b on the shortlist board
      for (const s of c.students) await call(s.page, `/api/me/groups/${s.mid}`, json('PATCH', { recruiterOptIn: true }));
      const rmail = `ravi-${c.tag}@bosch.example`;
      const inv = (await call(c.coord, `/api/org/${c.org.id}/recruiter-invites`, json('POST', { company: 'Bosch HR', recruiterName: 'Ravi', email: rmail, groupIds: [c.group.id], expiresOn: '2026-12-31' }))).body;
      const tok = inv.url.split('/').pop();
      expect((await call(c.admin, `/api/recruiter/${tok}/code`, { method: 'POST' })).status).toBe(200);
      const sess = (await call(c.admin, `/api/recruiter/${tok}/session`, json('POST', { code: lastCode(rmail) }))).body.session;
      const h = { 'Content-Type': 'application/json', 'X-Recruiter-Session': sess };
      const cands = (await call(c.admin, `/api/recruiter/${tok}/candidates`, { headers: h })).body.candidates;
      expect(cands.length).toBe(3);
      const bCard = cands.find((x) => x.name === c.students[1].name) || cands.find((x) => x.name !== a.name);
      expect((await call(c.admin, `/api/recruiter/${tok}/board/${bCard.id}`, { method: 'PUT', headers: h, body: JSON.stringify({ stage: 'selected', note: 'Strong SQL' }) })).status).toBe(200);

      await c.coord.goto(`/org/${c.org.id}/offers`);
      const stats = c.coord.getByTestId('offer-stats');
      await expect(stats.getByTestId('stat-placed')).toHaveText('1');
      await expect(stats.getByTestId('stat-not-placed')).toHaveText('2');
      await expect(stats.getByTestId('stat-highest')).toHaveText('7.2 LPA');
      await expect(stats.getByTestId('stat-median')).toHaveText('5.4 LPA');
      await expect(c.coord.getByTestId('offer-suggestions')).toContainText('Bosch HR');
      await c.coord.getByTestId('offer-suggestions').getByTestId('offer-prefill').first().click();
      await expect(c.coord.getByTestId('offer-company')).toHaveValue('Bosch HR');
      await c.coord.getByTestId('offer-role').fill('Graduate Engineer Trainee');
      await c.coord.getByTestId('offer-ctc').fill('6');
      await c.coord.getByTestId('offer-status').selectOption('accepted');
      await c.coord.getByTestId('offer-save').click();
      await expect(stats.getByTestId('stat-placed')).toHaveText('2');
      await expect(stats.getByTestId('stat-median')).toHaveText('6 LPA'); // 3.6, 6, 7.2
      expect(await noSideScroll(c.coord)).toBe(true);
      const [csv] = await Promise.all([c.coord.waitForEvent('download'), c.coord.getByTestId('offers-csv').click()]);
      expect(readFileSync(await csv.path(), 'utf8')).toContain('Graduate Engineer Trainee');
      const [pdf] = await Promise.all([c.coord.waitForEvent('download'), c.coord.getByTestId('offers-pdf').click()]);
      expect(readFileSync(await pdf.path()).subarray(0, 4).toString()).toBe('%PDF');
      // students: their own offers only
      await a.page.goto('/me/groups');
      await expect(a.page.getByTestId('my-offer')).toHaveCount(2);
      await expect(a.page.getByTestId('my-offers')).toContainText('Zoho');
      await d.page.goto('/me/groups');
      await expect(d.page.getByTestId('my-offers')).toHaveCount(0);
      expect((await call(d.page, '/api/me/offers')).body).toEqual([]);
      expect((await call(d.page, base)).status).toBe(404);
      await c.close();
    });
  });
}
