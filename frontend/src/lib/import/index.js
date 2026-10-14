// Entry point for "Import LinkedIn" and "Rebuild my old resume".
// Everything runs in the browser: the file never leaves the device in this version.
// Later the server can take over (scanned resumes, AI checks) — see services/api.js → parseResume.
import { readPdf, toLines } from './pdfRead';
import { isLinkedInPdf, parseLinkedIn } from './linkedin';
import { parseResume } from './resume';
import { finish } from './shared';
import { readDocx, readText } from './docxRead';

export const MAX_MB = 5;
const err = (code, msg) => Object.assign(new Error(msg), { code });

let pdfjsP = null;
export async function loadPdfjs() {
  if (!pdfjsP) {
    pdfjsP = (async () => {
      // pdf.js runs on the main thread here (its "fake worker"), so no extra worker file is needed.
      const worker = await import('pdfjs-dist/build/pdf.worker.js');
      globalThis.pdfjsWorker = worker.default || worker;
      const lib = await import('pdfjs-dist/build/pdf.js');
      return lib.default || lib;
    })();
  }
  return pdfjsP;
}

/** Small images of the first pages, for the side-by-side review. */
async function thumbnails(doc, max = 3) {
  const out = [];
  for (let p = 1; p <= Math.min(doc.numPages, max); p++) {
    try {
      const page = await doc.getPage(p);
      const vp = page.getViewport({ scale: 1.1 });
      const canvas = document.createElement('canvas');
      canvas.width = vp.width; canvas.height = vp.height;
      await page.render({ canvasContext: canvas.getContext('2d'), viewport: vp }).promise;
      out.push(canvas.toDataURL('image/jpeg', 0.82));
    } catch { /* thumbnail is optional */ }
  }
  return out;
}

/**
 * @param {File|{text:string}} input  a PDF/DOCX file, or pasted text
 * @param {'linkedin'|'resume'} mode   what the user chose (we still detect a LinkedIn PDF either way)
 * @param {(step:number)=>void} onStep progress: 0 reading, 1 sections, 2 skills, 3 dates/checks
 */
export async function importResume(input, mode, onStep = () => {}) {
  const tick = (n) => new Promise((r) => { onStep(n); setTimeout(r, 260); });
  await tick(0);
  if (typeof input.text === 'string') {
    if (input.text.trim().length < 40) throw err('empty', 'Paste a bit more — we need at least a few lines.');
    const { lines, links } = readText(input.text);
    await tick(1);
    const R = parseResume(lines, { links, source: 'text' });
    await tick(2);
    finish(R, { pages: 1 });
    await tick(3);
    return { ...R, fileName: 'Pasted text', thumbs: [], pages: 1 };
  }
  const file = input;
  if (file.size > MAX_MB * 1024 * 1024) throw err('size', `This file is over ${MAX_MB} MB. Try a smaller copy, or paste the text instead.`);
  const name = file.name || 'file';
  const buf = await file.arrayBuffer();
  const isPdf = /\.pdf$/i.test(name) || file.type === 'application/pdf';
  const isDocx = /\.docx$/i.test(name);
  if (/\.doc$/i.test(name)) throw err('doc', 'Old .doc files can’t be read here. In Word, use File → Save As → .docx or PDF, then upload again.');
  if (/\.(png|jpe?g|webp|heic)$/i.test(name)) throw err('scanned', 'Photos of resumes need text recognition, which comes in the live app. For now, upload a PDF or Word file, or paste the text.');
  if (!isPdf && !isDocx) throw err('type', 'Please upload a PDF or Word (.docx) file.');

  if (isDocx) {
    const { lines, links } = readDocx(buf);
    await tick(1);
    const R = parseResume(lines, { links, source: 'docx' });
    await tick(2);
    finish(R, { pages: 1 });
    await tick(3);
    return { ...R, fileName: name, thumbs: [], pages: 1 };
  }

  const pdfjs = await loadPdfjs();
  let r;
  try { r = await readPdf(pdfjs, new Uint8Array(buf)); } catch (e) {
    if (e?.name === 'PasswordException') throw err('password', 'This PDF is password-protected. Remove the password and upload it again.');
    throw err('unreadable', 'We couldn’t open this PDF. It may be damaged — try saving it again, or paste the text.');
  }
  const chars = r.items.reduce((s, i) => s + i.str.trim().length, 0);
  if (chars < 80) throw err('scanned', 'This PDF looks like a scanned image, so there’s no text to read. Text recognition comes in the live app — for now, paste the text instead.');
  await tick(1);
  const linkedin = isLinkedInPdf(r);
  const R = linkedin ? parseLinkedIn(r) : parseResume(toLines(r.items), { links: r.links });
  if (mode === 'linkedin' && !linkedin) R.notes.unshift({ kind: 'info', sec: 'review', msg: 'This isn’t LinkedIn’s profile PDF, so we read it as a regular resume.' });
  if (mode === 'resume' && linkedin) R.notes.unshift({ kind: 'info', sec: 'review', msg: 'This is a LinkedIn profile PDF — we used our LinkedIn reader for it.' });
  await tick(2);
  finish(R, { pages: r.pages.length });
  const thumbs = await thumbnails(r.doc);
  await tick(3);
  return { ...R, fileName: name, thumbs, pages: r.pages.length };
}
