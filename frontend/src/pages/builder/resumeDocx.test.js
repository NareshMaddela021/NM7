import { describe, expect, it } from 'vitest';
import { unzipSync, strFromU8 } from 'fflate';
import { buildDocx } from './resumeDocx';
import { INITIAL } from './schema';
import { DEFAULT_DESIGN, TEMPLATE_PRESETS } from './design';

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

describe('Academic template in Word', () => {
  it('two lines per entry: bold company · location, italic role (type) · dates at the right tab', async () => {
    const data = { ...structuredClone(INITIAL), hidden: {}, exp: [{ company: 'Northwind Retail', role: 'Data Analyst Intern', employmentType: 'Internship', location: 'Hybrid-Hyderabad', from: '2024-04', to: '', current: true, description: 'Built dashboards', links: [] }] };
    const design = { ...DEFAULT_DESIGN, ...TEMPLATE_PRESETS.academic.design };
    const files = unzipSync(new Uint8Array(await (await buildDocx({ data, design, cover: null, photoPng: null })).arrayBuffer()));
    const xml = strFromU8(files['word/document.xml']);
    const runOf = (t) => xml.match(new RegExp(`<w:r><w:rPr>((?:(?!</w:rPr>).)*)</w:rPr><w:t xml:space="preserve">${t.replace(/[()]/g, '\\$&')}</w:t></w:r>`))?.[1] || '';
    expect(runOf('Northwind Retail')).toContain('<w:b/>');
    expect(runOf('Hybrid-Hyderabad')).not.toContain('<w:b/>');
    expect(runOf('Data Analyst Intern (Internship)')).toContain('<w:i/>');
    expect(runOf('Apr 2024 – Present')).toContain('<w:i/>');
    expect(xml).toMatch(/Northwind Retail<\/w:t><\/w:r><w:r><w:tab\/><\/w:r><w:r>.*?Hybrid-Hyderabad/);
    expect(xml).toMatch(/<w:ind w:left="540" w:hanging="220"\/>.*Built dashboards/); // bullets indented under the entry
    expect(xml).toContain('w:ascii="Cambria"');
  });
});

describe('contact links in Word', () => {
  it('phone, email and profiles are working links; icon only keeps the links', async () => {
    const data = { ...structuredClone(INITIAL), hidden: {}, personal: { ...INITIAL.personal, phone: '+91 98765 43210', email: 'saivarsha@example.com' }, links: { ...INITIAL.links, linkedin: 'linkedin.com/in/saivarsha' } };
    for (const mode of ['both', 'text', 'icon']) {
      const files = unzipSync(new Uint8Array(await (await buildDocx({ data: { ...data, contactIcons: mode }, design: { ...DEFAULT_DESIGN, ...TEMPLATE_PRESETS.academic.design }, cover: null, photoPng: null })).arrayBuffer()));
      const rels = strFromU8(files['word/_rels/document.xml.rels']);
      for (const u of ['tel:+919876543210', 'mailto:saivarsha@example.com', 'https://linkedin.com/in/saivarsha']) expect(rels).toContain(`Target="${u}"`);
      const xml = strFromU8(files['word/document.xml']);
      expect(xml).toMatch(/<w:hyperlink r:id="rIdL\d+" w:history="1">(?:(?!<\/w:hyperlink>).)*saivarsha@example\.com/);
    }
  });
});
