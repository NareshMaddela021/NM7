// Word (.docx) and pasted text → the same "lines" the resume reader uses.
import { unzipSync, strFromU8 } from 'fflate';

const ent = (s) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');

export function readDocx(buf) {
  let files;
  try { files = unzipSync(new Uint8Array(buf), { filter: (f) => f.name === 'word/document.xml' || f.name === 'word/_rels/document.xml.rels' }); } catch { throw Object.assign(new Error('bad docx'), { code: 'unreadable' }); }
  const xml = files['word/document.xml'] ? strFromU8(files['word/document.xml']) : '';
  if (!xml) throw Object.assign(new Error('bad docx'), { code: 'unreadable' });
  const rels = files['word/_rels/document.xml.rels'] ? strFromU8(files['word/_rels/document.xml.rels']) : '';
  const relUrl = {};
  rels.replace(/<Relationship [^>]*Id="([^"]+)"[^>]*Target="([^"]+)"[^>]*TargetMode="External"/g, (_, id, t) => { relUrl[id] = t; return ''; });
  const links = Object.values(relUrl).filter((u) => /^https?:|^mailto:/i.test(u)).map((url) => ({ url, w: 0 }));
  // Layout signals for the ATS scan: tables, text boxes, multi-column sections, pictures.
  const layout = {
    tables: (xml.match(/<w:tbl>/g) || []).length,
    textBoxes: (xml.match(/<w:txbxContent>/g) || []).length,
    columns: Math.max(1, ...[...xml.matchAll(/<w:cols [^>]*w:num="(\d+)"/g)].map((m) => +m[1])),
    images: (rels.match(/relationships\/image"/g) || []).length,
  };

  const lines = [];
  let y = 0;
  (xml.match(/<w:p[ >][\s\S]*?<\/w:p>/g) || []).forEach((p) => {
    const bullet = /<w:numPr>/.test(p);
    const style = (p.match(/<w:pStyle w:val="([^"]+)"/) || [])[1] || '';
    const ind = +((p.match(/<w:ind [^>]*w:(?:left|start)="(\d+)"/) || [])[1] || 0) / 20;
    const runs = p.match(/<w:r[ >][\s\S]*?<\/w:r>/g) || [];
    let text = '';
    let boldChars = 0;
    let size = 0;
    runs.forEach((r) => {
      const t = (r.match(/<w:t[^>]*>[\s\S]*?<\/w:t>|<w:tab\/>|<w:br\/>/g) || []).map((x) => (x === '<w:tab/>' ? '   ' : x === '<w:br/>' ? '\n' : ent(x.replace(/<[^>]+>/g, '')))).join('');
      if (/<w:b\/>|<w:b w:val="(1|true)"\/>/.test(r)) boldChars += t.length;
      const sz = r.match(/<w:sz w:val="(\d+)"/);
      if (sz) size = Math.max(size, +sz[1] / 2);
      text += t;
    });
    const heading = /heading|title/i.test(style);
    text.split('\n').forEach((t) => {
      const clean = t.replace(/\u00a0/g, ' ').replace(/[ \t]{4,}/g, '   ').trim();
      y += 14;
      if (!clean) { y += 6; return; }
      lines.push({ text: (bullet ? '• ' : '') + clean, parts: clean.split(/\s{3,}/), size: size || (heading ? 14 : 11), bold: heading || boldChars >= clean.length * 0.6, x: ind, textX: ind, y, page: 1 });
    });
  });
  return { lines, links, layout };
}

export function readText(str) {
  const lines = [];
  let y = 0;
  str.replace(/\r/g, '').split('\n').forEach((raw) => {
    y += 14;
    const t = raw.replace(/\t/g, '   ').replace(/\s+$/, '');
    if (!t.trim()) { y += 6; return; }
    const x = (t.match(/^\s*/)[0].length) * 4;
    lines.push({ text: t.trim().replace(/\s{4,}/g, '   '), size: 11, bold: false, x, textX: x, y, page: 1 });
  });
  return { lines, links: [] };
}
