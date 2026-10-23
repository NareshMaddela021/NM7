// Resume design settings — one object drives both the live preview and the PDF.
// All sizes are in PDF points (1pt = 1/72 inch).

export const FONTS = {
  'source-sans-3': { label: 'Source Sans', kind: 'Sans', css: "'Source Sans 3', 'Segoe UI', sans-serif" },
  lato: { label: 'Lato', kind: 'Sans', css: "'Lato', 'Segoe UI', sans-serif" },
  'open-sans': { label: 'Open Sans', kind: 'Sans', css: "'Open Sans', 'Segoe UI', sans-serif" },
  roboto: { label: 'Roboto', kind: 'Sans', css: "'Roboto', 'Segoe UI', sans-serif" },
  'ibm-plex-sans': { label: 'IBM Plex Sans', kind: 'Sans', css: "'IBM Plex Sans', 'Segoe UI', sans-serif" },
  'source-serif-4': { label: 'Source Serif', kind: 'Serif', css: "'Source Serif 4', Georgia, serif" },
  lora: { label: 'Lora', kind: 'Serif', css: "'Lora', Georgia, serif" },
  merriweather: { label: 'Merriweather', kind: 'Serif', css: "'Merriweather', Georgia, serif" },
  // LaTeX's Computer Modern (OFL, served from our own origin); Telugu, Hindi and ₹ fall back to the Noto Serif fonts
  'cmu-serif': { label: 'CMU Serif (LaTeX)', kind: 'Serif', css: "'CMU Serif', 'Noto Serif Telugu', 'Noto Serif Devanagari', 'Latin Modern Roman', Georgia, serif" },
};

export const ACCENTS = ['#111827', '#1F3A8A', '#2E46D8', '#0F766E', '#0E7A52', '#7C2D12', '#9F1239', '#6D28D9', '#9A4508', '#334155'];
export const TEXT_COLORS = [['#111111', 'Black'], ['#2D3139', 'Dark grey'], ['#4A4F59', 'Soft grey']];
export const MARGINS = { narrow: 36, normal: 50, wide: 64 };
export const PAGE = { a4: { w: 595.28, h: 841.89, label: 'A4' }, letter: { w: 612, h: 792, label: 'US Letter' } };
export const HEADING_STYLES = [['underline', 'Underline'], ['rule', 'Line after'], ['bar', 'Filled bar'], ['caps', 'Small caps'], ['left', 'Left line']];
export const BULLETS = [['•', '• Dot'], ['–', '– Dash'], ['▸', '▸ Arrow'], ['none', 'None']];

export const DEFAULT_DESIGN = {
  font: 'source-sans-3',
  headFont: 'same',
  nameSize: 22,
  headSize: 10.5,
  bodySize: 10,
  lineHeight: 1.35,
  sectionGap: 12,
  itemGap: 6,
  bodyWeight: 400,
  headWeight: 700,
  accent: '#111827',
  accentOn: { name: false, headings: true, lines: true, links: false },
  textColor: '#111111',
  pageSize: 'a4',
  margin: 'normal',
  marginPt: 50,
  layout: 'one',
  headerAlign: 'center',
  contactLines: 'one',
  headingStyle: 'underline',
  bullet: '•',
  dateFormat: 'mon',
  datePos: 'right',
  icons: true,
  skillsStyle: 'lines',
  headerStyle: 'line', // 'line' = rule under the header, 'band' = light colour band, 'none'
  sideTint: false, // two columns: pale background behind the side column
  boldNumbers: false, // bold numbers in bullets (20%, ₹2L, 3x)
  logoColor: 'brand', // 'brand' = LinkedIn blue, GitHub black…; 'mono' = all icons in one colour
  photoShape: 'circle', // circle | rounded | square
  photoSize: 62, // pt
  photoPos: 'left', // left | right | top
  photoBorder: 'none', // none | thin | thick
  photoBorderColor: 'accent', // accent | grey
  printLinks: false, // also print the web address under entries that have a clickable word (paper copies)
  // Academic template (LaTeX look): 'academic' = each entry on two lines (bold name · place, italic role · dates)
  // with the bullets indented under it; the contact line phone | email | links | city
  entryStyle: 'standard',
  contactSep: '·',
  contactOrder: 'standard',
};

// Template tags drive the filters on the template screen.
// level: who it suits · ind: industries · photo: starts with the photo on · sections: a section layout in schema.js
export const INDUSTRY_TAGS = [['tech', 'IT / Tech'], ['govt', 'Banking / Govt / PSU'], ['sales', 'Sales & Ops'], ['mgmt', 'Management'], ['creative', 'Creative & Media'], ['care', 'Healthcare & Teaching']];
const D = DEFAULT_DESIGN;
const on = (o) => ({ name: false, headings: true, lines: true, links: false, ...o });
export const TEMPLATE_PRESETS = {
  fresher: { name: 'Fresher First', level: 'fresher', ind: ['tech', 'sales'], desc: 'Clean sans, bold headings. Projects before experience.', design: { ...D } },
  campus: { name: 'Campus', level: 'fresher', ind: ['tech', 'govt', 'care'], sections: 'campus', desc: 'Education and projects first, then internships. For final-year students.', design: { ...D, font: 'lato', accent: '#1F3A8A', headingStyle: 'rule' } },
  starter: { name: 'Starter', level: 'fresher', ind: ['sales', 'govt', 'care'], desc: 'The simplest look. Prints well on any printer.', design: { ...D, logoColor: 'mono', accent: '#111827', headingStyle: 'caps', accentOn: on({ headings: false, lines: false }) } },
  work: { name: 'Work-first', level: 'all', ind: ['sales', 'care'], sections: 'work', desc: 'Skills and work experience on top, education small. Simple and ATS-safe — for drivers, electricians, delivery and shop work.', design: { ...D, font: 'open-sans', accent: '#0F766E', headingStyle: 'rule', bodySize: 10.5, layout: 'one' } },
  kio: { name: 'Kio', level: 'fresher', ind: ['govt'], sections: 'kio', desc: 'Traditional Indian format: summary, education, experience, hobbies, strengths, personal information and declaration.', design: { ...D, logoColor: 'mono', font: 'source-serif-4', accent: '#2F5597', headingStyle: 'underline', nameSize: 21, accentOn: on({ name: true }) } },
  classic: { name: 'Classic', level: 'all', ind: ['govt', 'mgmt'], desc: 'Serif with a line after each heading. Safe for banks, consulting, PSU roles.', design: { ...D, logoColor: 'mono', font: 'source-serif-4', headingStyle: 'rule', accent: '#1A1A1A' } },
  formal: { name: 'Formal', level: 'all', ind: ['govt'], sections: 'formal', desc: 'Merriweather serif with personal details and declaration on. Govt, PSU and bank applications.', design: { ...D, logoColor: 'mono', font: 'merriweather', accent: '#111111', headingStyle: 'underline', bodySize: 9.5, nameSize: 20 } },
  modern: { name: 'Modern', level: 'experienced', ind: ['tech', 'sales'], desc: 'Lato with a blue accent and filled heading bars. Tech and startups.', design: { ...D, font: 'lato', accent: '#2E46D8', headingStyle: 'bar', accentOn: on({ name: true, links: true }) } },
  stack: { name: 'Stack', level: 'all', ind: ['tech'], sections: 'stack', desc: 'Skills right under the summary, so tech recruiters see your stack first.', design: { ...D, font: 'ibm-plex-sans', accent: '#0F766E', headingStyle: 'left', accentOn: on({ name: true }) } },
  mono: { name: 'Minimal Mono', level: 'all', ind: ['tech', 'creative'], desc: 'Lots of white space, quiet grey headings. Calm and modern.', design: { ...D, logoColor: 'mono', font: 'roboto', accent: '#334155', headingStyle: 'caps', bodySize: 9.5, sectionGap: 14, margin: 'wide', marginPt: 64, headerStyle: 'none', accentOn: on({ lines: false }) } },
  compact: { name: 'Compact', level: 'experienced', ind: ['tech', 'mgmt'], desc: 'Tighter type and spacing to fit more on one page.', design: { ...D, font: 'roboto', bodySize: 9.5, headSize: 10, nameSize: 20, lineHeight: 1.25, sectionGap: 8, itemGap: 4, margin: 'narrow', marginPt: 36, accent: '#0E7A52', headingStyle: 'left' } },
  impact: { name: 'Impact', level: 'experienced', ind: ['sales', 'mgmt'], desc: 'Numbers in your bullets are bolded, so results jump out. Sales and operations.', design: { ...D, font: 'open-sans', accent: '#9A4508', headingStyle: 'bar', boldNumbers: true, bodySize: 9.5 } },
  executive: { name: 'Executive', level: 'experienced', ind: ['mgmt'], sections: 'executive', desc: 'Summary and core strengths up top, generous spacing. Managers and leads.', design: { ...D, logoColor: 'mono', font: 'source-serif-4', accent: '#1F3A8A', headingStyle: 'rule', nameSize: 24, accentOn: on({ name: true }) } },
  accent: { name: 'Accent', level: 'all', ind: ['creative', 'sales'], desc: 'A light colour band behind your name. Stands out, still ATS-safe.', design: { ...D, font: 'lato', accent: '#6D28D9', headerStyle: 'band', headingStyle: 'underline', accentOn: on({ name: true }) } },
  twocol: { name: 'Two Column Light', level: 'experienced', ind: ['tech', 'creative'], desc: 'Pale side panel for skills, languages and certificates. Prints cleanly.', design: { ...D, font: 'source-sans-3', layout: 'two', sideTint: true, accent: '#1F3A8A', headingStyle: 'caps', accentOn: on({ name: true }) } },
  sidebar: { name: 'Sidebar', level: 'experienced', ind: ['tech'], desc: 'Two columns: skills, languages and certificates on the side.', design: { ...D, font: 'ibm-plex-sans', layout: 'two', accent: '#0F766E', headingStyle: 'caps', accentOn: on({ name: true }) } },
  care: { name: 'Care', level: 'all', ind: ['care'], sections: 'care', desc: 'Licences and certifications near the top. Nurses, pharmacists, teachers.', design: { ...D, font: 'open-sans', accent: '#0E7A52', headingStyle: 'rule' } },
  academic: { name: 'Academic', level: 'all', audience: 'Experienced + Freshers', ind: ['tech', 'mgmt', 'govt'], desc: 'The LaTeX look recruiters know (like Jake’s resume): Computer Modern serif, centred name, thin rules under headings, two-line entries. Tight, aims for one page.', design: { ...D, logoColor: 'mono', font: 'cmu-serif', accent: '#111111', textColor: '#111111', headingStyle: 'underline', headerAlign: 'center', headerStyle: 'none', icons: true, contactSep: '|', contactOrder: 'phone-first', entryStyle: 'academic', nameSize: 24, headSize: 11, bodySize: 10.5, lineHeight: 1.2, sectionGap: 9, itemGap: 5, margin: 'narrow', marginPt: 36, accentOn: on({ headings: true, lines: true }) } },
  portrait: { name: 'Portrait', level: 'all', ind: ['creative', 'care', 'sales'], sections: 'portrait', photo: true, desc: 'Photo beside your name. For aviation, hospitality, media and front-office roles.', design: { ...D, font: 'lato', accent: '#9F1239', headerStyle: 'band', headerAlign: 'left', accentOn: on({ name: true }) } },
};

/** A shared / exported resume's full design: its own settings over the defaults (the fresher preset when it has none). */
export const designOf = (d) => ({ ...DEFAULT_DESIGN, ...(d.design || TEMPLATE_PRESETS.fresher.design), preset: d.design?.preset ?? 'fresher' });
export const marginOf = (ds) => (ds.margin === 'custom' ? ds.marginPt : MARGINS[ds.margin] ?? 50);
export const headFontOf = (ds) => (ds.headFont === 'same' ? ds.font : ds.headFont);

/** Dates in the chosen format. v = "YYYY-MM". */
export function fmtDate(v, f) {
  if (!v) return '';
  const [y, m] = v.split('-');
  if (!m) return v;
  if (f === 'year') return y;
  if (f === 'num') return `${m}/${y}`;
  return `${['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][parseInt(m, 10) - 1]} ${y}`;
}
export function fmtDates(from, to, current, f, expected) {
  const a = fmtDate(from, f);
  let b = current ? (expected && to ? `Expected ${fmtDate(to, f)}` : 'Present') : fmtDate(to, f);
  if (f === 'year' && a && b === a) b = '';
  return [a, b].filter(Boolean).join(' – ');
}

/* ---------- colour helpers ---------- */
const lum = (hex) => {
  const n = parseInt(hex.replace('#', ''), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((c) => { const s = c / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; })
    .reduce((acc, c, i) => acc + c * [0.2126, 0.7152, 0.0722][i], 0);
};
export const contrastOnWhite = (hex) => 1.05 / (lum(hex) + 0.05);
export const tint = (hex, a) => {
  const n = parseInt(hex.replace('#', ''), 16);
  const mix = (c) => Math.round(c * a + 255 * (1 - a));
  return `rgb(${mix((n >> 16) & 255)}, ${mix((n >> 8) & 255)}, ${mix(n & 255)})`;
};

/** ATS-safety: 100 minus penalties, with plain-language reasons. */
export function atsCheck(ds, d) {
  const issues = [];
  if (ds.layout === 'two') issues.push([15, 'Two columns — some tracking systems read across both columns and mix up your text.']);
  if (ds.bodySize < 9.5) issues.push([10, 'Body text under 9.5 pt is hard to read and can be misread by scanners.']);
  if (ds.textColor === '#4A4F59') issues.push([5, 'Soft grey text prints faint. Black or dark grey is safer.']);
  const accentText = ds.accentOn.name || ds.accentOn.headings || ds.accentOn.links;
  if (accentText && contrastOnWhite(ds.accent) < 4.5) issues.push([10, 'Your accent colour is too light for text. Pick a darker shade.']);
  if (ds.skillsStyle === 'chips') issues.push([5, 'Skill chips look nice, but plain lines are the safest for scanners.']);
  if (d.showPhoto) issues.push([5, 'Many tracking systems skip or flag photos.']);
  if (ds.layout === 'two' && ds.sideTint && contrastOnWhite(ds.accent) < 3) issues.push([3, 'Light side panel with a light accent can print faintly.']);
  if (ds.headingStyle === 'bar' && contrastOnWhite(ds.accent) < 3) issues.push([5, 'Heading bars with light colours lower contrast.']);
  const score = Math.max(0, 100 - issues.reduce((s, [p]) => s + p, 0));
  return { score, label: score >= 90 ? 'Great' : score >= 75 ? 'Good' : 'Risky', issues: issues.map(([, m]) => m) };
}

/** Steps “Fit to one page” tries, in order, until the resume fits. */
export const FIT_STEPS = [
  (s) => ({ sectionGap: Math.max(6, s.sectionGap - 3) }),
  (s) => ({ itemGap: Math.max(3, s.itemGap - 2) }),
  (s) => ({ lineHeight: Math.max(1.15, +(s.lineHeight - 0.08).toFixed(2)) }),
  (s) => (s.margin === 'wide' || s.margin === 'normal' ? { margin: 'narrow', marginPt: MARGINS.narrow } : {}),
  (s) => ({ bodySize: Math.max(9, s.bodySize - 0.5), headSize: Math.max(9.5, s.headSize - 0.5) }),
  (s) => ({ nameSize: Math.max(16, s.nameSize - 3) }),
  (s) => ({ lineHeight: Math.max(1.15, +(s.lineHeight - 0.05).toFixed(2)), sectionGap: Math.max(6, s.sectionGap - 2) }),
  (s) => ({ bodySize: Math.max(9, s.bodySize - 0.5) }),
];
