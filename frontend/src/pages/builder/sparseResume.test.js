// Resumes that miss fields (saved by older builders, the demo college's made-up resumes, a hand-made API resume)
// render everywhere: the preview's sections, the college format and its checklist, the ATS score and the PDF.
// One once crashed Admin > Shared resumes > View ("Cannot read properties of undefined (reading 'filter')").
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { buildSections } from './resumeModel';
import { resumeShape, visibleResume } from './entries';
import { DEFAULT_DESIGN, TEMPLATE_PRESETS } from './design';
import { buildResumePdf } from './resumePdf';
import { atsScore } from '../../lib/atsScore';
import { checklist, formatData, formatDesign } from '../../lib/placementFormat';

const FONTS = path.resolve(__dirname, '../../../public/fonts');
beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(async (url) => {
    const file = path.join(FONTS, path.basename(url));
    if (!fs.existsSync(file)) return { ok: false, status: 404 };
    return { ok: true, arrayBuffer: async () => fs.readFileSync(file).buffer.slice(0) };
  }));
});
afterEach(() => vi.unstubAllGlobals());

const OLD = { personal: { name: 'Old Resume', email: 'old@example.com' }, exp: [{ company: 'Infosys', role: 'Intern' }] };
// the demo seed's shape before it was fixed: no ach, custom, hobbies, strengths, pinfo, hidden, titles…
const DEMO = {
  personal: { name: 'Lakshmi Rao', email: 'lakshmi.rao@demo.nm7.invalid', phone: '', headline: '', location: 'Demo City' },
  summary: '', edu: [{ institution: 'Demo Engineering College', degree: 'B.Tech', field: 'Computer Science', from: '2022-08', to: '2026-05', grade: '' }],
  skillGroups: [{ id: 'core', label: 'Skills', value: 'Python, SQL, Git' }], proj: [], exp: [], certs: [], langs: [{ name: 'English', level: 'Fluent' }],
  links: {}, design: { preset: 'fresher' },
};
const ODD = { personal: null, exp: null, edu: 'not a list', skillGroups: [null, { value: 'Python' }], custom: [{ id: 'c1', title: 'Talks' }], hobbies: null, hidden: [] };
const BRAND = { color: '#1F3A8A', templates: ['campus'], template: 'campus', collegeName: 'Demo Engineering College', headerStyle: 'center',
  rules: { order: ['edu', 'skills', 'proj'], required: ['edu', 'proj'], requireCgpa: true, optional: ['certs'], maxPages: 1, photo: false, showRoll: true } };
const design = (k) => ({ ...DEFAULT_DESIGN, ...TEMPLATE_PRESETS[k].design, preset: k });

describe('resumes with missing fields', () => {
  it('fills the shape without changing what is there', () => {
    const s = resumeShape(DEMO);
    expect(s.ach).toEqual([]); expect(s.custom).toEqual([]); expect(s.hobbies).toBe(''); expect(s.pinfo).toEqual({});
    expect(s.edu).toEqual(DEMO.edu); expect(s.personal).toEqual(DEMO.personal);
    const o = resumeShape(ODD);
    expect(o.exp).toEqual([]); expect(o.edu).toEqual([]); expect(o.personal).toEqual({}); expect(o.hidden).toEqual({});
    expect(o.skillGroups).toEqual([{ value: 'Python' }]); expect(o.custom[0].items).toEqual([]);
    expect(resumeShape(null)).toBe(null);
    expect(visibleResume(OLD).ach).toEqual([]);
  });

  for (const [name, data] of [['old', OLD], ['demo', DEMO], ['odd', ODD]]) {
    it(`${name}: preview sections, college format, checklist and ATS score`, () => {
      for (const k of ['fresher', 'campus', 'academic', 'twocol']) {
        if (!TEMPLATE_PRESETS[k]) continue;
        expect(() => buildSections(data, design(k))).not.toThrow();
      }
      const laid = formatData(data, BRAND);
      expect(() => buildSections(laid, formatDesign(BRAND, data))).not.toThrow();
      expect(() => checklist(data, BRAND, 1)).not.toThrow();
      expect(typeof atsScore(data).score).toBe('number');
    });

    it(`${name}: PDF, plain and in the college format`, async () => {
      for (const brand of [null, { ...BRAND, img: null, roll: '26CSE015' }]) {
        const blob = await buildResumePdf({ data, design: brand ? formatDesign(BRAND, data) : design('fresher'), brand, photo: null });
        expect(blob.type).toBe('application/pdf');
      }
    });
  }
});
