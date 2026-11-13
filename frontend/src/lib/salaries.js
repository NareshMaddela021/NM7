// Round D1: /salaries stays hidden (no menu link, noindex, not in the sitemap) until enough roles have real salary
// data; the API decides (Admin → Settings → Job seekers: Auto / Always show / Always hide). One request per page load.
import { useEffect, useState } from 'react';
import { http } from '../services/http';

let pending = null;
const HIDDEN = { visible: false, readyRoles: [] };

/** { visible, readyRoles } — hidden when the API can't be reached. */
export function salariesStatus() {
  if (!pending) pending = http('/api/public/salaries/status').catch(() => HIDDEN);
  return pending;
}

/** null while loading, then { visible, readyRoles }. */
export function useSalariesStatus() {
  const [s, setS] = useState(null);
  useEffect(() => {
    let on = true;
    salariesStatus().then((x) => { if (on) setS(x || HIDDEN); });
    return () => { on = false; };
  }, []);
  return s;
}

/** Whether a salaries page may be indexed: the guide is shown, and (for one role's page) that role has enough data. */
export const indexable = (visible, roleReady = true) => Boolean(visible && roleReady);

export const _reset = () => { pending = null; }; // tests
