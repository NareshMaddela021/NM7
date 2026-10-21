// The free scan must read the user's own file (in the browser) — not show the sample.
import { expect, test } from '@playwright/test';
import { strToU8, zipSync } from 'fflate';

const STRONG = `
<h1>Asha Kumar</h1>
<p>Bengaluru · asha.kumar@gmail.com · +91 98450 12345 · linkedin.com/in/asha-kumar</p>
<h2>Summary</h2><p>Data analyst fresher with a 6-month analytics internship. Skilled in SQL, Python (Pandas), Excel and Power BI; built dashboards used by 40 managers.</p>
<h2>Skills</h2><p>SQL, Python, Pandas, Excel, Pivot tables, Power BI, Tableau, Statistics, A/B testing, Data cleaning, Data visualisation</p>
<h2>Experience</h2><p>Data Analyst Intern · Flipkart · Jan 2025 – Jun 2025</p>
<ul><li>Built 6 Power BI dashboards that cut weekly sales reporting from 5 hours to 30 minutes.</li>
<li>Wrote 40+ SQL queries to clean and merge order data for 1.2 million rows.</li>
<li>Ran an A/B test on the checkout page across 12,000 sessions; variant B lifted conversions by 9%.</li></ul>
<h2>Projects</h2><ul><li>Analysed 3 years of Bengaluru rainfall data in Python and presented 5 findings to 60 students.</li>
<li>Automated a monthly Excel report with pivot tables, saving the department 4 hours each month.</li></ul>
<h2>Education</h2><p>B.Tech, Computer Science · RV College of Engineering · 2025 · 8.4 CGPA</p>
<h2>Achievements</h2><ul><li>Ranked 3rd of 120 teams in the college data hackathon (Feb 2024).</li>
<li>Led a team of 4 to build a placement-statistics dashboard used by 300 students.</li></ul>`;

const WEAK_TWO_COLUMN = `
<style>.g{display:grid;grid-template-columns:200px 1fr;gap:32px} body{font-family:Arial;font-size:12px}</style>
<h1>Ravi Shankar</h1><p>Chennai · ravi.s@gmail.com</p>
<div class="g">
 <div><h3>Skills</h3><p>Excel and data entry work</p><p>Customer handling skills</p><p>Tally basics and typing</p><p>Good communication skills</p><p>Hindi Tamil and English</p><p>MS Office and email work</p><p>Report making in Excel</p></div>
 <div><h3>Career Objective</h3><p>Seeking a challenging role in a reputed organisation where I can grow my skills.</p>
 <h3>Experience</h3><p>Intern · ABC Traders · June 2024 – 08/2024</p>
 <p>• Responsible for making reports in Excel every week.</p><p>• Helped with data entry for the sales team daily.</p><p>• Worked on customer records and filing for the office.</p>
 <h3>Education</h3><p>B.Com · XYZ College · 2024</p></div>
</div>`;

async function pdfOf(browser, html) {
  const page = await browser.newPage();
  await page.setContent(`<html><body style="font-family:Arial;padding:24px">${html}</body></html>`);
  const pdf = await page.pdf({ format: 'A4' });
  await page.close();
  return pdf;
}
async function imageOnlyPdf(browser) {
  const page = await browser.newPage();
  await page.setContent('<canvas id="c" width="600" height="800"></canvas><script>const x=document.getElementById("c").getContext("2d");x.fillStyle="#123";for(let i=0;i<40;i++)x.fillRect(20,20+i*18,400+(i%5)*20,8);</script>');
  const pdf = await page.pdf({ format: 'A4' });
  await page.close();
  return pdf;
}
function docxOf(paragraphs) {
  const body = paragraphs.map((t) => `<w:p><w:r><w:t xml:space="preserve">${t}</w:t></w:r></w:p>`).join('');
  const doc = `<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}</w:body></w:document>`;
  return Buffer.from(zipSync({ 'word/document.xml': strToU8(doc), 'word/_rels/document.xml.rels': strToU8('<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"></Relationships>') }));
}

async function scan(page, file, role = 'Data Analyst') {
  await page.goto('/');
  await page.locator('#role').fill(role);
  await page.locator('input[type=file]').first().setInputFiles(file);
}
const pdfFile = (name, buffer) => ({ name, mimeType: 'application/pdf', buffer });
const score = async (page) => Number(await page.getByTestId('score').innerText());

test('scans the uploaded PDFs — each shows its own resume and score; same file = same score', async ({ page, browser }) => {
  const strong = pdfFile('Asha_Kumar_Resume.pdf', await pdfOf(browser, STRONG));
  const weak = pdfFile('Ravi_Shankar_CV.pdf', await pdfOf(browser, WEAK_TWO_COLUMN));

  await scan(page, strong);
  await expect(page.getByText('Asha_Kumar_Resume.pdf', { exact: true })).toBeVisible();
  const preview = page.getByTestId('resume-preview');
  await expect(preview).toContainText('Asha Kumar');
  await expect(preview).toContainText('Built 6 Power BI dashboards');
  await expect(preview).not.toContainText('Sai Varsha');
  await expect(page.getByText('Sample resume')).toHaveCount(0);
  const a = await score(page);

  await scan(page, weak);
  await expect(page.getByText('Ravi_Shankar_CV.pdf', { exact: true })).toBeVisible();
  await expect(page.getByTestId('resume-preview')).toContainText('Responsible for making reports in Excel');
  await expect(page.getByTestId('issue').filter({ hasText: 'Two-column layout' })).toBeVisible();
  const b = await score(page);
  expect(b).toBeLessThan(a - 25);

  await scan(page, strong);
  await expect(page.getByText('Asha_Kumar_Resume.pdf', { exact: true })).toBeVisible();
  expect(await score(page)).toBe(a);

  // the role changes the keyword match
  await scan(page, strong, 'Software Engineer');
  await expect(page.getByText('Keywords for Software Engineer')).toBeVisible();
  expect(await score(page)).toBeLessThan(a);

  // "keep fixing it myself" opens the builder with this resume, not the sample
  await scan(page, strong);
  await page.getByRole('link', { name: 'or keep fixing it myself' }).click();
  await expect(page).toHaveURL(/\/builder/);
  await expect(page.getByLabel('Full name *')).toHaveValue('Asha Kumar');
});

test('rejects a fake PDF and an image-only PDF with a friendly message', async ({ page, browser }) => {
  await scan(page, pdfFile('fake.pdf', Buffer.from('hello pdf!')));
  await expect(page).toHaveURL(/\/#scan$/); // back at the scan box on the home page
  await expect(page.getByRole('alert')).toHaveCount(1); // shown once, under the box that was used
  await expect(page.getByRole('alert')).toContainText('isn’t a real PDF');

  await scan(page, pdfFile('scanned.pdf', await imageOnlyPdf(browser)));
  await expect(page.getByRole('alert')).toContainText('almost no text');
});

test('reads a Word file', async ({ page }) => {
  await scan(page, { name: 'Meera_Iyer.docx', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    buffer: docxOf(['Meera Iyer', 'meera@example.com · +91 99887 66554', 'Skills', 'SQL, Excel, Power BI', 'Education', 'B.Sc Statistics · Loyola College · 2024']) });
  await expect(page.getByText('Meera_Iyer.docx', { exact: true })).toBeVisible();
  await expect(page.getByTestId('resume-preview')).toContainText('Meera Iyer');
});

test('/scan with nothing uploaded goes back to the upload box; only the sample shows Sai Varsha, labelled', async ({ page }) => {
  await page.goto('/scan');
  await expect(page).toHaveURL(/\/#scan$/);
  await expect(page.locator('#role')).toBeVisible();

  await page.getByRole('button', { name: 'No resume handy? Try a sample' }).first().click();
  await expect(page.getByText('Sample resume').first()).toBeVisible();
  await expect(page.getByTestId('resume-preview')).toContainText('Sai Varsha');
  await page.getByRole('link', { name: 'or keep fixing it myself' }).click();
  await expect(page.getByLabel('Full name *')).toHaveValue('');
});

test('role is capped at 60 characters and long text never widens the page', async ({ page, browser }) => {
  await page.goto('/');
  await page.locator('#role').fill('x'.repeat(300));
  await expect(page.locator('#role')).toHaveValue('x'.repeat(60));
  await scan(page, pdfFile('Asha_Kumar_Resume.pdf', await pdfOf(browser, STRONG)), 'y'.repeat(60));
  await expect(page.getByTestId('score')).toBeVisible();
  const [scrollW, viewW] = await page.evaluate(() => [document.documentElement.scrollWidth, window.innerWidth]);
  expect(scrollW).toBeLessThanOrEqual(viewW);
});

test('copy says the file stays on the device', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByText('Read on your device — never uploaded').first()).toBeVisible();
  await expect(page.getByText(/Deleted automatically after/)).toHaveCount(0);
});
