// Serves dist/ like Vercel would: the vercel.json headers (the CSP also allows the local test API and Hygraph stand-in) and a real 404
// for paths the rewrites do not cover. Used by playwright.csp.config.mjs.
import { createServer } from 'node:http';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { join, extname } from 'node:path';
const root = process.argv[2];
const v = JSON.parse(readFileSync(join(root, '..', 'vercel.json'), 'utf8'));
const hs = v.headers[0].headers.map(({ key, value }) => [key, key === 'Content-Security-Policy' ? value.replace('connect-src', 'connect-src http://localhost:8001 http://localhost:5199').replace('; upgrade-insecure-requests', '') : value]);
const types = { '.js': 'text/javascript', '.css': 'text/css', '.html': 'text/html', '.svg': 'image/svg+xml', '.png': 'image/png', '.xml': 'application/xml', '.txt': 'text/plain', '.json': 'application/json' };
createServer((req, res) => {
  const p = decodeURIComponent(req.url.split('?')[0]);
  let f = join(root, p);
  let status = 200;
  // a rewrite's destination with its :params filled in (/blog/:slug → /blog/<slug>/index.html)
  const target = (r) => {
    const names = [];
    const re = new RegExp(`^${r.source.replace(/:path\*/g, () => { names.push('path'); return '(.*)'; }).replace(/:([a-z]+)/g, (_, n) => { names.push(n); return '([^/]+)'; })}$`);
    const m = p.match(re);
    if (!m) return null;
    return names.reduce((d, n, i) => d.replace(`:${n}`, m[i + 1]), r.destination);
  };
  if (!existsSync(f) || statSync(f).isDirectory()) {
    const dest = v.rewrites.map(target).find(Boolean);
    if (dest && existsSync(join(root, dest)) && !statSync(join(root, dest)).isDirectory()) f = join(root, dest);
    else { f = join(root, '404.html'); status = 404; }
  }
  hs.forEach(([k, val]) => res.setHeader(k, val));
  res.writeHead(status, { 'Content-Type': types[extname(f)] || 'application/octet-stream' });
  res.end(readFileSync(f));
}).listen(5182);
