// A stand-in for Hygraph's Content API with the test posts (src/lib/blog/fixtures/hygraph.js).
import { createServer } from 'node:http';
import { CATEGORIES, POSTS } from '../src/lib/blog/fixtures/hygraph.js';

export function answer(body, { posts = POSTS, categories = CATEGORIES } = {}) {
  const v = body.variables || {};
  return body.query.includes('post(where')
    ? { data: { post: posts.find((p) => p.slug === v.slug) || null } }
    : { data: { posts: posts.slice(v.skip || 0, (v.skip || 0) + (v.first || 100)), categories } };
}

export function startHygraphMock(port = 5199) {
  const server = createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => { raw += c; });
    req.on('end', () => {
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Headers', 'content-type');
      if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }
      if (req.method !== 'POST') { res.writeHead(200, { 'Content-Type': 'text/plain' }); res.end('ok'); return; }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(answer(JSON.parse(raw || '{}'))));
    });
  });
  return new Promise((resolve) => server.listen(port, () => resolve(server)));
}
