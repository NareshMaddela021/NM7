// The blog in the browser. First what the build wrote (the data the pre-rendered page carries, /blog/data.json,
// /blog/<slug>/post.json) so the page shows at once; then, when that list is empty or over 10 minutes old, the live
// list from Hygraph's CDN replaces it (posts published after the last build, a build that couldn't reach Hygraph,
// local development).
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
/** The list straight from Hygraph's CDN. */
export function liveIndex() {
  live ||= fetchBlog().then((b) => ({ live: true, posts: b.posts.map(summary), categories: b.categories })).catch((e) => { live = null; throw e; });
  return live;
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
      p = await fetchPost(slug); // published after the last build?
    } catch (e) {
      // Hygraph unreachable: if the built list is here and doesn't have it, there is no such post
      const built = d?.posts ? d : await staticJson('/blog/data.json');
      if (built?.posts && !built.posts.some((x) => x.slug === slug)) p = null;
      else throw e;
    }
  }
  posts.set(slug, p);
  return p;
}
