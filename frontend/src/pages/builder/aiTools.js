// Bullet helpers. "Rewrite with results" is a sample until the AI endpoint exists; the other two are simple rules that run now.
const VERBS = ['Built', 'Led', 'Created', 'Improved', 'Reduced', 'Increased', 'Designed', 'Automated', 'Analysed', 'Delivered', 'Launched', 'Managed', 'Developed', 'Cut', 'Grew'];
const WEAK = /^(responsible for|worked on|helped (with|in|to)?|involved in|assisted (with|in)?|handled|did|made)\s+/i;
const lines = (t) => (t || '').split('\n').map((l) => l.trim()).filter(Boolean);
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);

/** Keeps each bullet to about 22 words, cutting at a comma or "and" where possible. */
export function shorten(text) {
  return lines(text).map((l) => {
    const words = l.replace(/^[•\-*▸–]\s*/, '').split(/\s+/);
    if (words.length <= 22) return l;
    let cut = words.slice(0, 22).join(' ');
    const at = Math.max(cut.lastIndexOf(','), cut.lastIndexOf(' and '));
    if (at > 60) cut = cut.slice(0, at);
    return cut.replace(/[,;:\s]+$/, '');
  }).join('\n');
}

/** ATS-friendly: plain characters, starts with an action verb, no first person, no trailing full stops. */
export function atsFriendly(text) {
  return lines(text).map((l, i) => {
    let t = l.replace(/^[•\-*▸–➢✓]\s*/, '').replace(/[“”]/g, '"').replace(/[‘’]/g, "'").replace(/\s*&\s*/g, ' and ').replace(/[|→]/g, '-')
      .replace(/\b(I|we|my|our)\s+/gi, '').replace(/\s{2,}/g, ' ').trim();
    if (WEAK.test(t)) t = `${VERBS[i % VERBS.length]} ${t.replace(WEAK, '')}`;
    return cap(t).replace(/\.$/, '');
  }).join('\n');
}
