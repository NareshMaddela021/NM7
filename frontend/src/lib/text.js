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
