// The PDF maker: Latin resumes keep their layout, Indian-script text prints as real text (not boxes) with the
// Noto Sans font of its script, fetched from our own origin only when the resume uses that script.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { inflateSync } from 'node:zlib';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.js';
import { buildResumePdf } from './resumePdf';
import { INITIAL } from './schema';
import { DEFAULT_DESIGN, TEMPLATE_PRESETS } from './design';
import { readPdf, toLines } from '../../lib/import/pdfRead';
import { scriptsIn, splitRuns } from './indicFonts';
import { charCount } from '../../lib/text';
import { PDFHexString } from 'pdf-lib';

const FONTS = path.resolve(__dirname, '../../../public/fonts');
const design = (k, extra = {}) => ({ ...DEFAULT_DESIGN, ...TEMPLATE_PRESETS[k].design, preset: k, ...extra });
const fetched = [];
beforeEach(() => {
  fetched.length = 0;
  // the fonts are served from public/fonts/ in the app; here they are read from disk
  vi.stubGlobal('fetch', vi.fn(async (url) => {
    fetched.push(url);
    const file = path.join(FONTS, path.basename(url));
    if (!fs.existsSync(file)) return { ok: false, status: 404 };
    return { ok: true, arrayBuffer: async () => fs.readFileSync(file).buffer.slice(0) };
  }));
});
afterEach(() => vi.unstubAllGlobals());

/** Every page content stream of a PDF, inflated and joined (pdf-lib deflates them). */
const contentOf = (bytes) => {
  const latin = bytes.toString('latin1');
  const out = [];
  for (const m of latin.matchAll(/stream\r?\n([\s\S]*?)\r?\nendstream/g)) {
    try { out.push(inflateSync(Buffer.from(m[1], 'latin1')).toString('latin1')); } catch { /* not deflated */ }
  }
  return out.join('\n');
};

const read = async (blob) => {
  const r = await readPdf(pdfjs, new Uint8Array(await blob.arrayBuffer()));
  const lines = toLines(r.items);
  return { ...r, lines, text: lines.map((l) => l.text).join('\n') };
};

const TELUGU = {
  ...INITIAL,
  personal: { ...INITIAL.personal, name: 'రాము కుమార్', headline: 'डेटा विश्लेषक · SQL · Power BI', location: 'హైదరాబాద్, తెలంగాణ' },
  summary: 'डेटा और एक्सेल में तीन साल का अनुभव। Data analyst who turns raw sales data into dashboards. తెలుగు మరియు హిందీ మాట్లాడగలను.',
  skillGroups: [{ id: 'core', label: 'Core', value: 'Python, SQL, డేటా విశ్లేషణ, Power BI' }],
  hidden: {},
};

describe('buildResumePdf', () => {
  it('Latin resume: real text, links, one page in two columns, no script font fetched', async () => {
    const blob = await buildResumePdf({ data: { ...INITIAL, hidden: {} }, design: design('fresher', { layout: 'two' }), photo: null, cover: null });
    expect(blob.type).toBe('application/pdf');
    expect(Buffer.from(await blob.arrayBuffer()).toString('latin1')).toContain('jsPDF'); // the light engine, as before
    const r = await read(blob);
    expect(r.pages).toHaveLength(1);
    expect(r.meta.Title).toBe('Sai Varsha — Resume');
    expect(r.meta.Creator).toBe('Nm7 Resume Builder');
    expect(r.text).toContain('Sai Varsha');
    expect(r.text).toContain('Data Analyst · SQL · Power BI');
    expect(r.text).toContain('SKILLS'); // letter-spaced headings still extract as one word
    expect(r.text).toContain('Python, SQL, Statistics');
    expect(r.links.some((l) => /github\.com\/sai-varsha-example/.test(l.url))).toBe(true);
    expect(fetched).toEqual([]);
  });

  it('both engines lay a Latin resume out the same: page count, lines, sizes, links', async () => {
    for (const [k, layout] of [['fresher', 'two'], ['kio', 'one'], ['modern', 'one'], ['formal', 'two']]) {
      const ds = design(k, { layout });
      const data = { ...INITIAL, summary: 'Data analyst fresher who turns raw sales data into dashboards teams use. Cut weekly reporting from 5 hours to 30 minutes during my internship. Looking for a Data Analyst role.', hidden: {} };
      const brand = { img: null, header: 'JNTU Anantapur · Placements 2026', footer: 'Shared via Nm7', color: '#1F3A8A' };
      const [a, b] = await Promise.all(['jspdf', 'pdflib'].map((engine) => buildResumePdf({ data, design: ds, photo: null, cover: null, brand, stamp: 'Shared with Infosys via Nm7', engine }).then(read)));
      expect(b.pages).toEqual(a.pages);
      const shape = (r) => r.lines.map((l) => [l.page, Math.round(l.y), l.size, l.text]); // (jsPDF's font names hide bold from pdf.js)
      expect(shape(b)).toEqual(shape(a));
      expect(b.links.map((l) => l.url)).toEqual(a.links.map((l) => l.url));
    }
    expect(fetched).toEqual([]);
  }, 30000);

  it('Telugu name and skill, Hindi summary: shaped text that reads back, Noto fonts fetched for those scripts only', async () => {
    const blob = await buildResumePdf({ data: TELUGU, design: design('fresher'), photo: null, cover: null });
    const r = await read(blob);
    expect(r.text).toContain('రాము కుమార్');
    // pdf.js's extraction API splits items at vowel signs and returns decomposed two-part signs (ై → ె + ౖ)
    expect(r.items.map((i) => i.str).join('').normalize('NFC')).toContain('హైదరాబాద్,');
    expect(r.text).toContain('తెలంగాణ');
    expect(r.text).toContain('डेटा और एक्सेल में तीन साल का अनुभव।');
    expect(r.text).toContain('Core: Python, SQL, డేటా');
    // a conjunct's glyphs sit in visual order, so each Indic run also carries its text as ActualText (what Acrobat,
    // poppler and tracking systems that honour it copy and search); pdf.js reads the glyph order
    const raw = contentOf(Buffer.from(await blob.arrayBuffer()));
    const actual = (t) => `/ActualText ${PDFHexString.fromText(t).toString()}`;
    expect(raw).toContain(actual('విశ్లేషణ'));
    expect(raw).toContain(actual('రాము'));
    expect(raw).not.toContain(actual('Python')); // Latin runs are plain text, as before
    expect(r.text).toContain('Data analyst who turns raw sales data into dashboards.');
    expect(r.meta.Title).toBe('రాము కుమార్ — Resume');
    const nameLine = r.lines.find((l) => /రాము కుమార్/.test(l.text));
    expect(nameLine.size).toBe(DEFAULT_DESIGN.nameSize);
    expect(nameLine.bold).toBe(true); // Noto Sans Telugu Bold
    expect(r.text).not.toMatch(/�/); // no replacement characters
    const files = fetched.map((u) => path.basename(u)).sort();
    expect(files).toEqual(['NotoSansDevanagari-Bold.ttf', 'NotoSansDevanagari-Regular.ttf', 'NotoSansTelugu-Bold.ttf', 'NotoSansTelugu-Regular.ttf']);
    expect(blob.size).toBeLessThan(400_000); // fonts are subset to the glyphs used
  });

  it('a script whose font cannot be fetched still downloads (template font), and the fonts are cached per session', async () => {
    const data = { ...TELUGU, summary: 'தமிழ் மொழி · Tamil line' };
    const blob = await buildResumePdf({ data, design: design('classic'), photo: null, cover: null });
    expect(fetched.map((u) => path.basename(u))).toContain('NotoSansTamil-Regular.ttf');
    expect((await read(blob)).text).toContain('Tamil line');
    const before = fetched.length;
    await buildResumePdf({ data, design: design('classic'), photo: null, cover: null });
    expect(fetched.length).toBe(before); // cached
  });

  it('cover letter in Hindi', async () => {
    const cover = { company: 'Zoho', role: 'डेटा विश्लेषक', hiring: 'Hiring Team', body: 'मुझे डेटा विश्लेषक पद में रुचि है।' };
    const r = await read(await buildResumePdf({ data: TELUGU, design: design('fresher'), photo: null, cover }));
    expect(r.text).toContain('मुझे डेटा');
    expect(r.text).toContain('पद में');
    expect(r.meta.Title).toBe('రాము కుమార్ — Cover letter');
  });
});

describe('indicFonts', () => {
  it('finds the scripts in any data and splits lines into font runs', () => {
    expect(scriptsIn('plain text')).toEqual([]);
    expect(scriptsIn({ personal: { name: 'రాము' }, summary: 'नमस्ते' })).toEqual(['devanagari', 'telugu']);
    expect(splitRuns('SQL మరియు Python')).toEqual([{ text: 'SQL ', script: null }, { text: 'మరియు', script: 'telugu' }, { text: ' Python', script: null }]);
    expect(splitRuns('ಸಾಫ್ಟ್‌ವೇರ್ 2024')).toEqual([{ text: 'ಸಾಫ್ಟ್‌ವೇರ್', script: 'kannada' }, { text: ' 2024', script: null }]);
    expect(splitRuns('कलकाता। x')).toEqual([{ text: 'कलकाता।', script: 'devanagari' }, { text: ' x', script: null }]);
    expect(splitRuns('a‍b')).toEqual([{ text: 'ab', script: null }]); // a joiner means nothing in Latin
  });

  it('counts user-perceived characters, not UTF-16 units', () => {
    expect(charCount('రాము కుమార్')).toBe(6); // రా · ము · space · కు · మా · ర్ — 11 UTF-16 units
    expect('రాము కుమార్'.length).toBe(11);
    expect(charCount('abc')).toBe(3);
    expect(charCount('')).toBe(0);
    expect(charCount('👍🏽')).toBe(1);
  });
});

describe('rupee sign and emoji (QA)', () => {
  it('₹ prints as ₹ (drawn with a Noto Sans font), emoji are left out, and job preferences never decide the font', async () => {
    expect(scriptsIn('Saved ₹2 lakh a year')).toEqual(['devanagari']);
    expect(splitRuns('Saved ₹2 lakh').map((r) => [r.text, r.script])).toEqual([['Saved ', null], ['₹', 'devanagari'], ['2 lakh', null]]);
    const data = { ...structuredClone(INITIAL), summary: 'Cut costs by ₹2,00,000 a year 🚀 and won 🏆 twice ✅.', exp: [{ ...INITIAL.exp[0], description: 'Handled ₹5 lakh in daily sales 💰' }] };
    const r = await read(await buildResumePdf({ data, design: design('fresher'), photo: null, cover: null }));
    expect(r.text).toContain('Cut costs by ₹2,00,000 a year and won twice.');
    expect(r.text).toContain('Handled ₹5 lakh in daily sales');
    expect(r.text).not.toMatch(/[\u{1F300}-\u{1FAFF}✅]|�/u);
    expect(r.meta.Producer || '').not.toMatch(/jsPDF/i); // the shaping engine, with the Noto font
    // "Under ₹5 LPA" is only a job preference (never printed): a plain resume stays on the light engine
    const plain = await read(await buildResumePdf({ data: INITIAL, design: design('fresher'), photo: null, cover: null }));
    expect(plain.meta.Producer).toMatch(/jsPDF/i);
  });
});

describe('bold words (**word** markers)', () => {
  const BOLD = {
    ...structuredClone(INITIAL), hidden: {},
    personal: { ...INITIAL.personal, headline: 'Data **Analyst**' }, // not a rich field: the marker is left out
    summary: 'Analyst who built **Power BI** dashboards.',
    exp: [{ ...INITIAL.exp[0], description: '**Cut costs by 20%** using SQL\nBuilt reports with **Power BI**, weekly\nA stray ** marker' }],
  };
  /** The weight of each word of `phrase` on the printed line that holds it (words are drawn one by one). */
  const boldOf = (r, phrase) => {
    const rows = {};
    r.items.forEach((i) => { (rows[`${i.page}:${Math.round(i.y)}`] ||= []).push(i); });
    const row = Object.values(rows).find((its) => its.sort((a, b) => a.x - b.x).map((i) => i.str.trim()).join(' ').includes(phrase)) || [];
    const words = phrase.split(' ');
    return row.filter((i) => words.includes(i.str.trim())).map((i) => i.bold);
  };
  it.each(Object.keys(TEMPLATE_PRESETS))('%s: bold words print bold, the rest regular, and no ** is ever printed', async (k) => {
    // jsPDF (Latin resumes): the same text, never a marker (its font names hide bold from pdf.js, see above)
    const light = await read(await buildResumePdf({ data: BOLD, design: design(k), photo: null, cover: null }));
    expect(light.text).not.toContain('**');
    expect(light.text).toContain('Cut costs by 20% using SQL');
    // the shaping engine lays out the same lines (tested above) and names its bold fonts, so bold can be checked
    const r = await read(await buildResumePdf({ data: BOLD, design: design(k), photo: null, cover: null, engine: 'pdflib' }));
    expect(r.lines.map((l) => l.text)).toEqual(light.lines.map((l) => l.text));
    expect(r.text).not.toContain('**');
    expect(r.text).toContain('Data Analyst');
    expect(r.text).toMatch(/Built reports with Power BI, weekly/);
    expect(r.text).toContain('A stray marker');
    expect(boldOf(r, 'Cut costs by 20% using SQL')).toEqual([true, true, true, true, false, false]);
    expect(boldOf(r, 'Analyst who built Power BI dashboards.')).toEqual([false, false, false, true, true, false]);
    // "**Power BI**," keeps its comma regular
    expect(boldOf(r, 'Built reports with Power BI , weekly')).toEqual([false, false, false, true, true, false, false]);
    const stray = r.items.filter((i) => Math.abs(i.y - (r.items.find((x) => x.str.startsWith('A stray') || x.str === 'stray')?.y ?? -1)) < 1);
    expect(stray.length).toBeGreaterThan(0);
    expect(stray.every((i) => !i.bold)).toBe(true);
  });
  it('bold Telugu and Hindi words print with the bold Noto fonts (and ₹)', async () => {
    const data = { ...BOLD, summary: 'అనుభవం: **డేటా విశ్లేషణ** and **डेटा विश्लेषक** saved **₹2 lakh**.' };
    const blob = await buildResumePdf({ data, design: design('fresher'), photo: null, cover: null });
    const r = await read(blob);
    expect(r.text).not.toContain('**');
    // each word is drawn on its own; Indic words carry their text as ActualText (pdf.js reads glyph order)
    const raw = contentOf(Buffer.from(await blob.arrayBuffer()));
    const actual = (t) => `/ActualText ${PDFHexString.fromText(t).toString()}`;
    for (const w of ['డేటా', 'విశ్లేషణ', 'डेटा', 'विश्लेषक', 'అనుభవం']) expect(raw).toContain(actual(w));
    const weight = (t) => r.items.filter((i) => i.str.trim() === t).map((i) => i.bold);
    expect(weight('డేటా')).toEqual([true]); // Noto Sans Telugu Bold
    expect(weight('डेटा')).toEqual([true]); // Noto Sans Devanagari Bold
    expect(weight('₹')).toEqual([true]);
    expect(weight('lakh')).toEqual([true]);
    expect(weight('అనుభవం')).toEqual([false]);
    expect(weight('saved')).toEqual([false]);
  });
  it('the Impact template keeps bolding numbers next to bold words', async () => {
    const data = { ...BOLD, exp: [{ ...INITIAL.exp[0], description: 'Grew sales 35% with **Tally**' }] };
    const r = await read(await buildResumePdf({ data, design: design('impact'), photo: null, cover: null, engine: 'pdflib' }));
    expect(boldOf(r, '35%')).toEqual([true]);
    expect(r.items.filter((i) => i.str.trim() === 'Tally').map((i) => i.bold)).toEqual([true]);
    expect(boldOf(r, 'Grew sales').every((b) => !b)).toBe(true);
  });
});

describe('Academic template (LaTeX look)', () => {
  const person = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../../../e2e-live/testPerson.json'), 'utf8'));
  const ACAD = {
    ...structuredClone(INITIAL), hidden: {},
    exp: [{ company: 'Northwind Retail', role: 'Data Analyst Intern', employmentType: 'Internship', location: 'Hybrid-Hyderabad', from: '2024-04', to: '', current: true, description: 'Built **Power BI** dashboards for the sales team\nCleaned CSV files in Python', links: [] }],
  };
  const itemsOn = (r, re) => { const y = r.items.find((i) => re.test(i.str))?.y; return r.items.filter((i) => Math.abs(i.y - y) < 1).sort((a, b) => a.x - b.x); };
  it('the standard test resume and the sample fit on one page', async () => {
    for (const data of [{ ...person, hidden: {} }, ACAD]) {
      const r = await read(await buildResumePdf({ data, design: design('academic'), photo: null, cover: null }));
      expect(r.pages).toHaveLength(1);
    }
  });
  it('line 1: company bold left, location right; line 2: role (type) and dates in italic; bullets indented', async () => {
    const r = await read(await buildResumePdf({ data: ACAD, design: design('academic'), photo: null, cover: null, engine: 'pdflib' }));
    const l1 = itemsOn(r, /^Northwind Retail$/);
    expect(l1.map((i) => [i.str, i.bold, i.italic])).toEqual([['Northwind Retail', true, false], ['Hybrid-Hyderabad', false, false]]);
    const l2 = itemsOn(r, /^Data Analyst Intern \(Internship\)$/);
    expect(l2.map((i) => [i.str, i.italic])).toEqual([['Data Analyst Intern (Internship)', true], ['Apr 2024 – Present', true]]);
    expect(l1[1].x + l1[1].w).toBeCloseTo(l2[1].x + l2[1].w, 0); // both right-aligned to the margin
    const bullet = r.items.find((i) => i.str.startsWith('Built'));
    expect(bullet.x).toBeGreaterThan(l1[0].x + 15); // indented under the entry
    expect(r.items.filter((i) => ['Power', 'BI'].includes(i.str.trim())).map((i) => i.bold)).toEqual([true, true]); // bold words work here too
    expect(r.meta.Producer || '').not.toMatch(/jsPDF/i);
    // the light engine prints the same lines (CMU Serif embedded)
    const light = await read(await buildResumePdf({ data: ACAD, design: design('academic'), photo: null, cover: null }));
    expect(light.lines.map((l) => l.text)).toEqual(r.lines.map((l) => l.text));
    expect(Buffer.from(await (await buildResumePdf({ data: ACAD, design: design('academic'), photo: null, cover: null })).arrayBuffer()).toString('latin1')).toMatch(/\/BaseFont \/cmu-serif/);
  });
  it('empty location, dates or employment type leave no stray "()", "–" or "|"', async () => {
    const data = { ...ACAD, exp: [{ company: 'Zoho', role: 'Analyst', employmentType: '', location: '', from: '', to: '', current: false, description: '', links: [] }, { company: '', role: 'Volunteer tutor', employmentType: 'Part-time', location: '', from: '', to: '', current: false, description: '', links: [] }], edu: [{ institution: 'Osmania University', degree: 'B.Com', field: '', from: '', to: '', current: false, grade: '' }] };
    const r = await read(await buildResumePdf({ data, design: design('academic'), photo: null, cover: null }));
    const lines = r.lines.map((l) => l.text);
    expect(lines).toContain('Zoho');
    expect(lines).toContain('Analyst');
    expect(lines).toContain('Volunteer tutor (Part-time)');
    expect(lines).toContain('Osmania University');
    expect(lines).toContain('B.Com');
    for (const l of lines) expect(l).not.toMatch(/\(\s*\)|^[–\-|·]|[–\-|·]$|\s[–|]\s*$/);
  });
  it('Telugu, Hindi and ₹ print with the Noto Serif fonts', async () => {
    const data = { ...ACAD, personal: { ...ACAD.personal, name: 'రాము కుమార్' }, summary: 'डेटा विश्लेषक. Saved ₹2 lakh a year.' };
    const blob = await buildResumePdf({ data, design: design('academic'), photo: null, cover: null });
    const r = await read(blob);
    expect(r.text).toContain('రాము కుమార్');
    expect(r.text).toContain('₹2 lakh');
    expect(r.text).not.toMatch(/�/);
    expect(fetched.map((u) => path.basename(u)).sort()).toEqual(['NotoSerifDevanagari-Bold.ttf', 'NotoSerifDevanagari-Regular.ttf', 'NotoSerifTelugu-Bold.ttf', 'NotoSerifTelugu-Regular.ttf']);
    const raw = contentOf(Buffer.from(await blob.arrayBuffer()));
    expect(raw).toContain(`/ActualText ${PDFHexString.fromText('विश्लेषक').toString()}`);
  });
});

describe('contact icons follow the resume setting in every template (vector shapes)', () => {
  const WITH_LINKS = {
    ...structuredClone(INITIAL), hidden: {},
    personal: { ...INITIAL.personal, phone: '+91 98765 43210', email: 'saivarsha@example.com', location: 'Chennai' },
    links: { ...INITIAL.links, linkedin: 'linkedin.com/in/saivarsha', github: 'github.com/saivarsha' },
  };
  /** How many path-painting operations a PDF draws (icons are paths; headings' rules are too). */
  const paths = async (blob) => {
    const doc = await pdfjs.getDocument({ data: new Uint8Array(await blob.arrayBuffer()), isEvalSupported: false, verbosity: 0 }).promise;
    const ops = await (await doc.getPage(1)).getOperatorList();
    const paint = new Set([pdfjs.OPS.fill, pdfjs.OPS.stroke, pdfjs.OPS.eoFill, pdfjs.OPS.fillStroke, pdfjs.OPS.closeStroke]);
    return { n: ops.fnArray.filter((f) => paint.has(f) || f === pdfjs.OPS.constructPath).length, images: ops.fnArray.filter((f) => f === pdfjs.OPS.paintImageXObject).length };
  };
  it.each(Object.keys(TEMPLATE_PRESETS))('%s: icon + text, text only and icon only', async (k) => {
    const make = async (mode) => { const blob = await buildResumePdf({ data: { ...WITH_LINKS, contactIcons: mode }, design: design(k), photo: null, cover: null }); return { blob, r: await read(blob), p: await paths(blob) }; };
    const both = await make('both'); const textOnly = await make('text'); const iconOnly = await make('icon');
    for (const { r } of [both, textOnly]) {
      for (const t of ['+91 98765 43210', 'saivarsha@example.com', 'Chennai']) expect(r.text).toContain(t);
      expect(r.text).toMatch(/(^|[\s|·])saivarsha([\s|·]|$)/m); // the profile handles stay real text
    }
    expect(iconOnly.r.text).toContain('+91 98765 43210'); // phone and email keep their text
    expect(iconOnly.r.text).toContain('saivarsha@example.com');
    expect(iconOnly.r.text).not.toMatch(/(^|[\s|·])saivarsha([\s|·]|$)/m); // links show only their icon
    for (const { r } of [both, textOnly, iconOnly]) {
      const urls = r.links.map((l) => l.url);
      expect(urls).toEqual(expect.arrayContaining(['tel:+919876543210', 'mailto:saivarsha@example.com', 'https://linkedin.com/in/saivarsha', 'https://github.com/saivarsha']));
      expect(r.text).not.toMatch(/�/);
    }
    expect(both.p.n).toBeGreaterThan(textOnly.p.n + 5); // the icons are vector paths…
    expect(both.p.images).toBe(0); // …not pictures
    expect(iconOnly.p.n).toBe(both.p.n);
  });
  it('Academic: small icons on the baseline, | kept between items, icon and text one link; a long line wraps between items', async () => {
    const r = await read(await buildResumePdf({ data: WITH_LINKS, design: design('academic'), photo: null, cover: null }));
    const line = r.lines.find((l) => l.text.includes('saivarsha@example.com'));
    expect(line.text).toMatch(/\+91 98765 43210 \| saivarsha@example\.com \| saivarsha \| saivarsha \| Chennai/);
    const email = r.items.find((i) => i.str === 'saivarsha@example.com');
    const link = r.links.find((l) => l.url === 'mailto:saivarsha@example.com');
    expect(link.x).toBeLessThan(email.x - 5); // the link starts at the icon
    expect(link.x + link.w).toBeGreaterThanOrEqual(email.x + email.w - 0.5);
    // many links: the contact line wraps between items, centred, never inside one
    const many = { ...WITH_LINKS, links: { ...WITH_LINKS.links, portfolio: 'saivarsha-portfolio.example.com', medium: 'medium.com/@saivarsha-writes', stackoverflow: 'stackoverflow.com/users/123/saivarsha-answers' }, linkExtras: [{ url: 'x.com/saivarsha_tweets', label: '' }, { url: 'kaggle.com/saivarsha-kaggle', label: '' }] };
    const r2 = await read(await buildResumePdf({ data: many, design: design('academic'), photo: null, cover: null }));
    const contact = r2.lines.filter((l) => /saivarsha/.test(l.text) && l.y < 120);
    expect(contact.length).toBeGreaterThan(1);
    const mid = 595.28 / 2;
    for (const l of contact) {
      expect(Math.abs((l.x + l.xEnd) / 2 - mid)).toBeLessThan(14); // centred
      expect(l.text).not.toMatch(/^\||\|$/);
    }
    for (const t of ['saivarsha-portfolio.example.com', 'saivarsha-writes', 'saivarsha-answers', 'saivarsha_tweets', 'saivarsha-kaggle']) expect(contact.filter((l) => l.text.includes(t))).toHaveLength(1);
  });
});

describe('relevant courses under Education', () => {
  const SIX = ['Data Structures', 'Operating Systems', 'DBMS', 'Computer Networks', 'OOP', '**AI/ML**'];
  const withCourses = (courses) => ({ ...structuredClone(INITIAL), hidden: {}, edu: [{ ...INITIAL.edu[0], courses }] });
  it.each(['academic', 'fresher', 'classic', 'twocol'])('%s: bold "Courses:" then the comma list under the entry', async (k) => {
    const r = await read(await buildResumePdf({ data: withCourses(SIX), design: design(k), photo: null, cover: null, engine: 'pdflib' }));
    const label = r.items.find((i) => i.str === 'Courses:');
    // the main column only (two-column templates have the side column on the same lines)
    const col = toLines(r.items, { minX: label.x - 1 }).filter((l) => l.y >= label.y - 1 && l.y < label.y + 40).map((l) => l.text).join(' ');
    expect(col).toMatch(/^Courses: Data Structures, Operating Systems, DBMS, Computer Networks, OOP, AI\/ML/);
    expect(r.text).not.toContain('**');
    expect(label.bold).toBe(true);
    const ds = r.items.find((i) => i.str === 'Data' && Math.abs(i.y - label.y) < 1);
    expect(ds.italic).toBe(k === 'academic'); // italic in Academic, the template's own style elsewhere
    expect(r.items.find((i) => i.str === 'AI/ML').bold).toBe(true); // bold works in course names
    const grade = r.items.find((i) => /CGPA/.test(i.str));
    expect(label.y).toBeGreaterThan(grade.y); // after the grade line
  });
  it('a long list wraps with a hanging indent; an empty list prints no label; the label follows Design', async () => {
    const long = Array.from({ length: 12 }, (_, i) => `Advanced Course Number ${i + 1}`);
    const r = await read(await buildResumePdf({ data: withCourses(long), design: design('academic'), photo: null, cover: null, engine: 'pdflib' }));
    const label = r.items.find((i) => i.str === 'Courses:');
    const rows = r.lines.filter((l) => l.y >= label.y - 1 && /Advanced|Number|\d/.test(l.text) && l.y < label.y + 60);
    expect(rows.length).toBeGreaterThan(1);
    const firstWord = r.items.find((i) => i.str === 'Advanced' && Math.abs(i.y - label.y) < 1);
    for (const l of rows.slice(1)) expect(l.textX).toBeCloseTo(firstWord.x, 0); // wrapped lines start under the list, not under the label
    for (const k of ['academic', 'fresher']) {
      const empty = await read(await buildResumePdf({ data: withCourses([]), design: design(k), photo: null, cover: null }));
      expect(empty.text).not.toMatch(/Courses:|Coursework/);
    }
    const relabelled = await read(await buildResumePdf({ data: withCourses(SIX), design: design('fresher', { coursesLabel: 'Relevant coursework' }), photo: null, cover: null }));
    expect(relabelled.text).toContain('Relevant coursework: Data Structures');
  });
  it('Telugu and Hindi course names print', async () => {
    const r = await read(await buildResumePdf({ data: withCourses(['తెలుగు సాహిత్యం', 'हिंदी व्याकरण', 'DBMS']), design: design('academic'), photo: null, cover: null }));
    expect(r.items.map((i) => i.str).join('').normalize('NFC')).toMatch(/సాహిత్యం/);
    expect(r.text).toContain('DBMS');
    expect(r.text).not.toMatch(/�/);
  });
});
