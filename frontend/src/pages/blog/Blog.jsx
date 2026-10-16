// The blog: /blog (newest first, 12 at a time), /blog/category/:slug and /blog/:slug, plus the home page strip.
// The build pre-renders these pages as static HTML for search engines (scripts/prerender-blog.mjs); here the app
// takes over with the same markup.
import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import Header from '../../components/Header';
import SiteFooter from '../../components/SiteFooter';
import { Spinner } from '../../components/ui';
import { usePageMeta } from '../../lib/meta';
import { freshIndex, getIndex, getPost, liveIndex, mergeIndex, needsLive } from '../../lib/blog/data';
import { PER_PAGE, fmtDate, relatedPosts } from '../../lib/blog/hygraph';
import { richTextToHtml } from '../../lib/blog/richtext';
import { BLOG_DESC, BLOG_TITLE, categoryMeta, postMeta } from '../../lib/blog/seo';

function useAsync(fn, deps) {
  const [st, setSt] = useState({ loading: true });
  useEffect(() => {
    let off = false;
    setSt({ loading: true });
    fn().then((data) => !off && setSt({ data }), (error) => !off && setSt({ error }));
    return () => { off = true; };
  }, deps); // eslint-disable-line react-hooks/exhaustive-deps
  return st;
}

/** The post list: what the build saw at once; when that is empty or old, topped up (merged by slug) from Hygraph.
 * A live answer never removes built posts, so a stale or empty CDN answer can't turn the page into "coming soon". */
function useBlogIndex() {
  const [st, setSt] = useState({ loading: true });
  useEffect(() => {
    let off = false;
    getIndex().then((built) => {
      if (off) return;
      setSt({ data: built });
      if (needsLive(built)) liveIndex().then((fresh) => !off && setSt({ data: mergeIndex(built, fresh) }), () => {});
    }, () => liveIndex().then((data) => !off && setSt({ data }), (error) => !off && setSt({ error })));
    return () => { off = true; };
  }, []);
  return st;
}

const Meta = ({ p }) => <span className="blog-meta">{fmtDate(p.publishedAt)} · {p.minutes} min read</span>;
const Chip = ({ c }) => (c ? <span className="badge b-neutral blog-chip">{c.name}</span> : null);
const Cover = ({ p, className, eager }) => (p.cover ? <img className={className} src={p.cover.url} alt="" loading={eager ? undefined : 'lazy'} decoding="async" width={p.cover.width || undefined} height={p.cover.height || undefined} /> : null);

export function PostCard({ p, as: H = 'h2' }) {
  return (
    <article className="blog-card">
      <Link to={`/blog/${p.slug}`}>
        <Cover p={p} className="blog-card-img" />
        <span className="blog-card-body"><Chip c={p.category} /><H className="blog-card-title">{p.title}</H><p className="blog-card-excerpt">{p.excerpt}</p><Meta p={p} /></span>
      </Link>
    </article>
  );
}

function Frame({ children }) {
  return (<><Header /><main id="main" className="container blog">{children}</main><SiteFooter /></>);
}
const Loading = () => <div className="row g12 muted" role="status" style={{ padding: '48px 0' }}><Spinner /> Loading…</div>;
const Failed = () => <div className="card stack g8" role="alert"><strong>We couldn’t load the blog.</strong><span className="muted">Check your internet and try again.</span></div>;

export function BlogNotFound() {
  usePageMeta({ title: 'Page not found', description: 'This page doesn’t exist.', noindex: true });
  return (
    <Frame>
      <div className="stack g16" style={{ padding: '72px 0' }}>
        <h1 className="display h2">This page doesn’t exist.</h1>
        <p className="lead">The article may have moved. See the latest posts instead.</p>
        <Link to="/blog" className="btn btn-ink btn-lg" style={{ alignSelf: 'flex-start' }}>Go to the blog</Link>
      </div>
    </Frame>
  );
}

/** /blog and /blog/category/:slug */
export function BlogList() {
  const { slug } = useParams();
  const st = useBlogIndex();
  const [shown, setShown] = useState(PER_PAGE);
  useEffect(() => setShown(PER_PAGE), [slug]);
  const cat = slug && st.data?.categories.find((c) => c.slug === slug);
  const posts = useMemo(() => (st.data ? st.data.posts.filter((p) => !slug || p.category?.slug === slug) : []), [st.data, slug]);
  const m = cat ? categoryMeta(cat, posts.length) : null;
  usePageMeta(cat ? { title: m.title.replace(/ · Nm7$/, ''), description: m.description, noindex: m.noindex } : { title: BLOG_TITLE, description: BLOG_DESC });
  if (slug && st.data && !cat) return <BlogNotFound />;
  return (
    <Frame>
      <div className="stack g16">
        <h1 className="display h2">{cat ? cat.name : BLOG_TITLE}</h1>
        <p className="lead">{cat ? `Articles on ${cat.name.toLowerCase()}.` : BLOG_DESC}</p>
        {st.data && (
          <nav className="blog-filters" aria-label="Categories">
            <Link to="/blog" aria-current={!slug ? 'page' : undefined}>All</Link>
            {st.data.categories.map((c) => <Link key={c.slug} to={`/blog/category/${c.slug}`} aria-current={slug === c.slug ? 'page' : undefined}>{c.name}</Link>)}
          </nav>
        )}
      </div>
      {st.loading && <Loading />}
      {st.error && <Failed />}
      {st.data && (posts.length === 0
        ? <p className="blog-empty">{cat ? `No articles on ${cat.name.toLowerCase()} yet — first articles coming soon.` : 'First articles coming soon.'}</p>
        : (
          <>
            <div className="blog-grid">{posts.slice(0, shown).map((p) => <PostCard key={p.slug} p={p} />)}</div>
            {posts.length > shown && <button type="button" className="btn btn-outline btn-lg" style={{ alignSelf: 'center' }} onClick={() => setShown(shown + PER_PAGE)}>Load more articles</button>}
          </>
        ))}
    </Frame>
  );
}

/** /blog/:slug */
export function BlogPost() {
  const { slug } = useParams();
  const st = useAsync(async () => {
    const [post, idx] = await Promise.all([getPost(slug), freshIndex().catch(() => null)]);
    return { post, related: post && idx ? relatedPosts(post, idx.posts) : [] };
  }, [slug]);
  const p = st.data?.post;
  const m = p ? postMeta(p) : null;
  usePageMeta(p ? { title: m.title.replace(/ · Nm7$/, ''), description: m.description } : { title: 'Blog', description: BLOG_DESC });
  const html = useMemo(() => (p ? richTextToHtml(p.content) : ''), [p]);
  if (st.data && !p) return <BlogNotFound />;
  return (
    <Frame>
      {st.loading && <Loading />}
      {st.error && <Failed />}
      {p && (
        <>
          <div className="blog-layout">
            <article className="blog-article">
              <nav className="blog-crumbs" aria-label="Breadcrumb"><Link to="/blog">Blog</Link>{p.category && <> / <Link to={`/blog/category/${p.category.slug}`}>{p.category.name}</Link></>}</nav>
              <h1 className="display h2">{p.title}</h1>
              <p className="blog-byline">{p.author ? `${p.author.name} · ` : ''}{fmtDate(p.publishedAt)} · {p.minutes} min read</p>
              <Cover p={p} className="blog-cover" eager />
              {/* safe: richTextToHtml escapes every text and only emits known tags (see lib/blog/richtext.js) */}
              <div className="blog-content" dangerouslySetInnerHTML={{ __html: html }} />
            </article>
            <aside className="blog-cta" aria-label="Free resume scan">
              <strong>Is your resume ATS-ready?</strong>
              <span>See your score and every issue in seconds.</span>
              <Link className="btn btn-ink" to="/">Scan your resume free</Link>
            </aside>
          </div>
          {st.data.related.length > 0 && (
            <section className="blog-related" aria-labelledby="blog-related-h">
              <h2 id="blog-related-h">Related articles</h2>
              <div className="blog-grid">{st.data.related.map((r) => <PostCard key={r.slug} p={r} as="h3" />)}</div>
            </section>
          )}
        </>
      )}
    </Frame>
  );
}

/** Home page: the latest 3 posts, only when there are any. */
export function BlogStrip() {
  const posts = useBlogIndex().data?.posts.slice(0, 3) || [];
  if (!posts.length) return null;
  return (
    <section className="h-pad" aria-labelledby="blog-strip-t">
      <div className="h-wrap stack g24">
        <div className="row between g12" style={{ alignItems: 'flex-end' }}>
          <h2 id="blog-strip-t" className="h-sec-title">From the blog</h2>
          <Link to="/blog">All articles →</Link>
        </div>
        <div className="blog-grid">{posts.map((p) => <PostCard key={p.slug} p={p} as="h3" />)}</div>
      </div>
    </section>
  );
}
