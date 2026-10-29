// One file-name rule for every download (resume PDF / Word, cover letters, combined PDF, ZIP and the files in it,
// CSV exports, QR codes and posters, recruiter downloads), the same as the server's (backend/app/core/filenames.py):
//   - letters and digits stay (in any script, with their vowel signs, so a Telugu or Hindi name is still readable);
//     every other run of characters — spaces, dashes, dots, slashes, emoji — becomes one underscore;
//   - empty parts are dropped, and so are repeats: a part already said by another or inside a longer part
//     ("AsuraaX" + "AsuraaX Batch 2026" → "AsuraaX_Batch_2026"), and the same word twice in a row
//     ("AsuraaX_AsuraaX"), ignoring case;
//   - at most about 80 characters with the extension, cut between words; the extension is always kept.
const KEEP = /[\p{L}\p{N}\p{M}‌‍]/u;
export const MAX_NAME = 80;

/** "Asha – Data Analyst" → "Asha_Data_Analyst" ('' when nothing usable is left). */
export function fileSlug(s, max = 60) {
  return [...String(s ?? '')].map((c) => (KEEP.test(c) ? c : '_')).join('').replace(/_+/g, '_')
    .replace(/^[_‌‍]+|[_‌‍]+$/g, '').slice(0, max).replace(/_+$/, '');
}

const words = (slug) => (slug ? slug.split('_') : []);
const lower = (ws) => ws.map((w) => w.toLocaleLowerCase());
/** Does `inner` appear as whole words inside `outer`? */
function within(outer, inner) {
  if (!inner.length || inner.length > outer.length) return false;
  for (let i = 0; i + inner.length <= outer.length; i++) if (inner.every((w, j) => outer[i + j] === w)) return true;
  return false;
}

/** fileName(['AsuraaX', 'AsuraaX Batch 2026', 'QR'], 'png') → "AsuraaX_Batch_2026_QR.png". `fallback` when no part
 * leaves anything usable. */
export function fileName(parts, ext, { fallback = 'Nm7', max = MAX_NAME } = {}) {
  const e = String(ext || '').replace(/^\.+/, '').replace(/[^A-Za-z0-9]/g, '').toLowerCase();
  const DATE = /^\d{4}-\d{2}-\d{2}$/; // a date keeps its dashes (2026-10-25)
  let list = (Array.isArray(parts) ? parts : [parts]).map((p) => (DATE.test(String(p ?? '').trim()) ? [String(p).trim()] : words(fileSlug(p, 200)))).filter((w) => w.length);
  // a part said again by another part (the same, or inside a longer one) goes; the earlier / longer one stays
  list = list.filter((ws, i) => {
    const me = lower(ws);
    return !list.some((other, j) => {
      if (j === i) return false;
      const them = lower(other);
      if (them.length === me.length) return j < i && them.join('_') === me.join('_');
      return them.length > me.length && within(them, me);
    });
  });
  // the same word twice in a row ("AsuraaX_AsuraaX")
  const out = [];
  for (const w of list.flat()) if (!out.length || out[out.length - 1].toLocaleLowerCase() !== w.toLocaleLowerCase()) out.push(w);
  const room = Math.max(10, max - (e ? e.length + 1 : 0));
  let stem = '';
  for (const w of out) {
    const next = stem ? `${stem}_${w}` : w;
    if (next.length > room) { if (!stem) stem = w.slice(0, room); break; }
    stem = next;
  }
  stem = stem || fileSlug(fallback) || 'Nm7';
  return e ? `${stem}.${e}` : stem;
}

/** "<name>_Resume.pdf"; `fallback` when the name leaves nothing usable. */
export const resumeFileName = (name, { kind = 'Resume', ext = 'pdf', fallback = '' } = {}) =>
  fileName([fileSlug(name) || fileSlug(fallback), kind], ext, { fallback: kind });
