// The template picker's selection logic (TemplatePicker.jsx), kept plain so it can be unit tested.
// Also the small template helpers the home page needs, so it doesn't have to load the picker (and the preview).
import { DEFAULT_DESIGN, TEMPLATE_PRESETS } from './design';
import { INITIAL, SECTION_LAYOUTS } from './schema';

export const layoutOf = (k) => SECTION_LAYOUTS[TEMPLATE_PRESETS[k]?.sections || 'standard'];
// grey silhouette so photo templates show where the photo goes
export const PHOTO_PLACEHOLDER = `data:image/svg+xml;utf8,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" fill="#D9DCE1"/><circle cx="32" cy="25" r="11" fill="#A9AFB8"/><path d="M10 60c2-12 11-18 22-18s20 6 22 18z" fill="#A9AFB8"/></svg>')}`;

/** "Freshers" / "Experienced" / "Any level". */
export const audienceOf = (t) => (t?.audience ? t.audience : t?.level === 'fresher' ? 'Freshers' : t?.level === 'experienced' ? 'Experienced' : 'Any level');

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
 * A resume shown in template `k`: the template's look (fonts, colours, columns) and nothing else. Section on/off,
 * order, titles, the photo switch and all content stay exactly as the person set them.
 */
export function withTemplate(data, k) {
  const t = TEMPLATE_PRESETS[k];
  if (!t || !data) return { data, design: null };
  return { data, design: { ...DEFAULT_DESIGN, ...t.design, preset: k } };
}

const OPTIONAL = { hobbies: 'Hobbies', strengths: 'Strengths', pinfo: 'Personal information', decl: 'Declaration' };
/**
 * What template `k` usually shows that this resume has switched off: [{ id, label }] (sections, and 'photo').
 * Only a suggestion ("Turn it on?"); picking a template never switches anything by itself.
 */
export function templateSuggests(data, k) {
  if (!TEMPLATE_PRESETS[k] || !data) return [];
  const l = layoutOf(k);
  const out = Object.entries(OPTIONAL).filter(([id]) => !l.hidden[id] && data.hidden?.[id]).map(([id, label]) => ({ id, label }));
  if (l.showPhoto && !data.showPhoto) out.push({ id: 'photo', label: 'a photo' });
  return out;
}
/** "Personal information", "Hobbies and Strengths", "Hobbies, Strengths and Declaration". */
export const listText = (items) => (items.length < 2 ? items[0]?.label || '' : `${items.slice(0, -1).map((x) => x.label).join(', ')} and ${items[items.length - 1].label}`);

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
