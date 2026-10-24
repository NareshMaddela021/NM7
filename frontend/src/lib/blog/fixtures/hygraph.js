// A made-up Hygraph answer for tests, shaped like the real schema (rich text in `content.raw`):
// three categories, three posts; one has HTML typed into its text.
const t = (text, marks = {}) => ({ text, ...marks });
const words = (n) => Array.from({ length: n }, (_, i) => `word${i}`).join(' ');

export const CONTENT = {
  children: [
    { type: 'paragraph', children: [t('ATS software reads your resume before a person does. '), t('Keep it simple', { bold: true }), t('.')] },
    { type: 'heading-two', children: [t('Use standard headings')] },
    { type: 'bulleted-list', children: [
      { type: 'list-item', children: [{ type: 'list-item-child', children: [t('Experience')] }] },
      { type: 'list-item', children: [{ type: 'list-item-child', children: [t('Education')] }] },
    ] },
    { type: 'numbered-list', children: [{ type: 'list-item', children: [{ type: 'list-item-child', children: [t('First step')] }] }] },
    { type: 'paragraph', children: [
      t('Read the '), { type: 'link', href: 'https://example.org/guide', openInNewTab: true, children: [t('outside guide')] },
      t(', our '), { type: 'link', href: '/builder', children: [t('builder')] },
      t(' and not this '), { type: 'link', href: 'javascript:alert(1)', children: [t('bad link')] }, t('.'),
    ] },
    { type: 'image', src: 'https://ap-south-1.graphassets.com/abc/photo.png', altText: 'A clean resume', width: 800, height: 600, title: 'photo.png' },
    { type: 'image', src: 'javascript:alert(1)', title: 'nope' },
    { type: 'code-block', children: [t('<b>Skills</b>: SQL, Excel')] },
    { type: 'block-quote', children: [t('Recruiters skim for six seconds.')] },
    { type: 'table', children: [
      { type: 'table_head', children: [{ type: 'table_row', children: [{ type: 'table_header_cell', children: [{ type: 'paragraph', children: [t('Section')] }] }, { type: 'table_header_cell', children: [{ type: 'paragraph', children: [t('Tip')] }] }] }] },
      { type: 'table_body', children: [{ type: 'table_row', children: [{ type: 'table_cell', children: [{ type: 'paragraph', children: [t('Skills')] }] }, { type: 'table_cell', children: [{ type: 'paragraph', children: [t('Match the job post')] }] }] }] },
    ] },
    { type: 'paragraph', children: [t('<script>alert("x")</script><img src=x onerror=alert(1)>')] },
    { type: 'iframe', url: 'https://evil.example/' },
    { type: 'paragraph', children: [t(words(400))] },
  ],
};

const post = (o) => ({
  id: o.slug, slug: o.slug, title: o.title, excerpt: o.excerpt, seoTitle: o.seoTitle || null, seoDescription: o.seoDescription || null,
  publishedAt: o.publishedAt, updatedAt: o.updatedAt || o.publishedAt, createdAt: o.publishedAt,
  coverImage: o.cover === false ? null : { url: `https://ap-south-1.graphassets.com/abc/${o.slug}.jpg`, width: 1200, height: 630 },
  content: { raw: o.content || { children: [{ type: 'paragraph', children: [t(o.excerpt)] }] } },
  category: o.category, author: { name: 'Nm7 Team', bio: 'The team behind Nm7.', photo: null },
});

export const CATEGORIES = [{ name: 'ATS', slug: 'ats' }, { name: 'Freshers', slug: 'freshers' }, { name: 'Interviews', slug: 'interviews' }];
export const POSTS = [
  post({ slug: 'ats-friendly-resume', title: 'How to make an ATS-friendly resume', excerpt: 'Five rules that get your resume read.', seoDescription: 'The five rules that get an ATS to read your resume — with examples for Indian job seekers.', publishedAt: '2026-10-10T05:00:00.000Z', updatedAt: '2026-10-12T08:30:00.000Z', category: CATEGORIES[0], content: CONTENT }),
  post({ slug: 'ats-keywords', title: 'Which keywords does an ATS look for?', excerpt: 'Find the words recruiters search for.', publishedAt: '2026-10-08T05:00:00.000Z', category: CATEGORIES[0], cover: false }),
  post({ slug: 'first-resume-fresher', title: 'Your first resume as a fresher', excerpt: 'No experience? Start here.', publishedAt: '2026-10-14T05:00:00.000Z', category: CATEGORIES[1] }),
];

/** fetch() stand-in for the Hygraph endpoint. */
export function fakeHygraph({ posts = POSTS, categories = CATEGORIES, fail = false } = {}) {
  const calls = [];
  const fn = async (url, init) => {
    const body = JSON.parse(init.body);
    calls.push({ url, body });
    if (fail) throw new Error('getaddrinfo ENOTFOUND');
    const data = body.query.includes('post(where')
      ? { post: posts.find((p) => p.slug === body.variables.slug) || null }
      : { posts: posts.slice(body.variables.skip, body.variables.skip + body.variables.first), categories };
    const text = JSON.stringify({ data });
    return { ok: true, status: 200, text: async () => text, json: async () => JSON.parse(text) };
  };
  fn.calls = calls;
  return fn;
}
