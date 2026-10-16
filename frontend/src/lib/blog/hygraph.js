// Reading the blog from Hygraph's public Content API (read-only, published content only, no token).
// Plain JS: used in the browser and by the build-time pre-render (scripts/prerender-blog.mjs).
// Rich text is read as `content { raw }` (Hygraph's AST; there is no `json` field) and rendered by ./richtext.js —
// never from the `html` field, so nothing typed into a post reaches the page as HTML.
import { readingTime } from './richtext.js';

// Browser: Hygraph's CDN (fast, cached). Build: the uncached Content API, so a build started by the publish webhook
// sees the post that was just published (the CDN can keep serving its cached answer for the same query for a while).
export const DEFAULT_ENDPOINT = 'https://ap-south-1.cdn.hygraph.com/content/cmup9f6ob0ktu06w8zze56jn9/master';
export const DEFAULT_BUILD_ENDPOINT = 'https://api-ap-south-1.hygraph.com/v2/cmup9f6ob0ktu06w8zze56jn9/master';
const fromEnv = () => {
  try { return import.meta.env?.VITE_HYGRAPH_ENDPOINT; } catch { return undefined; }
};
const env = (k) => (typeof process !== 'undefined' && process.env?.[k]) || '';
export const ENDPOINT = (fromEnv() || env('VITE_HYGRAPH_ENDPOINT') || DEFAULT_ENDPOINT).trim();
/** The endpoint the build reads (HYGRAPH_BUILD_ENDPOINT, else the uncached Content API). */
export const buildEndpoint = () => (env('HYGRAPH_BUILD_ENDPOINT') || DEFAULT_BUILD_ENDPOINT).trim();
export const PER_PAGE = 12;

const POST_FIELDS = `id title slug excerpt publishedAt updatedAt createdAt seoTitle seoDescription
  coverImage { url width height }
  content { raw }
  category { name slug }
  author { name bio photo { url } }`;

// One module, one set of queries: the build and the browser send exactly these.
export const POSTS_QUERY = `query BlogPosts($first: Int!, $skip: Int!) {
  posts(orderBy: publishedAt_DESC, first: $first, skip: $skip) { ${POST_FIELDS} }
}`;
export const CATEGORIES_QUERY = 'query BlogCategories { categories(first: 100) { name slug } }';
export const POST_QUERY = `query Post($slug: String!) { post(where: { slug: $slug }) { ${POST_FIELDS} } }`;

/** A failed Hygraph request, with what the build log needs: HTTP status and the exact GraphQL errors. */
export class HygraphError extends Error {
  constructor(message, { status = 0, errors = [] } = {}) {
    super(message);
    this.status = status;
    this.errors = errors;
  }
}

export async function gql(query, variables, { endpoint = ENDPOINT, fetchImpl = fetch, timeout = 15000 } = {}) {
  const ctl = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const t = ctl && setTimeout(() => ctl.abort(), timeout);
  try {
    let res;
    try {
      res = await fetchImpl(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ query, variables }), signal: ctl?.signal });
    } catch (e) {
      throw new HygraphError(`network error: ${e.cause?.code || e.cause?.message || e.message}`);
    }
    const text = await res.text();
    let body = null;
    try { body = JSON.parse(text); } catch { /* not JSON */ }
    const errors = (body?.errors || []).map((e) => e.message);
    if (!res.ok || errors.length || !body?.data) {
      throw new HygraphError(`HTTP ${res.status}${errors.length ? ` — ${errors.join('; ')}` : body ? '' : ` — ${text.slice(0, 200)}`}`, { status: res.status, errors });
    }
    return body.data;
  } finally { if (t) clearTimeout(t); }
}

/** A post from the API → what the pages use (reading time worked out, dates as ISO strings). */
export function normalizePost(p) {
  const content = p.content?.raw ?? p.content ?? { children: [] }; // Hygraph's Rich Text AST is the `raw` field
  return {
    id: p.id,
    title: p.title || '',
    slug: p.slug,
    excerpt: p.excerpt || '',
    seoTitle: p.seoTitle || '',
    seoDescription: p.seoDescription || '',
    cover: p.coverImage?.url ? { url: p.coverImage.url, width: p.coverImage.width || null, height: p.coverImage.height || null } : null,
    category: p.category?.slug ? { name: p.category.name || p.category.slug, slug: p.category.slug } : null,
    author: p.author?.name ? { name: p.author.name, bio: p.author.bio || '', photo: p.author.photo?.url || null } : null,
    publishedAt: p.publishedAt || p.createdAt || null,
    updatedAt: p.updatedAt || p.publishedAt || null,
    minutes: readingTime(content),
    content,
  };
}
/** What lists need (no body). */
export const summary = ({ content, ...rest }) => rest; // eslint-disable-line no-unused-vars

const newestFirst = (a, b) => String(b.publishedAt || '').localeCompare(String(a.publishedAt || ''));

/** Every published post, newest first (all pages of 100). */
export async function fetchPosts(opts = {}) {
  const posts = [];
  for (let skip = 0; ; skip += 100) {
    const d = await gql(POSTS_QUERY, { first: 100, skip }, opts);
    if (!Array.isArray(d.posts)) throw new HygraphError('the answer has no `posts` list');
    posts.push(...d.posts.filter((p) => p?.slug).map(normalizePost));
    if (d.posts.length < 100) break;
  }
  return posts.sort(newestFirst);
}
export async function fetchCategories(opts = {}) {
  const d = await gql(CATEGORIES_QUERY, {}, opts);
  if (!Array.isArray(d.categories)) throw new HygraphError('the answer has no `categories` list');
  return d.categories.filter((c) => c?.slug);
}
/** Every published post (newest first) and every category. */
export async function fetchBlog(opts = {}) {
  const [posts, categories] = await Promise.all([fetchPosts(opts), fetchCategories(opts)]);
  return { posts, categories };
}

export async function fetchPost(slug, opts = {}) {
  const d = await gql(POST_QUERY, { slug }, opts);
  return d.post ? normalizePost(d.post) : null;
}

/** Up to `n` other posts from the same category, newest first. */
export function relatedPosts(post, posts, n = 3) {
  if (!post.category) return [];
  return posts.filter((p) => p.slug !== post.slug && p.category?.slug === post.category.slug).slice(0, n);
}

export const fmtDate = (iso) => (iso ? new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata' }) : '');
