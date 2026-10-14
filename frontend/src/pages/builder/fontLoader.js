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
const loaded = new Set();

/** Adds the Google Fonts stylesheet for these font keys (once each). */
export function ensureFonts(keys) {
  if (typeof document === 'undefined') return;
  const need = [...new Set(keys)].filter((k) => FAMILIES[k] && !loaded.has(k));
  if (!need.length) return;
  need.forEach((k) => loaded.add(k));
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = `https://fonts.googleapis.com/css2?${need.map((k) => `family=${FAMILIES[k]}`).join('&')}&display=swap`;
  document.head.appendChild(link);
}
/** Every template font (the template picker shows them all). */
export const ensureAllFonts = () => ensureFonts(Object.keys(FAMILIES));
