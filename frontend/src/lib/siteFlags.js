// GET /api/public/site-flags, fetched once per page load and shared: { langs, googleClientId }. Preview builds (no API)
// and a failed request get the "everything off" answer, so nothing waits on it and nothing new shows.
import { http, LIVE } from '../services/http';

export const NO_FLAGS = Object.freeze({ langs: false, googleClientId: '' });
let pending = null;

export function loadSiteFlags() {
  if (!LIVE) return Promise.resolve(NO_FLAGS);
  if (!pending) pending = http('/api/public/site-flags').then((f) => ({ ...NO_FLAGS, ...f }), () => { pending = null; return NO_FLAGS; });
  return pending;
}
