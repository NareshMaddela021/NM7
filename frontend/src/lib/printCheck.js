// "Check before download": the checks shown next to the print preview, worked out from the resume and from the PDF
// that will be saved (read back with pdf.js, so what is checked is exactly what prints). Nothing here blocks a
// download: "Download anyway" is always there.
import { visibleResume } from '../pages/builder/entries';
import { buildSections, printable } from '../pages/builder/resumeModel';
import { checklist } from './placementFormat';

const t = (s) => String(s ?? '').trim();
const words = (s) => t(s).split(/\s+/).filter(Boolean).length;
export const LONG_BULLET_WORDS = 35; // about two printed lines; recruiters skim the first one

/** The page target: a college's limit, else 1 page with under 3 years of work, else 2. */
export function targetPages(data, college = null) {
  if (college?.rules?.maxPages) return { pages: college.rules.maxPages, why: 'your college format' };
  const months = (data?.exp || []).filter((e) => e && e.off !== true && (e.company || e.role)).reduce((n, e) => {
    const from = Date.parse(e.from || '');
    const to = e.current || !e.to ? Date.now() : Date.parse(e.to);
    return Number.isFinite(from) && Number.isFinite(to) && to > from ? n + (to - from) / (30.4 * 864e5) : n;
  }, 0);
  return months >= 36 ? { pages: 2, why: '3+ years of experience' } : { pages: 1, why: 'freshers and early career' };
}

/** A link a recruiter can open: http(s), a real-looking host, no spaces. */
export function linkProblem(url) {
  const u = t(url);
  if (!u) return null;
  if (/\s/.test(u)) return 'has a space in it';
  let full;
  try { full = new URL(/^[a-z][a-z0-9+.-]*:/i.test(u) ? u : `https://${u}`); } catch { return 'isn’t a web address'; }
  if (!/^https?:$/.test(full.protocol)) return 'isn’t a web address';
  if (!/^[a-z0-9-]+(\.[a-z0-9-]+)+$/i.test(full.hostname) || /\.$/.test(full.hostname)) return 'isn’t a full web address';
  if (/linkedin\.com$/i.test(full.hostname) && !/^\/(in|company|pub)\/[^/]+/i.test(full.pathname)) return 'isn’t a LinkedIn profile link (linkedin.com/in/…)';
  return null;
}
const hostOf = (url) => { try { return new URL(/^[a-z]+:/i.test(url) ? url : `https://${url}`).hostname.replace(/^www\./, '').toLowerCase(); } catch { return ''; } };

/** Every link the resume prints: [{ where, url }] */
export function resumeLinks(data) {
  const d = visibleResume(data || {});
  const out = [];
  const names = { linkedin: 'LinkedIn', github: 'GitHub', portfolio: 'Portfolio', website: 'Website' };
  for (const [k, v] of Object.entries(d.links || {})) if (t(v)) out.push({ where: names[k] || k, url: t(v) });
  for (const x of d.linkExtras || []) if (t(x?.url)) out.push({ where: t(x.label) || 'Link', url: t(x.url) });
  const each = (list, label, head) => (list || []).forEach((it) => (it?.links || []).forEach((l) => { if (t(l?.url)) out.push({ where: `${label}: ${t(head(it)) || 'entry'}`, url: t(l.url) }); }));
  each(d.exp, 'Experience', (e) => e.company || e.role);
  each(d.proj, 'Projects', (p) => p.title);
  each(d.certs, 'Certifications', (c) => c.name);
  each(d.ach, 'Achievements', (a) => a.title);
  (d.custom || []).forEach((c) => each(c.items, c.label || 'Section', (x) => x.title));
  return out;
}

/** The bullets that are too long to skim: [{ where, words }] */
export function longBullets(data) {
  const d = printable(visibleResume(data || {}));
  const out = [];
  const check = (text, where) => {
    for (const line of String(text || '').split('\n')) {
      const w = words(line.replace(/^[-•*]\s*/, ''));
      if (w > LONG_BULLET_WORDS) out.push({ where, words: w, start: t(line.replace(/^[-•*]\s*/, '')).split(/\s+/).slice(0, 6).join(' ') });
    }
  };
  (d.exp || []).forEach((e) => check(e.description, `Experience: ${t(e.company || e.role) || 'entry'}`));
  (d.proj || []).forEach((p) => check(p.description, `Projects: ${t(p.title) || 'entry'}`));
  (d.ach || []).forEach((a) => check(a.description, `Achievements: ${t(a.title) || 'entry'}`));
  (d.custom || []).forEach((c) => (c.items || []).forEach((x) => check(x.description, `${t(c.label) || 'Section'}: ${t(x.title) || 'entry'}`)));
  return out;
}

/** Printed sections with only a heading line and nothing under it (e.g. a project with a title and no details). */
export function thinSections(data, design) {
  const { main, side } = buildSections(data || {}, design || {});
  const bare = (it) => !(it.lines || []).length && !t(it.sub) && !t(it.date) && !(it.links || []).length;
  return [...main, ...side].filter((s) => s.items.length && s.items.every(bare)).map((s) => s.title);
}

/**
 * Reads a pdf.js document: page count, page size, text runs with their box, and the link annotations.
 * Works with the browser build and the legacy (node) build alike.
 */
export async function readPrint(doc) {
  const pages = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const vp = page.getViewport({ scale: 1 });
    const content = await page.getTextContent();
    const runs = content.items.filter((it) => t(it.str)).map((it) => ({ str: it.str, x: it.transform[4], y: it.transform[5], w: it.width, h: it.height || Math.abs(it.transform[3]) }));
    const links = (await page.getAnnotations()).filter((a) => a.subtype === 'Link' && a.url).map((a) => a.url);
    pages.push({ w: vp.width, h: vp.height, runs, links });
  }
  return { count: doc.numPages, pages };
}

/** Text that runs past the paper edge (or so close to it that a printer cuts it). */
export function cutOff(print) {
  const out = [];
  print.pages.forEach((pg, i) => {
    for (const r of pg.runs) {
      const over = r.x < 2 || r.x + r.w > pg.w - 2 || r.y < 2 || r.y + r.h > pg.h - 2;
      if (over) out.push({ page: i + 1, text: t(r.str).slice(0, 40) });
    }
  });
  return out;
}

/**
 * The checklist: [{ key, ok, text, fix? }] (fix: the builder section to open). `print` is readPrint()'s result;
 * `college` a group's placement format ({ rules }) when the student is in one; `photo` the photo that prints.
 */
export function printChecks({ data, design, print, college = null, photo = null, cover = false }) {
  const d = data || {};
  const items = [];
  const p = d.personal || {};
  const missing = [['name', p.name], ['phone number', p.phone], ['email', p.email]].filter(([, v]) => !t(v)).map(([k]) => k);
  items.push({ key: 'contact', ok: !missing.length, text: missing.length ? `Add your ${missing.join(', ').replace(/, ([^,]*)$/, ' and $1')}` : 'Name, phone and email are there', fix: 'personal' });
  if (print) {
    if (!cover) {
      const goal = targetPages(d, college);
      items.push({ key: 'pages', ok: print.count <= goal.pages, text: print.count <= goal.pages ? `${print.count} page${print.count > 1 ? 's' : ''} (target ${goal.pages}, for ${goal.why})` : `${print.count} pages: aim for ${goal.pages} (for ${goal.why}). Shorten bullets or hide a section.` });
    }
    const cut = cutOff(print);
    items.push({ key: 'cutoff', ok: !cut.length, text: cut.length ? `Text runs off the page on page ${cut[0].page}: “${cut[0].text}”${cut.length > 1 ? ` and ${cut.length - 1} more` : ''}. Break up long words or links.` : 'Nothing is cut off at the page edges' });
  }
  if (cover) return items;
  const thin = thinSections(d, design);
  items.push({ key: 'empty', ok: !thin.length, text: thin.length ? `${thin.join(', ')}: a heading with nothing under it. Add details or hide it.` : 'No empty sections', fix: 'sections' });
  const links = resumeLinks(d);
  const broken = links.map((l) => ({ ...l, problem: linkProblem(l.url) })).filter((l) => l.problem);
  const printedLinks = new Set((print?.pages || []).flatMap((pg) => pg.links).map(hostOf));
  const dead = print ? links.filter((l) => !linkProblem(l.url) && !printedLinks.has(hostOf(l.url))) : [];
  items.push({ key: 'links', ok: !broken.length && !dead.length,
    text: broken.length ? `${broken[0].where} link ${broken[0].problem}${broken.length > 1 ? ` (and ${broken.length - 1} more)` : ''}`
      : dead.length ? `${dead[0].where} link won’t be clickable in the PDF${dead.length > 1 ? ` (and ${dead.length - 1} more)` : ''}`
        : links.length ? `${links.length} link${links.length > 1 ? 's' : ''} look right and are clickable` : 'No links to check', fix: 'personal' });
  const long = longBullets(d);
  items.push({ key: 'bullets', ok: !long.length, text: long.length ? `${long.length} long bullet${long.length > 1 ? 's' : ''} (over ${LONG_BULLET_WORDS} words), e.g. ${long[0].where}: “${long[0].start}…”. Split into two or cut words.` : 'Bullets are short enough to skim' });
  const shows = !!d.showPhoto;
  if (shows && !photo) items.push({ key: 'photo', ok: false, text: 'Photo is switched on but no photo is added', fix: 'personal' });
  else if (shows) items.push({ key: 'photo', ok: true, text: 'Photo: use a recent, plain-background passport-style photo (many companies don’t need one)' });
  for (const c of college ? checklist(d, college, print?.count ?? null) : []) items.push({ ...c, key: `college-${c.key}`, text: `College format: ${c.text}` });
  return items;
}

export const problems = (items) => items.filter((i) => !i.ok).length;
