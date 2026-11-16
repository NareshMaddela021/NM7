// Whether this person gets the vetting engine (Vetting V2+) or the site as before. While Admin → Skill checks → Launch
// is off, only demo accounts and the listed testers get it (GET /api/me/skill-checks/access → { on }). Asked once per
// page load; anything that fails counts as off, so nobody sees half-launched features.
import { useEffect, useState } from 'react';
import { http } from '../services/http';

let asked = null;

export function vettingOn() {
  if (!asked) asked = http('/api/me/skill-checks/access').then((x) => Boolean(x?.on), () => false);
  return asked;
}

/** For tests and after signing in as someone else. */
export function forgetVetting() { asked = null; }

/** null while it loads, then true / false. */
export function useVettingOn() {
  const [on, setOn] = useState(null);
  useEffect(() => { let live = true; vettingOn().then((v) => { if (live) setOn(v); }); return () => { live = false; }; }, []);
  return on;
}
