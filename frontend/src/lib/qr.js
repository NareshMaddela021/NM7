// QR codes made in the browser (no outside QR service) and saved as files without any network request: the PNG is
// built from a canvas with toBlob() (or, where that is missing, by decoding the canvas's base64 in the page). Never
// fetch() a data: URL — the site's CSP (connect-src) blocks it, and that is how "Download QR code" once did nothing.
import QRCode from 'qrcode';
import { saveBlob } from './fileDownload';
import { fileSlug } from './fileName';

export const QR_PRINT_SIZE = 1024; // px, enough for an A4 poster
export const QR_FAILED = 'Couldn’t download the QR. Long-press or right-click the QR to save it.';

/** A canvas with the QR of `text`: at least `size` px square, black on white, with a 4-module white quiet zone. */
export async function qrCanvas(text, size = QR_PRINT_SIZE) {
  const canvas = document.createElement('canvas');
  await QRCode.toCanvas(canvas, text, { width: size, margin: 4, errorCorrectionLevel: 'M', color: { dark: '#000000', light: '#ffffff' } });
  return canvas;
}

/** "data:image/png;base64,…" → Blob, decoded in the page (no fetch). */
export function dataUrlToBlob(dataUrl) {
  const [head, b64] = String(dataUrl).split(',');
  const type = /data:([^;]+)/.exec(head)?.[1] || 'application/octet-stream';
  const bin = atob(b64 || '');
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type });
}

/** The canvas as a PNG Blob: toBlob(), else the base64 decoded in the page. */
export function canvasToPng(canvas) {
  return new Promise((resolve) => {
    if (typeof canvas.toBlob === 'function') canvas.toBlob((b) => resolve(b || dataUrlToBlob(canvas.toDataURL('image/png'))), 'image/png');
    else resolve(dataUrlToBlob(canvas.toDataURL('image/png')));
  });
}

/** The QR of `text` as a print-size PNG Blob. */
export const qrPngBlob = async (text, size = QR_PRINT_SIZE) => canvasToPng(await qrCanvas(text, size));

/** "<org>_<group>_QR.png" with the same rule as resume files (letters and digits stay, the rest one underscore). */
export const qrFileName = (...parts) => `${fileSlug(parts.filter(Boolean).join(' ')) || 'Nm7'}_QR.png`;

/** Saves the QR of `text` as a PNG; throws with QR_FAILED when the browser won't make or save it. */
export async function downloadQrPng(text, filename) {
  try {
    saveBlob(await qrPngBlob(text), filename);
  } catch {
    throw new Error(QR_FAILED);
  }
}

/** An A4 poster PDF: the QR, the group's name, its join code and "Scan to share your resume". */
export async function qrPosterPdf({ text, title, code, subtitle = '' }) {
  const { jsPDF } = await import('jspdf');
  const doc = new jsPDF({ unit: 'pt', format: 'a4' });
  const W = doc.internal.pageSize.getWidth();
  const canvas = await qrCanvas(text, QR_PRINT_SIZE);
  const side = 380;
  doc.setFont('helvetica', 'bold'); doc.setFontSize(30);
  doc.text(doc.splitTextToSize(String(title || ''), W - 120), W / 2, 110, { align: 'center' });
  if (subtitle) { doc.setFont('helvetica', 'normal'); doc.setFontSize(15); doc.text(String(subtitle), W / 2, 150, { align: 'center' }); }
  doc.addImage(canvas, 'PNG', (W - side) / 2, 180, side, side); // jsPDF reads the canvas itself: no data: fetch
  doc.setFont('helvetica', 'bold'); doc.setFontSize(26);
  doc.text('Scan to share your resume', W / 2, 610, { align: 'center' });
  doc.setFont('helvetica', 'normal'); doc.setFontSize(16);
  doc.text(`Or open ${text}`, W / 2, 645, { align: 'center' });
  doc.setFont('courier', 'bold'); doc.setFontSize(30);
  doc.text(`Join code: ${code}`, W / 2, 700, { align: 'center' });
  return doc.output('blob');
}
