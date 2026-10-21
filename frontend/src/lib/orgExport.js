// Nm7 for Organizations: printing many shared resumes at once (admin → Shared resumes).
// Each resume is drawn by the same PDF maker members download with (so it matches their template exactly), in the
// admin's browser, in batches of 25. The server only hands out the data and records what was printed:
//   POST {base}/shared-resumes/exports → GET …/exports/{job}/data?offset&limit → POST …/exports/{job}/done
import { jsPDF } from 'jspdf';
import { PDFDocument } from 'pdf-lib';
import { zipSync } from 'fflate';
import { DEFAULT_DESIGN, TEMPLATE_PRESETS } from '../pages/builder/design';
import { http } from '../services/http';
import { brandDesign, prepareBrand } from './branding';
import { freshImport } from './chunks';

export const BATCH = 25;
export const designOf = (d) => ({ ...DEFAULT_DESIGN, ...(d.design || TEMPLATE_PRESETS.fresher.design), preset: d.design?.preset ?? 'fresher' });

const bytesOf = async (b) => (b instanceof Uint8Array ? b : new Uint8Array(await b.arrayBuffer()));

/** One PDF from many: every page of every file, in order. Returns { bytes, pages }. */
export async function mergePdfs(files) {
  const out = await PDFDocument.create();
  for (const f of files) {
    const src = await PDFDocument.load(await bytesOf(f));
    const pages = await out.copyPages(src, src.getPageIndices());
    pages.forEach((p) => out.addPage(p));
  }
  out.setTitle('Nm7 · shared resumes');
  out.setCreator('Nm7 Resume Builder');
  return { bytes: await out.save(), pages: out.getPageCount() };
}

/** The optional first page: organization, group, date and how many resumes follow. */
export function coverPdf({ orgs = [], groups = [], count = 0, date = new Date() }) {
  const doc = new jsPDF({ unit: 'pt', format: 'a4' });
  const x = 56;
  doc.setFont('helvetica', 'bold'); doc.setFontSize(26);
  doc.text(doc.splitTextToSize(orgs.join(', ') || 'Shared resumes', 480), x, 120);
  doc.setFont('helvetica', 'normal'); doc.setFontSize(14); doc.setTextColor(70, 70, 70);
  let y = 170;
  for (const g of groups.slice(0, 20)) { doc.text(doc.splitTextToSize(g, 480), x, y); y += 22; }
  if (groups.length > 20) { doc.text(`and ${groups.length - 20} more groups`, x, y); y += 22; }
  y += 20;
  doc.setFontSize(12);
  doc.text(`${count} resume${count === 1 ? '' : 's'} · printed ${date.toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' })}`, x, y);
  doc.setFontSize(10); doc.setTextColor(120, 120, 120);
  doc.text('Shared by the candidates with their consent via Nm7 (nm7.si). For printing and placement support only.', x, 780);
  return doc.output('blob');
}

/** The server's file-name rule, mirrored for a row that reaches the browser without one: letters and digits in any
 * script (with their vowel signs) stay, everything else becomes one underscore; nothing usable → the membership id. */
export function zipName({ fileName, name, membershipId }) {
  if (fileName) return fileName;
  const keep = (c) => /[\p{L}\p{N}\p{M}\u200c\u200d]/u.test(c);
  const slug = [...(name || '')].map((c) => (keep(c) ? c : '_')).join('').replace(/_+/g, '_').replace(/^[_\u200c\u200d]+|[_\u200c\u200d]+$/g, '').slice(0, 60);
  return `${slug || String(membershipId || '').slice(0, 8)}_Resume.pdf`.replace(/^_/, '');
}

/** A ZIP of { fileName, bytes } (PDFs are already compressed: stored, not deflated again). File names are stored
 * as UTF-8 with the ZIP's UTF-8 flag set (fflate does this), so Telugu or Hindi names unpack as typed. */
export function zipFiles(files) {
  return zipSync(Object.fromEntries(files.map((f) => [f.fileName, [f.bytes, { level: 0 }]])));
}

const stamp = (d = new Date()) => d.toISOString().slice(0, 10);

/**
 * Runs one export job. kind: 'print_bulk' (one combined PDF) | 'export_zip' (one PDF per person) | 'download' | 'print'
 * (one resume). `base`: '/api/admin' or '/api/org/<id>' (a coordinator). `ids` = a selection, or null for everything matching `filters`. onProgress({ done, total, stage }).
 * Returns { blob, fileName, pages?, total, skipped }.
 */
export async function runExport({ base = '/api/admin', kind, ids = null, filters = {}, sort = 'name', direction = 'asc', cover = false, onProgress = () => {}, signal, build }) {
  const job = await http(`${base}/shared-resumes/exports`, { method: 'POST', body: { kind, ids, filters, sort, direction } });
  // groups printing in their organization's template: the brand comes with the job (logo drawn once)
  const brands = Object.fromEntries(await Promise.all(Object.entries(job.brands || {}).map(async ([k, b]) => [k, await prepareBrand(b)])));
  const makePdf = build || (async (data, brand) => (await freshImport(() => import('../pages/builder/resumePdf'))).buildResumePdf({ data, design: brand ? brandDesign(brand) : designOf(data), brand }));
  const files = [];
  let skipped = 0;
  onProgress({ done: 0, total: job.total, stage: 'Drawing resumes' });
  for (let offset = 0; offset < job.total; offset += BATCH) {
    if (signal?.aborted) throw new DOMException('Stopped', 'AbortError');
    const batch = await http(`${base}/shared-resumes/exports/${encodeURIComponent(job.job)}/data?offset=${offset}&limit=${BATCH}`);
    for (const [i, row] of batch.entries()) {
      if (signal?.aborted) throw new DOMException('Stopped', 'AbortError');
      if (!row.data) { skipped += 1; continue; } // left the group or deleted the resume since the job started
      const item = job.items[offset + i];
      files.push({ fileName: zipName(item), bytes: await bytesOf(await makePdf(row.data, item.brand ? brands[item.brand] : null)) });
      onProgress({ done: offset + i + 1, total: job.total, stage: 'Drawing resumes' });
    }
  }
  if (!files.length) throw new Error('None of these resumes can be printed any more.');
  onProgress({ done: job.total, total: job.total, stage: kind === 'export_zip' ? 'Packing the ZIP' : 'Putting the pages together' });
  let result;
  if (kind === 'export_zip') {
    result = { blob: new Blob([zipFiles(files)], { type: 'application/zip' }), fileName: `Nm7_resumes_${stamp()}.zip` };
  } else if (kind === 'print_bulk') {
    const parts = files.map((f) => f.bytes);
    if (cover) parts.unshift(coverPdf({ ...job.cover, count: files.length }));
    const { bytes, pages } = await mergePdfs(parts);
    result = { blob: new Blob([bytes], { type: 'application/pdf' }), fileName: `Nm7_resumes_${stamp()}.pdf`, pages };
  } else {
    result = { blob: new Blob([files[0].bytes], { type: 'application/pdf' }), fileName: files[0].fileName };
  }
  await http(`${base}/shared-resumes/exports/${encodeURIComponent(job.job)}/done`, { method: 'POST', body: {} });
  return { ...result, total: files.length, skipped, job: job.job };
}
