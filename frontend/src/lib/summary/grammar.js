// Small English helpers for the summary writer: a/an, plurals, list joining, sentence handling, trimming.

const VOWEL_SOUND = /^(?:[aeiou]|hour|honest|heir|8|11|18|80|8\d)/i;
// said letter by letter, so the sound of the first letter decides: "an MBA", "an ITI", "an SSC", "a BA" ("bee")
const LETTER_START = /^(?:[A-Z]{2,}|[A-Z]\.)/;
const AN_LETTERS = /^[AEFHILMNORSX]/;

/** "a" or "an" for the word that follows. */
export function article(word) {
  const w = (word || '').trim();
  if (!w) return '';
  if (LETTER_START.test(w)) return AN_LETTERS.test(w) ? 'an' : 'a';
  if (/^(?:uni|use|user|euro|one)/i.test(w)) return 'a';
  return VOWEL_SOUND.test(w) ? 'an' : 'a';
}

/** "a driver" / "an electrician"; the word keeps its own capitals. */
export const withArticle = (word) => (word ? `${article(word)} ${word}` : '');

/** "1 year", "5 years", "8 months". */
export const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

/** "Python", "Python and SQL", "Python, Excel and SQL". */
export function joinList(items) {
  const a = (items || []).map((x) => (x || '').toString().trim()).filter(Boolean);
  if (a.length <= 1) return a[0] || '';
  return `${a.slice(0, -1).join(', ')} and ${a[a.length - 1]}`;
}

export const cap = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : '');

/** Splits text into sentences (keeps the end mark). */
export function sentences(text) {
  return (text || '').replace(/\s+/g, ' ').trim().match(/[^.!?]+[.!?]+(?:\s|$)|[^.!?]+$/g)?.map((s) => s.trim()).filter(Boolean) || [];
}

/** Drops the last sentence, never below one. */
export function dropLastSentence(text) {
  const s = sentences(text);
  return s.length > 1 ? s.slice(0, -1).join(' ') : (text || '').trim();
}

/** Keeps whole sentences within `max` characters; if even the first is too long, cuts at a word. */
export function trimTo(text, max = 400) {
  const t = (text || '').replace(/\s+/g, ' ').trim();
  if (t.length <= max) return t;
  const s = sentences(t);
  let out = '';
  for (const x of s) {
    if ((out ? `${out} ${x}` : x).length > max) break;
    out = out ? `${out} ${x}` : x;
  }
  if (out) return out;
  const cut = t.slice(0, max - 1);
  return `${cut.slice(0, Math.max(cut.lastIndexOf(' '), 40)).replace(/[,;:\s]+$/, '')}.`;
}

/** Makes "x ." / "x ,." / double spaces tidy and ends with one full stop. */
export function tidy(sentence) {
  let s = (sentence || '').replace(/\s+/g, ' ').replace(/\s+([.,;:!?])/g, '$1').replace(/,\s*\./g, '.').replace(/\.\.+/g, '.').trim();
  s = s.replace(/^[,;:\s]+/, '');
  if (!s) return '';
  if (!/[.!?]$/.test(s)) s += '.';
  return cap(s);
}

export const FIRST_PERSON = /\b(I|I'm|I’m|I've|I’ve|me|my|mine|myself|we|our|us)\b/;
export const hasFirstPerson = (text) => FIRST_PERSON.test(text || '');
