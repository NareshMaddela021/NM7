// Job links typed by the user: only web links. Same rule as the server (app/me/schemas.py job_link).
const SCHEME = /^[a-z][a-z0-9+.-]*:/i;
const HOST = /^[a-z0-9-]+(\.[a-z0-9-]+)+([/:?#].*)?$/i;

/** '' → ''; 'company.com/jobs/1' → 'https://company.com/jobs/1'; http(s) kept; anything else (javascript:, data:…) → null. */
export function webLink(v) {
  const s = (v || '').trim();
  if (!s) return '';
  if (SCHEME.test(s)) return /^https?:\/\/[^\s/]+\.\S+$/i.test(s) ? s : null;
  if (s.startsWith('//') || /\s/.test(s) || !HOST.test(s)) return null;
  return `https://${s}`;
}
