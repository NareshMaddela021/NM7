// Reads the user's resume in the browser (it is never uploaded) into plain lines + layout signals for the scan,
// plus the builder-ready details for "keep fixing it myself".
import { loadPdfjs, MAX_MB } from '../import/index';
import { readPdf, toLines } from '../import/pdfRead';
import { readDocx } from '../import/docxRead';
import { isLinkedInPdf, parseLinkedIn } from '../import/linkedin';
import { parseResume } from '../import/resume';
import { finish } from '../import/shared';
import { detectPdfLayout } from './layout';

export const MIN_PDF_CHARS = 100;
const fail = (code, message) => Object.assign(new Error(message), { code });
export const MESSAGES = {
  type: 'Please upload a PDF or Word (.docx) file.',
  doc: 'Old .doc files can’t be read. In Word, use File → Save As → .docx or PDF, then upload again.',
  size: `This file is over ${MAX_MB} MB. Try a smaller copy (export again as PDF).`,
  notPdf: 'This file isn’t a real PDF — it may have been renamed. Open your resume and export or save it as PDF, then try again.',
  notDocx: 'This file isn’t a real Word document. Open your resume and save it as .docx or PDF, then try again.',
  password: 'This PDF is password-protected. Remove the password (or export a new copy) and upload it again.',
  unreadable: 'We couldn’t open this file. It may be damaged — try exporting it again as PDF.',
  scanned: 'This PDF has almost no text — it looks like a scanned image or photo. Tracking systems can’t read it either: export your resume from Word or Google Docs as PDF and scan that.',
  empty: 'We couldn’t find any text in this Word file. Check it opens correctly, or export it as PDF and try again.',
};

const startsWith = (buf, sig) => sig.every((b, i) => buf[i] === b);
const near = (list, l) => list.some((r) => r.page === l.page && Math.abs(r.y - l.y) <= 2);

/** Validates a picked file before reading it (type, size). */
export function checkFile(file) {
  const name = file?.name || '';
  if (/\.doc$/i.test(name)) throw fail('doc', MESSAGES.doc);
  const isPdf = /\.pdf$/i.test(name) || file.type === 'application/pdf';
  const isDocx = /\.docx$/i.test(name) || file.type === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
  if (!isPdf && !isDocx) throw fail('type', MESSAGES.type);
  if (file.size > MAX_MB * 1024 * 1024) throw fail('size', MESSAGES.size);
  return isPdf ? 'pdf' : 'docx';
}

export async function extractDocx(buf) {
  if (!startsWith(buf, [0x50, 0x4b])) throw fail('notDocx', MESSAGES.notDocx);
  let r;
  try { r = readDocx(buf); } catch { throw fail('notDocx', MESSAGES.notDocx); }
  const text = r.lines.map((l) => l.text).join(' ');
  if (text.replace(/\s/g, '').length < 40) throw fail('empty', MESSAGES.empty);
  const R = parseResume(r.lines, { links: r.links, source: 'docx' });
  finish(R, { pages: 1 });
  return {
    kind: 'docx',
    lines: r.lines.map((l) => ({ text: l.text })),
    layout: { multiColumn: r.layout.textBoxes > 0 || r.layout.columns > 1, tables: r.layout.tables, images: r.layout.images },
    pages: 1, // Word doesn't store page breaks reliably; length is judged by word count
    links: r.links.map((l) => l.url),
    resume: R.data,
  };
}

export async function extractPdf(buf, pdfjs) {
  if (!startsWith(buf, [0x25, 0x50, 0x44, 0x46, 0x2d])) throw fail('notPdf', MESSAGES.notPdf); // "%PDF-"
  let r;
  try { r = await readPdf(pdfjs, buf); } catch (e) {
    if (e?.name === 'PasswordException') throw fail('password', MESSAGES.password);
    throw fail('unreadable', MESSAGES.unreadable);
  }
  const chars = r.items.reduce((s, i) => s + i.str.replace(/\s/g, '').length, 0);
  if (chars < MIN_PDF_CHARS) throw fail('scanned', MESSAGES.scanned);
  const layout = detectPdfLayout(r.items, r.pages);
  // Two columns: read each page's left column, then its right column (an ATS reading straight across mixes them;
  // that is reported as an issue, but the rest of the check should see your real lines).
  const ordered = layout.multiColumn
    ? r.pages.flatMap((_, i) => {
      const onPage = r.items.filter((it) => it.page === i + 1);
      return [...toLines(onPage, { maxX: layout.splitX }), ...toLines(onPage, { minX: layout.splitX })];
    })
    : toLines(r.items);
  const lines = ordered.map((l) => ({
    text: l.text, page: l.page, y: l.y, table: near(layout.tableRows, l), columnStart: near(layout.columnStarts, l),
  }));
  const R = isLinkedInPdf(r) ? parseLinkedIn(r) : parseResume(ordered, { links: r.links });
  finish(R, { pages: r.pages.length });
  return {
    kind: 'pdf',
    lines,
    layout: { multiColumn: layout.multiColumn, tables: layout.tableRows.length ? 1 : 0, images: r.images },
    pages: r.pages.length,
    links: r.links.map((l) => l.url),
    resume: R.data,
  };
}

/** @returns {Promise<{fileName, kind, lines, layout, pages, links, resume}>} */
export async function extractResume(file) {
  const kind = checkFile(file);
  const buf = new Uint8Array(await file.arrayBuffer());
  const out = kind === 'pdf' ? await extractPdf(buf, await loadPdfjs()) : await extractDocx(buf);
  return { fileName: file.name || `resume.${kind}`, ...out };
}
