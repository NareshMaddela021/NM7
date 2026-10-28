// Certificate wallet helpers: file checks, image compression in the browser (so a phone photo of a certificate is
// usually 150-400 KB, never over 2 MB), and turning a certificate into a resume Certifications entry.
export const MAX_FILES = 10;
export const MAX_BYTES = 2 * 1024 * 1024;
export const TYPES = ['application/pdf', 'image/jpeg', 'image/png'];
export const ID_WARNING = 'Don’t upload Aadhaar, PAN or other ID documents.';
const ID_WORDS = /\b(aadhaa?r|aadhar|pan card|passport|voter id|driving licen[cs]e|ration card)\b/i;

/** A problem with the chosen file or title, or '' when fine. */
export function fileProblem(file, title = '') {
  if (!file) return 'Choose a PDF, JPG or PNG file.';
  if (!TYPES.includes(file.type)) return 'Use a PDF, JPG or PNG file.';
  if (ID_WORDS.test(`${title} ${file.name}`)) return `${ID_WARNING} Certificates only.`;
  if (file.type === 'application/pdf' && file.size > MAX_BYTES) return 'That PDF is over 2 MB. Use a smaller scan or a photo of it.';
  return '';
}

/** Images: at most 1600 px on the long side, JPEG ~0.82 (PNG screenshots stay PNG when small). */
export async function compressImage(file, { max = 1600, quality = 0.82 } = {}) {
  if (!file.type.startsWith('image/')) return file;
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((resolve, reject) => { const i = new Image(); i.onload = () => resolve(i); i.onerror = reject; i.src = url; });
    const scale = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
    if (scale === 1 && file.size <= 400 * 1024) return file;
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(img.naturalWidth * scale);
    canvas.height = Math.round(img.naturalHeight * scale);
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality));
    return blob && blob.size < file.size ? new File([blob], file.name.replace(/\.\w+$/, '.jpg'), { type: 'image/jpeg' }) : file;
  } finally { URL.revokeObjectURL(url); }
}

export const toBase64 = (blob) => new Promise((resolve, reject) => {
  const r = new FileReader();
  r.onload = () => resolve(String(r.result).split(',', 2)[1] || '');
  r.onerror = reject;
  r.readAsDataURL(blob);
});

/** "2025-03" → the resume's issue date field; the credential link as the entry's link. */
export function certEntry(c) {
  return {
    name: c.title, issuer: c.issuer || '', issueDate: (c.date || '').slice(0, 7), expiryDate: '', noExpiry: false,
    credentialId: '', links: c.link ? [{ label: 'Credential', url: c.link }] : [],
  };
}

/** Adds the certificate to a resume's Certifications (skipped when the same title is already there). */
export function addToResume(data, c) {
  const certs = data.certs || [];
  if (certs.some((x) => (x.name || '').trim().toLowerCase() === c.title.trim().toLowerCase())) return { data, added: false };
  const blank = certs.length === 1 && !(certs[0].name || '').trim();
  return { data: { ...data, certs: [...(blank ? [] : certs), certEntry(c)] }, added: true };
}

export const kb = (n) => (n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);

/** Opens a certificate file fetched with the viewer's own access (cookie, recruiter session or access code) in a new
 * tab; downloads it when pop-ups are blocked. The page never links straight to the API, so no token is in a URL. */
export async function openCertFile(url, { headers = {}, credentials = 'include', name = 'certificate' } = {}) {
  const res = await fetch(url, { headers, credentials, cache: 'no-store' });
  if (!res.ok) throw new Error(res.status === 404 ? 'This certificate is no longer shared.' : 'Couldn’t open the certificate. Please try again.');
  const blob = await res.blob();
  const href = URL.createObjectURL(blob);
  const w = window.open(href, '_blank');
  if (!w) {
    const a = document.createElement('a');
    a.href = href; a.download = name; document.body.appendChild(a); a.click(); a.remove();
  }
  setTimeout(() => URL.revokeObjectURL(href), 60_000);
}
