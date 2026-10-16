// Reading the blog from Hygraph's public Content API (read-only, published content only, no token).
// Plain JS: used in the browser and by the build-time pre-render (scripts/prerender-blog.mjs).
import { readingTime } from './richtext.js';

export const DEFAULT_ENDPOINT = 'https://ap-south-1.cdn.hygraph.com/content/cmup9f6ob0ktu06w8zze56jn9/master';
const fromEnv = () => {
  try { return import.meta.env?.VITE_HYGRAPH_ENDPOINT; } catch { return undefined; }
};
export const ENDPOINT = (fromEnv() || (typeof process !== 'undefined' && process.env?.VITE_HYGRAPH_ENDPOINT) || DEFAULT_ENDPOINT).trim();
export const PER_PAGE = 12;

const POST_FIELDS = `id title slug excerpt publishedAt updatedAt createdAt seoTitle seoDescription
  coverImage { url width height }
  content { json }
  category { name slug }
  author { name bio photo { url } }`;

export const ALL_QUERY = `query Blog($first: Int!, $skip: Int!) {
  posts(orderBy: publishedAt_DESC, first: $first, skip: $skip) { ${POST_FIELDS} }
  categories(first: 100) { name slug }
}`;
export const POST_QUERY = `query Post($slug: String!) { post(where: { slug: $slug }) { ${POST_FIELDS} } }`;

export async function gql(query, variables, { endpoint = ENDPOINT, fetchImpl = fetch, timeout = 15000 } = {}) {
  const ctl = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const t = ctl && setTimeout(() => ctl.abort(), timeout);
  try {
    const res = await fetchImpl(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ query, variables }), signal: ctl?.signal });
    if (!res.ok) throw new Error(`Hygraph answered ${res.status}`);
    const body = await res.json();
    if (body.errors?.length) throw new Error(`Hygraph: ${body.errors.map((e) => e.message).join('; ')}`);
    return body.data;
  } finally { if (t) clearTimeout(t); }
}

/** A post from the API → what the pages use (reading time worked out, dates as ISO strings). */
export function normalizePost(p) {
  const content = p.content?.json ?? p.content?.raw ?? p.content ?? { children: [] };
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

/** Every published post (newest first) and every category. */
export async function fetchBlog(opts = {}) {
  const posts = [];
  let categories = [];
  for (let skip = 0; ; skip += 100) {
    const d = await gql(ALL_QUERY, { first: 100, skip }, opts);
    categories = d.categories || categories;
    posts.push(...(d.posts || []).filter((p) => p?.slug).map(normalizePost));
    if ((d.posts || []).length < 100) break;
  }
  return { posts: posts.sort(newestFirst), categories: categories.filter((c) => c?.slug) };
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
