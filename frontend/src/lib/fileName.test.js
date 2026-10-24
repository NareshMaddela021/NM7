import { describe, expect, it } from 'vitest';
import { fileSlug, resumeFileName } from './fileName';
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
