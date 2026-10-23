// The free LinkedIn check: a score out of 100 from fixed rules (no AI), a fix list per section (what is wrong, why
// it matters, the fix) and the keyword match for the target role. A section with full points says "Keep as it is".
// Photo, banner, Featured and Open to Work can't be read from the PDF, so the person ticks them.
import { LIMITS, isCustomUrl, profileText } from './profile';
import { keywordLine, keywordMatch, roleInfo } from './keywords';
import { hasPrivate } from './privacy';

export const KEEP = 'Keep as it is';
export const CHECKLIST = [
  { id: 'photo', label: 'I have a clear profile photo (face, plain background)' },
  { id: 'banner', label: 'I have a banner image (not the plain blue default)' },
  { id: 'featured', label: 'I have something in Featured (a project, certificate or post)' },
  { id: 'openToWork', label: 'Open to Work is on, with my target roles' },
];

const EMOJI = /\p{Extended_Pictographic}/u;
const GENERIC = /^(student|fresher|graduate|job seeker|looking for (a )?(job|opportunit\w*)|seeking opportunit\w*|open to work|unemployed|engineer)\b.{0,40}$/i;
const CTA = /open to|looking for|reach (out|me)|connect with me|let'?s connect|available for|seeking|happy to (talk|connect)/i;
const PROOF = /\d|project|built|certif|award|intern|won|led|launched|improved|reduced|increased/i;
const has = (text, w) => new RegExp(`(?<![\\p{L}\\p{N}])${w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\p{L}\\p{N}])`, 'iu').test(text);
const issue = (what, why, fix) => ({ what, why, fix });

function headline(s, ctx) {
  const h = s.headline || '';
  const out = { id: 'headline', title: 'Headline', max: 20, points: 0, issues: [] };
  if (!h) { out.issues.push(issue('There is no headline.', 'It shows under your name everywhere: search results, comments and invites.', 'Write your target role, 2-4 key skills and one proof point, like the example below.')); return out; }
  const words = ctx.words;
  const roleOk = !ctx.role || has(h, ctx.role) || (ctx.info && ctx.info.match.test(h));
  if (roleOk) out.points += 6; else out.issues.push(issue(`Your headline doesn't say "${ctx.role}".`, 'Recruiters search by job title; the headline is the strongest place for it.', `Start with "${ctx.role}".`));
  if (h.length > LIMITS.headline) out.issues.push(issue(`It is ${h.length} characters; LinkedIn allows ${LIMITS.headline}.`, 'LinkedIn cuts it off.', 'Keep the role, 2-4 skills and one proof point.'));
  else if (h.length < 40) out.issues.push(issue('It is very short.', 'A short headline wastes the most-seen line of your profile.', 'Add 2-4 key skills and one proof point (a degree, project or certificate).'));
  else out.points += 4;
  const kw = words.filter((w) => has(h, w)).length;
  if (kw >= 2 || (!ctx.info && (h.match(/[|·,]/g) || []).length >= 2)) out.points += 5;
  else out.issues.push(issue('It has fewer than 2 key skills.', 'Skills in the headline help you show up in searches.', `Add skills you really have, such as ${words.slice(0, 3).join(', ') || 'your main tools'}.`));
  if (!GENERIC.test(h)) out.points += 3;
  else out.issues.push(issue('It only says you are a student or looking for work.', 'It tells a recruiter nothing about what you can do.', 'Say the role you want and what you can already do.'));
  if (hasPrivate(h) || EMOJI.test(h)) out.issues.push(issue(hasPrivate(h) ? 'It has a phone number, email or ID number.' : 'It has emoji.', hasPrivate(h) ? 'Anyone can see your headline. Keep contact details in Contact info.' : 'Emoji look unprofessional to many recruiters.', hasPrivate(h) ? 'Remove them from the headline.' : 'Use " | " or " · " between parts instead.'));
  else out.points += 2;
  return out;
}

function about(s, ctx) {
  const a = s.about || '';
  const out = { id: 'about', title: 'About', max: 20, points: 0, issues: [] };
  if (!a) { out.issues.push(issue('There is no About section.', 'Profiles with an About get found and messaged more.', 'Write 3 short paragraphs: who you are and the role you want, what you can do (with your skills), and what you are looking for.')); return out; }
  if (a.length > LIMITS.about) out.issues.push(issue(`It is ${a.length.toLocaleString('en-IN')} characters; LinkedIn allows ${LIMITS.about.toLocaleString('en-IN')}.`, 'LinkedIn won\'t save it.', 'Cut repeated lines and long lists; keep it under 2,600.'));
  else if (a.length >= 600) out.points += 6;
  else { out.points += a.length >= 300 ? 3 : 0; out.issues.push(issue('It is short.', 'Only the first 2-3 lines show before "see more"; the rest is where you prove it.', 'Aim for 1,000-2,000 characters: your role, your skills with examples, and what you want next.')); }
  const open = a.slice(0, 220);
  if (!ctx.role || has(open, ctx.role) || (ctx.info && ctx.info.match.test(open)) || ctx.words.some((w) => has(open, w))) out.points += 4;
  else out.issues.push(issue('The first lines don\'t say what you do.', 'Only the opening shows before "see more".', `Open with the role you want ("${ctx.role}") and your strongest skill.`));
  const kw = ctx.info ? ctx.words.filter((w) => has(a, w)).length : 3;
  if (kw >= 3) out.points += 4;
  else out.issues.push(issue('It names few of the skills for your role.', 'LinkedIn search reads your About too.', `Mention the skills you really use, such as ${ctx.words.slice(0, 4).join(', ')}.`));
  if (PROOF.test(a)) out.points += 3;
  else out.issues.push(issue('It has no proof: no project, result or certificate.', 'Examples make your skills believable.', 'Add one real project, internship or certificate and what came of it.'));
  if (CTA.test(a.slice(-300))) out.points += 2;
  else out.issues.push(issue('It doesn\'t end with what you want next.', 'Recruiters need to know you are open to roles.', 'End with one line like "Open to Data Analyst roles in Hyderabad or remote."'));
  if (hasPrivate(a)) out.issues.push(issue('It has a phone number, email or ID number.', 'About is public. Keep contact details in Contact info, and never share ID numbers.', 'Remove them from About.'));
  else out.points += 1;
  return out;
}

function experience(s) {
  const ex = s.experience || [];
  const out = { id: 'experience', title: 'Experience', max: 15, points: 0, issues: [] };
  if (!ex.length) { out.issues.push(issue('There is no experience.', 'Even freshers can show internships, projects, part-time work or volunteering.', 'Add an internship, a college project or part-time work as an entry.')); return out; }
  out.points += 5;
  const empty = ex.filter((e) => !e.text);
  if (!empty.length) out.points += 4;
  else out.issues.push(issue(`${empty.length === ex.length ? 'No entry has' : `${empty.length} of ${ex.length} entries have`} a description.`, 'A title alone doesn\'t say what you did.', 'Add 2-4 lines: what you did, the tools you used and the result.'));
  const long = ex.filter((e) => (e.text || '').length > LIMITS.experience);
  if (!long.length) out.points += 2;
  else out.issues.push(issue(`${long.map((e) => e.title || e.company).join(', ')}: over ${LIMITS.experience.toLocaleString('en-IN')} characters.`, 'LinkedIn won\'t save more than 2,000 per entry.', 'Keep the 3-5 strongest points.'));
  if (ex.some((e) => /\d/.test(e.text || ''))) out.points += 4;
  else out.issues.push(issue('No entry shows a result.', 'Results (time saved, reports made, users helped) stand out.', 'Add a real result where you have one. Never make one up.'));
  return out;
}

function skills(s, ctx) {
  const sk = s.skills || [];
  const out = { id: 'skills', title: 'Skills', max: 15, points: 0, issues: [] };
  if (!sk.length) { out.issues.push(issue('There are no skills.', 'Skills are one of the main filters recruiters search with.', 'Add 10 or more skills you really have, starting with the ones for your target role.')); return out; }
  if (sk.length >= 10) out.points += 6;
  else { out.points += sk.length >= 5 ? 3 : 1; out.issues.push(issue(`Only ${sk.length} skill${sk.length === 1 ? '' : 's'}.`, 'More matching skills means more searches you appear in.', 'List 10 or more (LinkedIn allows up to 100).')); }
  if (!ctx.info) out.points += 9;
  else {
    const n = ctx.words.filter((w) => sk.some((x) => x.toLowerCase() === w.toLowerCase()) || has(sk.join(', '), w)).length;
    out.points += n >= 5 ? 6 : n >= 3 ? 4 : n >= 1 ? 2 : 0;
    if (n < 5) out.issues.push(issue(`Few skills match ${ctx.info.role}.`, 'Recruiters filter by these words.', `Add the ones you really have: ${ctx.missing.slice(0, 5).join(', ')}.`));
    if (sk.slice(0, 3).some((x) => ctx.words.some((w) => w.toLowerCase() === x.toLowerCase()))) out.points += 3;
    else out.issues.push(issue('Your top 3 skills aren\'t about your target role.', 'The top 3 show on your profile and in search.', `Put your strongest ${ctx.info.role} skills first.`));
  }
  return out;
}

function education(s) {
  const ed = s.education || [];
  const out = { id: 'education', title: 'Education', max: 10, points: 0, issues: [] };
  if (!ed.length) { out.issues.push(issue('There is no education.', 'Recruiters filter freshers by degree and college.', 'Add your highest degree or course and the college.')); return out; }
  out.points += 6;
  if (ed.some((e) => e.degree)) out.points += 4;
  else out.issues.push(issue('The degree name is missing.', 'Recruiters search by degree ("B.Tech", "B.Com").', 'Add the degree and the field of study.'));
  return out;
}

function tick(id, title, max, done, what, why, fix) {
  return { id, title, max, points: done ? max : 0, issues: done ? [] : [issue(what, why, fix)], checklist: true };
}

function photo(c) {
  const out = { id: 'photo', title: 'Photo and banner', max: 5, points: (c.photo ? 3 : 0) + (c.banner ? 2 : 0), issues: [], checklist: true };
  if (!c.photo) out.issues.push(issue('No profile photo ticked.', 'Profiles with a photo get many more views.', 'Add a clear, recent photo: your face, plain background, good light.'));
  if (!c.banner) out.issues.push(issue('No banner ticked.', 'The default blue banner is a missed chance to show your field.', 'Add a simple banner with your role or field (Canva has free ones).'));
  return out;
}

function customUrl(url) {
  const custom = isCustomUrl(url);
  if (custom === true) return { id: 'url', title: 'Custom URL', max: 5, points: 5, issues: [] };
  return {
    id: 'url', title: 'Custom URL', max: 5, points: 0,
    issues: [custom === false
      ? issue('Your link ends in a random code.', 'A clean link looks better on your resume and is easier to share.', 'Profile > Edit public profile & URL > set it to your name, like linkedin.com/in/ravi-kumar.')
      : issue('No profile link added.', 'We check whether your link is a clean, custom one.', 'Paste your link above (linkedin.com/in/...).')],
  };
}

/**
 * sections (see profile.js); opts: { role, url, checklist: { photo, banner, featured, openToWork } }.
 * → { score, role, keywords, keywordLine, items: [{ id, title, max, points, good, keep, issues }], top: [3 issues] }
 */
export function checkProfile(sections, { role = '', url = '', checklist = {} } = {}) {
  const s = sections || {};
  const text = profileText(s);
  const info = roleInfo(role);
  const km = keywordMatch(role, text);
  const ctx = { role: info?.role || role, info, words: info?.words || [], missing: km.missing };
  const items = [
    headline(s, ctx), about(s, ctx), experience(s), skills(s, ctx), education(s),
    tick('featured', 'Featured', 5, checklist.featured, 'Nothing in Featured ticked.', 'Featured shows your best work at the top of your profile.', 'Add a project link, a certificate or a post you wrote.'),
    photo(checklist), customUrl(url),
    tick('openToWork', 'Open to Work', 5, checklist.openToWork, 'Open to Work isn\'t ticked.', 'Recruiters filter for people who are open to work.', 'Profile > Open to > Finding a new job. Add your target roles and cities; choose "Recruiters only" if you prefer.'),
  ].map((it) => ({ ...it, good: it.points >= it.max && !it.issues.length, keep: it.points >= it.max && !it.issues.length ? KEEP : '' }));
  const score = Math.max(0, Math.min(100, items.reduce((n, it) => n + it.points, 0)));
  const top = [...items].filter((it) => it.issues.length).sort((a, b) => (b.max - b.points) - (a.max - a.points)).slice(0, 3).map((it) => ({ id: it.id, title: it.title, ...it.issues[0] }));
  return { score, role: ctx.role, keywords: km, keywordLine: keywordLine(km), items, top };
}

/** Text for a score band. */
export const scoreLabel = (n) => (n >= 85 ? 'Strong' : n >= 65 ? 'Good, a few fixes' : n >= 40 ? 'Needs work' : 'Just getting started');
