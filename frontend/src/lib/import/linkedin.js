// Reader for LinkedIn's "Save to PDF" profile. Its layout is fixed, so we can read it by position and font size:
// left sidebar (Contact, Top Skills, Languages, Certifications, Honors-Awards), right column (name, headline,
// location, Summary, Experience, Education).
import { toLines } from './pdfRead';
import { coursesLine } from '../courses';
import { findDates, stripDate } from './dates';
import { cleanUrl, langLevel, linkSlot, PHONE_RE, EMAIL_RE } from './vocab';
import { emptyResult, groupSkills, splitDegree, noteLongHeadline } from './shared';

export function isLinkedInPdf({ meta, items }) {
  if (/resume generated from profile/i.test(meta.Subject || '') && /linkedin/i.test(meta.Author || '')) return true;
  const txt = items.slice(0, 60).map((i) => i.str).join(' ');
  return /\bContact\b/.test(txt) && /Top Skills|Languages|Certifications/.test(txt) && items.some((i) => /^Page$/.test(i.str));
}

const SIDE_HEADS = { contact: 'contact', 'top skills': 'skills', languages: 'langs', certifications: 'certs', 'honors-awards': 'ach', 'honors & awards': 'ach', publications: 'pubs', patents: 'patents' };

/** Joins wrapped lines into items: a bigger vertical gap starts a new item. */
function splitByGap(lines, factor = 1.45) {
  const out = [];
  lines.forEach((l, i) => {
    const prev = lines[i - 1];
    const newItem = !prev || l.page !== prev.page || l.y - prev.y > l.size * factor;
    if (newItem) out.push([l]); else out[out.length - 1].push(l);
  });
  return out.map((g) => g.map((l) => l.text).join(' ').replace(/\s+/g, ' ').trim());
}

export function parseLinkedIn({ items, links, pages }) {
  const R = emptyResult('linkedin');
  const W = pages[0].w;
  const body = items.filter((i) => !(i.size <= 9.2 && /^(Page|\d+|of)$/.test(i.str.trim())));
  const side = toLines(body, { maxX: W * 0.33 });
  const main = toLines(body, { minX: W * 0.33 });

  /* ---------- sidebar ---------- */
  const sideSecs = {};
  let curS = null;
  side.forEach((l) => {
    const key = SIDE_HEADS[l.text.toLowerCase()];
    if (key && l.size >= 12.5) { curS = key; sideSecs[curS] = []; return; }
    if (curS) sideSecs[curS].push(l);
  });

  // contact: links come from the PDF's clickable areas (more reliable than wrapped text)
  const contactText = (sideSecs.contact || []).map((l) => l.text).join(' ');
  const mail = links.find((k) => /^mailto:/i.test(k.url));
  const email = mail ? mail.url.replace(/^mailto:/i, '') : (contactText.replace(/\s/g, '').match(EMAIL_RE) || [])[0];
  if (email) R.data.personal.email = email;
  const phone = contactText.match(PHONE_RE);
  if (phone) R.data.personal.phone = phone[0].trim();
  const seen = new Set();
  const joined = (sideSecs.contact || []).map((l) => l.text).join('').replace(/\s+/g, '');
  links.filter((k) => /^https?:/i.test(k.url)).forEach((k) => {
    const short = cleanUrl(k.url);
    if (seen.has(short)) return;
    seen.add(short);
    const pos = joined.toLowerCase().indexOf(short.toLowerCase().replace(/\/+$/, ''));
    const label = pos >= 0 ? (joined.slice(pos).match(/\(([A-Za-z ]+)\)/) || [])[1] || '' : '';
    const slot = linkSlot(short, label);
    if (!R.data.links[slot]) R.data.links[slot] = short;
    else R.extraLinks.push(`${short}${label ? ` (${label})` : ''}`);
  });

  const skills = splitByGap(sideSecs.skills || []);
  groupSkills(R, skills);

  R.data.langs = splitByGap(sideSecs.langs || []).map((t) => {
    const m = t.match(/^(.*?)\s*\((.*)\)\s*$/);
    return { name: (m ? m[1] : t).trim(), level: langLevel(m ? m[2] : '') };
  });
  R.data.certs = splitByGap(sideSecs.certs || []).map((name) => ({ name, issuer: '', issueDate: '', expiryDate: '', credentialId: '', links: [], noExpiry: false, _conf: 'check', _why: 'LinkedIn’s PDF has the name only — add the issuer and date.' }));
  R.data.ach = splitByGap(sideSecs.ach || []).map((title) => ({ title, type: 'Award / Recognition', date: '', issuer: '', description: '' }));
  if (sideSecs.pubs?.length) R.data.custom.push({ title: 'Publications', items: splitByGap(sideSecs.pubs).map((t) => ({ title: t, subtitle: '', date: '', description: '' })) });

  /* ---------- main column ---------- */
  const headIdx = main.findIndex((l) => l.size >= 15 && l.size < 20);
  const top = main.slice(0, headIdx < 0 ? main.length : headIdx);
  const nameLine = top.find((l) => l.size >= 20);
  if (nameLine) R.data.personal.name = nameLine.text;
  const afterName = top.filter((l) => l !== nameLine && l.y > (nameLine?.y || 0));
  if (afterName.length >= 2) {
    R.data.personal.location = afterName[afterName.length - 1].text;
    R.data.personal.headline = afterName.slice(0, -1).map((l) => l.text).join(' ').replace(/\s+/g, ' ');
  } else if (afterName.length === 1) R.data.personal.headline = afterName[0].text;
  noteLongHeadline(R);

  // split main into sections by the 15–16pt headings
  const secs = [];
  main.slice(headIdx < 0 ? main.length : headIdx).forEach((l) => {
    if (l.size >= 15 && l.size < 20) secs.push({ title: l.text, lines: [] });
    else secs[secs.length - 1]?.lines.push(l);
  });

  secs.forEach(({ title, lines }) => {
    const t = title.toLowerCase();
    if (t === 'summary') R.data.summary = paragraphs(lines, true).join(' ');
    else if (t === 'experience') R.data.exp = experience(lines, R);
    else if (t === 'education') R.data.edu = education(lines);
    else if (lines.length) R.data.custom.push({ title, items: [{ title: '', subtitle: '', date: '', description: paragraphs(lines).join('\n') }] });
  });
  return R;
}

/** Splits lines into paragraphs at big gaps. prose=true joins wrapped lines with spaces;
 * otherwise a line that starts lower-case continues the one before it (LinkedIn wraps at the column edge). */
function paragraphs(lines, prose = false) {
  const paras = [];
  let cur = [];
  lines.forEach((l, i) => {
    const prev = lines[i - 1];
    if (prev && l.page === prev.page && l.y - prev.y > l.size * 2.4) { paras.push(cur); cur = []; }
    if (cur.length && (prose || /^[a-z(&,]/.test(l.text))) cur[cur.length - 1] += ` ${l.text}`;
    else cur.push(l.text);
  });
  if (cur.length) paras.push(cur);
  return paras.map((p) => p.join('\n'));
}

function experience(lines, R) {
  const out = [];
  let company = '';
  let cur = null;
  let afterDate = false;
  const push = () => { if (cur) { cur.description = paragraphs(cur._desc).join('\n'); delete cur._desc; out.push(cur); } };
  lines.forEach((l) => {
    const isDateLine = l.size < 11.2 && /\d{4}\s*-\s*(?:\w+\s*\d{4}|Present)/i.test(l.text);
    if (l.size >= 11.8 && l.size < 15) { push(); cur = null; company = l.text; afterDate = false; return; }
    if (l.size >= 11.2 && l.size < 11.8) { push(); cur = { company, role: l.text, employmentType: '', from: '', to: '', current: false, description: '', _desc: [] }; afterDate = false; return; }
    if (isDateLine) {
      if (!cur) cur = { company, role: '', employmentType: '', from: '', to: '', current: false, description: '', _desc: [] };
      const d = findDates(l.text.replace(/\(.*\)/, ''));
      if (d) Object.assign(cur, { from: d.from, to: d.to, current: d.current });
      afterDate = true; cur._loc = true; return;
    }
    if (!cur) return; // tenure line under a company ("4 years 5 months")
    if (afterDate && cur._loc && /^[A-Z][\w .'-]+(,\s*[A-Z][\w .'-]+){1,3}$/.test(l.text) && l.text.length < 60) { cur._location = l.text; cur._loc = false; return; }
    cur._loc = false;
    cur._desc.push(l);
  });
  push();
  out.forEach((e) => {
    delete e._loc; delete e._location;
    if (!e.role) { e._conf = 'check'; e._why = 'Job title not found.'; }
    if (e.description.split('\n').length > 6) { e._conf = 'check'; e._why = 'Long description copied from LinkedIn — 3–5 short bullets with results read better.'; }
  });
  if (out.length) R.notes.push({ kind: 'info', sec: 'exp', msg: `${out.length} role${out.length > 1 ? 's' : ''} found. Roles at the same company were split into separate entries.` });
  return out;
}

function education(lines) {
  const out = [];
  let cur = null;
  lines.forEach((l) => {
    if (l.size >= 11.8) { if (cur) out.push(cur); cur = { institution: l.text.replace(/,\s*$/, ''), _deg: [] }; return; }
    if (cur && coursesLine(l.text)) { cur._courses = coursesLine(l.text); return; } // "Courses: …"
    cur?._deg.push(l.text);
  });
  if (cur) out.push(cur);
  return out.map((c) => {
    const txt = c._deg.join(' ');
    const d = findDates(txt);
    const rest = stripDate(txt, d).replace(/[·(]\s*$/, '').replace(/\s*·\s*$/, '').trim();
    const { degree, field } = splitDegree(rest);
    return { institution: c.institution, degree, field, from: d?.from || '', to: d?.to || '', current: !!d?.current, grade: '', ...(c._courses ? { courses: c._courses } : {}), _conf: d ? 'ok' : 'check', _why: d ? '' : 'Dates not found.' };
  });
}

