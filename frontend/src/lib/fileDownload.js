// Downloads a file the API makes (an invoice PDF, a CSV register) with the signed-in cookie, and saves it under
// the given name. Errors carry the server's message, code and HTTP status.
import { API_BASE } from '../services/http';

export function saveBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

export async function downloadFrom(path, filename) {
  const res = await fetch(`${API_BASE}${path}`, { credentials: 'include' });
  if (!res.ok) {
    const err = (await res.json().catch(() => null))?.error;
    throw Object.assign(new Error(err?.message || 'The file couldn’t be downloaded. Please try again.'), { status: res.status, code: err?.code || '' });
  }
  saveBlob(await res.blob(), filename);
}
