import { describe, expect, it } from 'vitest';
import { plainText, readingTime, richTextToHtml, safeHref } from './richtext';
import { CONTENT } from './fixtures/hygraph';

describe('reading time (about 200 words a minute)', () => {
  const para = (n) => ({ children: [{ type: 'paragraph', children: [{ text: Array.from({ length: n }, () => 'w').join(' ') }] }] });
  it('rounds to whole minutes and is at least 1', () => {
    expect(readingTime(para(0))).toBe(1);
    expect(readingTime(para(50))).toBe(1);
    expect(readingTime(para(200))).toBe(1);
    expect(readingTime(para(500))).toBe(3);
    expect(readingTime(para(1000))).toBe(5);
  });
  it('counts words across nested nodes (lists, tables, links)', () => {
    expect(plainText(CONTENT)).toContain('Experience Education');
    expect(readingTime(CONTENT)).toBe(2); // ~440 words
  });
});

describe('rich text → HTML', () => {
  const html = richTextToHtml(CONTENT);
  it('renders headings, lists, links, images, code, quotes and tables', () => {
    expect(html).toContain('<p>ATS software reads your resume before a person does. <strong>Keep it simple</strong>.</p>');
    expect(html).toContain('<h2>Use standard headings</h2>');
    expect(html).toContain('<ul><li>Experience</li><li>Education</li></ul>');
    expect(html).toContain('<ol><li>First step</li></ol>');
    expect(html).toContain('<a href="https://example.org/guide" rel="noopener noreferrer" target="_blank">outside guide</a>');
    expect(html).toContain('<a href="/builder">builder</a>'); // own pages: no rel / target
    expect(html).toContain('<img src="https://ap-south-1.graphassets.com/abc/photo.png" alt="A clean resume" loading="lazy" decoding="async" width="800" height="600">');
    expect(html).toContain('<pre><code>&lt;b&gt;Skills&lt;/b&gt;: SQL, Excel</code></pre>');
    expect(html).toContain('<blockquote>Recruiters skim for six seconds.</blockquote>');
    expect(html).toContain('<div class="blog-table"><table><thead><tr><th><p>Section</p></th>');
    expect(html).toContain('<td><p>Match the job post</p></td>');
  });
  it('never lets HTML or scripts through', () => {
    expect(html).not.toMatch(/<script/i);
    expect(html).not.toMatch(/<img[^>]*onerror/i);
    expect(html).toContain('&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;&lt;img src=x onerror=alert(1)&gt;');
    expect(html).not.toContain('javascript:');
    expect(html).toContain('bad link'); // the text stays, the link goes
    expect(html).not.toContain('<iframe');
    expect(html).not.toContain('evil.example');
  });
  it('allows only safe link targets', () => {
    expect(safeHref('https://x.org')).toBe('https://x.org');
    expect(safeHref('mailto:a@b.c')).toBe('mailto:a@b.c');
    expect(safeHref('/blog')).toBe('/blog');
    expect(safeHref('#top')).toBe('#top');
    expect(safeHref('//evil.org')).toBeNull();
    expect(safeHref(' JavaScript:alert(1)')).toBeNull();
    expect(safeHref('data:text/html,hi')).toBeNull();
  });
  it('escapes attributes', () => {
    const out = richTextToHtml({ children: [{ type: 'image', src: 'https://a.graphassets.com/x"onload="alert(1)', altText: '"><script>' }] });
    expect(out).not.toContain('"onload="');
    expect(out).toContain('alt="&quot;&gt;&lt;script&gt;"');
  });
});
