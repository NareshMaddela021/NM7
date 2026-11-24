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

/* ---------- the older articles (Hygraph project "Team Nm7", model BlogPost, Markdown body) ---------- */

const older = (o) => ({
  id: o.slug, slug: o.slug, title: o.title, excerpt: o.excerpt || `About ${o.title}.`, seoTitle: null, metaDescription: o.metaDescription || null,
  category: o.category || 'Govt Jobs', body: o.body || 'Short article.', faq: o.faq || null,
  publishedAt: o.publishedAt || '2025-03-01T05:00:00.000Z', updatedAt: o.updatedAt || o.publishedAt || '2025-03-01T05:00:00.000Z', createdAt: o.publishedAt || '2025-03-01T05:00:00.000Z',
});

/** As Hygraph stores them (what the API reads with its token; e2e-live/hygraph-mock.mjs answers these). */
export const OLDER_RAW = [
  older({
    slug: 'govt-job-resume', title: 'Resume for government jobs by Team Asuraa', metaDescription: 'How Asuraa writes a resume for PSU and government jobs.',
    body: '*Last updated: March 2025 · By the Asuraa Team*\n\n## Why Asuraa wrote this\n\nRead [our keyword guide](https://asuraa.in/blog/psu-interview-tips) and visit [asuraa.in](https://www.asuraa.in/).\nOur sister product [Asuraa AI](https://asuraa.ai) is separate. Mail hello@asuraa.in.',
    faq: [{ question: 'Is Asuraa free?', answer: 'Yes, everything on asuraa.in is free.' }],
  }),
  older({ slug: 'psu-interview-tips', title: 'PSU interview tips', category: 'Interviews', publishedAt: '2025-04-01T05:00:00.000Z', body: 'Prepare well. See [the guide](/blog/govt-job-resume).' }),
  // the same slug as the site's own post, older: the site's own post stays
  older({ slug: 'ats-keywords', title: 'ATS keywords (old)', publishedAt: '2024-05-01T05:00:00.000Z' }),
  // the same title as the site's own post, older: dropped, its slug goes to the site's post
  older({ slug: 'ats-friendly-resume-guide', title: 'How to make an ATS-friendly resume!', publishedAt: '2024-06-01T05:00:00.000Z' }),
];

const leaf = (text) => ({ text });
/** As GET /api/blog/legacy?content=1 answers them (rebranded and deduplicated by the API). One string still says
 * "asuraa.in" on purpose: the build must scrub it too. */
export const OLDER_API = [
  {
    id: 'psu-interview-tips', slug: 'psu-interview-tips', title: 'PSU interview tips', excerpt: 'About PSU interview tips.', seoTitle: '', seoDescription: '',
    cover: null, category: { name: 'Interviews', slug: 'interviews' }, author: null, publishedAt: '2025-04-01T05:00:00.000Z', updatedAt: '2025-04-01T05:00:00.000Z',
    content: { children: [{ type: 'paragraph', children: [leaf('Prepare well. See '), { type: 'link', href: 'https://nm7.si/blog/govt-job-resume', children: [leaf('the guide')] }, leaf('.')] }] },
    faq: [], source: 'legacy',
  },
  {
    id: 'govt-job-resume', slug: 'govt-job-resume', title: 'Resume for government jobs by Team Nm7', excerpt: 'About Resume for government jobs by Team Nm7.', seoTitle: '', seoDescription: 'How Nm7 writes a resume for PSU and government jobs.',
    cover: null, category: { name: 'Govt Jobs', slug: 'govt-jobs' }, author: null, publishedAt: '2025-03-01T05:00:00.000Z', updatedAt: '2025-03-01T05:00:00.000Z',
    content: { children: [
      { type: 'heading-two', children: [leaf('Why Nm7 wrote this')] },
      { type: 'paragraph', children: [leaf('Read '), { type: 'link', href: 'https://nm7.si/blog/psu-interview-tips', children: [leaf('our keyword guide')] }, leaf(' and visit '), { type: 'link', href: 'https://nm7.si', children: [leaf('nm7.si')] }, leaf('. Left over: www.asuraa.in/blog. Our sister product '), { type: 'link', href: 'https://asuraa.ai', children: [leaf('Asuraa AI')] }, leaf(' is separate.')] },
    ] },
    faq: [{ question: 'Is Nm7 free?', answer: 'Yes, everything on nm7.si is free.' }], source: 'legacy',
  },
  { ...{ id: 'ats-keywords', slug: 'ats-keywords', title: 'ATS keywords (old)', excerpt: 'Old.', cover: null, category: { name: 'Govt Jobs', slug: 'govt-jobs' }, author: null, publishedAt: '2024-05-01T05:00:00.000Z', updatedAt: '2024-05-01T05:00:00.000Z', content: { children: [{ type: 'paragraph', children: [leaf('Old.')] }] }, faq: [], source: 'legacy' } },
  { ...{ id: 'ats-friendly-resume-guide', slug: 'ats-friendly-resume-guide', title: 'How to make an ATS-friendly resume!', excerpt: 'Old.', cover: null, category: { name: 'Govt Jobs', slug: 'govt-jobs' }, author: null, publishedAt: '2024-06-01T05:00:00.000Z', updatedAt: '2024-06-01T05:00:00.000Z', content: { children: [{ type: 'paragraph', children: [leaf('Old.')] }] }, faq: [], source: 'legacy' } },
];

/** fetch() stand-in for the API's GET /api/blog/legacy (pages of `per_page`). */
export function fakeOlderApi({ posts = OLDER_API, aliases = { 'what-is-asuraa': 'what-is-nm7' }, configured = true, fail = false } = {}) {
  const calls = [];
  const fn = async (url) => {
    calls.push(url);
    if (fail) throw new Error('connect ECONNREFUSED');
    const u = new URL(url);
    const per = Number(u.searchParams.get('per_page') || 50);
    const page = Number(u.searchParams.get('page') || 1);
    const list = configured ? posts : [];
    const body = { configured, error: null, total: list.length, page, pages: Math.max(1, Math.ceil(list.length / per)), posts: list.slice((page - 1) * per, page * per), aliases: configured ? aliases : {} };
    return { ok: true, status: 200, json: async () => JSON.parse(JSON.stringify(body)) };
  };
  fn.calls = calls;
  return fn;
}
