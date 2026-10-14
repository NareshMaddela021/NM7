// Turns builder data + design into printable sections. Shared by the live preview AND the PDF,
// so what you see is exactly what downloads.
import { DECL_TEXT, PINFO_LABELS, resolveOrder, sectionLabel, splitList, splitSkills } from './schema';
import { fmtDate, fmtDates } from './design';
import { visibleResume } from './entries';

const fullUrl = (u) => (/^https?:\/\//i.test(u) ? u : `https://${u}`);
const shortUrl = (u) => u.replace(/^https?:\/\//i, '').replace(/^www\./i, '').replace(/\/+$/, '');
/** item.links → [{ label, url }] (blank word = "Link"). */
const linksOf = (o) => (o.links || []).filter((l) => l.url && l.url.trim()).map((l) => ({ label: (l.label || '').trim() || 'Link', url: fullUrl(l.url.trim()) }));
/** Optional: also print the address itself, for paper copies. */
const printed = (o, ds) => (ds.printLinks ? linksOf(o).map((l) => `${l.label}: ${shortUrl(l.url)}`) : []);

const SIDE_IDS = ['skills', 'langs', 'certs', 'hobbies', 'strengths'];
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
/** "2001-05-15" → "15 May 2001" */
const longDate = (v) => { const [y, m, day] = (v || '').split('-'); return y && m && day ? `${+day} ${MONTHS[+m - 1]} ${y}` : v; };


/** Lines of a textarea → [{ t, bullet: true }] (leading •, -, * stripped). */
function bullets(text) {
  return (text || '').split('\n').map((s) => s.trim()).filter(Boolean)
    .map((s) => ({ t: s.replace(/^[•\-*▸–]\s*/, ''), bullet: true }));
}

/**
 * Returns { main: [section], side: [section] } in print order.
 * section = { id, title, items: [{ head, date, sub, lines }] }
 * line = string | { t, bullet } | { bold, text } | { label, chips: [] } | { kv: [label, value], url? } | { sign: { left: [], right } }
 */
export function buildSections(data, ds) {
  const d = visibleResume(data); // switched-off entries are never printed
  const f = ds.dateFormat;
  const by = {};
  if (d.summary) by.summary = [{ lines: [d.summary] }];
  by.exp = d.exp.filter((e) => e.company || e.role).map((e) => ({
    head: [e.role, e.company].filter(Boolean).join(' · '), links: linksOf(e), date: fmtDates(e.from, e.to, e.current, f), sub: e.employmentType, lines: [...bullets(e.description), ...printed(e, ds)],
  }));
  by.proj = d.proj.filter((p) => p.title).map((p) => ({
    head: p.title, links: linksOf(p), date: fmtDates(p.from, p.to, p.ongoing, f) || p.status, sub: [p.tagline, p.tech].filter(Boolean).join(' · '),
    lines: [...bullets(p.description), ...printed(p, ds)],
  }));
  by.edu = d.edu.filter((e) => e.institution || e.degree).map((e) => ({
    head: [e.degree, e.field].filter(Boolean).join(', '), date: fmtDates(e.from, e.to, e.current, f, true), sub: [e.institution, e.grade].filter(Boolean).join(' · '),
  }));
  const groups = d.skillGroups.filter((g) => splitSkills(g.value).length);
  if (groups.length) {
    if (ds.skillsStyle === 'comma') by.skills = [{ lines: [groups.flatMap((g) => splitSkills(g.value)).join(', ')] }];
    else if (ds.skillsStyle === 'chips') by.skills = [{ lines: groups.map((g) => ({ label: g.label, chips: splitSkills(g.value) })) }];
    else by.skills = [{ lines: groups.map((g) => ({ bold: `${g.label || 'Skills'}:`, text: splitSkills(g.value).join(', ') })) }];
  }
  by.certs = d.certs.filter((c) => c.name).map((c) => ({ head: c.name, links: linksOf(c), date: fmtDate(c.issueDate, f), sub: [c.issuer, c.credentialId && `ID ${c.credentialId}`].filter(Boolean).join(' · '), lines: printed(c, ds) }));
  by.ach = d.ach.filter((a) => a.title).map((a) => ({ head: a.title, links: linksOf(a), date: fmtDate(a.date, f), sub: [a.type, a.issuer].filter(Boolean).join(' · '), lines: [...bullets(a.description), ...printed(a, ds)] }));
  const langs = d.langs.filter((l) => l.name).map((l) => `${l.name}${l.level ? ` (${l.level})` : ''}`);
  if (langs.length) by.langs = [{ lines: ds.layout === 'two' ? langs : [langs.join(' · ')] }];
  const hobbies = splitList(d.hobbies);
  if (hobbies.length) by.hobbies = [{ lines: hobbies.map((t) => ({ t, bullet: true })) }];
  const strengths = splitList(d.strengths);
  if (strengths.length) by.strengths = [{ lines: strengths.map((t) => ({ t, bullet: true })) }];
  const pi = d.pinfo || {};
  const pLines = Object.keys(PINFO_LABELS).filter((k) => (pi[k] || '').trim()).map((k) => ({ kv: [PINFO_LABELS[k], k === 'dob' ? longDate(pi[k]) : pi[k].trim()] }));
  if (pLines.length) by.pinfo = [{ lines: pLines }];
  const dc = d.decl || {};
  if ((dc.text ?? DECL_TEXT).trim()) {
    const blank = '____________';
    by.decl = [{ lines: [(dc.text ?? DECL_TEXT).trim(), { sign: { left: [`Place: ${dc.place || blank}`, `Date: ${dc.date || blank}`], right: (dc.name || d.personal.name || '').toUpperCase() } }] }];
  }
  d.custom.forEach((c) => {
    by[c.id] = c.items.filter((x) => x.title || x.description).map((x) => ({ head: x.title, links: linksOf(x), date: x.date, sub: x.subtitle, lines: [...bullets(x.description), ...printed(x, ds)] }));
  });

  const all = resolveOrder(d)
    .filter((id) => !d.hidden?.[id] && by[id]?.length)
    .map((id) => ({ id, title: sectionLabel(d, id), items: by[id] }));
  if (ds.layout !== 'two') return { main: all, side: [] };
  return { main: all.filter((s) => !SIDE_IDS.includes(s.id)), side: all.filter((s) => SIDE_IDS.includes(s.id)) };
}

/** Words with a number (20%, ₹2L, 3x, 1,200) — bolded by templates like Impact. Years alone stay normal. */
export const isNumWord = (w) => /[\d₹%]/.test(w) && !/^\(?(19|20)\d{2}\)?[.,;:]?$/.test(w);
