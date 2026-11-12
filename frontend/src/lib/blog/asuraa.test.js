import { describe, expect, it } from 'vitest';
import { ASURAA_BUILD_ENDPOINT, ASURAA_POSTS_QUERY, EXCLUDED_CATEGORIES, asuraaCategory, cleanBody, fetchAsuraaPosts, mapHref, normalizeAsuraaPost, rebrand } from './asuraa';
import { markdownToAst } from './markdown';
import { richTextToHtml } from './richtext';
import { fetchCategories, fetchPost, fetchPosts, summary } from './hygraph';
import { postJsonLd } from './seo';

// Shaped like a real Team Asuraa post (assembled by the blog pipeline): byline line, quick answer, takeaways,
// body with a table, related guides, FAQ.
const BODY = [
  '*Last updated: 23 October 2026 · By the Asuraa Team*',
  '',
  '> **Quick answer:** Fake internships ask for money. Check the company on the [MCA portal](https://www.mca.gov.in/) and apply on [Asuraa jobs](https://asuraa.in/jobs).',
  '',
  '**Key takeaways**',
  '',
  '- Real employers never charge a fee.',
  '- Verify the email domain.',
  '',
  '## What are the red flags?',
  '',
  'Asuraa\'s October 2026 job market report found most listings omit salary. AsuraaX AI Private Limited runs asuraa.in.',
  '',
  '| Red flag | What to do |',
  '| --- | --- |',
  '| Fee asked | Walk away |',
  '| Gmail offer | Check the [careers page](https://asuraa.in/blog/how-to-verify-a-company-before-applying-india) |',
  '',
  '1. Search the company name.',
  '2. Check the domain.',
  '    - Use WHOIS.',
  '',
  'Book a [mentor](https://asuraa.in/mentors) or plan with the [career path planner](https://asuraa.in/career-path).',
  '',
  '```',
  'const fee = 0; // <b>never</b>',
  '```',
  '',
  '## FAQ',
  '',
  '### Is a paid internship certificate valid?',
  '',
  'No. Check it with the [Asuraa resume reviewer](https://asuraa.in/resume/reviewer).',
].join('\n');

const RAW = (o = {}) => ({
  id: 'x1', slug: 'fake-internship-scams-india', title: 'Fake Internship Scams in India: Asuraa Guide', excerpt: 'How to spot them, from the Asuraa Team.',
  seoTitle: 'Fake internship scams', metaDescription: 'Spot fake internships. By AsuraaIN.', category: 'Job Search Safety', body: BODY,
  faq: [{ question: 'Is Asuraa free?', answer: 'Yes, asuraa.in is free to start.' }, { question: '', answer: 'dropped' }],
  publishedAt: '2026-10-12T05:00:00Z', updatedAt: '2026-10-23T05:00:00Z', createdAt: '2026-10-12T05:00:00Z', ...o,
});

describe('markdown → rich text AST', () => {
  const ast = markdownToAst(BODY, { mapHref });
  const html = richTextToHtml(ast);
  it('makes the blocks richtext.js knows', () => {
    const types = ast.children.map((n) => n.type);
    expect(types).toEqual(expect.arrayContaining(['block-quote', 'paragraph', 'bulleted-list', 'heading-two', 'table', 'numbered-list', 'code-block', 'heading-three']));
    expect(html).toContain('<table>');
    expect(html).toContain('<ol><li>Search the company name.</li><li>Check the domain.<ul><li>Use WHOIS.</li></ul></li></ol>');
    expect(html).toContain('<strong>Quick answer:</strong>');
  });
  it('never lets HTML through', () => {
    expect(html).toContain('&lt;b&gt;never&lt;/b&gt;');
    expect(richTextToHtml(markdownToAst('<script>alert(1)</script> and [x](javascript:alert(1))'))).not.toMatch(/<script|javascript:/);
  });
  it('keeps snake_case and plain asterisks as text', () => {
    expect(richTextToHtml(markdownToAst('Use snake_case_names here.'))).toBe('<p>Use snake_case_names here.</p>');
  });
});

describe('asuraa.in → nm7.si links', () => {
  it('maps blog posts, jobs and the resume reviewer; drops pages nm7.si does not have', () => {
    expect(mapHref('https://asuraa.in/blog/how-to-verify-a-company-before-applying-india')).toBe('/blog/how-to-verify-a-company-before-applying-india');
    expect(mapHref('https://www.asuraa.in/jobs?city=pune')).toBe('/jobs');
    expect(mapHref('https://asuraa.in/jobs/abc123')).toBe('/jobs');
    expect(mapHref('https://asuraa.in/resume/reviewer')).toBe('/');
    expect(mapHref('https://asuraa.in')).toBe('/');
    expect(mapHref('https://asuraa.in/mentors')).toBeNull();
    expect(mapHref('https://asuraa.in/career-path')).toBeNull();
    expect(mapHref('https://www.mca.gov.in/')).toBe('https://www.mca.gov.in/');
  });
});

describe('rebranding', () => {
  it('Asuraa → Nm7, asuraa.in → nm7.si, keeps the company name', () => {
    expect(rebrand('By the Asuraa Team')).toBe('By the Nm7 Team');
    expect(rebrand('AsuraaIN and Asuraa’s report on asuraa.in')).toBe('Nm7 and Nm7’s report on nm7.si');
    expect(rebrand('AsuraaX AI Private Limited')).toBe('AsuraaX AI Private Limited');
  });
  it('drops the stored byline line', () => {
    expect(cleanBody(BODY).startsWith('\n> **Quick answer:**')).toBe(true);
  });
});

describe('a Team Asuraa post as an nm7.si post', () => {
  const p = normalizeAsuraaPost(RAW());
  const html = richTextToHtml(p.content);
  it('has the shape the pages use', () => {
    expect(p).toMatchObject({ slug: 'fake-internship-scams-india', title: 'Fake Internship Scams in India: Nm7 Guide', excerpt: 'How to spot them, from the Nm7 Team.',
      seoDescription: 'Spot fake internships. By Nm7.', category: { name: 'Job Search Safety', slug: 'job-search-safety' }, author: null, cover: null, source: 'asuraa' });
    expect(p.minutes).toBeGreaterThanOrEqual(1);
    expect(p.faq).toEqual([{ question: 'Is Nm7 free?', answer: 'Yes, nm7.si is free to start.' }]);
  });
  it('the body carries no asuraa.in link and no old byline', () => {
    expect(html).not.toMatch(/asuraa\.in|Last updated|Asuraa Team/);
    expect(html).toContain('href="/jobs"');
    expect(html).toContain('href="/blog/how-to-verify-a-company-before-applying-india"');
    expect(html).toContain('Book a mentor or plan with the career path planner.'); // dropped links keep their words
    expect(html).toContain('Nm7’s October 2026'.replace('’', '&#39;'));
    expect(html).toContain('AsuraaX AI Private Limited runs nm7.si.');
    expect(html).toContain('href="https://www.mca.gov.in/"');
  });
  it('lists skip the FAQ and the body', () => {
    expect(summary(p)).not.toHaveProperty('faq');
    expect(summary(p)).not.toHaveProperty('content');
  });
  it('the FAQ becomes FAQPage JSON-LD', () => {
    const faq = postJsonLd(p).find((j) => j['@type'] === 'FAQPage');
    expect(faq.mainEntity[0]).toMatchObject({ '@type': 'Question', name: 'Is Nm7 free?', acceptedAnswer: { text: 'Yes, nm7.si is free to start.' } });
  });
  it('category names become slugs', () => {
    expect(asuraaCategory('Exams & Certifications')).toEqual({ name: 'Exams & Certifications', slug: 'exams-and-certifications' });
  });
});

// A fake fetch that answers both Hygraph projects.
const OWN = { id: 'n1', slug: 'own-post', title: 'Own', excerpt: 'e', publishedAt: '2026-11-01T00:00:00Z', content: { raw: { children: [] } }, category: { name: 'ATS', slug: 'ats' } };
function fakeFetch({ asuraaFails = false } = {}) {
  return async (url, init) => {
    const { query, variables } = JSON.parse(init.body);
    const json = (data) => ({ ok: true, status: 200, text: async () => JSON.stringify({ data }) });
    if (url.includes('cmtxihlft00uf06v1drejgj89')) {
      if (asuraaFails) return { ok: false, status: 500, text: async () => 'down' };
      const all = [RAW(), RAW({ id: 'x2', slug: 'own-post', title: 'dupe' }), RAW({ id: 'x3', slug: 'telugu-one', category: 'Telugu Guides' }), RAW({ id: 'x4', slug: 'what-is-asuraa', category: 'About Asuraa' })];
      if (query.includes('blogPost(')) return json({ blogPost: all.find((p) => p.slug === variables.slug) || null });
      return json({ blogPosts: variables.skip ? [] : all });
    }
    if (query.includes('categories')) return json({ categories: [{ name: 'ATS', slug: 'ats' }] });
    if (query.includes('post(')) return json({ post: variables.slug === 'own-post' ? OWN : null });
    return json({ posts: variables.skip ? [] : [OWN] });
  };
}

describe('both sources together', () => {
  it('off by default: nm7-blog only', async () => {
    expect((await fetchPosts({ endpoint: 'https://x/cmup', fetchImpl: fakeFetch() })).map((p) => p.slug)).toEqual(['own-post']);
  });
  it('switched on: adds the asuraa.in posts, nm7-blog wins a shared slug, excluded categories stay out', async () => {
    const opts = { endpoint: 'https://x/cmup', fetchImpl: fakeFetch(), includeAsuraa: true };
    const posts = await fetchPosts(opts);
    expect(posts.map((p) => p.slug)).toEqual(['own-post', 'fake-internship-scams-india']);
    expect(posts[0].title).toBe('Own');
    expect((await fetchCategories(opts)).map((c) => c.slug)).toEqual(['ats', 'job-search-safety']);
    expect((await fetchPost('fake-internship-scams-india', opts)).source).toBe('asuraa');
    expect(await fetchPost('what-is-asuraa', opts)).toBeNull();
  });
  it('an asuraa.in outage never hides nm7-blog posts', async () => {
    const warn = [];
    const posts = await fetchPosts({ endpoint: 'https://x/cmup', fetchImpl: fakeFetch({ asuraaFails: true }), includeAsuraa: true, log: { warn: (m) => warn.push(m) } });
    expect(posts.map((p) => p.slug)).toEqual(['own-post']);
    expect(warn[0]).toMatch(/asuraa\.in posts could not be read/);
  });
  it('the build reads the uncached API; excluded categories are listed', async () => {
    expect(ASURAA_BUILD_ENDPOINT).toBe('https://api-ap-south-1.hygraph.com/v2/cmtxihlft00uf06v1drejgj89/master');
    expect(ASURAA_POSTS_QUERY).toMatch(/blogPosts\(orderBy: publishedAt_DESC/);
    expect([...EXCLUDED_CATEGORIES]).toEqual(['Telugu Guides', 'Hindi Guides', 'Tamil Guides', 'About Asuraa']);
    const got = await fetchAsuraaPosts(async () => ({ blogPosts: [RAW()] }));
    expect(got).toHaveLength(1);
  });
});

describe('the read-only token (ASURAA_HYGRAPH_TOKEN)', () => {
  it('is sent as a Bearer header at build time, and only to the asuraa project', async () => {
    const seen = [];
    const fetchImpl = async (url, init) => {
      seen.push([url, init.headers.Authorization]);
      const { query } = JSON.parse(init.body);
      const data = url.includes('cmtxihlft00uf06v1drejgj89') ? { blogPosts: [] } : query.includes('categories') ? { categories: [] } : { posts: [] };
      return { ok: true, status: 200, text: async () => JSON.stringify({ data }) };
    };
    process.env.ASURAA_HYGRAPH_TOKEN = 'test-token';
    try {
      await fetchPosts({ endpoint: 'https://x/cmup', fetchImpl, includeAsuraa: true });
    } finally { delete process.env.ASURAA_HYGRAPH_TOKEN; }
    expect(seen.find(([u]) => u.includes('cmtxihlft00uf06v1drejgj89'))[1]).toBe('Bearer test-token');
    expect(seen.find(([u]) => u.includes('cmup'))[1]).toBeUndefined();
  });
  it('without it, requests are unauthenticated (works while public read access is on)', async () => {
    let auth = 'unset';
    await fetchAsuraaPosts(async (q, v, o) => { auth = o.token; return { blogPosts: [] }; });
    expect(auth).toBe('');
  });
});
