// Markdown → the same Rich Text AST Hygraph's `content { raw }` returns, so ./richtext.js renders it with the same
// escaping and the same allow-list of tags. Used for posts whose body is stored as Markdown text (the asuraa.in blog
// in the Team Asuraa Hygraph project). Plain JS: used in the browser and by the build-time pre-render.
//
// Supported: # headings, paragraphs, - / * / 1. lists (nested by indentation), > quotes, ``` code blocks, | tables,
// **bold**, *italic* / _italic_, `code`, [links](url). Anything else is kept as plain text — never as HTML.

const t = (text, marks = {}) => ({ text, ...marks });

/** Inline Markdown → leaves and link nodes. `mapHref(href)` may rewrite a link or return null to drop it (text stays). */
export function inline(src, mapHref = (h) => h, marks = {}) {
  const out = [];
  let buf = '';
  const flush = () => { if (buf) { out.push(t(buf, marks)); buf = ''; } };
  let i = 0;
  while (i < src.length) {
    const rest = src.slice(i);
    let m;
    if (rest[0] === '\\' && rest.length > 1 && /[\\`*_[\]()#|>-]/.test(rest[1])) { buf += rest[1]; i += 2; continue; }
    if ((m = /^`([^`]+)`/.exec(rest))) { flush(); out.push(t(m[1], { ...marks, code: true })); i += m[0].length; continue; }
    if ((m = /^\[([^\]]+)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/.exec(rest))) {
      flush();
      const href = mapHref(m[2]);
      const kids = inline(m[1], mapHref, marks);
      if (href) out.push({ type: 'link', href, children: kids });
      else out.push(...kids);
      i += m[0].length;
      continue;
    }
    if ((m = /^(\*\*|__)(?=\S)([\s\S]*?\S)\1/.exec(rest))) { flush(); out.push(...inline(m[2], mapHref, { ...marks, bold: true })); i += m[0].length; continue; }
    if ((m = /^\*(?=\S)([^*]*?\S)\*/.exec(rest)) || (m = /^_(?=\S)([^_]*?\S)_(?![A-Za-z0-9])/.exec(rest))) {
      if (rest[0] === '_' && /[A-Za-z0-9]$/.test(buf)) { buf += '_'; i += 1; continue; } // snake_case stays text
      flush(); out.push(...inline(m[1], mapHref, { ...marks, italic: true })); i += m[0].length; continue;
    }
    buf += rest[0];
    i += 1;
  }
  flush();
  return out.length ? out : [t('', marks)];
}

const HEADING = ['heading-one', 'heading-two', 'heading-three', 'heading-four', 'heading-five', 'heading-six'];
const LIST = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/;
const indentOf = (s) => s.replace(/\t/g, '    ').match(/^ */)[0].length;
const isRow = (s) => /^\s*\|.*\|\s*$/.test(s);
const isSep = (s) => /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/.test(s);
const cells = (s) => s.trim().replace(/^\|/, '').replace(/\|$/, '').split(/(?<!\\)\|/).map((c) => c.trim().replace(/\\\|/g, '|'));

function list(lines, start, mapHref) {
  const base = indentOf(lines[start]);
  const ordered = /\d/.test(LIST.exec(lines[start])[2]);
  const items = [];
  let i = start;
  while (i < lines.length) {
    const m = LIST.exec(lines[i]);
    if (!m || indentOf(lines[i]) !== base || /\d/.test(m[2]) !== ordered) break;
    let text = m[3];
    i += 1;
    // continuation lines of this item (indented, not a new item or a blank line)
    while (i < lines.length && lines[i].trim() && !LIST.exec(lines[i]) && indentOf(lines[i]) > base) { text += ` ${lines[i].trim()}`; i += 1; }
    const kids = [{ type: 'list-item-child', children: inline(text, mapHref) }];
    while (i < lines.length && LIST.exec(lines[i]) && indentOf(lines[i]) > base) {
      const sub = list(lines, i, mapHref);
      kids.push(sub.node);
      i = sub.next;
    }
    items.push({ type: 'list-item', children: kids });
    // a single blank line between items of the same list keeps the list going
    if (i + 1 < lines.length && !lines[i]?.trim() && LIST.exec(lines[i + 1]) && indentOf(lines[i + 1]) === base) i += 1;
  }
  return { node: { type: ordered ? 'numbered-list' : 'bulleted-list', children: items }, next: i };
}

/** A Markdown document → `{ children: [...] }` in Hygraph's Rich Text shape. */
export function markdownToAst(md, { mapHref } = {}) {
  const lines = String(md ?? '').replace(/\r\n?/g, '\n').split('\n');
  const out = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) { i += 1; continue; }
    let m;
    if ((m = /^\s*(```|~~~)/.exec(line))) {
      const fence = m[1];
      const code = [];
      i += 1;
      while (i < lines.length && !lines[i].trim().startsWith(fence)) { code.push(lines[i]); i += 1; }
      i += 1;
      out.push({ type: 'code-block', children: [t(code.join('\n'))] });
      continue;
    }
    if ((m = /^(#{1,6})\s+(.*?)\s*#*\s*$/.exec(line))) {
      out.push({ type: HEADING[m[1].length - 1], children: inline(m[2], mapHref) });
      i += 1;
      continue;
    }
    if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(line)) { i += 1; continue; } // horizontal rule: dropped
    if (isRow(line) && i + 1 < lines.length && isSep(lines[i + 1])) {
      const head = cells(line);
      const rows = [];
      i += 2;
      while (i < lines.length && isRow(lines[i])) { rows.push(cells(lines[i])); i += 1; }
      const cell = (type) => (c) => ({ type, children: [{ type: 'paragraph', children: inline(c, mapHref) }] });
      out.push({ type: 'table', children: [
        { type: 'table_head', children: [{ type: 'table_row', children: head.map(cell('table_header_cell')) }] },
        { type: 'table_body', children: rows.map((r) => ({ type: 'table_row', children: head.map((_, k) => cell('table_cell')(r[k] ?? '')) })) },
      ] });
      continue;
    }
    if (/^\s*>/.test(line)) {
      const quote = [];
      while (i < lines.length && /^\s*>/.test(lines[i])) { quote.push(lines[i].replace(/^\s*>\s?/, '')); i += 1; }
      out.push({ type: 'block-quote', children: inline(quote.join(' ').trim(), mapHref) });
      continue;
    }
    if (LIST.test(line)) {
      const l = list(lines, i, mapHref);
      out.push(l.node);
      i = l.next;
      continue;
    }
    const para = [line.trim()];
    i += 1;
    while (i < lines.length && lines[i].trim() && !/^\s*(#{1,6}\s|>|```|~~~)/.test(lines[i]) && !LIST.test(lines[i]) && !(isRow(lines[i]) && isSep(lines[i + 1] || ''))) {
      para.push(lines[i].trim());
      i += 1;
    }
    out.push({ type: 'paragraph', children: inline(para.join(' '), mapHref) });
  }
  return { children: out };
}
