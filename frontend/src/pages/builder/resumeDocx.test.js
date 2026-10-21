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
