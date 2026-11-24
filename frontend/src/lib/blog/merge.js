// The older articles (Hygraph project "Team Nm7") merged into nm7.si/blog. The API on Render reads them with its own
// read-only token, rebrands them for nm7.si and drops duplicates (backend/app/blog); the build
// (scripts/prerender-blog.mjs) reads them from GET /api/blog/legacy and merges them with the site's own posts here.
// Plain JS, no token anywhere: the browser never talks to that Hygraph project.
import { readingTime } from './richtext.js';

/** A title for spotting duplicates: lower case, letters, marks and digits only (any script). */
export const normTitle = (t) => String(t || '').toLowerCase().replace(/[^\p{L}\p{M}\p{N}]+/gu, ' ').trim();

const when = (p) => String(p.updatedAt || p.publishedAt || '');
const size = (p) => JSON.stringify(p.content || '').length;
/** Is `a` the one to keep over `b`? The newer one; on a tie the site's own post, then the longer one. */
export const better = (a, b) => {
  if (when(a) !== when(b)) return when(a) > when(b);
  if ((a.source === 'legacy') !== (b.source === 'legacy')) return b.source === 'legacy';
  return size(a) >= size(b);
};

const newestFirst = (a, b) => String(b.publishedAt || '').localeCompare(String(a.publishedAt || ''));

/** The site's posts plus the older ones: one post per slug and per title (the better one stays, see `better`).
 * Returns { posts (newest first), aliases: { dropped slug: kept slug } }. */
export function mergePosts(own = [], older = [], olderAliases = {}) {
  const bySlug = new Map();
  const byTitle = new Map();
  const aliases = { ...olderAliases };
  const drop = (gone, kept) => { if (gone.slug !== kept.slug) aliases[gone.slug] = kept.slug; };
  for (const p of [...own, ...older]) {
    if (!p?.slug) continue;
    const key = normTitle(p.title) || p.slug;
    const rival = bySlug.get(p.slug) || byTitle.get(key);
    if (rival) {
      if (!better(p, rival)) { drop(p, rival); continue; }
      bySlug.delete(rival.slug);
      byTitle.delete(normTitle(rival.title) || rival.slug);
      drop(rival, p);
    }
    bySlug.set(p.slug, p);
    byTitle.set(key, p);
  }
  const posts = [...bySlug.values()].sort(newestFirst);
  const live = new Set(posts.map((p) => p.slug));
  for (const [from, to] of Object.entries(aliases)) {
    let end = to;
    for (let i = 0; i < 5 && aliases[end]; i++) end = aliases[end]; // a chain of moves ends at one article
    if (live.has(from) || !live.has(end)) delete aliases[from];
    else aliases[from] = end;
  }
  return { posts, aliases };
}

const OLD_DOMAIN = /(?:www\.)?asuraa\.in(?![\w-])/gi;
/** Every string in a value with "asuraa.in" turned into "nm7.si" (the API already does this; a last safety net). */
export function scrubOldDomain(v) {
  if (typeof v === 'string') return v.replace(OLD_DOMAIN, 'nm7.si');
  if (Array.isArray(v)) return v.map(scrubOldDomain);
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, scrubOldDomain(x)]));
  return v;
}

/** An article from GET /api/blog/legacy -> the post shape the pages use. */
export function normalizeOlder(p) {
  const content = p.content?.children ? p.content : { children: [] };
  return scrubOldDomain({
    id: p.id || p.slug,
    title: p.title || '',
    slug: String(p.slug || '').toLowerCase(),
    excerpt: p.excerpt || '',
    seoTitle: p.seoTitle || '',
    seoDescription: p.seoDescription || '',
    cover: null,
    category: p.category?.slug ? { name: p.category.name || p.category.slug, slug: p.category.slug } : null,
    author: null,
    publishedAt: p.publishedAt || null,
    updatedAt: p.updatedAt || p.publishedAt || null,
    minutes: readingTime(content),
    content,
    faq: Array.isArray(p.faq) ? p.faq.filter((q) => q?.question && q?.answer) : [],
    source: 'legacy',
  });
}

/** Every older article from the API (all pages), or { posts: [] } when the API has no token set. Throws on an error. */
export async function fetchOlder(base, { fetchImpl = fetch, timeout = 90_000, perPage = 200, tries = 2 } = {}) {
  const posts = [];
  let aliases = {};
  let configured = false;
  // one try more: a sleeping free Render service can take most of a minute to wake up and read Hygraph
  const get = async (url, left) => {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), timeout);
    try {
      const res = await fetchImpl(url, { headers: { Accept: 'application/json' }, signal: ctl.signal });
      if (res.status >= 500 && left > 1) return get(url, left - 1);
      return res;
    } catch (e) {
      if (left > 1) return get(url, left - 1);
      throw new Error(`network error: ${e.cause?.code || e.cause?.message || e.message}`);
    } finally { clearTimeout(t); }
  };
  for (let page = 1; page <= 100; page++) {
    const res = await get(`${base.replace(/\/+$/, '')}/api/blog/legacy?content=1&per_page=${perPage}&page=${page}`, tries);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const d = await res.json();
    if (!Array.isArray(d.posts)) throw new Error('the answer has no posts list');
    configured = !!d.configured;
    if (d.error && !d.posts.length && page === 1) throw new Error(`the API could not read Hygraph: ${d.error}`);
    aliases = { ...aliases, ...(d.aliases || {}) };
    posts.push(...d.posts.filter((p) => p?.slug).map(normalizeOlder));
    if (page >= (d.pages || 1)) break;
  }
  return { configured, posts, aliases };
}

/** The categories the posts use, in first-seen order, after the given ones (same slug: the given one wins). */
export function withPostCategories(categories, posts) {
  const all = new Map((categories || []).map((c) => [c.slug, c]));
  for (const p of posts) if (p.category && !all.has(p.category.slug)) all.set(p.category.slug, p.category);
  return [...all.values()];
}
