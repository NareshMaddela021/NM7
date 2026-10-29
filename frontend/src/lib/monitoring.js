// Error reporting in the browser, only when VITE_SENTRY_DSN is set at build time (Vercel → Environment
// Variables). The Sentry client is loaded as a separate file after the page is up, so nobody pays for it in the
// main bundle, and nothing is sent without a DSN. No personal data: no cookies, no IPs, no form contents.
export const SENTRY_DSN = import.meta.env.VITE_SENTRY_DSN || '';

let client = null;

export async function startMonitoring() {
  if (!SENTRY_DSN || client) return client;
  try {
    const Sentry = await import('@sentry/browser');
    Sentry.init({
      dsn: SENTRY_DSN,
      release: import.meta.env.VITE_VERCEL_GIT_COMMIT_SHA || undefined,
      environment: import.meta.env.VITE_VERCEL_ENV || import.meta.env.MODE,
      sendDefaultPii: false,
      tracesSampleRate: 0,
      beforeSend(event) { delete event.user; delete event.request?.cookies; return event; },
      ignoreErrors: [/Failed to fetch dynamically imported module/, /Importing a module script failed/, /ResizeObserver loop/],
    });
    client = Sentry;
  } catch { /* offline or blocked: errors stay in the console */ }
  return client;
}

/** A caught error worth reporting (a page crash, a failed save after retries). */
export function reportError(error, extra) {
  try { client?.captureException(error, extra ? { extra } : undefined); } catch { /* ignore */ }
}
