// Reader for any resume layout (PDF, Word or pasted text). It works on "lines":
// { text, size, bold, x, textX, y, page } — PDFs give real positions; Word and pasted text give estimates.
import { findDates, stripDate, normDate } from './dates';
import {
  headingId, ROLE_RE, ORG_RE, DEGREE_RE, SCHOOL_RE, GRADE_RE, EMAIL_RE, PHONE_RE, URL_RE, INDIAN_PLACE_RE,
  langLevel, linkSlot, cleanUrl,
} from './vocab';
import { emptyResult, groupSkills, splitDegree } from './shared';

const BULLET_RE = /^[•●▪■◦‣\-*➢➤✓✔►▶◆◇□❖·]\s*/;
const isBullet = (l) => BULLET_RE.test(l.text) && !/^-\s*\d/.test(l.text);
const unbullet = (t) => t.replace(BULLET_RE, '').trim();
const PRINT_TITLES = { summary: 'Summary', exp: 'Experience', edu: 'Education', skills: 'Skills', proj: 'Projects', certs: 'Certifications', ach: 'Achievements', langs: 'Languages', hobbies: 'Hobbies', strengths: 'Strengths', pinfo: 'Personal Information', decl: 'Declaration' };

/** Most common font size, weighted by text length. */
function bodySize(lines) {
  const w = {};
  lines.forEach((l) => { w[l.size] = (w[l.size] || 0) + l.text.length; });
  return +Object.entries(w).sort((a, b) => b[1] - a[1])[0]?.[0] || 11;
}

export function parseResume(lines, { links = [], source = 'resume' } = {}) {
  const R = emptyResult(source);
  if (!lines.length) return R;
  const body = bodySize(lines);

  /* ---------- 1. split into sections ---------- */
  // where known headings sit: an unknown bold line at the same spot is a heading too (e.g. "Extracurricular")
  const headXs = lines.filter((l) => headingId(l.text.trim()) && !isBullet(l)).map((l) => ({ x: l.x, size: l.size, bold: l.bold }));
  const likeHeading = (l) => headXs.some((h) => l.x != null && Math.abs(h.x - l.x) < 3 && Math.abs(h.size - l.size) < 0.6 && h.bold === l.bold && l.size > body);
  const sections = [];
  const header = [];
  lines.forEach((l) => {
    const t = l.text.trim();
    const colon = t.match(/^([A-Za-z][A-Za-z &/]{2,40}):\s*(.+)$/);
    let id = headingId(t);
    const inside = sections[sections.length - 1]?.id;
    if (id && ['skills', 'pinfo'].includes(inside) && colon) id = null; // "Languages: C, Python" inside Skills is a category
    if (!id && colon && headingId(colon[1]) && !['pinfo', 'decl'].includes(headingId(colon[1])) && !['skills', 'pinfo'].includes(inside)) {
      // "Skills: Python, SQL" — a heading and its content on one line
      sections.push({ id: headingId(colon[1]), title: colon[1], lines: [{ ...l, text: colon[2] }] });
      return;
    }
    const styled = !id && !isBullet(l) && t.length < 40 && !/\d/.test(t) && t.split(/\s+/).length <= 4
      && sections.length + header.length > 0 && !EMAIL_RE.test(t)
      && ((t === t.toUpperCase() && /[A-Z]{3}/.test(t) && (l.bold || l.size >= body)) || (l.size >= body + 1.5 && l.bold) || likeHeading(l));
    if (id && t.length < 50 && !isBullet(l)) sections.push({ id, title: t.replace(/:$/, ''), lines: [] });
    else if (styled && (sections.length || header.length > 1)) sections.push({ id: 'custom', title: titleCase(t), lines: [] });
    else if (sections.length) sections[sections.length - 1].lines.push(l);
    else header.push(l);
  });

  /* ---------- 2. header: name + contact ---------- */
  contact(R, header, lines, links);

  /* ---------- 3. sections ---------- */
  sections.forEach((s) => {
    const L = s.lines.filter((l) => l.text.trim());
    if (!L.length && s.id !== 'decl') return;
    switch (s.id) {
      case 'summary': R.data.summary = tidy([R.data.summary, L.map((l) => unbullet(l.text)).join(' ')].filter(Boolean).join(' ')); break;
      case 'exp': R.data.exp.push(...blocks(L).map(toExp)); break;
      case 'edu': R.data.edu.push(...blocks(L).map(toEdu)); break;
      case 'proj': R.data.proj.push(...blocks(L).map(toProj)); break;
      case 'certs': R.data.certs.push(...blocks(L).flatMap(toCerts)); break;
      case 'ach': R.data.ach.push(...achList(L)); break;
      case 'skills': skills(R, L); break;
      case 'langs': langs(R, L); break;
      case 'hobbies': R.data.hobbies = listOf(L).join('\n'); break;
      case 'strengths': R.data.strengths = listOf(L).join('\n'); break;
      case 'pinfo': pinfo(R, L); break;
      case 'decl': decl(R, L); break;
      default: R.data.custom.push({ title: s.title, items: blocks(L).map(toCustom) });
    }
  });
  R.sectionsFound = sections.map((s) => (s.id === 'custom' ? s.title : PRINT_TITLES[s.id]));
  return R;
}

const titleCase = (t) => (t === t.toUpperCase() ? t.toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase()) : t);

/* ---------- contact ---------- */
function contact(R, header, all, links) {
  const P = R.data.personal;
  const top = header.length ? header : all.slice(0, 6);
  const contactish = (t) => EMAIL_RE.test(t) || PHONE_RE.test(t) || /linkedin|github|https?:|www\./i.test(t);
  const cands = top.filter((l) => !contactish(l.text) && /^[A-Za-z][A-Za-z .'-]{2,40}$/.test(l.text.trim()));
  const name = cands.sort((a, b) => b.size - a.size || a.y - b.y)[0];
  if (name) P.name = titleCase(name.text.trim());
  const text = (header.length ? header : all.slice(0, 12)).map((l) => l.text).join('  |  ');
  const scan = text || all.map((l) => l.text).join(' ');
  P.email = (scan.match(EMAIL_RE) || all.map((l) => l.text).join(' ').match(EMAIL_RE) || [''])[0];
  const ph = scan.match(PHONE_RE) || all.map((l) => l.text).join(' ').match(PHONE_RE);
  if (ph) P.phone = ph[0].replace(/\s*-\s*/g, ' ').replace(/\s+/g, ' ').trim();
  // headline: a short non-contact line right under the name
  const nameIdx = name ? top.indexOf(name) : -1;
  const next = top[nameIdx + 1];
  if (next && !contactish(next.text) && next.text.length < 80 && !INDIAN_PLACE_RE.test(next.text)) P.headline = next.text.trim();
  // location: a header part that names an Indian place
  const parts = top.flatMap((l) => l.text.split(/\s*[|•·#]\s*|\s{3,}/)).map((s) => s.trim()).filter(Boolean);
  const loc = parts.find((p) => INDIAN_PLACE_RE.test(p) && !contactish(p) && p.length < 60);
  if (loc) P.location = loc;

  // links: text URLs + clickable areas. Clickable areas win; flag ones that don't match visible text.
  const visible = all.map((l) => l.text).join(' ');
  const textUrls = (scan.replace(new RegExp(EMAIL_RE.source, 'g'), ' ').match(URL_RE) || []).filter((u) => !EMAIL_RE.test(u) && /\.(com|in|io|dev|me|org|net|co|ai|app|site|xyz|page)\b/i.test(u));
  const clickable = links.map((k) => k.url).filter((u) => /^https?:/i.test(u));
  const all2 = [...clickable, ...textUrls];
  const lnk = all2.filter((u) => /linkedin\.com\/in\//i.test(u)).map(cleanUrl);
  const uniqLnk = [...new Set(lnk)];
  if (uniqLnk.length > 1) {
    // prefer the one with the widest clickable area (sits on the visible "LinkedIn" text, not on a stray icon)
    const ranked = links.filter((k) => /linkedin\.com\/in\//i.test(k.url)).sort((a, b) => b.w - a.w).map((k) => cleanUrl(k.url));
    const keep = ranked[0] || uniqLnk[0];
    R.data.links.linkedin = keep;
    uniqLnk.filter((u) => u !== keep).forEach((u) => R.notes.push({ kind: 'warn', sec: 'links', msg: `Your file also has a hidden link to ${u}. It may be left over from a template — check your original resume too.` }));
  }
  [...new Set(all2.map(cleanUrl))].forEach((u) => {
    const slot = linkSlot(u);
    if (!R.data.links[slot]) R.data.links[slot] = u;
    else if (R.data.links[slot] !== u && slot !== 'linkedin') R.extraLinks.push(u);
  });
  if (!visible.toLowerCase().includes((R.data.links.linkedin || '').split('/').pop()?.toLowerCase() || '§') && R.data.links.linkedin) {
    R.notes.push({ kind: 'info', sec: 'links', msg: `LinkedIn link read from the clickable “LinkedIn” text: ${R.data.links.linkedin}` });
  }
}

/** Joins words split across lines ("data-" + "driven") and fixes spaces before punctuation. */
const tidy = (t) => t.replace(/(\w)-\s+(\w)/g, '$1-$2').replace(/\s+([.,;:)])/g, '$1').replace(/\(\s+/g, '(').replace(/\s+/g, ' ').trim();

/* ---------- blocks: one entry = header lines + its bullets ---------- */
// bullet = { t, sub: [] } — sub holds an indented line under a dated bullet (e.g. the institute under a course)
function blocks(L) {
  const out = [];
  let cur = null;
  let lastX = null;
  L.forEach((l, i) => {
    const prev = L[i - 1];
    if (isBullet(l)) {
      if (!cur) { cur = { head: [], items: [] }; out.push(cur); }
      cur.items.push({ t: unbullet(l.text), sub: [] });
      lastX = l.textX ?? null;
      return;
    }
    const last = cur?.items[cur.items.length - 1];
    const indentMatch = lastX != null && l.x != null && (Math.abs(l.x - lastX) < 4 || Math.abs((l.textX ?? l.x) - lastX) < 4);
    const close = prev && l.page === prev.page && l.y - prev.y < Math.max(l.size, 9) * 2.6;
    if (last && (indentMatch || /^[a-z&(,]/.test(l.text)) && (close || prev?.page !== l.page)) {
      if (findDates(last.t) && !findDates(l.text)) last.sub.push(l.text.trim()); else last.t += ` ${l.text.trim()}`;
      return;
    }
    const hasDate = !!findDates(l.text);
    const curHasDate = cur && cur.head.some((h) => findDates(h));
    const bigGap = prev && l.page === prev.page && l.y - prev.y > Math.max(l.size, 9) * 2.2;
    if (!cur || cur.items.length || (hasDate && curHasDate) || (bigGap && cur.head.length)) { cur = { head: [], items: [] }; out.push(cur); lastX = null; }
    cur.head.push(l.text.trim());
  });
  return out.map((b) => ({ head: b.head, items: b.items.map((x) => ({ t: tidy(x.t), sub: x.sub })), bullets: b.items.map((x) => tidy([x.t, ...x.sub].join(' — '))) }));
}

function dateOf(b) {
  for (const h of b.head) { const d = findDates(h); if (d) return d; }
  return null;
}
const strip = (b, d) => b.head.map((h) => (d && h.includes(d.raw) ? stripDate(h, d) : h)).map((h) => h.replace(/[,\s|–-]+$/, '').trim()).filter(Boolean);
const flag = (o, why) => Object.assign(o, why ? { _conf: 'check', _why: why } : {});

function toExp(b) {
  const d = dateOf(b);
  const hs = strip(b, d).flatMap((h) => h.split(/\s+[|]\s+|\s{3,}/));
  let role = '';
  let company = '';
  const at = hs.find((h) => /\s(?:at|@)\s/i.test(h));
  if (at) [role, company] = at.split(/\s(?:at|@)\s/i).map((s) => s.trim());
  else {
    const roleLine = hs.find((h) => ROLE_RE.test(h) && !ORG_RE.test(h)) || hs.find((h) => ROLE_RE.test(h));
    const orgLine = hs.find((h) => h !== roleLine);
    role = roleLine || hs[0] || '';
    company = orgLine || (roleLine ? '' : hs[1] || '');
  }
  // "Hyundai Glovis, Penukonda-Andhra Pradesh" → company only (place goes away)
  const parts = company.split(/\s*,\s*/);
  if (parts.length > 1 && INDIAN_PLACE_RE.test(parts.slice(1).join(','))) company = parts[0];
  const type = /intern/i.test(role) ? 'Internship' : '';
  return flag({ company, role: role.replace(/[,\s]+$/, ''), employmentType: type, from: d?.from || '', to: d?.to || '', current: !!d?.current, description: b.bullets.join('\n') },
    !d ? 'Dates not found.' : !company ? 'Company not found.' : d.from && !d.from.includes('-') ? 'Only years found — add months if you know them.' : '');
}

function toEdu(b) {
  const d = dateOf(b);
  const hs = strip(b, d);
  let grade = '';
  const cleaned = hs.map((h) => {
    const g = h.match(GRADE_RE);
    if (!g) return h;
    grade = g[0].replace(/\s+/g, ' ').replace(/^(cgpa|gpa|cpi|sgpa|percentage|marks|aggregate)\s*[:–-]?\s*/i, '').trim();
    const label = (g[1] || '').toUpperCase();
    if (label && !/%/.test(grade)) grade = `${grade} ${label === 'PERCENTAGE' || label === 'MARKS' ? '%' : label}`.trim();
    return h.replace(g[0], '').replace(/[\s,–-]+$/, '').trim();
  }).filter(Boolean);
  const degLine = cleaned.find((h) => DEGREE_RE.test(h)) || cleaned[0] || '';
  let inst = cleaned.find((h) => h !== degLine && SCHOOL_RE.test(h)) || cleaned.find((h) => h !== degLine) || '';
  const ip = inst.split(/\s*,\s*/);
  if (ip.length > 1 && INDIAN_PLACE_RE.test(ip[ip.length - 1])) inst = ip.slice(0, -1).join(', ');
  const { degree, field } = splitDegree(degLine);
  const yearsOnly = d && d.from && !d.from.includes('-');
  return flag({ institution: inst, degree, field, from: d?.from || '', to: d?.to || '', current: !!d?.current, grade },
    !d ? 'Dates not found.' : !inst ? 'Institution not found.' : yearsOnly ? '' : '');
}

function toProj(b) {
  const d = dateOf(b);
  const hs = strip(b, d);
  let tech = '';
  const bullets = b.bullets.filter((x) => {
    const m = x.match(/^(?:tech(?:nologies)?(?: stack)?|tools(?: used)?|built with)\s*[:–-]\s*(.+)$/i);
    if (m) { tech = m[1]; return false; }
    return true;
  });
  const [title = '', ...rest] = hs;
  const sub = rest.join(' · ');
  const tm = sub.match(/(?:tech(?:nologies)?|tools)\s*[:–-]\s*(.+)$/i);
  return flag({ title: title.replace(/\s*[|–-]\s*$/, ''), tagline: tm ? '' : sub, type: '', status: d?.current ? 'In Development' : '', from: d?.from || '', to: d?.to || '', ongoing: !!d?.current, description: bullets.join('\n'), tech: tech || (tm ? tm[1] : ''), links: projLinks(b) }, title ? '' : 'Project title not found.');
}

/** Web addresses written inside a project → clickable words (GitHub / Live Demo). */
function projLinks(b) {
  const urls = [...b.head, ...b.bullets].join(' ').match(/(?:https?:\/\/)?(?:www\.)?(?:github\.com|[a-z0-9-]+\.(?:vercel\.app|netlify\.app|herokuapp\.com|github\.io|streamlit\.app|onrender\.com))\/?[^\s,|()]*/gi) || [];
  return [...new Set(urls)].slice(0, 2).map((u) => ({ url: cleanUrl(u), label: /github\.com/i.test(u) ? 'GitHub' : 'Live Demo' }));
}

function toCerts(b) {
  if (!b.head.length) return b.bullets.map((x) => { const d = findDates(x); return { name: stripDate(x, d), issuer: '', issueDate: d?.to || d?.from || '', expiryDate: '', credentialId: '', links: [], noExpiry: false }; });
  const d = dateOf(b);
  const [name = '', issuer = ''] = strip(b, d);
  return [{ name, issuer, issueDate: d?.from || d?.to || '', expiryDate: '', credentialId: '', links: [], noExpiry: false }];
}

function achList(L) {
  return blocks(L).flatMap((b) => [...b.head, ...b.bullets]).map((t) => {
    const d = findDates(t);
    const text = d ? stripDate(t, d) : t;
    const [title, ...desc] = text.split(/\s+[–—]\s+/);
    return { title: title.trim(), type: '', date: d?.to || d?.from || '', issuer: '', description: desc.join(' – ') };
  });
}

function toCustom(b) {
  const d = dateOf(b);
  const [title = '', subtitle = ''] = strip(b, d);
  return { title, subtitle, date: d ? d.raw : '', description: b.bullets.join('\n') };
}

function listOf(L) {
  return L.flatMap((l) => unbullet(l.text).split(/\s*[,;|]\s*|\s*•\s*/)).map((s) => s.replace(/\.$/, '').trim()).filter(Boolean);
}

/* ---------- skills (also catches courses listed under "Course & Skills") ---------- */
function skills(R, L) {
  const bs = blocks(L);
  const flat = [];
  bs.forEach((b) => {
    const d = dateOf(b);
    if (d && b.head.length) {
      // a dated entry inside Skills is a course → Certifications
      const [name = '', issuer = ''] = strip(b, d);
      R.data.certs.push({ name, issuer, issueDate: d.from, expiryDate: '', credentialId: '', links: [], noExpiry: !!d.current, _conf: 'check', _why: d.current ? 'Ongoing course — found under Skills, moved here.' : 'Found under Skills, moved here.' });
      R.notes.push({ kind: 'info', sec: 'certs', msg: `“${name}” was listed under Skills — moved to Certifications.` });
      b.bullets.forEach((x) => flat.push(x));
      return;
    }
    b.items.forEach((it) => {
      const dd = findDates(it.t);
      if (dd && !dd.single) {
        const name = stripDate(it.t, dd);
        R.data.certs.push({ name, issuer: it.sub[0] || '', issueDate: dd.from, expiryDate: '', credentialId: '', links: [], noExpiry: false, _conf: 'check', _why: dd.current ? 'Ongoing course — found under Skills and moved here.' : 'Found under Skills and moved here.' });
        R.notes.push({ kind: 'info', sec: 'certs', msg: `“${name}” was listed under Skills — moved to Certifications.` });
        it.done = true;
      }
    });
    [...b.head, ...b.items.filter((it) => !it.done).map((it) => it.t)].forEach((x) => {
      const m = x.match(/^([A-Za-z][A-Za-z /&()-]{2,40})\s*[:–-]\s*(.+)$/);
      if (m && m[2].includes(',')) groupSkills(R, m[2].split(/\s*,\s*/), m[1].trim());
      else flat.push(...x.split(/\s*[,;|•]\s*/));
    });
  });
  groupSkills(R, flat);
}

function langs(R, L) {
  const items = L.flatMap((l) => unbullet(l.text).split(/\s*[,;|]\s*(?![^(]*\))/)).filter(Boolean);
  R.data.langs.push(...items.map((t) => { const m = t.match(/^(.*?)\s*[(–-]\s*([^)]*)\)?$/); return { name: (m ? m[1] : t).replace(/[:.]$/, '').trim(), level: langLevel(m ? m[2] : '') }; }).filter((x) => x.name && x.name.length < 30));
}

const PI_KEYS = [
  ['father', /father/i], ['mother', /mother/i], ['dob', /date of birth|d\.?o\.?b|birth/i], ['gender', /gender|sex/i], ['marital', /marital/i],
  ['nationality', /nationality/i], ['languages', /languages?/i], ['address', /address|residence/i],
];
function pinfo(R, L) {
  let last = null;
  L.forEach((l) => {
    const m = unbullet(l.text).match(/^([A-Za-z' .]{3,30}?)\s*[:–-]\s*(.*)$/);
    const key = m && PI_KEYS.find(([, re]) => re.test(m[1]))?.[0];
    if (key) {
      let v = m[2].trim();
      if (key === 'dob') { const dm = v.match(/(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})/); if (dm) v = `${dm[3]}-${dm[2].padStart(2, '0')}-${dm[1].padStart(2, '0')}`; }
      R.data.pinfo[key] = v.replace(/\.$/, '');
      last = key;
    } else if (last === 'address') R.data.pinfo.address += `, ${l.text.trim()}`;
  });
  if (R.data.pinfo.languages && !R.data.langs.length) R.data.langs = R.data.pinfo.languages.split(/\s*,\s*/).map((n) => ({ name: n, level: '' }));
}

function decl(R, L) {
  const text = [];
  const D = { text: '', place: '', date: '', name: '' };
  L.forEach((l) => {
    const t = l.text.trim();
    const pl = t.match(/place\s*[:–-]\s*([^\s].*?)(?=\s{2,}|date|$)/i);
    const dt = t.match(/\bdate\s*[:–-]\s*([0-9/.-]*)/i);
    if (pl) D.place = pl[1].replace(/_+/g, '').trim();
    if (dt && dt[1]) D.date = dt[1].trim();
    const rest = t.replace(/place\s*[:–-]\s*\S*/i, '').replace(/date\s*[:–-]\s*\S*/i, '').replace(/_+/g, '').trim();
    if (pl || dt) { if (rest && rest === rest.toUpperCase() && /[A-Z]{2}/.test(rest)) D.name = rest; return; }
    if (t === t.toUpperCase() && /[A-Z]{2}/.test(t) && t.split(' ').length <= 4 && text.length) { D.name = t; return; }
    text.push(t);
  });
  D.text = text.join(' ').replace(/\s+/g, ' ').trim() || 'I hereby declare that the information given above is true and correct to the best of my knowledge and belief.';
  D.text = D.text.replace(/\bhere by\b/i, 'hereby');
  R.data.decl = D;
}

export const _norm = normDate;
