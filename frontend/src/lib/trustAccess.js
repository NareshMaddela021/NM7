// Whether this person gets Vetting Trust (T1–T15) or the site as before. While Admin → Skill checks → Vetting Trust is
// off, only admins, demo accounts and the listed testers get it (GET /api/me/trust/access → { on }). Asked once per page
// load; anything that fails counts as off, so nobody sees half-launched features.
import { useEffect, useState } from 'react';
import { LIVE, http } from '../services/http';

let asked = null;

export function trustOn() {
  if (!LIVE) return Promise.resolve(false);
  if (!asked) asked = http('/api/me/trust/access').then((x) => Boolean(x?.on), () => false);
  return asked;
}

/** For tests and after signing in as someone else. */
export function forgetTrust() { asked = null; }

/** null while it loads, then true / false. */
export function useTrustOn() {
  const [on, setOn] = useState(null);
  useEffect(() => { let live = true; trustOn().then((v) => { if (live) setOn(v); }); return () => { live = false; }; }, []);
  return on;
}
