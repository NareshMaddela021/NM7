// Nm7 for Organizations: printing many shared resumes at once (admin → Shared resumes).
// Each resume is drawn by the same PDF maker members download with (so it matches their template exactly), in the
// admin's browser, in batches of 25. The server only hands out the data and records what was printed:
//   POST /api/admin/shared-resumes/exports → GET …/exports/{job}/data?offset&limit → POST …/exports/{job}/done
import { jsPDF } from 'jspdf';
import { PDFDocument } from 'pdf-lib';
import { zipSync } from 'fflate';
import { DEFAULT_DESIGN, TEMPLATE_PRESETS } from '../pages/builder/design';
import { http } from '../services/http';

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

/** A ZIP of { fileName, bytes } (PDFs are already compressed: stored, not deflated again). */
export function zipFiles(files) {
  return zipSync(Object.fromEntries(files.map((f) => [f.fileName, [f.bytes, { level: 0 }]])));
}

const stamp = (d = new Date()) => d.toISOString().slice(0, 10);

/**
 * Runs one export job. kind: 'print_bulk' (one combined PDF) | 'export_zip' (one PDF per person) | 'download' | 'print'
 * (one resume). `ids` = a selection, or null for everything matching `filters`. onProgress({ done, total, stage }).
 * Returns { blob, fileName, pages?, total, skipped }.
 */
export async function runExport({ kind, ids = null, filters = {}, sort = 'name', direction = 'asc', cover = false, onProgress = () => {}, signal, build }) {
  const job = await http('/api/admin/shared-resumes/exports', { method: 'POST', body: { kind, ids, filters, sort, direction } });
  const makePdf = build || (async (data) => (await import('../pages/builder/resumePdf')).buildResumePdf({ data, design: designOf(data) }));
  const files = [];
  let skipped = 0;
  onProgress({ done: 0, total: job.total, stage: 'Drawing resumes' });
  for (let offset = 0; offset < job.total; offset += BATCH) {
    if (signal?.aborted) throw new DOMException('Stopped', 'AbortError');
    const batch = await http(`/api/admin/shared-resumes/exports/${encodeURIComponent(job.job)}/data?offset=${offset}&limit=${BATCH}`);
    for (const [i, row] of batch.entries()) {
      if (signal?.aborted) throw new DOMException('Stopped', 'AbortError');
      if (!row.data) { skipped += 1; continue; } // left the group or deleted the resume since the job started
      files.push({ fileName: job.items[offset + i].fileName, bytes: await bytesOf(await makePdf(row.data)) });
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
  await http(`/api/admin/shared-resumes/exports/${encodeURIComponent(job.job)}/done`, { method: 'POST', body: {} });
  return { ...result, total: files.length, skipped, job: job.job };
}
