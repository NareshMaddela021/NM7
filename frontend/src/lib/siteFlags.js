// GET /api/public/site-flags, fetched once per page load and shared: { langs, googleClientId, autoApply }. Preview
// builds (no API) and a failed request get the defaults (no Telugu / Hindi, no Google button, Auto Apply on), so
// nothing waits on it and nothing new shows.
import { useEffect, useState } from 'react';
import { http, LIVE } from '../services/http';

export const NO_FLAGS = Object.freeze({ langs: false, googleClientId: '', autoApply: true });
let pending = null;

export function loadSiteFlags() {
  if (!LIVE) return Promise.resolve(NO_FLAGS);
  if (!pending) pending = http('/api/public/site-flags').then((f) => ({ ...NO_FLAGS, ...f }), () => { pending = null; return NO_FLAGS; });
  return pending;
}

/** The site flags in a component: NO_FLAGS until they arrive. */
export function useSiteFlags() {
  const [flags, setFlags] = useState(NO_FLAGS);
  useEffect(() => {
    let dead = false;
    loadSiteFlags().then((f) => { if (!dead) setFlags(f); });
    return () => { dead = true; };
  }, []);
  return flags;
}
