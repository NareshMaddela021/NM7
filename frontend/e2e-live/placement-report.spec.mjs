// Placement report PDF on a desktop and a 390 px phone, against the real API: Org > Drives has "Placement report
// for the year" (with the NAAC / NIRF note, not an official format) and each drive day a "Drive report (PDF)"; both
// download a PDF with the numbers by branch and company and no student names or contact details.
import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { pdfText } from './helpers.mjs';
import { SIZES, call, college, json, noSideScroll } from './college.mjs';

async function saved(page, click) {
  const [file] = await Promise.all([page.waitForEvent('download', { timeout: 30_000 }), click()]);
  return { name: file.suggestedFilename(), text: [].concat(await pdfText(readFileSync(await file.path()))).join('\n') };
}

for (const [label, opts] of SIZES) {
  test.describe(label, () => {
    test.use(opts);

    test('year report and drive report: numbers only, NAAC / NIRF note', async ({ browser }) => {
      test.setTimeout(150_000);
      const c = await college(browser, opts, label, { students: 2, prefix: 'rp' });
      const [s0, s1] = c.students;
      const base = `/api/org/${c.org.id}`;
      const day = new Date(Date.now() + 5.5 * 3600e3).toISOString().slice(0, 10);
      expect((await call(c.coord, `${base}/offers`, json('POST', { membershipId: s0.mid, company: 'Infosys', ctcLpa: 4.5, status: 'accepted', offerDate: day }))).status).toBe(201);
      const d = await call(c.coord, `${base}/drives`, json('POST', { name: 'Infosys day', date: day, groupIds: [c.group.id], companies: ['Infosys'] }));
      expect(d.status).toBe(201);

      await c.coord.goto(`/org/${c.org.id}/drives`);
      const box = c.coord.getByTestId('year-report');
      await expect(box).toContainText('NAAC / NIRF');
      await expect(box).toContainText('not an official NAAC or NIRF format');
      const y = await saved(c.coord, () => c.coord.getByTestId('year-report-pdf').click());
      expect(y.name).toMatch(/^placement_report_\d{4}-\d{2}\.pdf$/);
      expect(y.text).toContain('Placement report');
      expect(y.text).toContain('Joined 2');
      expect(y.text).toContain('Placed 1');
      expect(y.text).toContain('Infosys');
      expect(y.text).toContain('CSE');
      for (const leak of [s0.name, s1.name, s0.email, '21A00']) expect(y.text).not.toContain(leak);
      expect(await noSideScroll(c.coord)).toBe(true);

      await c.coord.getByTestId('drive-item').first().click();
      const r = await saved(c.coord, () => c.coord.getByTestId('drive-report').click());
      expect(r.name).toBe('drive_report.pdf');
      expect(r.text).toContain('Drive report');
      expect(r.text).toContain('Infosys day');
      expect(r.text).toContain('Attended 0');
      for (const leak of [s0.name, s1.email]) expect(r.text).not.toContain(leak);
      expect(await noSideScroll(c.coord)).toBe(true);
      await c.close();
    });
  });
}
