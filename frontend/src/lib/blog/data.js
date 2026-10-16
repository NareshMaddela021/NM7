// The blog in the browser. In order: the data the pre-rendered page carries, the build's JSON files
// (/blog/data.json, /blog/<slug>/post.json), then Hygraph itself (new posts before the next rebuild, a build that
// couldn't reach Hygraph, local development).
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
/** { posts (newest first, without bodies), categories } */
export function getIndex() {
  index ||= (async () => {
    const d = pageData();
    if (d?.posts && d?.categories) return { posts: d.posts, categories: d.categories };
    const j = await staticJson('/blog/data.json');
    if (j?.posts) return j;
    const live = await fetchBlog();
    return { posts: live.posts.map(summary), categories: live.categories };
  })().catch((e) => { index = null; throw e; });
  return index;
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
