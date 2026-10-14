/**
 * Talking to the Nm7 API. When VITE_API_BASE is not set the app runs in preview / sample mode
 * (accounts and orders live in this browser) and nothing here is called.
 */
export const API_BASE = (import.meta.env.VITE_API_BASE || '').replace(/\/+$/, '');
export const LIVE = !!API_BASE;

export class ApiError extends Error {
  constructor(status, code, message, fields) {
    super(message);
    this.status = status;
    this.code = code;
    this.fields = fields;
  }
}

/** JSON request with the session cookie. Errors come back as ApiError with the server's code and message. */
export async function http(path, { method = 'GET', body } = {}) {
  let res;
  try {
    res = await fetch(API_BASE + path, {
      method,
      credentials: 'include',
      headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new ApiError(0, 'network', 'We can’t reach the server. Check your internet and try again.');
  }
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    const e = data?.error;
    const fields = e?.fields?.map((f) => f.field).filter(Boolean);
    const msg = e?.code === 'invalid_input' && fields?.length ? `Please check: ${fields.join(', ')}.` : e?.message;
    throw new ApiError(res.status, e?.code || 'error', msg || 'Something went wrong. Please try again.', e?.fields);
  }
  return data;
}

/* ---------- background save errors (shown as a toast by <SaveErrors/>) ---------- */
const saveErrorSubs = new Set();
export const onSaveError = (fn) => { saveErrorSubs.add(fn); return () => saveErrorSubs.delete(fn); };
export const reportSaveError = (e) => saveErrorSubs.forEach((f) => f(e));
