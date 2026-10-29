// "Relevant courses (optional)" in an Education entry: a short list of course names (chips in the editor), printed
// under the entry as "Courses: A, B, C". Stored as an array of strings on the entry (`courses`); a name may hold
// **bold** words. At most 12 courses of 60 characters; duplicates (ignoring case and bold) are left out.
import { stripBold } from './bold';

export const MAX_COURSES = 12;
export const MAX_COURSE_LEN = 60;
export const COURSES_PH = 'Data Structures, Operating Systems, DBMS, Computer Networks';
export const COURSES_HINT = 'Add 4-6 courses that match the jobs you want.';
export const COURSE_LABELS = ['Courses', 'Relevant coursework', 'Coursework'];

const key = (c) => stripBold(String(c || '')).trim().toLowerCase().replace(/\s+/g, ' ');

/** "A, B; C\nD" → ['A', 'B', 'C', 'D'] (trimmed, empty parts dropped). */
export const splitCourses = (text) => String(text || '').split(/[,;\n]+/).map((x) => x.replace(/\s+/g, ' ').trim()).filter(Boolean);

/** The list with `adds` appended: trimmed, cut to 60 characters, no duplicates, at most 12. */
export function addCourses(list, adds) {
  const out = [...(list || [])];
  const seen = new Set(out.map(key));
  for (const raw of adds) {
    const c = String(raw || '').replace(/\s+/g, ' ').trim().slice(0, MAX_COURSE_LEN).trim();
    if (!c || seen.has(key(c)) || out.length >= MAX_COURSES) continue;
    seen.add(key(c));
    out.push(c);
  }
  return out;
}
export const hasCourse = (list, c) => (list || []).some((x) => key(x) === key(c));

/** An entry's courses, tidy (also for data typed elsewhere: a string, extra spaces, duplicates). */
export const coursesOf = (e) => addCourses([], Array.isArray(e?.courses) ? e.courses : splitCourses(e?.courses));

// quick-add ideas by field of study; added only when tapped
const SUGGEST = [
  [/comput|\bcse\b|\bcs\b|software|information tech|\bit\b|\bmca\b|\bbca\b/i, ['Data Structures', 'DBMS', 'Operating Systems', 'Computer Networks', 'OOP', 'AI/ML']],
  [/electronics|\bece\b|communication|\beee\b|electrical/i, ['Digital Electronics', 'Signals and Systems', 'Microprocessors', 'Control Systems', 'VLSI Design', 'Embedded Systems']],
  [/mechanic|\bmech\b|automobile|production/i, ['Thermodynamics', 'Fluid Mechanics', 'Machine Design', 'Manufacturing Processes', 'CAD/CAM', 'Strength of Materials']],
  [/civil|construction|structural/i, ['Structural Analysis', 'Surveying', 'Concrete Technology', 'Geotechnical Engineering', 'AutoCAD', 'Estimation and Costing']],
  [/data|statistic|analytics|math/i, ['Statistics', 'Probability', 'Linear Algebra', 'Machine Learning', 'Data Visualization', 'SQL']],
  [/commerce|b\.?com|account|finance|\bca\b|\bcma\b/i, ['Financial Accounting', 'Cost Accounting', 'Income Tax', 'GST', 'Business Law', 'Auditing']],
  [/business|management|\bmba\b|\bbba\b|marketing/i, ['Marketing Management', 'Financial Management', 'Human Resource Management', 'Operations Management', 'Business Analytics', 'Organisational Behaviour']],
  [/nurs|pharm|medic|health|biotech|biology/i, ['Anatomy', 'Physiology', 'Pharmacology', 'Microbiology', 'Biochemistry', 'Community Health']],
  [/design|architect|fine art|media|journal/i, ['Design Fundamentals', 'Typography', 'User Research', 'Digital Media', 'Visual Communication', 'Portfolio Development']],
];
/** Course ideas for a field of study (and degree), without the ones already added. */
export function suggestCourses(entry) {
  const text = `${entry?.field || ''} ${entry?.degree || ''}`;
  const found = SUGGEST.find(([re]) => re.test(text));
  return found ? found[1].filter((c) => !hasCourse(entry?.courses, c)) : [];
}

/** "Relevant coursework: A, B" (or "Courses - A; B") at the start of a line → ['A', 'B'], else null. */
export function coursesLine(line) {
  const m = String(line || '').match(/^\s*[•\-*▸–]?\s*(?:relevant\s+)?(?:course\s*work|courses|coursework|key courses|subjects)\s*[:–-]\s*(.+)$/i);
  return m ? addCourses([], splitCourses(m[1])) : null;
}
