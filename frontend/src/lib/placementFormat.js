// The college's official placement format (Organizations, colleges Phase 2), applied to org-side copies: the view,
// PDF, combined PDF, ZIP, kiosk print and recruiter downloads of a group that prints in it. Only the layout changes:
//   - the template: the member's own one when the college allows it, else the college's first choice;
//   - the section order: the college's order first, then the member's other sections in their own order;
//   - the photo: printed only when the college allows photos (and the member switched it on);
//   - the roll number in the header strip, when the college shows it.
// Content is never changed, and a section the member switched off stays off (and one switched on stays on). What
// doesn't follow the college's rules is listed for the member to fix (`checklist`).
import { DEFAULT_DESIGN, TEMPLATE_PRESETS } from '../pages/builder/design';
import { PRINTABLE, resolveOrder } from '../pages/builder/schema';
import { resumeShape } from '../pages/builder/entries';

export const SECTION_NAMES = PRINTABLE; // summary, exp, proj, edu, skills, certs, ach, langs, hobbies, strengths, pinfo, decl
export const ALL_TEMPLATES = Object.keys(TEMPLATE_PRESETS);

const has = (v) => typeof v === 'string' ? v.trim().length > 0 : Array.isArray(v) ? v.length > 0 : !!v;

/** Is a section filled in (and switched on) for this member? */
export function sectionFilled(d, id) {
  if (d?.hidden?.[id]) return false;
  const on = (x) => x && x.off !== true;
  switch (id) {
    case 'summary': return has(d.summary);
    case 'exp': return (d.exp || []).some((e) => on(e) && (e.company || e.role));
    case 'proj': return (d.proj || []).some((p) => on(p) && p.title);
    case 'edu': return (d.edu || []).some((e) => on(e) && (e.institution || e.degree));
    case 'skills': return (d.skillGroups || []).some((g) => on(g) && has(g.value)) || has(d.skills);
    case 'certs': return (d.certs || []).some((c) => on(c) && c.name);
    case 'ach': return (d.ach || []).some((a) => on(a) && (a.title || a.description));
    case 'langs': return (d.langs || []).some((l) => on(l) && l.name);
    case 'hobbies': return has(d.hobbies);
    case 'strengths': return has(d.strengths);
    case 'pinfo': return Object.values(d.pinfo || {}).some(has);
    case 'decl': return !d.hidden?.decl && !!d.decl;
    default: return false;
  }
}

/** The template key the member's copy is drawn in. */
export function formatTemplate(brand, data) {
  const allowed = (brand?.templates?.length ? brand.templates : [brand?.template || 'fresher']).filter((k) => TEMPLATE_PRESETS[k]);
  const own = data?.design?.preset;
  return allowed.includes(own) ? own : allowed[0] || 'fresher';
}

/** The design for an org-side copy: the chosen template as it ships (the colour goes in the header strip only). */
export function formatDesign(brand, data) {
  const k = formatTemplate(brand, data);
  return { ...DEFAULT_DESIGN, ...TEMPLATE_PRESETS[k].design, preset: k };
}

/** The member's resume laid out in the college format: same content, the college's section order and photo rule. */
export function formatData(data, brand) {
  const rules = brand?.rules;
  if (!data || !rules) return data;
  const own = resolveOrder(resumeShape(data)); // an old resume may miss lists the order reads
  const first = (rules.order || []).filter((id) => own.includes(id));
  return {
    ...data,
    order: [...first, ...own.filter((id) => !first.includes(id))],
    showPhoto: rules.photo ? data.showPhoto : false,
  };
}

/** The brand for one member's copy: the roll number goes in the header strip when the college shows it. */
export function brandFor(brand, roll = '') {
  if (!brand) return brand;
  return { ...brand, roll: brand.rules?.showRoll ? String(roll || '').trim() : '' };
}

/** What doesn't follow the college's rules (for the member to fix; nothing is changed for them). `pages`: the
 * member's page count in the college format, when known. */
export function checklist(data, brand, pages = null) {
  const rules = brand?.rules;
  const items = [];
  if (!data || !rules) return items;
  data = resumeShape(data); // an old resume may miss lists the rules read
  const name = (id) => SECTION_NAMES[id] || id;
  for (const id of rules.required || []) {
    items.push({ key: `req-${id}`, ok: sectionFilled(data, id), text: `${name(id)} is required` });
  }
  if (rules.requireCgpa) {
    const edu = (data.edu || []).filter((e) => e && e.off !== true && (e.institution || e.degree));
    items.push({ key: 'cgpa', ok: edu.length > 0 && edu.some((e) => has(e.grade)), text: 'CGPA or percentage required in Education' });
  }
  if (rules.optional) {
    const allowed = new Set([...(rules.order || []), ...(rules.required || []), ...rules.optional]);
    const extra = Object.keys(SECTION_NAMES).filter((id) => !allowed.has(id) && sectionFilled(data, id));
    for (const id of extra) items.push({ key: `extra-${id}`, ok: false, text: `${name(id)} isn’t part of the college format: hide it in the builder if you like` });
  }
  if (rules.maxPages) {
    items.push({ key: 'pages', ok: pages === null ? true : pages <= rules.maxPages, text: `Keep to ${rules.maxPages} page${rules.maxPages > 1 ? 's' : ''}${pages ? ` (now ${pages})` : ''}` });
  }
  if (!rules.photo && data.showPhoto) items.push({ key: 'photo', ok: false, text: 'Your photo won’t print in the college format' });
  return items;
}
