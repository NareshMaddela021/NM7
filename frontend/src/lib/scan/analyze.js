// The free ATS scan: a deterministic, rule-based check of the text read from the user's own resume.
// No AI and no randomness — the same file and role always give the same score.
//
// Score = sum of these parts (100 in total):
//   contact   10  email 4 · phone 4 · LinkedIn 2
//   sections  15  education 4 · skills 4 · experience or projects 5 · summary 2 (an objective counts 1)
//   layout    15  single column 8 · no tables 4 · no photo / personal details 3
//   impact    20  share of experience/project bullets with a number; 60% or more = full marks
//   language  10  −3 per bullet starting with a weak opener ("responsible for", "helped with", …)
//   keywords  20  role keywords found ÷ min(10, keywords checked)
//   length     5  250–900 words and ≤ 2 pages = 5 · 150–249 or 901–1200 words = 3 · otherwise 0
//   dates      5  consistent month format and no reversed ranges = 5 · mixed formats = 2 · no dates at all = 2

import { findKeywords, keywordsFor } from './keywords';

export const WEIGHTS = { contact: 10, sections: 15, layout: 15, impact: 20, language: 10, keywords: 20, length: 5, dates: 5 };
const SEV_ORDER = { 'Blocks ATS': 0, High: 1, Medium: 2, Low: 3 };

const HEADINGS = [
  ['summary', /^(professional |career |profile |executive )?(summary|profile|about me|about)$/],
  ['objective', /^(career |job |professional )?objective$/],
  ['experience', /^((work|professional|relevant|industry) )?(experience|employment( history)?|work history)$|^internships?( experience)?$|^experience & internships?$/],
  ['projects', /^((academic|personal|key|major|college|technical) )?projects?( & publications| and publications)?$/],
  ['education', /^(education(al)?( qualifications?| background| details)?|academic (details|qualifications?|background)|qualifications?)$/],
  ['skills', /^((technical|key|core|professional|it) )?skills?( (& tools|and tools|summary|set))?$|^technical proficiency$|^tools( (&|and) technologies)?$|^competencies$/],
  ['certifications', /^(certifications?|courses|certifications? (&|and) (courses|trainings?)|trainings?)$/],
  ['achievements', /^(achievements|awards|accomplishments|honou?rs( (&|and) awards)?|awards (&|and) achievements)$/],
  ['activities', /^(extra[-\s]?curricular( activities)?|positions? of responsibility|leadership|volunteer(ing| experience)?|activities)$/],
  ['personal', /^personal (details|information|profile|data)$/],
  ['languages', /^languages( known)?$/],
  ['hobbies', /^(hobbies|interests|hobbies (&|and) interests)$/],
  ['declaration', /^declaration$/],
];
const BULLET_SECTIONS = new Set(['experience', 'projects', 'achievements', 'activities']);

const MONTHS = 'jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?';
const RE = {
  email: /[\w.+-]+@[\w-]+(\.[\w-]+)+/,
  phoneCandidate: /\+?\d[\d\s().-]{8,}\d/g,
  linkedin: /linkedin\.com\/(in|pub)\//i,
  bulletChar: /^[•●▪■◦‣\-*➢➤✓✔►▶○◆◇–]\s*/,
  weak: /^(responsible for|helped( with| in| to)?|worked (on|with|in)|assisted( in| with)?|involved in|participated in|duties (included|include)|tasked with|was part of|part of a team)\b/i,
  monthYear: new RegExp(`\\b(${MONTHS})\\.?\\s*[,']?\\s*((?:19|20)\\d{2}|'?\\d{2})\\b`, 'gi'),
  numMonth: /\b(0?[1-9]|1[0-2])[/.-]((?:19|20)\d{2})\b/g,
  isoMonth: /\b((?:19|20)\d{2})-(0[1-9]|1[0-2])\b/g,
  year: /\b(19|20)\d{2}\b/g,
  range: new RegExp(`((?:(?:${MONTHS})\\.?\\s*)?((?:19|20)\\d{2}))\\s*(?:-|–|—|to|till|until)\\s*((?:(?:${MONTHS})\\.?\\s*)?((?:19|20)\\d{2})|present|current|now|ongoing|today)`, 'gi'),
  personal: /\b(date of birth|d\.?o\.?b\.?|marital status|religion|caste|father'?s name|mother'?s name|gender|nationality|age\s*:)/i,
  genericObjective: /\b(seeking|reputed|challenging|growth|organi[sz]ation|utili[sz]e|opportunity|esteemed|dynamic environment)\b/i,
};

const words = (s) => (s.match(/[A-Za-z0-9][\w+#.'/-]*/g) || []).length;
const clean = (s) => s.replace(/\s+/g, ' ').trim();
const strip = (s) => s.replace(RE.bulletChar, '').trim();

function headingOf(text) {
  const t = clean(text).replace(/[:|–—-]+$/, '').replace(/^[^a-z0-9]+/i, '').trim().toLowerCase();
  if (!t || t.length > 45 || t.split(' ').length > 6) return null;
  const hit = HEADINGS.find(([, re]) => re.test(t));
  return hit ? hit[0] : null;
}
/** "SKILLS | SQL | Python" or "Skills: SQL, Python" → the heading key, when content follows on the same line. */
function inlineHeadingOf(text) {
  const m = clean(text).match(/^([A-Za-z &]{3,40}?)\s*[:|]\s*(.{2,})$/);
  return m ? headingOf(m[1]) : null;
}

function phoneOf(text) {
  for (const m of text.matchAll(RE.phoneCandidate)) {
    const digits = m[0].replace(/\D/g, '');
    if (digits.length >= 10 && digits.length <= 13 && !/^(19|20)\d{2}(19|20)\d{2}$/.test(digits)) return m[0];
  }
  return null;
}

/** Removes dates and years so "Jan 2024 – Mar 2024" doesn't count as a result. */
function withoutDates(s) {
  return s.replace(RE.range, ' ').replace(RE.monthYear, ' ').replace(RE.numMonth, ' ').replace(RE.isoMonth, ' ').replace(RE.year, ' ')
    .replace(/\b(cgpa|gpa|sgpa|percentage)\b.*$/i, ' ');
}
const hasNumber = (s) => /\d|%|₹|\b(one|two|three|four|five|six|seven|eight|nine|ten|twice|double[ds]?|tripled|hundreds?|thousands?|lakhs?|crores?|million)\b/i.test(withoutDates(s));

function dateStyles(text) {
  const styles = new Set();
  for (const m of text.matchAll(RE.monthYear)) styles.add(m[1].length > 4 && !/^sept$/i.test(m[1]) ? 'month-full' : 'month-short');
  if (text.match(RE.numMonth)) styles.add('month-number');
  if (text.match(RE.isoMonth)) styles.add('month-iso');
  return styles;
}
function reversedRange(text) {
  for (const m of text.matchAll(RE.range)) {
    const end = m[4];
    if (end && +end < +m[2]) return true;
  }
  return false;
}

/** A rule-based rewrite template built from the user's own line — not AI; placeholders in [brackets]. */
const STRONG = [
  [/^responsible for\s+/i, 'Managed '], [/^helped( with| in| to)?\s+/i, 'Supported '], [/^worked (on|with|in)\s+/i, 'Built '],
  [/^assisted( in| with)?\s+/i, 'Supported '], [/^involved in\s+/i, 'Contributed to '], [/^participated in\s+/i, 'Took part in '],
  [/^duties (included|include)\s+/i, 'Handled '], [/^tasked with\s+/i, 'Delivered '], [/^(was )?part of( a team)?\s+/i, 'Worked with a team to '],
];
function rewriteBullet(line, { weak, number }) {
  let s = strip(line).replace(/[.;]+$/, '');
  if (weak) {
    const rule = STRONG.find(([re]) => re.test(s));
    if (rule) s = s.replace(rule[0], rule[1]);
    s = s[0].toUpperCase() + s.slice(1);
  }
  if (number) s += ', [result with a number — e.g. cut time from X to Y hours, N users, N% more]';
  return `${s}.`;
}

/**
 * @param {object} input
 * @param {{text:string, page?:number, table?:boolean}[]} input.lines  lines in reading order
 * @param {string} input.role
 * @param {{multiColumn?:boolean, tables?:number, images?:number}} [input.layout]
 * @param {number} [input.pages]
 * @param {string[]} [input.links] link URLs found in the file
 */
export function analyzeResume({ lines: rawLines, role = '', layout = {}, pages = 1, links = [] }) {
  const roleText = clean(role).slice(0, 60);
  const lines = rawLines.map((l, i) => ({ ...l, id: `l${i}`, text: clean(l.text || '') })).filter((l) => l.text);
  const all = lines.map((l) => l.text).join('\n');
  const linkText = links.join('\n');

  // ---------- sections ----------
  const sections = [];
  let cur = { key: 'top', title: '', lines: [], headingId: null };
  sections.push(cur);
  lines.forEach((l) => {
    const h = headingOf(l.text);
    if (h) { cur = { key: h, title: clean(l.text).replace(/[:|]+$/, ''), lines: [], headingId: l.id }; sections.push(cur); return; }
    const inline = inlineHeadingOf(l.text);
    if (inline) { cur = { key: inline, title: clean(l.text).split(/[:|]/)[0].trim(), lines: [], headingId: l.id }; sections.push(cur); }
    cur.lines.push(l);
  });
  const top = sections[0];
  const nameLine = top.lines.find((l) => !RE.email.test(l.text) && !phoneOf(l.text) && words(l.text) <= 5 && !/\d{3}/.test(l.text));
  const has = (k) => sections.some((s) => s.key === k && (s.lines.length || s.headingId));
  const firstOf = (k) => sections.find((s) => s.key === k);
  const anchor = nameLine?.id || lines[0]?.id;
  const lineOfSection = (k) => { const s = firstOf(k); return s?.lines[0]?.id || s?.headingId || anchor; };

  const issues = [];
  const add = (issue) => { if (issue.pts > 0 || issue.sev === 'Blocks ATS') issues.push(issue); };
  const checks = [];

  // ---------- contact (10) ----------
  const email = RE.email.test(all);
  const phone = !!phoneOf(all);
  const linkedin = RE.linkedin.test(all) || RE.linkedin.test(linkText);
  const contact = (email ? 4 : 0) + (phone ? 4 : 0) + (linkedin ? 2 : 0);
  checks.push({ key: 'contact', label: 'Contact details', score: contact, max: WEIGHTS.contact });
  const missingContact = [!email && 'email', !phone && 'phone number', !linkedin && 'LinkedIn link'].filter(Boolean);
  if (missingContact.length) {
    add({ kind: 'contact', sev: !email || !phone ? 'High' : 'Low', line: (top.lines.find((l) => l !== nameLine) || nameLine || lines[0])?.id, pts: WEIGHTS.contact - contact,
      title: `Add your ${missingContact.join(' and ')}`,
      why: `Recruiters need a way to reach you${!linkedin ? ', and many check LinkedIn before calling' : ''}. We couldn’t find your ${missingContact.join(' or ')}.`,
      suggest: `${nameLine?.text || 'Your Name'} · City · your.name@email.com · +91 98765 43210 · linkedin.com/in/your-name` });
  }

  // ---------- sections (15) ----------
  const hasExp = has('experience') || has('projects');
  const summaryPts = has('summary') ? 2 : has('objective') ? 1 : 0;
  const secScore = (has('education') ? 4 : 0) + (has('skills') ? 4 : 0) + (hasExp ? 5 : 0) + summaryPts;
  checks.push({ key: 'sections', label: 'Standard sections', score: secScore, max: WEIGHTS.sections });
  if (!has('education')) add({ kind: 'section', sev: 'High', line: anchor, pts: 4, title: 'No Education section found', why: 'Tracking systems look for a section called “Education”. Use that exact heading so your degree is picked up.', suggest: 'Education\nB.Tech, [Branch] · [College] · [Year] · [CGPA or %]', builder: true });
  if (!has('skills')) add({ kind: 'section', sev: 'High', line: anchor, pts: 4, title: 'No Skills section found', why: 'Recruiters filter by skills. A plain “Skills” heading with a comma-separated list is read best.', suggest: 'Skills: [tool], [tool], [tool], [method]', builder: true });
  if (!hasExp) add({ kind: 'section', sev: 'High', line: anchor, pts: 5, title: 'No Experience or Projects section', why: 'Without internships or projects there is nothing to show what you can do. Freshers: add 2–3 projects with results.', suggest: 'Projects\n[Project name] · [Tools] · [Year]\n• Built [what] using [tools], [result with a number].', builder: true });
  const objSec = firstOf('objective');
  if (!has('summary') && objSec) {
    const objLine = objSec.lines[0];
    const generic = objLine && RE.genericObjective.test(objLine.text);
    add({ kind: 'objective', sev: generic ? 'Medium' : 'Low', line: objLine?.id || objSec.headingId, pts: 1,
      title: generic ? 'Generic objective wastes the top of the page' : 'Use a summary instead of an objective',
      why: 'An objective says what you want; a summary says what you offer. Recruiters read the top lines first — use them for your role, skills and one proof point.',
      suggest: null /* filled in after keywords */ });
  } else if (!has('summary') && !objSec) {
    add({ kind: 'objective', sev: 'Low', line: anchor, pts: 2, title: 'No summary at the top', why: 'Two lines under your name saying who you are and what you bring help a recruiter decide to keep reading.', suggest: null });
  }

  // ---------- layout (15) ----------
  const tables = (layout.tables || 0) > 0 || lines.some((l) => l.table);
  const photo = (layout.images || 0) > 0;
  const personalLines = lines.filter((l) => RE.personal.test(l.text));
  const hygiene = 3 - Math.min(3, (photo ? 2 : 0) + Math.min(2, personalLines.length));
  const layoutScore = (layout.multiColumn ? 0 : 8) + (tables ? 0 : 4) + hygiene;
  checks.push({ key: 'layout', label: 'ATS-friendly layout', score: layoutScore, max: WEIGHTS.layout });
  if (layout.multiColumn) {
    add({ kind: 'layout', sev: 'Blocks ATS', line: lines.find((l) => l.columnStart)?.id || firstOf('skills')?.headingId || anchor, pts: 8,
      title: 'Two-column layout', why: 'Many tracking systems read straight across both columns, mixing your skills into your experience. A single column is read correctly everywhere.',
      suggest: null, builder: true });
  }
  if (tables) {
    add({ kind: 'layout', sev: 'Blocks ATS', line: lines.find((l) => l.table)?.id || lineOfSection('skills'), pts: 4,
      title: 'Content inside a table', why: 'Text in tables is often read as one jumbled line, so those skills or dates may never be indexed. Use plain lines instead.',
      suggest: firstOf('skills') ? `Skills: ${strip(firstOf('skills').lines[0]?.text || '').replace(/^skills?\s*[:|]\s*/i, '').split(/\s*[|,·;\t]\s*|\s{2,}/).filter(Boolean).join(', ')}` : null });
  }
  if (photo || personalLines.length) {
    const what = [photo && 'a photo', personalLines.length && 'personal details (date of birth, marital status, father’s name…)'].filter(Boolean).join(' and ');
    add({ kind: 'personal', sev: 'Low', line: personalLines[0]?.id || anchor, pts: 3 - hygiene,
      title: photo ? 'Remove the photo and personal details' : 'Remove personal details',
      why: `Your resume has ${what}. Most private-sector employers don’t need these, they take space, and photos often confuse tracking systems. Keep them only if the job post asks.`, suggest: null });
  }

  // ---------- impact (20) + language (10) ----------
  const bulletLines = sections.filter((s) => BULLET_SECTIONS.has(s.key)).flatMap((s) => s.lines)
    .filter((l) => {
      const t = l.text;
      if (RE.bulletChar.test(t)) return strip(t).length > 3;
      const dateHeavy = withoutDates(t).trim().length < t.length * 0.75;
      return words(t) >= 6 && !(dateHeavy && words(t) <= 12);
    });
  const numbered = bulletLines.filter((l) => hasNumber(l.text));
  const ratio = bulletLines.length ? numbered.length / bulletLines.length : 0;
  const impact = bulletLines.length ? Math.round(WEIGHTS.impact * Math.min(1, ratio / 0.6)) : 0;
  checks.push({ key: 'impact', label: 'Results with numbers', score: impact, max: WEIGHTS.impact, detail: `${numbered.length} of ${bulletLines.length} bullets have a number` });

  const weakLines = bulletLines.filter((l) => RE.weak.test(strip(l.text)));
  const language = Math.max(0, WEIGHTS.language - 3 * weakLines.length);
  checks.push({ key: 'language', label: 'Strong action verbs', score: language, max: WEIGHTS.language, detail: weakLines.length ? `${weakLines.length} weak opener${weakLines.length > 1 ? 's' : ''}` : 'no weak openers' });

  if (!bulletLines.length) {
    add({ kind: 'impact', sev: 'High', line: lineOfSection(has('experience') ? 'experience' : 'projects'), pts: WEIGHTS.impact,
      title: 'No bullet points describing your work', why: 'Under each internship or project, add 2–4 bullets: what you did and what changed because of it.',
      suggest: '• Built [what] using [tools], [result — e.g. saved N hours a week].', builder: true });
  } else {
    let impactLeft = WEIGHTS.impact - impact;
    let langLeft = WEIGHTS.language - language;
    const perBullet = Math.ceil(WEIGHTS.impact / (0.6 * bulletLines.length));
    bulletLines.forEach((l) => {
      const weak = RE.weak.test(strip(l.text));
      const noNumber = !hasNumber(l.text);
      if (!weak && !noNumber) return;
      const p1 = noNumber ? Math.min(impactLeft, perBullet) : 0;
      const p2 = weak ? Math.min(langLeft, 3) : 0;
      impactLeft -= p1; langLeft -= p2;
      add({ kind: 'bullet', sev: weak ? 'High' : 'Medium', line: l.id, pts: p1 + p2,
        title: weak && noNumber ? 'Weak opener and no result' : weak ? 'Starts with a weak opener' : 'This bullet shows no result',
        why: weak
          ? `“${strip(l.text).match(RE.weak)[0]}” describes a duty, not an achievement. Start with what you did (built, analysed, cut, led)${noNumber ? ' and add a number' : ''}.`
          : 'Recruiters scan for numbers: how many, how much, how fast. Add one if you have it.',
        suggest: rewriteBullet(l.text, { weak, number: noNumber }) });
    });
  }

  // ---------- keywords (20) ----------
  const { keywords, lists } = keywordsFor(roleText);
  const kw = findKeywords(all, keywords);
  const target = Math.min(10, keywords.length);
  const kwScore = Math.round(WEIGHTS.keywords * Math.min(1, kw.found.length / target));
  checks.push({ key: 'keywords', label: `Keywords for ${roleText || 'the role'}`, score: kwScore, max: WEIGHTS.keywords, detail: `${kw.found.length} of ${keywords.length} found` });
  if (kwScore < WEIGHTS.keywords) {
    const skillsSec = firstOf('skills');
    const current = skillsSec ? strip(skillsSec.lines[0]?.text || '').replace(/^skills?\s*[:|]\s*/i, '') : '';
    add({ kind: 'keywords', sev: kwScore < 12 ? 'High' : 'Medium', line: lineOfSection('skills'), pts: WEIGHTS.keywords - kwScore,
      title: `Missing keywords for ${roleText || 'your role'}`,
      why: `Job posts for ${roleText || 'this kind of role'} often mention: ${kw.missing.slice(0, 6).join(', ')}. Add the ones you really have — in Skills and in your project bullets.`,
      suggest: `Skills: ${[current, ...kw.missing.slice(0, 3).map((k) => `[${k} — only if you have it]`)].filter(Boolean).join(', ')}` });
  }
  const obj = issues.find((i) => i.kind === 'objective');
  if (obj) obj.suggest = `${roleText || '[Role]'} skilled in ${kw.found.slice(0, 3).join(', ') || '[your top 3 skills]'} — [one proof point: an internship, project or result with a number].`;

  // ---------- length (5) ----------
  const wordCount = words(all);
  const lengthScore = pages > 2 ? 0 : wordCount >= 250 && wordCount <= 900 ? 5 : (wordCount >= 150 && wordCount < 250) || (wordCount > 900 && wordCount <= 1200) ? 3 : 0;
  checks.push({ key: 'length', label: 'Length', score: lengthScore, max: WEIGHTS.length, detail: `${wordCount} words · ${pages} page${pages > 1 ? 's' : ''}` });
  if (lengthScore < WEIGHTS.length) {
    const short = wordCount < 250;
    add({ kind: 'length', sev: 'Medium', line: anchor, pts: WEIGHTS.length - lengthScore,
      title: pages > 2 ? 'Longer than two pages' : short ? 'Too short' : 'Too long',
      why: short ? `About ${wordCount} words. Most fresher resumes that get shortlisted have 300–600: add projects, results and skills.` : `About ${wordCount} words${pages > 2 ? ` on ${pages} pages` : ''}. Keep it to one page for freshers, two at most: cut older or weaker points.`, suggest: null });
  }

  // ---------- dates (5) ----------
  const styles = dateStyles(all);
  const anyDate = styles.size > 0 || RE.year.test(all);
  RE.year.lastIndex = 0;
  const reversed = reversedRange(all);
  const datesScore = !anyDate ? 2 : reversed ? 0 : styles.size > 1 ? 2 : 5;
  checks.push({ key: 'dates', label: 'Dates', score: datesScore, max: WEIGHTS.dates });
  if (datesScore < WEIGHTS.dates) {
    const styleLine = (st) => lines.find((l) => dateStyles(l.text).has(st));
    const minority = [...styles].map((st) => [st, lines.filter((l) => dateStyles(l.text).has(st)).length]).sort((a, b) => a[1] - b[1])[0];
    add({ kind: 'dates', sev: 'Low', pts: WEIGHTS.dates - datesScore,
      line: reversed ? lines.find((l) => reversedRange(l.text))?.id : !anyDate ? lineOfSection('experience') : styleLine(minority[0])?.id,
      title: !anyDate ? 'No dates on your experience or education' : reversed ? 'A date range runs backwards' : 'Mixed date formats',
      why: !anyDate ? 'Add month and year to internships and the year to your degree so recruiters can see the timeline.' : reversed ? 'An end date is before its start date — check it.' : 'Use one format everywhere, e.g. “Jan 2024 – Jun 2024”. Mixed formats can confuse tracking systems.',
      suggest: null });
  }

  // ---------- result ----------
  const score = checks.reduce((s, c) => s + c.score, 0);
  issues.sort((a, b) => SEV_ORDER[a.sev] - SEV_ORDER[b.sev] || b.pts - a.pts || +a.line?.slice(1) - +b.line?.slice(1));
  issues.forEach((iss, i) => { iss.n = i + 1; iss.id = `${iss.kind}-${i + 1}`; });

  const skimIds = new Set([...top.lines.map((l) => l.id), ...sections.map((s) => s.lines[0]?.id).filter(Boolean),
    ...lines.filter((l) => styles.size && dateStyles(l.text).size).map((l) => l.id)]);
  const view = sections.filter((s) => s.lines.length || s.headingId).map((s, i) => ({
    id: `s${i}`,
    title: s.key === 'top' ? (nameLine?.text || '') : s.title,
    titleId: s.key === 'top' ? nameLine?.id || null : s.headingId, // issues can point at the name or a heading
    isName: s.key === 'top',
    lines: s.lines.filter((l) => !(s.key === 'top' && l === nameLine)).map((l) => ({ id: l.id, text: l.text, skim: skimIds.has(l.id) })),
  })).filter((s) => s.title || s.lines.length);

  return {
    role: roleText,
    score,
    targetScore: Math.min(100, score + issues.reduce((s, i) => s + i.pts, 0)),
    checks,
    issues,
    sections: view,
    keywords: { ...kw, lists },
    stats: { words: wordCount, pages, bullets: bulletLines.length, numbered: numbered.length },
  };
}
