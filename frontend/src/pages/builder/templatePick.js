// The template picker's selection logic (TemplatePicker.jsx), kept plain so it can be unit tested.
// Also the small template helpers the home page needs, so it doesn't have to load the picker (and the preview).
import { TEMPLATE_PRESETS } from './design';
import { SECTION_LAYOUTS } from './schema';

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
