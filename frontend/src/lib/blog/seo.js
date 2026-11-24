// SEO for blog pages: titles, descriptions, canonical URLs and JSON-LD. Shared by the pre-render and the app.
export const ORIGIN = 'https://nm7.si';
export const DEFAULT_IMAGE = `${ORIGIN}/og-image.png`;
const SITE = 'Nm7';

export const BLOG_TITLE = 'Resume & job-search blog';
export const BLOG_DESC = 'Practical resume, ATS and interview advice for India: freshers, government and PSU jobs, career switches — from the Nm7 team.';

const clip = (s, n) => { const t = String(s || '').replace(/\s+/g, ' ').trim(); return t.length > n ? `${t.slice(0, n - 1).trimEnd()}…` : t; };

export const postUrl = (slug) => `${ORIGIN}/blog/${slug}`;
export const categoryUrl = (slug) => `${ORIGIN}/blog/category/${slug}`;

/** { title, description, canonical, image, type, noindex, published, modified } for a post. */
export function postMeta(p) {
  return {
    title: `${clip(p.seoTitle || p.title, 70)} · ${SITE}`,
    description: clip(p.seoDescription || p.excerpt, 160),
    canonical: postUrl(p.slug),
    image: p.cover?.url || DEFAULT_IMAGE,
    type: 'article',
    published: p.publishedAt,
    modified: p.updatedAt,
  };
}
/** Page 2 and on of a list: /blog/page/2, /blog/category/ats/page/2 (page 1 is the list itself). */
export const pagePath = (base, page = 1) => (page > 1 ? `${base}/page/${page}` : base);
const pageNote = (page) => (page > 1 ? ` · Page ${page}` : '');
export const listMeta = (page = 1) => ({ title: `${BLOG_TITLE}${pageNote(page)} · ${SITE}`, description: BLOG_DESC, canonical: `${ORIGIN}${pagePath('/blog', page)}`, image: DEFAULT_IMAGE, type: 'website' });
export const categoryMeta = (c, count, page = 1) => ({
  title: `${c.name}${pageNote(page)} · Blog · ${SITE}`,
  description: clip(`Articles on ${c.name.toLowerCase()} from the Nm7 blog: practical resume and job-search advice for India.`, 160),
  canonical: `${ORIGIN}${pagePath(`/blog/category/${c.slug}`, page)}`,
  image: DEFAULT_IMAGE,
  type: 'website',
  noindex: count === 0,
});

const crumbs = (items) => ({
  '@context': 'https://schema.org',
  '@type': 'BreadcrumbList',
  itemListElement: items.map(([name, item], i) => ({ '@type': 'ListItem', position: i + 1, name, item })),
});

export function postJsonLd(p) {
  const m = postMeta(p);
  return [
    {
      '@context': 'https://schema.org',
      '@type': 'BlogPosting',
      headline: clip(p.title, 110),
      description: m.description,
      image: [m.image],
      datePublished: p.publishedAt,
      dateModified: p.updatedAt || p.publishedAt,
      author: { '@type': p.author?.name && p.author.name !== 'Nm7 Team' ? 'Person' : 'Organization', name: p.author?.name || 'Nm7 Team' },
      publisher: { '@type': 'Organization', name: SITE, url: ORIGIN, logo: { '@type': 'ImageObject', url: DEFAULT_IMAGE } },
      mainEntityOfPage: { '@type': 'WebPage', '@id': m.canonical },
      ...(p.category ? { articleSection: p.category.name } : {}),
    },
    crumbs([['Home', `${ORIGIN}/`], ['Blog', `${ORIGIN}/blog`], ...(p.category ? [[p.category.name, categoryUrl(p.category.slug)]] : []), [p.title, m.canonical]]),
    ...(p.faq?.length ? [{
      '@context': 'https://schema.org',
      '@type': 'FAQPage',
      mainEntity: p.faq.map((q) => ({ '@type': 'Question', name: q.question, acceptedAnswer: { '@type': 'Answer', text: q.answer } })),
    }] : []),
  ];
}
export const listJsonLd = () => [crumbs([['Home', `${ORIGIN}/`], ['Blog', `${ORIGIN}/blog`]])];
export const categoryJsonLd = (c) => [crumbs([['Home', `${ORIGIN}/`], ['Blog', `${ORIGIN}/blog`], [c.name, categoryUrl(c.slug)]])];
