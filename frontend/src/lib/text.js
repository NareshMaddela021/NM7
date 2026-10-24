// Counting what people see: a Telugu syllable with its vowel sign, or an emoji, is one character to the person
// typing it, but several UTF-16 units to `string.length`.

const segmenter = typeof Intl !== 'undefined' && Intl.Segmenter ? new Intl.Segmenter(undefined, { granularity: 'grapheme' }) : null;

/** User-perceived characters (grapheme clusters) in `s`; code points when the browser has no Intl.Segmenter. */
export function charCount(s) {
  const str = String(s ?? '');
  if (!segmenter) return [...str].length;
  let n = 0;
  for (const _ of segmenter.segment(str)) n += 1;
  return n;
}

/** "5 min ago", "3 h ago", "2 d ago". */
export const ago = (t) => { const m = (Date.now() - t) / 60000; return m < 60 ? `${Math.max(1, Math.round(m))} min ago` : m < 1440 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} d ago`; };
