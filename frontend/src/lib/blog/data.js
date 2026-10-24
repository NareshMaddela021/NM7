// The blog in the browser. The build's data is the primary source: the data the pre-rendered page carries, then
// the same-origin /blog/data.json and /blog/<slug>/post.json. Hygraph's CDN is only asked when that list is missing,
// empty or over 10 minutes old, and its answer is MERGED in by slug: it can add newer posts, never remove or hide
// the built ones (a stale CDN answer once said `posts: []` while 30 posts were published).
import { fetchBlog, fetchPost, summary } from './hygraph';

let embedded;
function pageData() {
  if (embedded !== undefined) return embedded;
  try { embedded = JSON.parse(document.getElementById('nm7-blog-data')?.textContent || 'null'); } catch { embedded = null; }
  return embedded;
}
async function staticJson(path) {
  try {
    const r = await fetch(path, { headers: { Accept: 'application/json' } });
    if (!r.ok || !(r.headers.get('content-type') || '').includes('json')) return null;
    return await r.json();
  } catch { return null; }
}

let index = null;
/** What the build saw: { builtAt, posts (newest first, without bodies), categories }; the live list if there is none. */
export function getIndex() {
  index ||= (async () => {
    const d = pageData();
    if (Array.isArray(d?.posts) && d?.categories) return { builtAt: d.builtAt, posts: d.posts, categories: d.categories };
    const j = await staticJson('/blog/data.json');
    if (Array.isArray(j?.posts)) return j;
    return liveIndex();
  })().catch((e) => { index = null; throw e; });
  return index;
}

const STALE_MS = 10 * 60 * 1000;
/** A missed or old build must never hide posts: no posts, no date, or built over 10 minutes ago → ask Hygraph too. */
export const needsLive = (idx, now = Date.now()) => !idx?.live && (!idx?.posts?.length || !idx.builtAt || now - Date.parse(idx.builtAt) > STALE_MS);

let live = null;
/** The list straight from Hygraph's CDN (cache-busted, see hygraph.js). */
export function liveIndex() {
  live ||= fetchBlog({ cacheBust: true }).then((b) => ({ live: true, posts: b.posts.map(summary), categories: b.categories })).catch((e) => { live = null; throw e; });
  return live;
}

const bySlug = (list) => new Map((list || []).map((x) => [x.slug, x]));
const newestFirst = (a, b) => String(b.publishedAt || '').localeCompare(String(a.publishedAt || ''));
/** The built list plus whatever the live list adds (by slug). Never fewer posts or categories than were built. */
export function mergeIndex(built, fresh) {
  if (!fresh?.posts) return built;
  if (!built?.posts?.length) return { ...fresh, categories: fresh.categories?.length ? fresh.categories : built?.categories || [] };
  const posts = bySlug(built.posts);
  for (const p of fresh.posts) if (!posts.has(p.slug)) posts.set(p.slug, p);
  const cats = bySlug(built.categories);
  for (const c of fresh.categories || []) if (!cats.has(c.slug)) cats.set(c.slug, c);
  return { ...built, live: true, posts: [...posts.values()].sort(newestFirst), categories: [...cats.values()] };
}
/** The best list we can get: the built one, topped up from Hygraph when it is empty or old. */
export async function freshIndex() {
  let built = null;
  try { built = await getIndex(); } catch { /* no built list: live only */ }
  if (built && !needsLive(built)) return built;
  try { return mergeIndex(built, await liveIndex()); } catch (e) { if (built) return built; throw e; }
}

const posts = new Map();
/** The full post, or null when there is no published post with this slug. */
export async function getPost(slug) {
  if (posts.has(slug)) return posts.get(slug);
  const d = pageData();
  let p = d?.post?.slug === slug ? d.post : null;
  p ||= await staticJson(`/blog/${encodeURIComponent(slug)}/post.json`);
  if (!p?.slug) {
    try {
      p = await fetchPost(slug, { cacheBust: true }); // published after the last build?
      // a live "no such post" never beats the build: if the built list has it, this is a CDN hiccup, not a 404
      if (!p && (d?.posts || (await staticJson('/blog/data.json'))?.posts || []).some((x) => x.slug === slug)) throw new Error('Hygraph didn’t return a post the build has');
    } catch (e) {
      // Hygraph unreachable: if the built list is here and doesn't have it, there is no such post
      const built = d?.posts ? d : await staticJson('/blog/data.json');
      if (Array.isArray(built?.posts) && !built.posts.some((x) => x.slug === slug)) p = null;
      else throw e;
    }
  }
  posts.set(slug, p);
  return p;
}
