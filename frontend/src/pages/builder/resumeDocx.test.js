import { describe, expect, it } from 'vitest';
import { unzipSync, strFromU8 } from 'fflate';
import { buildDocx } from './resumeDocx';
import { INITIAL } from './schema';
import { DEFAULT_DESIGN } from './design';

describe('buildDocx', () => {
  it('keeps Indic text as typed and names a complex-script font Word has (Nirmala UI)', async () => {
    const data = { ...INITIAL, personal: { ...INITIAL.personal, name: 'రాము కుమార్' }, summary: 'डेटा विश्लेषक · తెలుగు', hidden: {} };
    const blob = await buildDocx({ data, design: DEFAULT_DESIGN, cover: null, photoPng: null });
    const files = unzipSync(new Uint8Array(await blob.arrayBuffer()));
    const xml = strFromU8(files['word/document.xml']);
    expect(xml).toContain('రాము కుమార్');
    expect(xml).toContain('डेटा विश्लेषक · తెలుగు');
    expect(xml).toMatch(/<w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" w:cs="Nirmala UI"\/>/);
    expect(xml).not.toMatch(/w:cs="Calibri"/);
    expect(strFromU8(files['docProps/core.xml'])).toContain('రాము కుమార్ — Resume');
  });
});

describe('bold words in Word', () => {
  it('**word** becomes a bold run; no ** anywhere; a stray marker is left out', async () => {
    const data = { ...structuredClone(INITIAL), hidden: {}, personal: { ...INITIAL.personal, headline: 'Data **Analyst**' }, summary: 'Analyst who built **Power BI** dashboards.\n**Second** line', exp: [{ ...INITIAL.exp[0], description: 'Cut costs by **20%** using SQL\nA stray ** marker' }] };
    const files = unzipSync(new Uint8Array(await (await buildDocx({ data, design: DEFAULT_DESIGN, cover: null, photoPng: null })).arrayBuffer()));
    const xml = strFromU8(files['word/document.xml']);
    expect(xml).not.toContain('**');
    const runOf = (t) => xml.match(new RegExp(`<w:r><w:rPr>((?:(?!</w:rPr>).)*)</w:rPr><w:t xml:space="preserve">${t}</w:t></w:r>`))?.[1] || '';
    expect(runOf('Power BI')).toContain('<w:b/>');
    expect(runOf('20%')).toContain('<w:b/>');
    expect(runOf('Second')).toContain('<w:b/>');
    expect(runOf('Analyst who built ')).not.toContain('<w:b/>');
    expect(runOf(' using SQL')).not.toContain('<w:b/>');
    expect(xml).toContain('A stray marker');
    expect(xml).toContain('Data Analyst');
  });
});
