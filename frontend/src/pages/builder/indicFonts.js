// Indian scripts in the PDF: which script a character belongs to, how a string splits into script runs, and the
// Noto Sans fonts (public/fonts/, OFL) that are fetched from our own origin only when a resume contains that
// script. Latin, digits and punctuation stay in the template's own font.

/** Unicode blocks → { file: Noto Sans family file prefix }. Order does not matter. */
export const SCRIPTS = {
  devanagari: { from: 0x0900, to: 0x097f, file: 'NotoSansDevanagari', label: 'Hindi / Marathi' },
  bengali: { from: 0x0980, to: 0x09ff, file: 'NotoSansBengali', label: 'Bengali' },
  tamil: { from: 0x0b80, to: 0x0bff, file: 'NotoSansTamil', label: 'Tamil' },
  telugu: { from: 0x0c00, to: 0x0c7f, file: 'NotoSansTelugu', label: 'Telugu' },
  kannada: { from: 0x0c80, to: 0x0cff, file: 'NotoSansKannada', label: 'Kannada' },
  malayalam: { from: 0x0d00, to: 0x0d7f, file: 'NotoSansMalayalam', label: 'Malayalam' },
};
const ORDER = Object.keys(SCRIPTS);
const DANDA = [0x0964, 0x0965]; // shared by every Indic script, in the Devanagari block
const JOINERS = [0x200c, 0x200d]; // ZWNJ / ZWJ: part of a word's shaping, kept inside the surrounding run

/** The script key of one code point, or null for everything that is not Indic. */
export function scriptOf(cp) {
  for (const k of ORDER) { const s = SCRIPTS[k]; if (cp >= s.from && cp <= s.to) return k; }
  return null;
}

/** The scripts used anywhere in `text` (a string, or anything JSON-serialisable), e.g. ['telugu']. */
export function scriptsIn(text) {
  const s = typeof text === 'string' ? text : JSON.stringify(text ?? '');
  const found = new Set();
  for (const ch of s) { const k = scriptOf(ch.codePointAt(0)); if (k) found.add(k); }
  return ORDER.filter((k) => found.has(k));
}

/**
 * Splits a line into runs that one font can draw: [{ text, script }], script null for the template's font.
 * Common characters (spaces, digits, punctuation) go to the template's font; a danda or joiner stays with the
 * Indic run it follows so conjuncts keep their shape.
 */
export function splitRuns(text) {
  const runs = [];
  let cur = null;
  for (const ch of String(text ?? '')) {
    const cp = ch.codePointAt(0);
    let k = scriptOf(cp);
    if (DANDA.includes(cp)) k = cur?.script || 'devanagari';
    else if (JOINERS.includes(cp)) { if (!cur?.script) continue; k = cur.script; } // a joiner means nothing in Latin
    if (cur && cur.script === k) cur.text += ch;
    else { cur = { text: ch, script: k }; runs.push(cur); }
  }
  return runs;
}

const WEIGHTS = ['Regular', 'Bold'];
const cache = {}; // script → promise of { normal, bold } (Uint8Array)

/** Where a font file lives: next to the app (dist/fonts/…), so the CSP's connect-src 'self' allows it. */
export const fontUrl = (script, weight) => `${import.meta.env.BASE_URL || '/'}fonts/${SCRIPTS[script].file}-${weight}.ttf`;

async function fetchFont(script, weight) {
  const r = await fetch(fontUrl(script, weight));
  if (!r.ok) throw new Error(`font ${script} ${weight}: ${r.status}`);
  return new Uint8Array(await r.arrayBuffer());
}

/**
 * Loads the Regular and Bold Noto Sans files of these scripts (once per session). Returns
 * { [script]: { normal, bold } }; a script whose files cannot be fetched is left out (its text then falls back to
 * the template font, as before), so a download never fails because of a font.
 */
export async function loadScriptFonts(scripts) {
  const out = {};
  await Promise.all(scripts.filter((k) => SCRIPTS[k]).map(async (k) => {
    if (!cache[k]) {
      cache[k] = Promise.all(WEIGHTS.map((w) => fetchFont(k, w))).then(([normal, bold]) => ({ normal, bold }))
        .catch((e) => { delete cache[k]; throw e; });
    }
    try { out[k] = await cache[k]; } catch { /* left out */ }
  }));
  return out;
}
