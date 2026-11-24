// Build step (run by vite.config.js after `vite build`): fetches every published post and category from Hygraph and
// writes real HTML pages for search engines and link previews:
//   dist/blog/index.html, dist/blog/<slug>/index.html, dist/blog/category/<slug>/index.html
// each with its own <title>, description, canonical URL, OpenGraph / Twitter tags and JSON-LD, the article in the
// page, plus the data the app uses when it takes over (dist/blog/data.json, dist/blog/<slug>/post.json) and
// dist/sitemap.xml. If Hygraph can't be reached the build still succeeds: a warning is logged, /blog is written
// as an empty shell and the app reads the blog from Hygraph in the browser instead.
// The older articles (Hygraph project "Team Nm7") come from the API on Render (GET /api/blog/legacy at BLOG_API_BASE,
// else VITE_API_BASE), which holds the read-only token, rebrands them and drops duplicates; they are merged in here
// (src/lib/blog/merge.js: one post per slug and per title). Lists are split into pages of PER_PAGE
// (/blog/page/2, /blog/category/<slug>/page/2); an old slug that moved gets a small page sending readers on.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { PER_PAGE, buildEndpoint, fetchCategories, fetchPosts, fmtDate, relatedPosts, summary } from '../src/lib/blog/hygraph.js';
import { esc, faqToHtml, richTextToHtml } from '../src/lib/blog/richtext.js';
import { BLOG_DESC, BLOG_TITLE, ORIGIN, categoryJsonLd, categoryMeta, listJsonLd, listMeta, pagePath, postJsonLd, postMeta } from '../src/lib/blog/seo.js';
import { fetchOlder, mergePosts, scrubOldDomain, withPostCategories } from '../src/lib/blog/merge.js';

/** Where the older articles come from: the API (BLOG_API_BASE, else VITE_API_BASE); empty = not read. */
export const olderBase = () => String(process.env.BLOG_API_BASE || process.env.VITE_API_BASE || '').trim();

/** Pages that are always in the sitemap (the blog adds its own). */
export const STATIC_PAGES = [
  ['/', 'weekly', '1.0'], ['/builder', 'monthly', '0.8'], ['/templates', 'monthly', '0.8'], ['/blog', 'daily', '0.8'], ['/jobs', 'daily', '0.9'], ['/for-companies', 'monthly', '0.6'], ['/contact', 'yearly', '0.4'], ['/for-orgs', 'monthly', '0.7'], ['/partners', 'monthly', '0.5'], ['/pricing', 'monthly', '0.6'],
  ['/terms', 'yearly', '0.3'], ['/privacy', 'yearly', '0.3'], ['/refund-policy', 'yearly', '0.3'], ['/delivery-policy', 'yearly', '0.3'], ['/expert-terms', 'yearly', '0.3'], ['/company-terms', 'yearly', '0.3'],
];

/** JSON safe to put inside a <script> element (no "</script>", no HTML comments). */
const jsonForScript = (v) => JSON.stringify(v).replace(/</g, '\\u003c').replace(/>/g, '\\u003e').replace(/&/g, '\\u0026').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');

/** The built index.html with this page's head tags and content. */
export function page(template, meta, bodyHtml, { jsonLd = [], data = null } = {}) {
  let html = template
    .replace(/<title>[\s\S]*?<\/title>/i, '')
    .replace(/\s*<meta\s+(name="(description|robots|twitter:[^"]*)"|property="(og|article):[^"]*")[^>]*>/gi, '')
    .replace(/\s*<link\s+rel="canonical"[^>]*>/gi, '');
  const tags = [
    `<title>${esc(meta.title)}</title>`,
    `<meta name="description" content="${esc(meta.description)}" />`,
    `<meta name="robots" content="${meta.noindex ? 'noindex, follow' : 'index, follow'}" />`,
    `<link rel="canonical" href="${esc(meta.canonical)}" />`,
    `<meta property="og:type" content="${meta.type}" />`,
    `<meta property="og:title" content="${esc(meta.title)}" />`,
    `<meta property="og:description" content="${esc(meta.description)}" />`,
    `<meta property="og:url" content="${esc(meta.canonical)}" />`,
    `<meta property="og:image" content="${esc(meta.image)}" />`,
    ...(meta.published ? [`<meta property="article:published_time" content="${esc(meta.published)}" />`] : []),
    ...(meta.modified ? [`<meta property="article:modified_time" content="${esc(meta.modified)}" />`] : []),
    '<meta name="twitter:card" content="summary_large_image" />',
    `<meta name="twitter:title" content="${esc(meta.title)}" />`,
    `<meta name="twitter:description" content="${esc(meta.description)}" />`,
    `<meta name="twitter:image" content="${esc(meta.image)}" />`,
    ...jsonLd.map((j) => `<script type="application/ld+json">${jsonForScript(j)}</script>`),
  ].map((t) => `    ${t}`).join('\n');
  html = html.replace('</head>', `${tags}\n  </head>`);
  const dataTag = data ? `\n    <script type="application/json" id="nm7-blog-data">${jsonForScript(data)}</script>` : '';
  return html.replace(/<div id="root"><\/div>/, `<div id="root">${bodyHtml}</div>${dataTag}`);
}

/* ---------- the page content (the same classes the app uses, so nothing jumps when it takes over) ---------- */
const shell = (inner) => `<header class="site-header"><div class="bar"><a href="/" class="logo">Nm7</a><nav class="nav nav-public" aria-label="Main"><a href="/builder">Build a resume</a><a href="/blog">Blog</a></nav></div></header><main id="main" class="container blog">${inner}</main>`;
const meta = (p) => `<span class="blog-meta">${esc(fmtDate(p.publishedAt))} · ${p.minutes} min read</span>`;
const chip = (c) => (c ? `<span class="badge b-neutral blog-chip">${esc(c.name)}</span>` : '');
const cover = (p, cls) => (p.cover ? `<img class="${cls}" src="${esc(p.cover.url)}" alt="" loading="lazy" decoding="async"${p.cover.width && p.cover.height ? ` width="${p.cover.width}" height="${p.cover.height}"` : ''}>` : '');
export const card = (p) => `<article class="blog-card"><a href="/blog/${esc(p.slug)}">${cover(p, 'blog-card-img')}<span class="blog-card-body">${chip(p.category)}<h2 class="blog-card-title">${esc(p.title)}</h2><p class="blog-card-excerpt">${esc(p.excerpt)}</p>${meta(p)}</span></a></article>`;
const filters = (categories, active) => `<nav class="blog-filters" aria-label="Categories"><a href="/blog"${active ? '' : ' aria-current="page"'}>All</a>${categories.map((c) => `<a href="/blog/category/${esc(c.slug)}"${active === c.slug ? ' aria-current="page"' : ''}>${esc(c.name)}</a>`).join('')}</nav>`;
const empty = '<p class="blog-empty">First articles coming soon.</p>';

export const pageCount = (n) => Math.max(1, Math.ceil(n / PER_PAGE));
/** "Newer articles · Page 2 of 5 · Older articles" (links crawlers follow to every article). */
export function pager(base, page, pages) {
  if (pages <= 1) return '';
  const prev = page > 1 ? `<a href="${esc(pagePath(base, page - 1))}" rel="prev">Newer articles</a>` : '';
  const next = page < pages ? `<a href="${esc(pagePath(base, page + 1))}" rel="next">Older articles</a>` : '';
  return `<nav class="blog-pager" aria-label="Pages">${prev}<span>Page ${page} of ${pages}</span>${next}</nav>`;
}

export function listBody(posts, categories, active = null, page = 1) {
  const c = active && categories.find((x) => x.slug === active);
  const head = `<h1 class="display h2">${c ? esc(c.name) : esc(BLOG_TITLE)}</h1><p class="lead">${c ? `Articles on ${esc(c.name.toLowerCase())}.` : esc(BLOG_DESC)}</p>`;
  const shown = posts.slice((page - 1) * PER_PAGE, page * PER_PAGE);
  const base = c ? `/blog/category/${c.slug}` : '/blog';
  return shell(`<div class="stack g16">${head}${filters(categories, active)}</div>${posts.length ? `<div class="blog-grid">${shown.map(card).join('')}</div>${pager(base, page, pageCount(posts.length))}` : empty}`);
}

/** A small page for an old slug: sends the reader (and search engines) to the article it moved to. */
export const movedPage = (to) => `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <title>Moved · Nm7</title>
    <meta name="robots" content="noindex, follow" />
    <link rel="canonical" href="${esc(`${ORIGIN}/blog/${to}`)}" />
    <meta http-equiv="refresh" content="0; url=/blog/${esc(to)}" />
  </head>
  <body><p>This article moved: <a href="/blog/${esc(to)}">read it here</a>.</p></body>
</html>
`;

export function postBody(p, related) {
  const by = `<p class="blog-byline">${p.author ? `${esc(p.author.name)} · ` : ''}${esc(fmtDate(p.publishedAt))} · ${p.minutes} min read</p>`;
  const crumbs = `<nav class="blog-crumbs" aria-label="Breadcrumb"><a href="/blog">Blog</a>${p.category ? ` / <a href="/blog/category/${esc(p.category.slug)}">${esc(p.category.name)}</a>` : ''}</nav>`;
  const art = `<article class="blog-article">${crumbs}<h1 class="display h2">${esc(p.title)}</h1>${by}${p.cover ? `<img class="blog-cover" src="${esc(p.cover.url)}" alt="" decoding="async"${p.cover.width && p.cover.height ? ` width="${p.cover.width}" height="${p.cover.height}"` : ''}>` : ''}<div class="blog-content">${richTextToHtml(p.content)}${faqToHtml(p.faq)}</div></article>`;
  const cta = '<aside class="blog-cta" aria-label="Free resume scan"><strong>Is your resume ATS-ready?</strong><span>See your score and every issue in seconds.</span><a class="btn btn-ink" href="/pricing#scan">Scan your resume free</a></aside>';
  const rel = related.length ? `<section class="blog-related" aria-labelledby="blog-related-h"><h2 id="blog-related-h">Related articles</h2><div class="blog-grid">${related.map(card).join('')}</div></section>` : '';
  return shell(`<div class="blog-layout">${art}${cta}</div>${rel}`);
}

export function sitemap(posts, categories) {
  const url = (loc, extra) => `  <url><loc>${esc(loc)}</loc>${extra}</url>`;
  const used = new Set(posts.map((p) => p.category?.slug).filter(Boolean));
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    ...STATIC_PAGES.map(([p, f, pr]) => url(`${ORIGIN}${p}`, `<changefreq>${f}</changefreq><priority>${pr}</priority>`)),
    ...categories.filter((c) => used.has(c.slug)).map((c) => url(`${ORIGIN}/blog/category/${c.slug}`, '<changefreq>weekly</changefreq><priority>0.5</priority>')),
    ...posts.map((p) => url(`${ORIGIN}/blog/${p.slug}`, `${p.updatedAt ? `<lastmod>${esc(p.updatedAt)}</lastmod>` : ''}<changefreq>monthly</changefreq><priority>0.7</priority>`)),
    '</urlset>',
    '',
  ].join('\n');
}

/** What a post page carries for the app. With a small blog, the whole list too (no extra request); with a large one
 * only the post itself — the list would add hundreds of KB to every page — and the app reads
 * the list from /blog/data.json when it needs it. */
export const EMBED_LIST_MAX = 60;
export const postData = (data, p) => (data.posts.length > EMBED_LIST_MAX ? { builtAt: data.builtAt, post: p } : { ...data, post: p });

const write = (file, text) => { mkdirSync(join(file, '..'), { recursive: true }); writeFileSync(file, text); };
const SLUG = /^[a-z0-9][a-z0-9-]*$/i; // only safe folder names

/** Writes the blog pages and the sitemap into `dist`. Never throws on a Hygraph problem: it logs exactly what went
 * wrong (endpoint, HTTP status, GraphQL errors) for posts and for categories separately. */
export async function prerenderBlog({ dist, endpoint = buildEndpoint(), fetchImpl = globalThis.fetch, log = console, now = Date.now(), apiBase = olderBase(), apiFetch = fetchImpl } = {}) {
  const template = readFileSync(join(dist, 'index.html'), 'utf8');
  const opts = { endpoint, fetchImpl };
  const why = (e) => e.message;
  log.info?.(`[blog] reading Hygraph at ${endpoint}`);
  if (apiBase) log.info?.(`[blog] reading the older articles from ${apiBase}/api/blog/legacy`);
  const [postsRes, catsRes, olderRes] = await Promise.allSettled([fetchPosts(opts), fetchCategories(opts), apiBase ? fetchOlder(apiBase, { fetchImpl: apiFetch }) : Promise.resolve(null)]);
  const older = olderRes.status === 'fulfilled' && olderRes.value ? olderRes.value : { configured: false, posts: [], aliases: {} };
  if (olderRes.status === 'rejected') log.warn(`[blog] WARNING: the older articles could not be read from the API: ${why(olderRes.reason)}. Only the blog's own posts were pre-rendered.`);
  else if (olderRes.value && !older.configured) log.info?.('[blog] older articles: off (HYGRAPH_TOKEN is not set on the API)');
  else if (olderRes.value) log.info?.(`[blog] older articles: ${older.posts.length}`);
  if (postsRes.status === 'fulfilled') log.info?.(`[blog] posts: ${postsRes.value.length} published (${postsRes.value.map((p) => p.slug).join(', ') || 'none'})`);
  else log.warn(`[blog] WARNING: the posts query failed: ${why(postsRes.reason)}. No articles were pre-rendered; /blog/data.json says posts: null so the site reads Hygraph in the browser.`);
  if (catsRes.status === 'fulfilled') log.info?.(`[blog] categories: ${catsRes.value.length} (${catsRes.value.map((c) => c.slug).join(', ') || 'none'})`);
  else log.warn(`[blog] WARNING: the categories query failed: ${why(catsRes.reason)}. Category pages were not written.`);

  // the blog's own posts must have come through; the older ones alone still make a blog when they did not
  const ok = postsRes.status === 'fulfilled' || older.posts.length > 0;
  const own = postsRes.status === 'fulfilled' ? postsRes.value : [];
  const merged = mergePosts(own, older.posts, older.aliases);
  const all = merged.posts.map(scrubOldDomain);
  if (older.posts.length) log.info?.(`[blog] merged: ${own.length} own + ${older.posts.length} older = ${all.length} articles (${Object.keys(merged.aliases).length} old slugs point to another article)`);
  const posts = all.filter((p) => SLUG.test(p.slug));
  const skipped = all.filter((p) => !SLUG.test(p.slug));
  if (skipped.length) log.warn(`[blog] WARNING: skipped posts whose slug isn’t a-z, 0-9 and dashes: ${skipped.map((p) => JSON.stringify(p.slug)).join(', ')}`);
  const categories = withPostCategories(catsRes.status === 'fulfilled' ? catsRes.value : [], older.posts).filter((c) => SLUG.test(c.slug));
  const live = new Set(posts.map((p) => p.slug));
  const aliases = Object.fromEntries(Object.entries(merged.aliases).filter(([from, to]) => SLUG.test(from) && live.has(to)));
  const list = posts.map(summary);
  const builtAt = new Date(now).toISOString();
  const data = ok ? { builtAt, posts: list, categories, ...(Object.keys(aliases).length ? { aliases } : {}) } : null;
  // a big list is not put into every list page (hundreds of KB); the app reads /blog/data.json instead
  const listData = data && data.posts.length <= EMBED_LIST_MAX ? data : null;
  const pages = (n) => Array.from({ length: pageCount(n) }, (_, i) => i + 1);

  for (const n of ok ? pages(posts.length) : [1]) {
    const file = n > 1 ? join(dist, 'blog', 'page', String(n), 'index.html') : join(dist, 'blog', 'index.html');
    write(file, page(template, listMeta(n), ok ? listBody(posts, categories, null, n) : shell(''), { jsonLd: listJsonLd(), data: listData }));
  }
  // always there (no 404): `posts: null` tells the app to read the blog from Hygraph itself
  write(join(dist, 'blog', 'data.json'), JSON.stringify(data || { builtAt, posts: null, categories: categories.length ? categories : null }));
  if (ok) {
    for (const c of categories) {
      const mine = posts.filter((p) => p.category?.slug === c.slug);
      for (const n of pages(mine.length)) {
        const dir = n > 1 ? join(dist, 'blog', 'category', c.slug, 'page', String(n)) : join(dist, 'blog', 'category', c.slug);
        write(join(dir, 'index.html'), page(template, categoryMeta(c, mine.length, n), listBody(mine, categories, c.slug, n), { jsonLd: categoryJsonLd(c), data: listData }));
      }
    }
    for (const [from, to] of Object.entries(aliases)) write(join(dist, 'blog', from, 'index.html'), movedPage(to));
    for (const p of posts) {
      const related = relatedPosts(p, posts);
      write(join(dist, 'blog', p.slug, 'index.html'), page(template, postMeta(p), postBody(p, related), { jsonLd: postJsonLd(p), data: postData(data, p) }));
      write(join(dist, 'blog', p.slug, 'post.json'), JSON.stringify(p));
    }
  }
  write(join(dist, 'sitemap.xml'), sitemap(posts, categories));
  log.info?.(`[blog] ${ok ? `pre-rendered ${posts.length} post${posts.length === 1 ? '' : 's'} and ${categories.length} categories` : 'no posts pre-rendered'}; sitemap written`);
  return { ok, posts: posts.length, older: older.posts.length, aliases: Object.keys(aliases).length, categories: categories.length, postsError: postsRes.status === 'fulfilled' ? null : postsRes.reason.message, categoriesError: catsRes.status === 'fulfilled' ? null : catsRes.reason.message, olderError: olderRes.status === 'rejected' ? olderRes.reason.message : null };
}

export { PER_PAGE };
