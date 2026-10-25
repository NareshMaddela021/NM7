import { describe, expect, it } from 'vitest';
import { fileName, fileSlug, resumeFileName } from './fileName';
import { qrFileName, qrPosterFileName } from './qr';
import { bannerFileName } from './linkedin/pack';
import { zipName } from './orgExport';
import { pdfName } from './recruiter';

describe('one file-name rule for every resume file (QA)', () => {
  it('an en dash, spaces and punctuation become one underscore, the same in the builder and the org export', () => {
    expect(resumeFileName('TEST – Data Analyst')).toBe('TEST_Data_Analyst_Resume.pdf');
    expect(zipName({ name: 'TEST – Data Analyst' })).toBe('TEST_Data_Analyst_Resume.pdf');
    expect(pdfName('TEST – Data Analyst')).toBe('TEST_Data_Analyst_Resume.pdf');
    expect(resumeFileName('Asha Rao', { kind: 'Cover_Letter', ext: 'docx' })).toBe('Asha_Rao_Cover_Letter.docx');
    expect(resumeFileName('  O’Brien / R.  ')).toBe('O_Brien_R_Resume.pdf');
    expect(resumeFileName('Asha 🚀 Rao')).toBe('Asha_Rao_Resume.pdf');
    expect(resumeFileName('రాము కుమార్')).toBe('రాము_కుమార్_Resume.pdf'); // names in Indian scripts stay readable
    expect(resumeFileName('', { fallback: 'ab12cd34ef' })).toBe('ab12cd34ef_Resume.pdf');
    expect(resumeFileName('')).toBe('Resume.pdf');
    expect(fileSlug('x'.repeat(80))).toHaveLength(60);
  });
});

describe('fileName: one helper for every download', () => {
  it('drops empty parts and repeats, ignoring case', () => {
    expect(fileName(['AsuraaX', 'AsuraaX', 'Job Drive 2026', 'QR'], 'png')).toBe('AsuraaX_Job_Drive_2026_QR.png');
    expect(fileName(['AsuraaX', 'asuraax', '', null, undefined, 'Resume'], 'pdf')).toBe('AsuraaX_Resume.pdf');
    // the org name already inside the group name or the resume name
    expect(fileName(['AsuraaX', 'AsuraaX Job Drive 2026', 'QR'], 'png')).toBe('AsuraaX_Job_Drive_2026_QR.png');
    expect(fileName(['JNTU Anantapur', 'B.Tech 2026 – JNTU Anantapur', 'QR'], 'png')).toBe('B_Tech_2026_JNTU_Anantapur_QR.png');
    expect(fileName(['Asha Rao Resume', 'Resume'], 'pdf')).toBe('Asha_Rao_Resume.pdf');
    // one part that already says a word twice
    expect(fileName(['AsuraaX AsuraaX Batch'], 'csv')).toBe('AsuraaX_Batch.csv');
    expect(fileName(['AsuraaX_ASURAAX_shortlist'], 'zip')).toBe('AsuraaX_shortlist.zip');
    // a word that only looks similar stays
    expect(fileName(['Asura', 'AsuraaX Batch'], 'pdf')).toBe('Asura_AsuraaX_Batch.pdf');
  });

  it('safe characters only, about 80 characters at most, the extension kept, a fallback when nothing is left', () => {
    expect(fileName(['Acme & Co. (India)', 'shortlist'], 'csv')).toBe('Acme_Co_India_shortlist.csv');
    expect(fileName(['a/b\\c:d*e?f"g<h>i|j'], 'pdf')).toBe('a_b_c_d_e_f_g_h_i_j.pdf');
    const long = fileName(['A very long college name that goes on and on', 'Another long group name for the batch of 2026', 'QR', 'poster'], 'pdf');
    expect(long.length).toBeLessThanOrEqual(80);
    expect(long.endsWith('.pdf')).toBe(true);
    expect(long).not.toMatch(/_\.pdf$/);
    expect(fileName(['x'.repeat(200)], 'zip').length).toBeLessThanOrEqual(80);
    expect(fileName(['', '🚀'], 'csv')).toBe('Nm7.csv');
    expect(fileName([], 'zip', { fallback: 'Shortlist' })).toBe('Shortlist.zip');
    expect(fileName(['Asha'], '.PDF')).toBe('Asha.pdf');
    expect(fileName(['Nm7', 'resumes', '2026-10-25'], 'zip')).toBe('Nm7_resumes_2026-10-25.zip'); // dates keep their dashes
    expect(fileName(['రాము కుమార్', 'రాము'], 'pdf')).toBe('రాము_కుమార్.pdf');
  });

  it('every download uses it', () => {
    expect(qrFileName('AsuraaX', 'AsuraaX Job Drive 2026')).toBe('AsuraaX_Job_Drive_2026_QR.png');
    expect(qrPosterFileName('AsuraaX', 'AsuraaX Job Drive 2026')).toBe('AsuraaX_Job_Drive_2026_QR_poster.pdf');
    expect(qrFileName('Stall 1', 'kiosk')).toBe('Stall_1_kiosk_QR.png');
    expect(resumeFileName('AsuraaX Resume')).toBe('AsuraaX_Resume.pdf');
    expect(resumeFileName('Asha Rao', { kind: 'Cover_Letter' })).toBe('Asha_Rao_Cover_Letter.pdf');
    expect(bannerFileName('Ravi Kumar')).toBe('Ravi_Kumar_LinkedIn_Banner.png');
    expect(bannerFileName('')).toBe('My_LinkedIn_Banner.png');
  });
});
