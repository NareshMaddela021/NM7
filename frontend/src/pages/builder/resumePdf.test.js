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
