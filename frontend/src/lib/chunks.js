// A tab left open across a deploy (a kiosk all day, an admin console, the builder) still runs the old build, whose
// lazily loaded files (e.g. /assets/resumePdf-<hash>.js) no longer exist on the new deploy. Loading one fails with
// "Failed to fetch dynamically imported module". This file turns that into one automatic reload onto the new build
// (at most once a minute, so a real outage can't loop) and, for actions like Print or Export, a friendly message.

export const RELOAD_KEY = 'nm7-chunk-reload';
export const RELOAD_GAP = 60_000; // at most one automatic reload a minute
export const STALE_TEXT = 'Nm7 was just updated. Updating this page — please try again in a moment.';

/** An error from loading a lazily loaded file of an older build (Chrome, Firefox, Safari, Vite wording). */
export function isChunkError(e) {
  const m = String(e?.message || e || '');
  return e?.name === 'ChunkLoadError'
    || /Failed to fetch dynamically imported module|Importing a module script failed|error loading dynamically imported module|Unable to preload CSS|Loading (CSS )?chunk .* failed|is not a valid JavaScript MIME type/i.test(m);
}

export class StaleBuildError extends Error {
  constructor(reloading = true) {
    super(reloading ? STALE_TEXT : 'Nm7 was updated. Please reload this page and try again.');
    this.name = 'StaleBuildError';
    this.code = 'stale_build';
  }
}

const session = () => { try { return window.sessionStorage; } catch { return null; } };

/** Reloads the page unless it already did so in the last minute. Returns true when it reloads. */
export function reloadOnce({ store = session(), reload = () => window.location.reload(), now = Date.now() } = {}) {
  try {
    const last = Number(store?.getItem(RELOAD_KEY) || 0);
    if (now - last < RELOAD_GAP) return false;
    store?.setItem(RELOAD_KEY, String(now));
  } catch { return false; }
  reload();
  return true;
}

/** For React.lazy: a page whose file is gone reloads onto the new build (and shows nothing meanwhile). */
export function lazyRetry(load, reload = reloadOnce) {
  return () => load().catch((e) => {
    if (isChunkError(e) && reload()) return new Promise(() => {});
    throw e;
  });
}

/**
 * For actions (Print, Export, Download): import(), and when the file is from an older build throw a friendly
 * StaleBuildError and reload onto the new build shortly after (beforeReload runs first, e.g. to save progress).
 */
export async function freshImport(load, { beforeReload, reload = reloadOnce, delay = 1500 } = {}) {
  try {
    return await load();
  } catch (e) {
    if (!isChunkError(e)) throw e;
    const store = session();
    let recent = false;
    try { recent = Date.now() - Number(store?.getItem(RELOAD_KEY) || 0) < RELOAD_GAP; } catch { /* ignore */ }
    if (!recent) setTimeout(async () => { try { await beforeReload?.(); } finally { reload(); } }, delay);
    throw new StaleBuildError(!recent);
  }
}

/** Vite's own signal that a preloaded file failed: reload onto the new build (once a minute at most). */
export function installChunkRecovery(win = window, reload = reloadOnce) {
  win.addEventListener('vite:preloadError', (ev) => { if (reload()) ev.preventDefault(); });
}

export const BUILD_CHECK_MS = 5 * 60_000; // an idle kiosk looks for a new build every 5 minutes

/** Is the site's live index.html on a different build from this page? (Compares the hashed /assets/index-*.js.)
 * False when it can't tell (dev server, offline, an unexpected page). */
export function newBuildLive(html, doc = document) {
  const live = String(html || '').match(/\/assets\/index-[\w-]+\.js/)?.[0];
  const mine = [...doc.querySelectorAll('script[src]')].map((s) => s.getAttribute('src')).find((src) => /\/assets\/index-[\w-]+\.js/.test(src || ''));
  return !!(live && mine && !mine.endsWith(live));
}
