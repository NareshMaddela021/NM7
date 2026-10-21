/**
 * Talking to the Nm7 API. When VITE_API_BASE is not set the app runs in preview / sample mode
 * (accounts and orders live in this browser) and nothing here is called.
 *
 * Every request has a time limit (the API sleeps on the free plan and takes 30–60 s to wake: a stuck spinner is
 * worse than a clear message), reads can retry once on a network error / 5xx, and anyone can subscribe to
 * "a request has been running for a while" to show a waking-up notice.
 */
export const API_BASE = (import.meta.env.VITE_API_BASE || '').replace(/\/+$/, '');
// A build-time constant (Vite writes the value in), so the bundler drops preview-only code from live builds.
export const LIVE = !!import.meta.env.VITE_API_BASE;

export const TIMEOUT_MS = 25_000; // longer than a cold start, shorter than giving up
export const SLOW_AFTER_MS = 3_000; // when a request takes this long, say the server is waking up
const RETRY_WAIT_MS = [1_500, 4_000];

export class ApiError extends Error {
  constructor(status, code, message, fields) {
    super(message);
    this.status = status;
    this.code = code;
    this.fields = fields;
  }
}
/** A network error, a timeout or a 5xx: the request may well succeed again in a moment. */
export const isTransient = (e) => e instanceof ApiError && (e.status === 0 ? e.code !== 'cancelled' : e.status >= 500);

// The server names the fields it rejects; show them the way the form labels them.
const FIELD_LABELS = {
  name: 'full name', email: 'email', phone: 'mobile number', password: 'password', passwordConfirm: 'the re-typed password',
  termsAccepted: 'the terms checkbox', code: 'the code', note: 'the note', data: 'the resume',
};
const label = (f) => FIELD_LABELS[f] || f.replace(/([A-Z])/g, ' $1').toLowerCase();

/* ---------- slow requests (the API waking up) ---------- */
const slowSubs = new Set();
let slowCount = 0;
const notifySlow = () => slowSubs.forEach((f) => f(slowCount > 0));
/** `fn(true)` while any request has been running for more than 3 s, `fn(false)` once they all settled. */
export const onSlow = (fn) => { slowSubs.add(fn); fn(slowCount > 0); return () => slowSubs.delete(fn); };
export const isSlow = () => slowCount > 0;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function once(path, { method, body, signal, timeout }) {
  const ctl = new AbortController();
  const onAbort = () => ctl.abort();
  if (signal) { if (signal.aborted) ctl.abort(); else signal.addEventListener('abort', onAbort, { once: true }); }
  let timedOut = false;
  const timer = setTimeout(() => { timedOut = true; ctl.abort(); }, timeout);
  let slow = false;
  const slowTimer = setTimeout(() => { slow = true; slowCount += 1; notifySlow(); }, SLOW_AFTER_MS);
  try {
    return await fetch(API_BASE + path, {
      method,
      credentials: 'include',
      headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: ctl.signal,
    });
  } catch (e) {
    if (timedOut) throw new ApiError(0, 'timeout', 'The server is taking too long to answer. Please try again in a moment.');
    if (e?.name === 'AbortError') throw new ApiError(0, 'cancelled', 'Cancelled.');
    throw new ApiError(0, 'network', 'We can’t reach the server. Check your internet and try again.');
  } finally {
    clearTimeout(timer);
    clearTimeout(slowTimer);
    if (slow) { slowCount -= 1; notifySlow(); }
    signal?.removeEventListener('abort', onAbort);
  }
}

/**
 * JSON request with the session cookie. Errors come back as ApiError with the server's code and message.
 * Options: `signal` (AbortController), `timeout` ms (default 25 s), `retry` (how many times to try again on a
 * network error / timeout / 5xx; default 1 for GET, 0 otherwise — a POST must not be sent twice by accident).
 */
export async function http(path, { method = 'GET', body, signal, timeout = TIMEOUT_MS, retry = method === 'GET' ? 1 : 0 } = {}) {
  for (let attempt = 0; ; attempt += 1) {
    let res;
    try {
      res = await once(path, { method, body, signal, timeout });
    } catch (e) {
      if (attempt < retry && isTransient(e)) { await sleep(RETRY_WAIT_MS[Math.min(attempt, RETRY_WAIT_MS.length - 1)]); continue; }
      throw e;
    }
    if (res.status >= 500 && attempt < retry) { await sleep(RETRY_WAIT_MS[Math.min(attempt, RETRY_WAIT_MS.length - 1)]); continue; }
    const data = await res.json().catch(() => null);
    if (!res.ok) {
      const e = data?.error;
      const fields = e?.fields?.map((f) => f.field).filter(Boolean);
      const msg = e?.code === 'invalid_input' && fields?.length ? `Please check ${fields.map(label).join(', ')}.` : e?.message;
      const err = new ApiError(res.status, e?.code || 'error', msg || 'Something went wrong. Please try again.', e?.fields);
      if (Array.isArray(e?.photos)) err.photos = e.photos; // photo import: which photos look like ID cards
      throw err;
    }
    return data;
  }
}

/* ---------- background save errors (shown as a toast by <SaveErrors/>) ---------- */
const saveErrorSubs = new Set();
export const onSaveError = (fn) => { saveErrorSubs.add(fn); return () => saveErrorSubs.delete(fn); };
export const reportSaveError = (e) => saveErrorSubs.forEach((f) => f(e));
