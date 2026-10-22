// One file-name rule for every resume file (builder PDF / Word, organization exports, recruiter links), the same as
// the server's (backend/app/orgs/service.py safe_part): letters and digits stay (in any script, with their vowel
// signs, so a Telugu or Hindi name is still readable); every other run of characters — spaces, dashes, en dashes,
// dots, slashes, emoji — becomes one underscore. Safe on Windows, macOS, Android and in ZIP files.
const KEEP = /[\p{L}\p{N}\p{M}‌‍]/u;

/** "Asha – Data Analyst" → "Asha_Data_Analyst" (at most 60 characters; '' when nothing usable is left). */
export function fileSlug(s) {
  return [...String(s || '')].map((c) => (KEEP.test(c) ? c : '_')).join('').replace(/_+/g, '_')
    .replace(/^[_‌‍]+|[_‌‍]+$/g, '').slice(0, 60).replace(/_+$/, '');
}

/** "<name>_Resume.pdf"; `fallback` when the name leaves nothing usable. */
export const resumeFileName = (name, { kind = 'Resume', ext = 'pdf', fallback = '' } = {}) => `${[fileSlug(name) || fileSlug(fallback), kind].filter(Boolean).join('_')}.${ext}`;
