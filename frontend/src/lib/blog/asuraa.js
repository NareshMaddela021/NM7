// The asuraa.in blog (Hygraph project "Team Asuraa") as a second source for nm7.si/blog.
//
// OFF unless VITE_BLOG_INCLUDE_ASURAA=1 (Vercel env var, or .env.local). Turn it on in PRODUCTION only on the day
// asuraa.in/blog/* starts 301-redirecting to nm7.si/blog/*: before that, the same posts would be on two domains
// (duplicate content). Turn it on for Preview deployments first to check the posts.
//
// The Team Asuraa schema is different from nm7-blog: model `BlogPost`, Markdown `body`, `category` as plain text,
// `metaDescription`, `faq` JSON. Each post is turned into the same shape normalizePost() returns, so the list, the
// post page, the pre-render, the sitemap and the JSON-LD treat both sources alike. On the way it is rebranded for
// nm7.si (links, byline, brand name: "NM7" / "nm7.si") — the posts in Hygraph are not changed, so asuraa.in keeps showing them as
// they are until its redirects go live.
import { markdownToAst } from './markdown.js';
import { readingTime } from './richtext.js';

export const ASURAA_ENDPOINT = 'https://ap-south-1.cdn.hygraph.com/content/cmtxihlft00uf06v1drejgj89/master';
export const ASURAA_BUILD_ENDPOINT = 'https://api-ap-south-1.hygraph.com/v2/cmtxihlft00uf06v1drejgj89/master';

const env = (k) => {
  let v;
  try { v = import.meta.env?.[k]; } catch { /* not Vite */ }
  return String(v || (typeof process !== 'undefined' && process.env?.[k]) || '').trim();
};
/** Is the asuraa.in blog included? (VITE_BLOG_INCLUDE_ASURAA=1) */
export const asuraaEnabled = () => env('VITE_BLOG_INCLUDE_ASURAA') === '1';
const inBrowser = () => typeof window !== 'undefined' && typeof document !== 'undefined';
/** Browser: the CDN. Build: the uncached Content API (overrides: VITE_ASURAA_HYGRAPH_ENDPOINT / ASURAA_HYGRAPH_BUILD_ENDPOINT). */
export const asuraaEndpoint = () => (inBrowser()
  ? env('VITE_ASURAA_HYGRAPH_ENDPOINT') || ASURAA_ENDPOINT
  : env('ASURAA_HYGRAPH_BUILD_ENDPOINT') || ASURAA_BUILD_ENDPOINT);

/** The read-only Permanent Auth Token for the Team Asuraa project (ASURAA_HYGRAPH_TOKEN). Build only: it is never
 * read in the browser, and it has no VITE_ prefix, so Vite never puts it in the bundle. Needed once the project's
 * public (unauthenticated) read access is switched off to disconnect asuraa.in. Without it, requests go out
 * unauthenticated, which works while public read access is still on. */
export const asuraaToken = () => (inBrowser() ? '' : env('ASURAA_HYGRAPH_TOKEN'));

/** Categories that are not moved to nm7.si: the About Asuraa posts, which describe asuraa.in and must be rewritten
 * for nm7.si by hand (asuraa.in redirects them to the nm7.si home page). The Telugu, Hindi and Tamil guides do move,
 * so every other asuraa.in/blog URL has its twin on nm7.si for the 301 redirect. */
export const EXCLUDED_CATEGORIES = new Set(['About Asuraa']);

const FIELDS = 'id title slug excerpt seoTitle metaDescription category body faq publishedAt updatedAt createdAt';
export const ASURAA_POSTS_QUERY = `query AsuraaPosts($first: Int!, $skip: Int!) {
  blogPosts(orderBy: publishedAt_DESC, first: $first, skip: $skip) { ${FIELDS} }
}`;
export const ASURAA_POST_QUERY = `query AsuraaPost($slug: String!) { blogPost(where: { slug: $slug }) { ${FIELDS} } }`;

/* ---------- rebranding: asuraa.in → nm7.si ---------- */

/** asuraa.in pages → their nm7.si page. A link to an asuraa.in page that has no nm7.si equivalent is dropped (its
 * words stay as plain text) rather than sent to a page that doesn't exist. Edit this table as nm7.si pages launch. */
export const PAGE_MAP = [
  [/^\/blog\/([a-z0-9-]+)\/?$/i, (m) => `/blog/${m[1].toLowerCase()}`],
  [/^\/jobs(\/.*)?$/i, () => '/jobs'],
  [/^\/resume\/reviewer\/?$/i, () => '/'], // the free ATS scan is on the nm7.si home page
  [/^\/?$/, () => '/'],
];
const ASURAA = /^https?:\/\/(www\.)?asuraa\.in(?=\/|$|[?#])/i;

/** The old About Asuraa posts were rewritten for NM7 in Hygraph under new slugs. A link to an old slug — whether it
 * still points at asuraa.in or was already rewritten to nm7.si — goes to the new post (vercel.json also redirects
 * the old URLs). */
export const RENAMED_SLUGS = {
  'what-is-asuraa': 'what-is-nm7',
  'how-to-use-asuraa-to-find-jobs': 'how-to-use-nm7-to-find-jobs',
  'is-asuraa-free-and-how-we-verify-jobs': 'is-nm7-free-and-how-we-verify-jobs',
};
const BLOG_LINK = /^(?:https?:\/\/(?:www\.)?(?:asuraa\.in|nm7\.si))?\/blog\/([a-z0-9-]+)\/?(?:[?#].*)?$/i;

/** An href from an asuraa.in post → the href nm7.si shows, or null to drop the link. */
export function mapHref(href) {
  const h = String(href ?? '').trim();
  const b = BLOG_LINK.exec(h);
  const renamed = b && RENAMED_SLUGS[b[1].toLowerCase()];
  if (renamed) return `/blog/${renamed}`;
  if (!ASURAA.test(h)) return h;
  const path = h.replace(ASURAA, '').replace(/[?#].*$/, '') || '/';
  for (const [re, to] of PAGE_MAP) { const m = re.exec(path); if (m) return to(m); }
  return null;
}

/** Brand words in text. Order matters: the longer names first. The company name AsuraaX AI is kept. */
const BRAND = [
  [/\bAsuraaX AI\b/g, '\uE000'], // protect the company name (a private-use character as a placeholder)
  [/\bthe Asuraa Team\b/g, 'the NM7 Team'],
  [/\bAsuraa Team\b/g, 'NM7 Team'],
  [/\bAsuraaIN\b/g, 'NM7'],
  [/\b(www\.)?asuraa\.in\b/gi, 'nm7.si'],
  [/\bAsuraa(?=['’]s\b)/g, 'NM7'],
  [/\bAsuraa\b/g, 'NM7'],
  [/\uE000/g, 'AsuraaX AI'],
];
export function rebrand(text) {
  let s = String(text ?? '');
  for (const [re, to] of BRAND) s = s.replace(re, to);
  return s;
}

/** The stored body → what nm7.si renders: the "Last updated · By the Asuraa Team" line is dropped (nm7.si prints its
 * own byline), asuraa.in links are mapped (before the brand pass, so URLs are never half-rewritten), then the brand. */
export function cleanBody(body) {
  const lines = String(body ?? '').replace(/\r\n?/g, '\n').split('\n');
  const first = lines.findIndex((l) => l.trim());
  if (first >= 0 && /^\*?\s*Last updated:.*\*?\s*$/i.test(lines[first].trim())) lines.splice(first, 1);
  return lines.join('\n');
}

const slugify = (s) => String(s || '').toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
/** A category name from the Team Asuraa project → the { name, slug } nm7.si uses. */
export const asuraaCategory = (name) => (name ? { name: String(name).trim(), slug: slugify(name) } : null);

/** A Team Asuraa BlogPost → the post shape normalizePost() returns (+ `faq` and `source`). */
export function normalizeAsuraaPost(p) {
  const brandInline = (h) => mapHref(h);
  const content = markdownToAst(rebrandOutsideLinks(cleanBody(p.body)), { mapHref: brandInline });
  const faq = Array.isArray(p.faq) ? p.faq.filter((q) => q?.question && q?.answer).map((q) => ({ question: rebrand(q.question), answer: rebrand(q.answer) })) : [];
  return {
    id: p.id,
    title: rebrand(p.title),
    slug: p.slug,
    excerpt: rebrand(p.excerpt),
    seoTitle: rebrand(p.seoTitle),
    seoDescription: rebrand(p.metaDescription),
    cover: null,
    category: asuraaCategory(p.category),
    author: null, // shown and marked up as the Nm7 Team
    publishedAt: p.publishedAt || p.createdAt || null,
    updatedAt: p.updatedAt || p.publishedAt || null,
    minutes: readingTime(content),
    content,
    faq,
    source: 'asuraa',
  };
}

/** Rebrands the words of a Markdown body but never the inside of a link target `(...)` (those are mapped by mapHref). */
export function rebrandOutsideLinks(md) {
  const parts = String(md).split(/(\]\([^)\s]+(?:\s+"[^"]*")?\))/);
  return parts.map((part, i) => (i % 2 ? part : rebrand(part))).join('');
}

const keep = (p) => p?.slug && !EXCLUDED_CATEGORIES.has(String(p.category || '').trim());

/** Every published post that moves to nm7.si, normalized. `gql` is hygraph.js's request function. */
export async function fetchAsuraaPosts(gql, { endpoint = asuraaEndpoint(), fetchImpl, cacheBust, token = asuraaToken() } = {}) {
  const posts = [];
  for (let skip = 0; ; skip += 100) {
    const d = await gql(ASURAA_POSTS_QUERY, { first: 100, skip }, { endpoint, fetchImpl, cacheBust, token });
    if (!Array.isArray(d.blogPosts)) throw new Error('the asuraa answer has no `blogPosts` list');
    posts.push(...d.blogPosts.filter(keep).map(normalizeAsuraaPost));
    if (d.blogPosts.length < 100) break;
  }
  return posts;
}

export async function fetchAsuraaPost(gql, slug, { endpoint = asuraaEndpoint(), fetchImpl, cacheBust, token = asuraaToken() } = {}) {
  const d = await gql(ASURAA_POST_QUERY, { slug }, { endpoint, fetchImpl, cacheBust, token });
  return keep(d.blogPost) ? normalizeAsuraaPost(d.blogPost) : null;
}

const CATS_QUERY = 'query AsuraaCategories($first: Int!, $skip: Int!) { blogPosts(first: $first, skip: $skip) { slug category } }';
/** The categories of the posts that move (a light query: no bodies). */
export async function fetchAsuraaCategories(gql, { endpoint = asuraaEndpoint(), fetchImpl, cacheBust, token = asuraaToken() } = {}) {
  const seen = new Map();
  for (let skip = 0; ; skip += 100) {
    const d = await gql(CATS_QUERY, { first: 100, skip }, { endpoint, fetchImpl, cacheBust, token });
    if (!Array.isArray(d.blogPosts)) throw new Error('the asuraa answer has no `blogPosts` list');
    for (const p of d.blogPosts.filter(keep)) { const c = asuraaCategory(p.category); if (c && !seen.has(c.slug)) seen.set(c.slug, c); }
    if (d.blogPosts.length < 100) break;
  }
  return [...seen.values()];
}

/** The categories used by these posts, in first-seen order. */
export const asuraaCategories = (posts) => [...new Map(posts.filter((p) => p.category).map((p) => [p.category.slug, p.category])).values()];
