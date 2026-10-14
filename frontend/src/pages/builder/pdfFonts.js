// Font files for the PDF (TTF, base64). Loaded only when someone downloads, so the app stays light.
const LOADERS = import.meta.env.VITE_PREVIEW === '1' ? {} : {
  'source-sans-3': () => Promise.all([import('../../fonts/pdf/source-sans-3-normal.js'), import('../../fonts/pdf/source-sans-3-bold.js'), import('../../fonts/pdf/source-sans-3-italic.js')]),
  lato: () => Promise.all([import('../../fonts/pdf/lato-normal.js'), import('../../fonts/pdf/lato-bold.js'), import('../../fonts/pdf/lato-italic.js')]),
  'open-sans': () => Promise.all([import('../../fonts/pdf/open-sans-normal.js'), import('../../fonts/pdf/open-sans-bold.js'), import('../../fonts/pdf/open-sans-italic.js')]),
  roboto: () => Promise.all([import('../../fonts/pdf/roboto-normal.js'), import('../../fonts/pdf/roboto-bold.js'), import('../../fonts/pdf/roboto-italic.js')]),
  'ibm-plex-sans': () => Promise.all([import('../../fonts/pdf/ibm-plex-sans-normal.js'), import('../../fonts/pdf/ibm-plex-sans-bold.js'), import('../../fonts/pdf/ibm-plex-sans-italic.js')]),
  'source-serif-4': () => Promise.all([import('../../fonts/pdf/source-serif-4-normal.js'), import('../../fonts/pdf/source-serif-4-bold.js'), import('../../fonts/pdf/source-serif-4-italic.js')]),
  lora: () => Promise.all([import('../../fonts/pdf/lora-normal.js'), import('../../fonts/pdf/lora-bold.js'), import('../../fonts/pdf/lora-italic.js')]),
  merriweather: () => Promise.all([import('../../fonts/pdf/merriweather-normal.js'), import('../../fonts/pdf/merriweather-bold.js'), import('../../fonts/pdf/merriweather-italic.js')]),
};

const cache = {};

/** Loads a font family's 3 styles once; returns { normal, bold, italic } base64 strings. */
// Preview build: fonts are separate files next to the page (fonts/<id>-<style>.txt), so the page itself stays small.
const fetchStyle = (id, style) => fetch(`fonts/${id}-${style}.txt`).then((r) => { if (!r.ok) throw new Error('font'); return r.text(); });

export async function loadFont(id) {
  if (!cache[id]) {
    cache[id] = (import.meta.env.VITE_PREVIEW === '1'
      ? Promise.all(['normal', 'bold', 'italic'].map((st) => fetchStyle(id, st))).then(([normal, bold, italic]) => ({ normal, bold, italic }))
      : LOADERS[id]().then(([n, b, i]) => ({ normal: n.default, bold: b.default, italic: i.default })))
      .catch((e) => { delete cache[id]; throw e; });
  }
  return cache[id];
}

/** Registers a loaded family with a jsPDF document under the family name `id`. */
export function registerFont(doc, id, files) {
  ['normal', 'bold', 'italic'].forEach((style) => {
    const file = `${id}-${style}.ttf`;
    doc.addFileToVFS(file, files[style]);
    doc.addFont(file, id, style);
  });
}
