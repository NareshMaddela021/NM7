// The Easy dashboard's data (Phase 4): GET /api/me/simple, kept for this tab (sessionStorage: nothing personal is
// left in localStorage) so the simple screens still show the last numbers on a bad connection, reloads included
// ("Will update when internet is back"). The key starts with nm7-, so signing out wipes it too (lib/auth.js).
import { useCallback, useEffect, useState } from 'react';
import { http } from '../services/http';
import { STORE_KEY, setLang } from './i18n';

export const CACHE_KEY = 'nm7-simple-cache';
const LANG_CODES = ['en', 'te', 'hi'];

const read = (k) => { try { return localStorage.getItem(k); } catch { return null; } };
export function cached() { try { return JSON.parse(sessionStorage.getItem(CACHE_KEY) || 'null'); } catch { return null; } }
function keep(d) { try { sessionStorage.setItem(CACHE_KEY, JSON.stringify(d)); } catch { /* storage full or blocked */ } return d; }

/** The site language this browser picked before (not the phone's): it picks the default dashboard for new people. */
export const hint = () => (LANG_CODES.includes(read(STORE_KEY)) ? read(STORE_KEY) : '');

/** The person's own language wins on the simple screens: the whole site follows it in this browser. */
export const applyLang = (d) => { if (d?.lang && LANG_CODES.includes(d.lang)) setLang(d.lang); return d; };

let inflight = null;
export function loadSimple() {
  const h = hint();
  inflight ||= http(`/api/me/simple${h ? `?hint=${h}` : ''}`).then((d) => keep(applyLang(d))).finally(() => { inflight = null; });
  return inflight;
}

export const savePrefs = (body) => http('/api/me/simple/prefs', { method: 'PUT', body }).then((d) => keep(applyLang(d)));

/** No answer at all (no internet), as opposed to the server saying no. */
export const isOffline = (e) => e?.status === 0 || (typeof navigator !== 'undefined' && navigator.onLine === false);

/** { data, offline, error, reload, setData }: the last saved data at once, then fresh data; on no internet, the
 * saved data stays with `offline` true and it reloads by itself when the connection comes back. */
export function useSimple() {
  const [data, setData] = useState(cached);
  const [offline, setOffline] = useState(false);
  const [error, setError] = useState('');
  const reload = useCallback(() => loadSimple().then((d) => { setData(d); setOffline(false); setError(''); }, (e) => {
    if (isOffline(e)) setOffline(true); else setError(e.message || 'error');
  }), []);
  useEffect(() => {
    reload();
    const on = () => reload();
    window.addEventListener('online', on);
    return () => window.removeEventListener('online', on);
  }, [reload]);
  return { data, offline, error, reload, setData };
}
