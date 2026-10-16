// Hygraph Rich Text (the `content { json }` AST) → safe HTML, plain text and reading time.
// Used by the browser and by the build-time pre-render (plain JS, no JSX). Every piece of text is escaped and
// only known node types become tags, so HTML typed into a post can never reach the page as HTML.

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ESC[c]);

const SITE = /^https?:\/\/(www\.)?nm7\.si(\/|$)/i;
/** Allowed link targets: web, mail, phone and same-site links. Anything else (javascript:, data:, …) is dropped. */
export function safeHref(href) {
  const h = String(href ?? '').trim();
  if (/^(https?:|mailto:|tel:)/i.test(h)) return h;
  if (/^(\/(?!\/)|#)/.test(h)) return h;
  return null;
}
const isExternal = (h) => /^https?:/i.test(h) && !SITE.test(h);
const safeImg = (src) => (/^https:\/\//i.test(String(src ?? '')) ? String(src) : null);

const BLOCK = {
  paragraph: 'p', 'heading-one': 'h2', 'heading-two': 'h2', 'heading-three': 'h3', 'heading-four': 'h4', 'heading-five': 'h5', 'heading-six': 'h6',
  'block-quote': 'blockquote', 'bulleted-list': 'ul', 'numbered-list': 'ol', 'list-item': 'li',
  table: 'table', table_head: 'thead', table_body: 'tbody', table_row: 'tr', table_header_cell: 'th', table_cell: 'td',
};

function leaf(n) {
  let s = esc(n.text).replace(/\n/g, '<br>');
  if (!s) return '';
  if (n.code) s = `<code>${s}</code>`;
  if (n.bold) s = `<strong>${s}</strong>`;
  if (n.italic) s = `<em>${s}</em>`;
  if (n.underline) s = `<u>${s}</u>`;
  return s;
}

function node(n) {
  if (!n || typeof n !== 'object') return '';
  if (typeof n.text === 'string') return leaf(n);
  const inner = () => (n.children || []).map(node).join('');
  switch (n.type) {
    case 'list-item-child': return inner();
    case 'link': {
      const href = safeHref(n.href);
      if (!href) return inner();
      const ext = isExternal(href);
      return `<a href="${esc(href)}"${ext ? ' rel="noopener noreferrer"' : ''}${ext && n.openInNewTab ? ' target="_blank"' : ''}${n.title ? ` title="${esc(n.title)}"` : ''}>${inner()}</a>`;
    }
    case 'image': {
      const src = safeImg(n.src);
      if (!src) return '';
      const size = n.width && n.height ? ` width="${Number(n.width) | 0}" height="${Number(n.height) | 0}"` : '';
      return `<figure><img src="${esc(src)}" alt="${esc(n.altText || n.title || '')}" loading="lazy" decoding="async"${size}>${n.caption ? `<figcaption>${esc(n.caption)}</figcaption>` : ''}</figure>`;
    }
    case 'code-block': return `<pre><code>${(n.children || []).map((c) => esc(c.text ?? '')).join('')}</code></pre>`;
    case 'table': return `<div class="blog-table"><table>${inner()}</table></div>`;
    default: {
      const tag = BLOCK[n.type];
      if (tag) return `<${tag}>${inner()}</${tag}>`;
      return ''; // video, iframe, embeds, custom classes: not shown
    }
  }
}

/** The post body as HTML. Accepts `{ children: [...] }`, the `raw` / `json` field, or an array of nodes. */
export function richTextToHtml(doc) {
  const kids = Array.isArray(doc) ? doc : doc?.children || doc?.json?.children || doc?.raw?.children || [];
  return kids.map(node).join('');
}

export function plainText(doc) {
  const out = [];
  const walk = (n) => { if (!n) return; if (typeof n.text === 'string') out.push(n.text); (n.children || []).forEach(walk); };
  (Array.isArray(doc) ? doc : doc?.children || doc?.json?.children || doc?.raw?.children || []).forEach((n) => { walk(n); out.push(' '); });
  return out.join(' ').replace(/\s+/g, ' ').trim();
}

/** Minutes to read at about 200 words a minute (at least 1). */
export function readingTime(doc) {
  const words = plainText(doc).split(' ').filter(Boolean).length;
  return Math.max(1, Math.round(words / 200));
}
