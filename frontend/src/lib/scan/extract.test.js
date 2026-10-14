import { describe, expect, it } from 'vitest';
import { strToU8, zipSync } from 'fflate';
import { MESSAGES, checkFile, extractDocx, extractPdf } from './extract';
import { detectPdfLayout } from './layout';
import { analyzeResume } from './analyze';

const p = (t) => `<w:p><w:r><w:t xml:space="preserve">${t}</w:t></w:r></w:p>`;
function docx(body, rels = '') {
  const doc = `<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}</w:body></w:document>`;
  const relsXml = `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${rels}</Relationships>`;
  return zipSync({ 'word/document.xml': strToU8(doc), 'word/_rels/document.xml.rels': strToU8(relsXml) });
}

describe('file checks', () => {
  it('accepts PDF and DOCX, rejects others and old .doc', () => {
    expect(checkFile({ name: 'a.pdf', type: 'application/pdf', size: 10 })).toBe('pdf');
    expect(checkFile({ name: 'a.docx', type: '', size: 10 })).toBe('docx');
    expect(() => checkFile({ name: 'a.doc', type: '', size: 10 })).toThrow(MESSAGES.doc);
    expect(() => checkFile({ name: 'a.png', type: 'image/png', size: 10 })).toThrow(MESSAGES.type);
    expect(() => checkFile({ name: 'big.pdf', type: 'application/pdf', size: 6 * 1024 * 1024 })).toThrow(/over 5 MB/);
  });

  it('rejects a text file renamed to .pdf without calling pdf.js', async () => {
    const fake = new TextEncoder().encode('hello pdf!');
    await expect(extractPdf(fake, null)).rejects.toThrow(MESSAGES.notPdf);
  });

  it('rejects a renamed .docx and an empty one', async () => {
    await expect(extractDocx(new TextEncoder().encode('not a zip'))).rejects.toThrow(MESSAGES.notDocx);
    await expect(extractDocx(docx(p('Hi')))).rejects.toThrow(MESSAGES.empty);
  });

  it('reads a real .docx: text, a table and a picture', async () => {
    const body = [p('Meera Iyer'), p('meera@example.com · +91 99887 66554'), p('Skills'),
      '<w:tbl><w:tr><w:tc>' + p('SQL') + '</w:tc><w:tc>' + p('Excel') + '</w:tc></w:tr></w:tbl>',
      p('Education'), p('B.Sc Statistics · Loyola College · 2024')].join('');
    const r = await extractDocx(docx(body, '<Relationship Id="rId5" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/image1.png"/>'));
    expect(r.lines.map((l) => l.text)).toContain('Meera Iyer');
    expect(r.layout).toMatchObject({ tables: 1, images: 1, multiColumn: false });
    expect(r.resume.personal.email).toBe('meera@example.com');
    const report = analyzeResume({ lines: r.lines, role: 'Data Analyst', layout: r.layout });
    expect(report.issues.map((i) => i.title)).toContain('Content inside a table');
  });
});

describe('detectPdfLayout', () => {
  const W = 612;
  const item = (str, x, y, page = 1) => ({ str, x, y, w: str.length * 5, size: 10, page });

  it('single column: no columns, no tables (right-aligned dates are fine)', () => {
    const items = [];
    for (let i = 0; i < 30; i++) items.push(item(`Built dashboard number ${i} for the sales team`, 50, 100 + i * 14));
    items.push(item('Data Analyst Intern · Flipkart', 50, 60), item('Jan 2025 – Jun 2025', 480, 60));
    expect(detectPdfLayout(items, [{ w: W, h: 792 }])).toMatchObject({ multiColumn: false, tableRows: [] });
  });

  it('two columns: text starting in the middle of the page on many rows', () => {
    const items = [];
    for (let i = 0; i < 20; i++) {
      items.push(item(`SQL Python Excel ${i}`, 40, 100 + i * 14));
      items.push(item(`Built dashboard number ${i} for sales`, 240, 100 + i * 14));
    }
    const layout = detectPdfLayout(items, [{ w: W, h: 792 }]);
    expect(layout.multiColumn).toBe(true);
    expect(layout.splitX).toBe(236); // just left of where the right column starts (x = 240)
  });

  it('table: rows with three or more cells', () => {
    const items = [];
    for (let i = 0; i < 4; i++) items.push(item('SQL', 40, 100 + i * 14), item('Python', 200, 100 + i * 14), item('Excel', 380, 100 + i * 14));
    expect(detectPdfLayout(items, [{ w: W, h: 792 }]).tableRows).toHaveLength(4);
  });
});
