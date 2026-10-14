// Serves dist/ like Vercel would: the vercel.json headers (the CSP also allows the local test API) and a real 404
// for paths the rewrites do not cover. Used by playwright.csp.config.mjs.
import { createServer } from 'node:http';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { join, extname } from 'node:path';
const root = process.argv[2];
const v = JSON.parse(readFileSync(join(root, '..', 'vercel.json'), 'utf8'));
const hs = v.headers[0].headers.map(({ key, value }) => [key, key === 'Content-Security-Policy' ? value.replace('connect-src', 'connect-src http://localhost:8001').replace('; upgrade-insecure-requests', '') : value]);
const types = { '.js': 'text/javascript', '.css': 'text/css', '.html': 'text/html', '.svg': 'image/svg+xml', '.png': 'image/png', '.xml': 'application/xml', '.txt': 'text/plain' };
createServer((req, res) => {
  const p = decodeURIComponent(req.url.split('?')[0]);
  let f = join(root, p);
  let status = 200;
  const toRe = (src) => new RegExp(`^${src.replace(/:path\*/g, '.*').replace(/:[a-z]+/g, '[^/]+')}$`);
  if (!existsSync(f) || statSync(f).isDirectory()) {
    if (v.rewrites.some((r) => toRe(r.source).test(p))) f = join(root, 'index.html');
    else { f = join(root, '404.html'); status = 404; }
  }
  hs.forEach(([k, val]) => res.setHeader(k, val));
  res.writeHead(status, { 'Content-Type': types[extname(f)] || 'application/octet-stream' });
  res.end(readFileSync(f));
}).listen(5182);
