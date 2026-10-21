// The template picker's selection logic (TemplatePicker.jsx), kept plain so it can be unit tested.
// Also the small template helpers the home page needs, so it doesn't have to load the picker (and the preview).
import { DEFAULT_DESIGN, TEMPLATE_PRESETS } from './design';
import { INITIAL, SECTION_LAYOUTS } from './schema';

export const layoutOf = (k) => SECTION_LAYOUTS[TEMPLATE_PRESETS[k]?.sections || 'standard'];
// grey silhouette so photo templates show where the photo goes
export const PHOTO_PLACEHOLDER = `data:image/svg+xml;utf8,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" fill="#D9DCE1"/><circle cx="32" cy="25" r="11" fill="#A9AFB8"/><path d="M10 60c2-12 11-18 22-18s20 6 22 18z" fill="#A9AFB8"/></svg>')}`;

/** "Freshers" / "Experienced" / "Any level". */
export const audienceOf = (t) => (t?.level === 'fresher' ? 'Freshers' : t?.level === 'experienced' ? 'Experienced' : 'Any level');

/** What the selected-template bar and the under-card button say. */
export function selectionText(t, { ats, two } = {}) {
  const name = t?.name || 'this';
  return {
    name,
    use: `Use ${name}`,
    meta: `ATS ${ats ?? '—'} · ${two ? '2 columns' : '1 column'} · ${audienceOf(t)}`,
    announce: `${name} selected. Use ${name} to continue.`,
  };
}

/** Enter or Space on a focused card uses it straight away. */
export const isUseKey = (e) => e.key === 'Enter' || e.key === ' ' || e.key === 'Spacebar';

/**
 * Selection state: which template is selected and whether the person has picked one in this visit
 * (the bottom bar appears from the first pick on; the default selection alone doesn't show it).
 */
export function pickState(prev, action) {
  switch (action.type) {
    case 'pick': return { selected: action.key, touched: true };
    case 'sync': return prev.selected === action.key ? prev : { ...prev, selected: action.key }; // the template applied from outside (default, suggestion)
    default: return prev;
  }
}

/* ---------- "Sample resume | My details" (template gallery, the builder's picker, the large preview) ---------- */

/**
 * A resume shown in template `k`, the way the builder applies it: the template's look, and its section layout only
 * when that layout differs from the current template's (look-only switches keep the person's own order and on/off
 * choices — hidden sections, personal information, declaration and photo stay exactly as they set them).
 */
export function withTemplate(data, k) {
  const t = TEMPLATE_PRESETS[k];
  if (!t || !data) return { data, design: null };
  const cur = data.design?.preset;
  const from = layoutOf(cur in TEMPLATE_PRESETS ? cur : 'fresher');
  const to = layoutOf(k);
  const laid = from === to ? data : { ...data, order: to.order, hidden: { ...to.hidden }, titles: { ...to.titles }, showPhoto: to.showPhoto };
  return { data: laid, design: { ...DEFAULT_DESIGN, ...t.design, preset: k } };
}

export const VIEW_KEY = 'nm7-template-view';
/** True when a resume has the person's own details to show (at least a name, and not the built-in sample). */
export const hasOwnDetails = (data) => !!data?.personal?.name?.trim() && !(data.personal.name === INITIAL.personal.name && data.personal.email === INITIAL.personal.email);
/** Which view to open: the choice saved on this device, else My details when there is a name to show, else Sample. */
export function startView(saved, data) {
  if (saved === 'sample' || saved === 'mine') return saved;
  return hasOwnDetails(data) ? 'mine' : 'sample';
}
export function readView() { try { return localStorage.getItem(VIEW_KEY); } catch { return null; } }
export function saveView(v) { try { localStorage.setItem(VIEW_KEY, v); } catch { /* private mode: this visit only */ } }
