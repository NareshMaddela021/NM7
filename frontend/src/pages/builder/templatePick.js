// The template picker's selection logic (TemplatePicker.jsx), kept plain so it can be unit tested.

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
