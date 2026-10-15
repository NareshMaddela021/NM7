// Resume template fonts load only when a resume preview needs them (public pages load just the 2 site fonts).
const FAMILIES = {
  'source-sans-3': 'Source+Sans+3:ital,wght@0,400;0,500;0,600;0,700;1,400',
  lato: 'Lato:ital,wght@0,400;0,700;1,400',
  'open-sans': 'Open+Sans:ital,wght@0,400;0,500;0,600;0,700;1,400',
  roboto: 'Roboto:ital,wght@0,400;0,500;0,700;1,400',
  'ibm-plex-sans': 'IBM+Plex+Sans:ital,wght@0,400;0,500;0,600;0,700;1,400',
  'source-serif-4': 'Source+Serif+4:ital,wght@0,400;0,600;0,700;1,400',
  lora: 'Lora:ital,wght@0,400;0,500;0,600;0,700;1,400',
  merriweather: 'Merriweather:ital,wght@0,400;0,700;1,400',
};
const loading = new Map(); // font key → promise that settles when its faces are ready (or failed)
const nameOf = (k) => FAMILIES[k].split(':')[0].replace(/\+/g, ' ');
const settle = (p, ms = 4000) => Promise.race([p, new Promise((r) => { setTimeout(r, ms); })]).catch(() => {});

/** Adds the Google Fonts stylesheet for these font keys (once each). Resolves when they can be measured with
 * (loaded, failed or timed out — never hangs, so a blocked font only means a fallback font is measured). */
export function ensureFonts(keys) {
  if (typeof document === 'undefined') return Promise.resolve();
  const want = [...new Set(keys)].filter((k) => FAMILIES[k]);
  const need = want.filter((k) => !loading.has(k));
  if (need.length) {
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = `https://fonts.googleapis.com/css2?${need.map((k) => `family=${FAMILIES[k]}`).join('&')}&display=swap`;
    const sheet = new Promise((resolve) => { link.onload = resolve; link.onerror = resolve; });
    document.head.appendChild(link);
    need.forEach((k) => loading.set(k, settle(sheet.then(() => Promise.all(['400', '700'].map((w) => document.fonts?.load(`${w} 12px "${nameOf(k)}"`)))))));
  }
  return Promise.all(want.map((k) => loading.get(k))).then(() => document.fonts?.ready);
}
/** Every template font (the template picker shows them all). */
export const ensureAllFonts = () => ensureFonts(Object.keys(FAMILIES));
