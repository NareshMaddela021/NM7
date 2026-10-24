import { afterEach, describe, expect, it, vi } from 'vitest';
import { jsPDF } from 'jspdf';
import { PDFDocument } from 'pdf-lib';
import { unzipSync } from 'fflate';

vi.mock('../services/http', () => ({ http: vi.fn() }));
const { http } = await import('../services/http');
const { coverPdf, mergePdfs, runExport, zipFiles, zipName } = await import('./orgExport');

/** A test resume PDF with `n` pages. */
function pdfOf(n, name = 'x') {
  const doc = new jsPDF({ unit: 'pt', format: 'a4' });
  for (let i = 0; i < n; i += 1) { if (i) doc.addPage(); doc.text(`${name} page ${i + 1}`, 40, 40); }
  return new Uint8Array(doc.output('arraybuffer'));
}
const pagesIn = async (bytes) => (await PDFDocument.load(bytes)).getPageCount();

/** The server side of an export job, answered from `people` ({ name, fileName, pages }). */
function fakeServer(people, kind) {
  const calls = [];
  http.mockImplementation(async (path, opts = {}) => {
    calls.push([opts.method || 'GET', path, opts.body]);
    if (path === '/api/admin/shared-resumes/exports') {
      return { job: 'J1', kind, total: people.length, items: people.map((p, i) => ({ membershipId: `m${i}`, name: p.name, fileName: p.fileName })), cover: { orgs: ['JNTU Anantapur'], groups: ['JNTU Anantapur · B.Tech 2026'], count: people.length } };
    }
    const m = path.match(/exports\/J1\/data\?offset=(\d+)&limit=(\d+)/);
    if (m) return people.slice(+m[1], +m[1] + +m[2]).map((p, i) => ({ membershipId: `m${+m[1] + i}`, data: p.gone ? null : { personal: { name: p.name }, pages: p.pages } }));
    if (path.endsWith('/done')) return { ok: true };
    throw new Error(`unexpected ${path}`);
  });
  return calls;
}
const build = async (data) => pdfOf(data.pages, data.personal.name);

afterEach(() => http.mockReset());

describe('organization exports', () => {
  it('merges PDFs in order: page count = sum of the resumes (+ cover)', async () => {
    const { bytes, pages } = await mergePdfs([pdfOf(1), pdfOf(2), pdfOf(3)]);
    expect(pages).toBe(6);
    expect(await pagesIn(bytes)).toBe(6);
    const withCover = await mergePdfs([coverPdf({ orgs: ['A'], groups: ['A · G'], count: 3 }), pdfOf(1), pdfOf(2)]);
    expect(withCover.pages).toBe(4);
  });

  it('combined PDF job: batches of 25, cover page, then marks the job done', async () => {
    const people = Array.from({ length: 30 }, (_, i) => ({ name: `P${i}`, fileName: `P${i}_Resume.pdf`, pages: 1 + (i % 2) }));
    const calls = fakeServer(people, 'print_bulk');
    const progress = [];
    const r = await runExport({ kind: 'print_bulk', cover: true, build, onProgress: (p) => progress.push(p) });
    const sum = people.reduce((n, p) => n + p.pages, 0);
    expect(r.pages).toBe(sum + 1);
    expect(await pagesIn(new Uint8Array(await r.blob.arrayBuffer()))).toBe(sum + 1);
    expect(r.fileName).toMatch(/^Nm7_resumes_\d{4}-\d\d-\d\d\.pdf$/);
    expect(calls.filter(([, p]) => p.includes('/data?')).map(([, p]) => p.split('?')[1])).toEqual(['offset=0&limit=25', 'offset=25&limit=25']);
    expect(calls.at(-1)[1]).toBe('/api/admin/shared-resumes/exports/J1/done');
    expect(progress.at(-1)).toMatchObject({ done: 30, total: 30 });

    fakeServer(people.slice(0, 3), 'print_bulk');
    expect((await runExport({ kind: 'print_bulk', cover: false, build })).pages).toBe(1 + 2 + 1);
  });

  it('ZIP job: one PDF per person with the server’s file names; people who left are skipped', async () => {
    const people = [
      { name: 'Bala', fileName: '21A01_Bala_Resume.pdf', pages: 2 },
      { name: 'Gone', fileName: '21A02_Gone_Resume.pdf', pages: 1, gone: true },
      { name: 'Asha', fileName: 'Asha_Resume.pdf', pages: 1 },
    ];
    fakeServer(people, 'export_zip');
    const r = await runExport({ kind: 'export_zip', build });
    expect(r.skipped).toBe(1);
    const files = unzipSync(new Uint8Array(await r.blob.arrayBuffer()));
    expect(Object.keys(files)).toEqual(['21A01_Bala_Resume.pdf', 'Asha_Resume.pdf']);
    expect(await pagesIn(files['21A01_Bala_Resume.pdf'])).toBe(2);
  });

  it('zipFiles stores the given names', () => {
    const z = unzipSync(zipFiles([{ fileName: 'a.pdf', bytes: new Uint8Array([1, 2]) }]));
    expect([...z['a.pdf']]).toEqual([1, 2]);
  });

  it('ZIP keeps Indic file names', async () => {
    const names = ['21A01_రాము_కుమార్_Resume.pdf', 'नेहा_शर्मा_Resume.pdf', 'ಸಾಫ್ಟ್\u200cವೇರ್_Resume_2.pdf'];
    const bytes = zipFiles(names.map((fileName, i) => ({ fileName, bytes: new Uint8Array([i]) })));
    expect(Object.keys(unzipSync(bytes))).toEqual(names); // UTF-8 names round-trip (flag bit 11 set)
    const people = [{ name: 'రాము కుమార్', fileName: 'రాము_కుమార్_Resume.pdf', pages: 1 }, { name: 'నేహా', fileName: '', pages: 1 }];
    fakeServer(people, 'export_zip');
    const r = await runExport({ kind: 'export_zip', build });
    expect(Object.keys(unzipSync(new Uint8Array(await r.blob.arrayBuffer())))).toEqual(['రాము_కుమార్_Resume.pdf', 'నేహా_Resume.pdf']);
  });

  it('zipName mirrors the server rule when a row has no file name', () => {
    expect(zipName({ fileName: 'x.pdf', name: 'y' })).toBe('x.pdf');
    expect(zipName({ name: 'Asha  Rao!', membershipId: 'm1' })).toBe('Asha_Rao_Resume.pdf');
    expect(zipName({ name: 'రాము కుమార్', membershipId: 'm1' })).toBe('రాము_కుమార్_Resume.pdf');
    expect(zipName({ name: '...', membershipId: 'abcdefghijkl' })).toBe('abcdefgh_Resume.pdf');
    expect(zipName({ name: '', membershipId: '' })).toBe('Resume.pdf');
  });

  it('stops when asked', async () => {
    fakeServer([{ name: 'A', fileName: 'A_Resume.pdf', pages: 1 }], 'print_bulk');
    const ac = new AbortController(); ac.abort();
    await expect(runExport({ kind: 'print_bulk', build, signal: ac.signal })).rejects.toThrow('Stopped');
  });
});
