// "Check before download": the checks read the real PDF (pages, text at the page edge, clickable links) and the resume.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.js';
import { buildResumePdf } from '../pages/builder/resumePdf';
import { INITIAL } from '../pages/builder/schema';
import { DEFAULT_DESIGN, TEMPLATE_PRESETS } from '../pages/builder/design';
import { cutOff, linkProblem, longBullets, printChecks, readPrint, resumeLinks, targetPages, thinSections } from './printCheck';

const FONTS = path.resolve(__dirname, '../../public/fonts');
const design = { ...DEFAULT_DESIGN, ...TEMPLATE_PRESETS.classic?.design, preset: 'classic' };
beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(async (url) => {
    const file = path.join(FONTS, path.basename(url));
    if (!fs.existsSync(file)) return { ok: false, status: 404 };
    return { ok: true, arrayBuffer: async () => fs.readFileSync(file).buffer.slice(0) };
  }));
});
afterEach(() => vi.unstubAllGlobals());

const base = () => ({
  ...structuredClone(INITIAL),
  personal: { ...INITIAL.personal, name: 'Asha Rao', phone: '+91 90000 12345', email: 'asha@example.com', location: 'Hyderabad' },
  links: { linkedin: 'linkedin.com/in/asha-rao', github: 'github.com/asharao' },
  linkExtras: [], exp: [], proj: [], certs: [], ach: [], custom: [],
});
const pdfOf = async (data) => {
  const blob = await buildResumePdf({ data, design, photo: null });
  const doc = await pdfjs.getDocument({ data: new Uint8Array(await blob.arrayBuffer()), disableWorker: true }).promise;
  return readPrint(doc);
};
const byKey = (items) => Object.fromEntries(items.map((i) => [i.key, i]));

describe('print checks', () => {
  it('a tidy resume passes: 1 page, contact, clickable links, nothing cut off', async () => {
    const d = base();
    const print = await pdfOf(d);
    const c = byKey(printChecks({ data: d, design, print }));
    expect(print.count).toBe(1);
    expect(c.contact.ok).toBe(true);
    expect(c.pages).toMatchObject({ ok: true });
    expect(c.cutoff.ok).toBe(true);
    expect(c.links).toMatchObject({ ok: true, text: '2 links look right and are clickable' });
    expect(cutOff(print)).toEqual([]);
  });

  it('one link reads in the singular', () => {
    const d = base();
    d.links = { linkedin: d.links.linkedin };
    const c = byKey(printChecks({ data: d, design, print: null }));
    expect(c.links.text).toBe('1 link looks right and is clickable');
  });

  it('flags missing contact details, broken links, long bullets and bare sections', async () => {
    const d = base();
    d.personal.phone = '';
    d.personal.email = '';
    d.links = { linkedin: 'linkedin.com/feed', github: 'my github' };
    d.proj = [{ ...(INITIAL.proj?.[0] || {}), id: 'p1', title: 'Chat app', status: '', description: '', tech: '', tagline: '', from: '', to: '', links: [] }];
    d.exp = [{ id: 'e1', company: 'Acme', role: 'Intern', from: '2024-01', to: '2024-06', description: `Built ${'very '.repeat(40)}fast reports for the sales team` }];
    const c = byKey(printChecks({ data: d, design, print: await pdfOf(d) }));
    expect(c.contact).toMatchObject({ ok: false, text: 'Add your phone number and email' });
    expect(c.links.ok).toBe(false);
    expect(c.links.text).toMatch(/LinkedIn link isn’t a LinkedIn profile link/);
    expect(c.bullets.ok).toBe(false);
    expect(c.bullets.text).toMatch(/Experience: Acme/);
    expect(c.empty).toMatchObject({ ok: false });
    expect(c.empty.text).toMatch(/Projects/);
  });

  it('a link printed without a clickable area is reported', () => {
    const d = base();
    const print = { count: 1, pages: [{ w: 595, h: 842, runs: [], links: ['https://linkedin.com/in/asha-rao'] }] };
    const c = byKey(printChecks({ data: d, design, print }));
    expect(c.links).toMatchObject({ ok: false, text: 'GitHub link won’t be clickable in the PDF' });
  });

  it('pages over the target, text past the edge, photo switched on with none, college rules', () => {
    const d = { ...base(), showPhoto: true, edu: [] };
    const print = { count: 2, pages: [{ w: 595, h: 842, runs: [{ str: 'https://example.com/a-very-long-link', x: 500, y: 400, w: 160, h: 10 }], links: [] }, { w: 595, h: 842, runs: [], links: [] }] };
    const college = { rules: { maxPages: 1, required: ['edu'], photo: false } };
    const c = byKey(printChecks({ data: d, design, print, college }));
    expect(c.pages).toMatchObject({ ok: false, text: '2 pages: aim for 1 (for your college format). Shorten bullets or hide a section.' });
    expect(c.cutoff.text).toMatch(/Text runs off the page on page 1: “https:\/\/example.com/);
    expect(c.photo).toMatchObject({ ok: false, text: 'Photo is switched on but no photo is added' });
    expect(c['college-req-edu']).toMatchObject({ ok: false, text: 'College format: Education is required' });
    expect(c['college-photo'].ok).toBe(false);
  });

  it('helpers', () => {
    expect(linkProblem('github.com/asha')).toBeNull();
    expect(linkProblem('https://x')).toBe('isn’t a full web address');
    expect(linkProblem('ftp://files.example.com')).toBe('isn’t a web address');
    expect(targetPages({ exp: [{ company: 'A', from: '2018-01', to: '2023-01' }] }).pages).toBe(2);
    expect(targetPages({ exp: [] }).pages).toBe(1);
    expect(resumeLinks({ links: { github: 'github.com/a' }, proj: [{ title: 'P', links: [{ url: 'p.dev' }] }] })).toEqual([
      { where: 'GitHub', url: 'github.com/a' }, { where: 'Projects: P', url: 'p.dev' }]);
    expect(longBullets({ exp: [{ company: 'A', description: 'short line\nanother short line' }] })).toEqual([]);
    expect(thinSections(base(), design)).toEqual([]);
  });
});
