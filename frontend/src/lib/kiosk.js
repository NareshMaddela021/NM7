// Kiosk mode (Nm7 for Organizations, Phase 3A): the parts of the kiosk screen that are plain logic — the idle
// timer, wiping the device after each candidate, and the coordinator's expiry choices. See pages/kiosk/Kiosk.jsx.

export const IDLE_MS = 2 * 60 * 1000; // no touch for 2 minutes…
export const WARN_MS = 20 * 1000; // …then a 20-second "Are you still there?" before everything is wiped
export const HEARTBEAT_MS = 60 * 1000; // the screen checks in every minute (the coordinator sees "active")

/**
 * An idle timer. `poke()` on every touch / key; after `idleMs` without one, `onWarn(secondsLeft)` is called each
 * second for `warnMs`, then `onIdle()` once. `poke()` during the warning cancels it (`onWarn(null)`).
 * `stop()` ends the timer.
 */
export function createIdleTimer({ idleMs = IDLE_MS, warnMs = WARN_MS, onWarn = () => {}, onIdle = () => {} } = {}) {
  let last = Date.now();
  let t = null;
  let stopped = false;
  let warning = false;
  const schedule = (ms) => { clearTimeout(t); t = setTimeout(tick, Math.max(0, ms)); };
  function tick() {
    if (stopped) return;
    const quiet = Date.now() - last;
    if (quiet < idleMs) { schedule(idleMs - quiet); return; }
    const left = Math.ceil((idleMs + warnMs - quiet) / 1000);
    if (left <= 0) { stopped = true; warning = false; onIdle(); return; }
    warning = true;
    onWarn(left);
    schedule(Math.min(1000, idleMs + warnMs - quiet));
  }
  schedule(idleMs);
  return {
    poke() {
      if (stopped) return;
      last = Date.now();
      if (warning) { warning = false; onWarn(null); }
      schedule(idleMs);
    },
    stop() { stopped = true; clearTimeout(t); },
  };
}

/**
 * Leaves nothing personal on the device: every localStorage / sessionStorage key, every IndexedDB database of this
 * site, and Cache Storage. Never throws. `win` is injectable for tests.
 */
export async function wipeDevice(win = globalThis) {
  for (const store of ['localStorage', 'sessionStorage']) {
    try { win[store]?.clear(); } catch { /* blocked storage */ }
  }
  try {
    const idb = win.indexedDB;
    if (idb?.databases) {
      const dbs = await idb.databases();
      await Promise.all(dbs.filter((d) => d.name).map((d) => new Promise((res) => {
        const r = idb.deleteDatabase(d.name);
        r.onsuccess = r.onerror = r.onblocked = () => res();
      })));
    }
  } catch { /* not supported */ }
  try {
    if (win.caches?.keys) await Promise.all((await win.caches.keys()).map((k) => win.caches.delete(k)));
  } catch { /* not supported */ }
}

/** Today's date in India (YYYY-MM-DD) — kiosk links end at midnight India time, wherever the browser is. */
export const indiaDate = (now = new Date()) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);

/** The coordinator's expiry choices: today, tomorrow, the day after, in India time (kiosk links last at most 3 days). */
export function expiryOptions(now = new Date()) {
  const [y, m, d] = indiaDate(now).split('-').map(Number);
  return [0, 1, 2].map((n) => {
    const day = new Date(Date.UTC(y, m - 1, d + n));
    const value = day.toISOString().slice(0, 10);
    const label = n === 0 ? 'End of today' : n === 1 ? 'End of tomorrow' : `End of ${day.toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'short', timeZone: 'UTC' })}`;
    return { value, label };
  });
}

export const PIN_RE = /^\d{4,6}$/;

/** Kiosk state as the coordinator reads it. */
export const KIOSK_STATE = { active: 'Active now', idle: 'Idle', expired: 'Expired', revoked: 'Revoked' };

/** The guided builder's steps (the kiosk's simple mode of the builder). */
export const KIOSK_STEPS = [
  ['about', 'About you'],
  ['edu', 'Education'],
  ['work', 'Work & projects'],
  ['skills', 'Skills'],
  ['summary', 'Summary'],
  ['review', 'Check & finish'],
];
