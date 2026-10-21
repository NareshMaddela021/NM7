// Build step (run by vite.config.js after `vite build`): fetches every published post and category from Hygraph and
// writes real HTML pages for search engines and link previews:
//   dist/blog/index.html, dist/blog/<slug>/index.html, dist/blog/category/<slug>/index.html
// each with its own <title>, description, canonical URL, OpenGraph / Twitter tags and JSON-LD, the article in the
// page, plus the data the app uses when it takes over (dist/blog/data.json, dist/blog/<slug>/post.json) and
// dist/sitemap.xml. If Hygraph can't be reached the build still succeeds: a warning is logged, /blog is written
// as an empty shell and the app reads the blog from Hygraph in the browser instead.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { PER_PAGE, buildEndpoint, fetchCategories, fetchPosts, fmtDate, relatedPosts, summary } from '../src/lib/blog/hygraph.js';
import { esc, richTextToHtml } from '../src/lib/blog/richtext.js';
import { BLOG_DESC, BLOG_TITLE, ORIGIN, categoryJsonLd, categoryMeta, listJsonLd, listMeta, postJsonLd, postMeta } from '../src/lib/blog/seo.js';

/** Pages that are always in the sitemap (the blog adds its own). */
export const STATIC_PAGES = [
  ['/', 'weekly', '1.0'], ['/builder', 'monthly', '0.8'], ['/blog', 'daily', '0.8'], ['/contact', 'yearly', '0.4'], ['/for-orgs', 'monthly', '0.7'], ['/partners', 'monthly', '0.5'],
  ['/terms', 'yearly', '0.3'], ['/privacy', 'yearly', '0.3'], ['/refund-policy', 'yearly', '0.3'], ['/delivery-policy', 'yearly', '0.3'], ['/expert-terms', 'yearly', '0.3'],
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

export function listBody(posts, categories, active = null) {
  const c = active && categories.find((x) => x.slug === active);
  const head = `<h1 class="display h2">${c ? esc(c.name) : esc(BLOG_TITLE)}</h1><p class="lead">${c ? `Articles on ${esc(c.name.toLowerCase())}.` : esc(BLOG_DESC)}</p>`;
  return shell(`<div class="stack g16">${head}${filters(categories, active)}</div>${posts.length ? `<div class="blog-grid">${posts.map(card).join('')}</div>` : empty}`);
}

export function postBody(p, related) {
  const by = `<p class="blog-byline">${p.author ? `${esc(p.author.name)} · ` : ''}${esc(fmtDate(p.publishedAt))} · ${p.minutes} min read</p>`;
  const crumbs = `<nav class="blog-crumbs" aria-label="Breadcrumb"><a href="/blog">Blog</a>${p.category ? ` / <a href="/blog/category/${esc(p.category.slug)}">${esc(p.category.name)}</a>` : ''}</nav>`;
  const art = `<article class="blog-article">${crumbs}<h1 class="display h2">${esc(p.title)}</h1>${by}${p.cover ? `<img class="blog-cover" src="${esc(p.cover.url)}" alt="" decoding="async"${p.cover.width && p.cover.height ? ` width="${p.cover.width}" height="${p.cover.height}"` : ''}>` : ''}<div class="blog-content">${richTextToHtml(p.content)}</div></article>`;
  const cta = '<aside class="blog-cta" aria-label="Free resume scan"><strong>Is your resume ATS-ready?</strong><span>See your score and every issue in seconds.</span><a class="btn btn-ink" href="/">Scan your resume free</a></aside>';
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

const write = (file, text) => { mkdirSync(join(file, '..'), { recursive: true }); writeFileSync(file, text); };
const SLUG = /^[a-z0-9][a-z0-9-]*$/i; // only safe folder names

/** Writes the blog pages and the sitemap into `dist`. Never throws on a Hygraph problem: it logs exactly what went
 * wrong (endpoint, HTTP status, GraphQL errors) for posts and for categories separately. */
export async function prerenderBlog({ dist, endpoint = buildEndpoint(), fetchImpl = globalThis.fetch, log = console, now = Date.now() } = {}) {
  const template = readFileSync(join(dist, 'index.html'), 'utf8');
  const opts = { endpoint, fetchImpl };
  const why = (e) => e.message;
  log.info?.(`[blog] reading Hygraph at ${endpoint}`);
  const [postsRes, catsRes] = await Promise.allSettled([fetchPosts(opts), fetchCategories(opts)]);
  if (postsRes.status === 'fulfilled') log.info?.(`[blog] posts: ${postsRes.value.length} published (${postsRes.value.map((p) => p.slug).join(', ') || 'none'})`);
  else log.warn(`[blog] WARNING: the posts query failed: ${why(postsRes.reason)}. No articles were pre-rendered; /blog/data.json says posts: null so the site reads Hygraph in the browser.`);
  if (catsRes.status === 'fulfilled') log.info?.(`[blog] categories: ${catsRes.value.length} (${catsRes.value.map((c) => c.slug).join(', ') || 'none'})`);
  else log.warn(`[blog] WARNING: the categories query failed: ${why(catsRes.reason)}. Category pages were not written.`);

  const ok = postsRes.status === 'fulfilled';
  const posts = (ok ? postsRes.value : []).filter((p) => SLUG.test(p.slug));
  const skipped = (ok ? postsRes.value : []).filter((p) => !SLUG.test(p.slug));
  if (skipped.length) log.warn(`[blog] WARNING: skipped posts whose slug isn’t a-z, 0-9 and dashes: ${skipped.map((p) => JSON.stringify(p.slug)).join(', ')}`);
  const categories = (catsRes.status === 'fulfilled' ? catsRes.value : []).filter((c) => SLUG.test(c.slug));
  const list = posts.map(summary);
  const builtAt = new Date(now).toISOString();
  const data = ok ? { builtAt, posts: list, categories } : null;

  write(join(dist, 'blog', 'index.html'), page(template, listMeta(), ok ? listBody(posts, categories) : shell(''), { jsonLd: listJsonLd(), data }));
  // always there (no 404): `posts: null` tells the app to read the blog from Hygraph itself
  write(join(dist, 'blog', 'data.json'), JSON.stringify(data || { builtAt, posts: null, categories: categories.length ? categories : null }));
  if (ok) {
    for (const c of categories) {
      const mine = posts.filter((p) => p.category?.slug === c.slug);
      write(join(dist, 'blog', 'category', c.slug, 'index.html'), page(template, categoryMeta(c, mine.length), listBody(mine, categories, c.slug), { jsonLd: categoryJsonLd(c), data }));
    }
    for (const p of posts) {
      const related = relatedPosts(p, posts);
      write(join(dist, 'blog', p.slug, 'index.html'), page(template, postMeta(p), postBody(p, related), { jsonLd: postJsonLd(p), data: { ...data, post: p } }));
      write(join(dist, 'blog', p.slug, 'post.json'), JSON.stringify(p));
    }
  }
  write(join(dist, 'sitemap.xml'), sitemap(posts, categories));
  log.info?.(`[blog] ${ok ? `pre-rendered ${posts.length} post${posts.length === 1 ? '' : 's'} and ${categories.length} categories` : 'no posts pre-rendered'}; sitemap written`);
  return { ok, posts: posts.length, categories: categories.length, postsError: ok ? null : postsRes.reason.message, categoriesError: catsRes.status === 'fulfilled' ? null : catsRes.reason.message };
}

export { PER_PAGE };
