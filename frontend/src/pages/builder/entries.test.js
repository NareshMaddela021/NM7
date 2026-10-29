import { describe, expect, it } from 'vitest';
import { unzipSync, strFromU8 } from 'fflate';
import { hiddenCount, lineItems, linesPatch, migrateEntries, moveItem, removeItem, toggleItem, visibleResume } from './entries';
import { buildSections } from './resumeModel';
import { DEFAULT_DESIGN } from './design';
import { INITIAL, migrateLinks } from './schema';
import { atsScore, resumeText } from '../../lib/atsScore';
import { buildDocx } from './resumeDocx';

const base = () => migrateLinks(structuredClone({
  ...INITIAL,
  summary: '',
  edu: [{ institution: 'IIT Madras', degree: 'B.Tech', field: 'CSE', from: '2021-08', to: '2025-05' }, { institution: 'DAV School', degree: 'Class 12', field: 'CBSE' }],
  exp: [{ company: 'Acme', role: 'Intern', description: 'Built dashboards' }],
  langs: [{ name: 'English', level: 'Fluent' }, { name: 'Tamil', level: 'Native' }],
  hobbies: 'Reading\nChess\nCricket',
  hidden: {},
  custom: [{ id: 'c_x', title: 'Extracurricular Activities', items: [{ title: 'NSS Volunteer' }, { title: 'Drama Club' }] }],
  linkExtras: [{ url: 'kaggle.com/asha', label: '', icon: 'auto' }, { url: 'behance.net/asha', label: '', icon: 'auto' }],
}));
const ds = { ...DEFAULT_DESIGN, layout: 'one' };
const sec = (d, id) => buildSections(d, ds).main.find((s) => s.id === id);

describe('moving, hiding, removing entries', () => {
  it('moves one place and never past the ends', () => {
    expect(moveItem(['a', 'b', 'c'], 0, 1)).toEqual(['b', 'a', 'c']);
    expect(moveItem(['a', 'b', 'c'], 2, -1)).toEqual(['a', 'c', 'b']);
    expect(moveItem(['a', 'b'], 0, -1)).toEqual(['a', 'b']);
    expect(moveItem(['a', 'b'], 1, 1)).toEqual(['a', 'b']);
    const src = ['a', 'b'];
    moveItem(src, 0, 1);
    expect(src).toEqual(['a', 'b']); // never changes the original
  });
  it('switches an entry off and on without losing what was typed', () => {
    const list = [{ name: 'x' }, { name: 'y' }];
    const off = toggleItem(list, 1);
    expect(off[1]).toEqual({ name: 'y', off: true });
    expect(toggleItem(off, 1)[1]).toEqual({ name: 'y', off: false });
    expect(removeItem(list, 0)).toEqual([{ name: 'y' }]);
  });
  it('one-per-line sections keep hidden lines in the text', () => {
    const d = base();
    const items = lineItems(d, 'hobbies');
    expect(items.map((x) => x.text)).toEqual(['Reading', 'Chess', 'Cricket']);
    const patch = linesPatch(d, 'hobbies', moveItem(toggleItem(items, 1), 1, 1));
    expect(patch.hobbies).toBe('Reading\nCricket\nChess');
    expect(patch.offLines.hobbies).toEqual(['Chess']);
    const d2 = { ...d, ...patch };
    expect(lineItems(d2, 'hobbies').map((x) => `${x.text}${x.off ? '-' : ''}`)).toEqual(['Reading', 'Cricket', 'Chess-']);
    expect(hiddenCount(d2, 'hobbies')).toBe(1);
  });
  it('old resumes: everything visible', () => {
    const old = structuredClone(INITIAL);
    delete old.offLines;
    const m = migrateEntries(old);
    expect(m.offLines).toEqual({});
    expect(visibleResume(m).edu).toEqual(old.edu);
    expect(migrateEntries({ ...old, edu: [{ degree: 'x', off: 'yes' }] }).edu).toEqual([{ degree: 'x' }]);
  });
});

describe('renderers skip switched-off entries', () => {
  it('preview/PDF sections: order follows the list, off entries and empty sections disappear', () => {
    const d = base();
    d.edu = moveItem(d.edu, 1, -1);
    expect(sec(d, 'edu').items.map((x) => x.sub.split(' · ')[0])).toEqual(['DAV School', 'IIT Madras']);
    d.edu = toggleItem(d.edu, 0);
    expect(sec(d, 'edu').items.map((x) => x.sub.split(' · ')[0])).toEqual(['IIT Madras']);
    expect(hiddenCount(d, 'edu')).toBe(1);
    d.edu = toggleItem(d.edu, 1);
    expect(sec(d, 'edu')).toBeUndefined(); // all off → no heading
    expect(d.edu.map((x) => x.institution)).toEqual(['DAV School', 'IIT Madras']); // typed data kept
  });
  it('custom sections, languages, skills, hobbies and extra links', () => {
    const d = base();
    d.custom[0].items = toggleItem(d.custom[0].items, 0);
    expect(sec(d, 'c_x').items.map((x) => x.head)).toEqual(['Drama Club']);
    d.langs = toggleItem(d.langs, 1);
    expect(sec(d, 'langs').items[0].lines.join(' ')).not.toContain('Tamil');
    d.skillGroups = toggleItem(d.skillGroups, 0);
    expect(JSON.stringify(sec(d, 'skills'))).not.toContain('Statistics');
    const h = { ...d, hidden: {}, ...linesPatch(d, 'hobbies', toggleItem(lineItems(d, 'hobbies'), 0)) };
    expect(JSON.stringify(sec(h, 'hobbies'))).not.toContain('Reading');
    d.linkExtras = toggleItem(d.linkExtras, 0);
    expect(visibleResume(d).linkExtras.map((x) => x.url)).toEqual(['behance.net/asha']);
    expect(hiddenCount(d, 'links')).toBe(1);
    expect(hiddenCount(d, 'c_x')).toBe(1);
  });
  it('ATS score and keyword text ignore hidden entries', () => {
    const d = base();
    d.exp = [{ company: 'Zeta Corp', role: 'Kubernetes Engineer', description: 'Ran kubernetes clusters' }];
    expect(resumeText(d)).toContain('kubernetes');
    d.exp = toggleItem(d.exp, 0);
    expect(resumeText(d)).not.toContain('kubernetes');
    const shown = { ...d, exp: toggleItem(d.exp, 0) };
    expect(atsScore(d, 'kubernetes').match.found).not.toContain('kubernetes');
    expect(atsScore(shown, 'kubernetes').match.found).toContain('kubernetes');
  });
  it('Word file: entries in the chosen order, hidden ones left out', async () => {
    const d = base();
    d.edu = toggleItem(moveItem(d.edu, 1, -1), 1); // DAV first, IIT hidden
    const blob = await buildDocx({ data: d, design: ds });
    const xml = strFromU8(unzipSync(new Uint8Array(await blob.arrayBuffer()))['word/document.xml']);
    expect(xml).toContain('DAV School');
    expect(xml).not.toContain('IIT Madras');
    d.edu = toggleItem(d.edu, 1);
    const xml2 = strFromU8(unzipSync(new Uint8Array(await (await buildDocx({ data: d, design: ds })).arrayBuffer()))['word/document.xml']);
    expect(xml2.indexOf('DAV School')).toBeLessThan(xml2.indexOf('IIT Madras'));
  });
});
