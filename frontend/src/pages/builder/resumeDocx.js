// Word (.docx) download for the resume and the cover letter. Built from the same section model as the
// preview and PDF. Word gets one column (safest for tracking systems) and Calibri / Cambria, which every
// Windows and Mac computer has, so the file looks right wherever HR opens it.
import { zipSync, strToU8 } from 'fflate';
import { buildSections } from './resumeModel';
import { visibleResume } from './entries';
import { contactItems } from './ContactLine';
import { iconColor, iconPng } from './icons';
import { FONTS, PAGE, headFontOf, marginOf } from './design';
import { coverParts } from './cover';

const CS_FONT = 'Nirmala UI';
const esc = (t) => String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const hex = (c) => c.replace('#', '').toUpperCase();
const mix = (c, a) => { const n = parseInt(c.replace('#', ''), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => Math.round(v * a + 255 * (1 - a)).toString(16).padStart(2, '0')).join('').toUpperCase(); };
const isNum = (w) => /[\d₹%]/.test(w) && !/^\(?(19|20)\d{2}\)?[.,;:]?$/.test(w);

const b64ToBytes = (dataUrl) => { const bin = atob(dataUrl.split(',')[1]); const u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); return u; };

/** photoPng: the photo already cut to its shape (PNG data URL), or null. */
export async function buildDocx({ data, design: ds, cover, photoPng }) {
  const d = visibleResume(data); // switched-off entries are not printed
  const page = PAGE[ds.pageSize] || PAGE.a4;
  const M = marginOf(ds);
  const contentW = Math.round((page.w - 2 * M) * 20);
  const font = FONTS[ds.font].kind === 'Serif' ? 'Cambria' : 'Calibri';
  const headFont = FONTS[headFontOf(ds)].kind === 'Serif' ? 'Cambria' : 'Calibri';
  const text = hex(ds.textColor);
  const accent = hex(ds.accent);
  const lineCol = ds.accentOn.lines ? accent : 'B8B8B8';
  const bandFill = ds.headerStyle === 'band' ? mix(ds.accent, 0.1) : null;

  // w:cs is the font Word uses for complex-script characters (Telugu, Hindi, Tamil…): Nirmala UI ships with Windows
  // and covers every Indian script; Word for Mac substitutes its own Indic fonts for it. Latin text keeps `font`.
  const run = (t, o = {}) => `<w:r><w:rPr><w:rFonts w:ascii="${o.font || font}" w:hAnsi="${o.font || font}" w:cs="${CS_FONT}"/>${o.b ? '<w:b/>' : ''}${o.i ? '<w:i/>' : ''}${o.caps ? '<w:caps/>' : ''}<w:color w:val="${o.color || text}"/>${o.spacing ? `<w:spacing w:val="${o.spacing}"/>` : ''}<w:sz w:val="${Math.round((o.sz || ds.bodySize) * 2)}"/><w:szCs w:val="${Math.round((o.sz || ds.bodySize) * 2)}"/>${o.u ? '<w:u w:val="single"/>' : ''}</w:rPr><w:t xml:space="preserve">${esc(t)}</w:t></w:r>`;
  const tab = '<w:r><w:tab/></w:r>';
  const P = (runs, o = {}) => {
    const pPr = [
      o.keep ? '<w:keepNext/>' : '',
      o.border ? `<w:pBdr>${o.border}</w:pBdr>` : '',
      o.fill ? `<w:shd w:val="clear" w:color="auto" w:fill="${o.fill}"/>` : '',
      o.tabs ? `<w:tabs>${o.tabs.map(([pos, al]) => `<w:tab w:val="${al}" w:pos="${pos}"/>`).join('')}</w:tabs>` : '',
      `<w:spacing w:before="${Math.round((o.before || 0) * 20)}" w:after="${Math.round((o.after || 0) * 20)}" w:line="${Math.round(ds.lineHeight * 240)}" w:lineRule="auto"/>`,
      o.ind ? `<w:ind w:left="${o.ind[0]}" w:hanging="${o.ind[1] || 0}"/>` : '',
      `<w:jc w:val="${o.align || 'left'}"/>`,
    ].join('');
    return `<w:p><w:pPr>${pPr}</w:pPr>${runs}</w:p>`;
  };
  const out = [];
  const rels = [];
  const hyper = (url, inner) => { rels.push(url); return `<w:hyperlink r:id="rIdL${rels.length}" w:history="1">${inner}</w:hyperlink>`; };
  const linkRuns = (links = []) => links.map((l) => run(' | ', { color: '9A9A9A' }) + hyper(l.url, run(l.label, { u: true, color: ds.accentOn.links ? accent : text }))).join('');

  /* header */
  const pos = photoPng && !cover ? ds.photoPos || 'left' : null;
  const align = pos === 'top' || (!pos && ds.headerAlign === 'center') ? 'center' : 'left';
  if (pos) {
    const E = Math.round((ds.photoSize || 62) * 12700); // EMU
    const geom = ds.photoShape === 'square' ? 'rect' : ds.photoShape === 'rounded' ? 'roundRect' : 'ellipse';
    const bw = { none: 0, thin: 1, thick: 2.5 }[ds.photoBorder || 'none'];
    const ln = bw ? `<a:ln w="${Math.round(bw * 12700)}"><a:solidFill><a:srgbClr val="${ds.photoBorderColor === 'grey' ? 'B8B8B8' : accent}"/></a:solidFill></a:ln>` : '';
    const graphic = `<a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:nvPicPr><pic:cNvPr id="1" name="photo.png"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="rIdPhoto"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${E}" cy="${E}"/></a:xfrm><a:prstGeom prst="${geom}"><a:avLst/></a:prstGeom>${ln}</pic:spPr></pic:pic></a:graphicData></a:graphic>`;
    const drawing = pos === 'top'
      ? `<w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="${E}" cy="${E}"/><wp:docPr id="1" name="Photo"/><wp:cNvGraphicFramePr/>${graphic}</wp:inline></w:drawing></w:r>`
      : `<w:r><w:drawing><wp:anchor distT="0" distB="0" distL="114300" distR="114300" simplePos="0" relativeHeight="251658240" behindDoc="0" locked="0" layoutInCell="1" allowOverlap="1"><wp:simplePos x="0" y="0"/><wp:positionH relativeFrom="margin"><wp:align>${pos}</wp:align></wp:positionH><wp:positionV relativeFrom="paragraph"><wp:posOffset>0</wp:posOffset></wp:positionV><wp:extent cx="${E}" cy="${E}"/><wp:effectExtent l="0" t="0" r="0" b="0"/><wp:wrapSquare wrapText="bothSides"/><wp:docPr id="1" name="Photo"/><wp:cNvGraphicFramePr/>${graphic}</wp:anchor></w:drawing></w:r>`;
    if (pos === 'top') out.push(P(drawing, { align: 'center', after: 4 }));
    else out.push(`<w:p><w:pPr><w:spacing w:before="0" w:after="0" w:line="20" w:lineRule="exact"/></w:pPr>${drawing}</w:p>`);
  }
  out.push(P(run(d.personal.name || 'Your Name', { b: true, sz: ds.nameSize, font: headFont, color: ds.accentOn.name ? accent : text }), { align, fill: bandFill, before: bandFill ? 6 : 0 }));
  if (d.personal.headline) out.push(P(run(d.personal.headline, { sz: ds.bodySize + 1.5, color: ds.accentOn.name ? accent : '444444' }), { align, fill: bandFill, before: 2 }));
  const rows = contactItems(d, ds.contactLines, 'url');
  // small logo / icon before each contact item (inline pictures)
  const media = {};
  if (ds.icons) {
    const mono = ds.accentOn.links || ds.accentOn.headings ? ds.accent : '#444444';
    await Promise.all([...new Set(rows.flat().map((it) => it.kind))].map(async (k) => {
      try { media[k] = await iconPng(k, iconColor(k, ds, mono), 64); } catch { /* skip icon */ }
    }));
  }
  const iconIds = Object.keys(media);
  const iconEmu = Math.round((ds.bodySize - 1) * 1.05 * 12700);
  const iconRun = (k) => {
    const n = iconIds.indexOf(k);
    if (n < 0) return '';
    return `<w:r><w:rPr><w:position w:val="-3"/></w:rPr><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="${iconEmu}" cy="${iconEmu}"/><wp:docPr id="${100 + n}" name="icon${n}"/><wp:cNvGraphicFramePr/><a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:nvPicPr><pic:cNvPr id="${100 + n}" name="icon${n}.png"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="rIdIcon${n}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${iconEmu}" cy="${iconEmu}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r>`;
  };
  rows.forEach((items, i) => {
    const last = i === rows.length - 1;
    const border = last && !bandFill && ds.headerStyle !== 'none' ? `<w:bottom w:val="single" w:sz="${ds.accentOn.lines ? 12 : 6}" w:space="6" w:color="${ds.accentOn.lines ? accent : 'CFCFCF'}"/>` : '';
    out.push(P(items.map((it, j) => (j ? run('  |  ', { color: '999999', sz: ds.bodySize - 1 }) : '') + iconRun(it.kind) + (media[it.kind] ? run(' ', { sz: ds.bodySize - 1 }) : '') + run(it.text, { sz: ds.bodySize - 1, color: it.link && ds.accentOn.links ? accent : '4A4A4A' })).join(''), { align, fill: bandFill, border, before: 2, after: last ? (bandFill ? 6 : 4) : 0 }));
  });

  const heading = (title) => {
    const o = { b: true, sz: ds.headSize, font: headFont, color: ds.accentOn.headings ? accent : text, caps: true, spacing: ds.headingStyle === 'caps' ? 30 : 10 };
    const p = { before: ds.sectionGap, after: 4, keep: true };
    if (ds.headingStyle === 'underline' || ds.headingStyle === 'rule') p.border = `<w:bottom w:val="single" w:sz="6" w:space="2" w:color="${lineCol}"/>`;
    if (ds.headingStyle === 'bar') p.fill = mix(ds.accentOn.lines ? ds.accent : '#777777', 0.12);
    if (ds.headingStyle === 'left') p.border = `<w:left w:val="single" w:sz="18" w:space="6" w:color="${lineCol}"/>`;
    out.push(P(run(title.toUpperCase(), o), p));
  };
  const rich = (t) => (ds.boldNumbers ? t.split(/(\s+)/).map((w) => (w ? run(w, { b: isNum(w) }) : '')).join('') : run(t));
  const bullet = ds.bullet === 'none' ? '' : ds.bullet === '▸' ? '›' : ds.bullet;

  const line = (l) => {
    if (typeof l === 'string') return out.push(P(run(l), { after: 1 }));
    if (l.bullet) return out.push(bullet ? P(run(bullet) + tab + rich(l.t), { ind: [300, 220], tabs: [[300, 'left']], after: 1 }) : P(rich(l.t), { after: 1 }));
    if (l.chips) return out.push(P((l.label ? run(`${l.label}: `, { b: true }) : '') + run(l.chips.join(', ')), { after: 1 }));
    if (l.kv) return out.push(P(run(l.kv[0]) + tab + run(`:  ${l.kv[1].replace(/\n/g, ', ')}`), { tabs: [[Math.round(ds.bodySize * 9.5 * 20), 'left']], after: 1 }));
    if (l.sign) {
      l.sign.left.forEach((t, i) => {
        const last = i === l.sign.left.length - 1;
        out.push(P(run(t) + (last && l.sign.right ? tab + run(l.sign.right, { b: true }) : ''), { tabs: [[contentW, 'right']], before: i === 0 ? ds.bodySize : 0 }));
      });
      return undefined;
    }
    return out.push(P(run(`${l.bold} `, { b: true }) + run(l.text), { after: 1 }));
  };

  if (cover) {
    const c = coverParts(d, cover);
    out.push(P(run(c.date), { before: 8, after: ds.bodySize }));
    c.to.forEach((t) => out.push(P(run(t))));
    if (c.subject) out.push(P(run(c.subject, { b: true }), { before: ds.bodySize }));
    out.push(P(run(c.greeting), { before: ds.bodySize, after: ds.bodySize * 0.6 }));
    c.body.forEach((p) => out.push(P(run(p), { after: ds.bodySize * 0.8, align: 'both' })));
    out.push(P(run(c.close), { before: ds.bodySize }));
    out.push(P(run(c.name, { b: true }), { before: 4 }));
  } else {
    const { main } = buildSections(d, { ...ds, layout: 'one' });
    main.forEach((sec) => {
      heading(sec.title);
      sec.items.forEach((it, i) => {
        const before = i ? ds.itemGap : 0;
        if (it.head || it.date) {
          out.push(P(run(it.head || '', { b: true }) + linkRuns(it.links) + (it.date ? tab + run(it.date, { color: '5A5A5A', sz: ds.bodySize - 0.5 }) : ''), { tabs: [[contentW, 'right']], before, keep: true }));
        }
        if (it.sub) out.push(P(run(it.sub, { i: true, color: '5A5A5A' }), { before: it.head ? 0 : before }));
        (it.lines || []).forEach(line);
      });
    });
  }

  const body = `${out.join('')}<w:sectPr><w:pgSz w:w="${Math.round(page.w * 20)}" w:h="${Math.round(page.h * 20)}"/><w:pgMar w:top="${Math.round(M * 20)}" w:right="${Math.round(M * 20)}" w:bottom="${Math.round(M * 20)}" w:left="${Math.round(M * 20)}" w:header="0" w:footer="0" w:gutter="0"/></w:sectPr>`;
  const files = {
    '[Content_Types].xml': strToU8('<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="png" ContentType="image/png"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/></Types>'),
    '_rels/.rels': strToU8('<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/></Relationships>'),
    'docProps/core.xml': strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>${esc(`${d.personal.name || ''} — ${cover ? 'Cover letter' : 'Resume'}`)}</dc:title><dc:creator>${esc(d.personal.name || '')}</dc:creator></cp:coreProperties>`),
    'word/_rels/document.xml.rels': strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${rels.map((u, i) => `<Relationship Id="rIdL${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="${esc(u)}" TargetMode="External"/>`).join('')}${pos ? '<Relationship Id="rIdPhoto" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/photo.png"/>' : ''}${iconIds.map((k, n) => `<Relationship Id="rIdIcon${n}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/icon${n}.png"/>`).join('')}</Relationships>`),
    'word/document.xml': strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing"><w:body>${body}</w:body></w:document>`),
  };
  if (pos) files['word/media/photo.png'] = b64ToBytes(photoPng);
  iconIds.forEach((k, n) => { files[`word/media/icon${n}.png`] = b64ToBytes(media[k]); });
  return new Blob([zipSync(files)], { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' });
}
