// vercel.json: security headers are set, every app route is served, unknown paths get a real 404.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const vercel = JSON.parse(readFileSync(new URL('../../vercel.json', import.meta.url), 'utf8'));
const app = readFileSync(new URL('../App.jsx', import.meta.url), 'utf8');
const toRe = (src) => new RegExp(`^${src.replace(/:path\*/g, '.*').replace(/:[a-z]+/g, '[^/]+')}$`);
const served = (path) => vercel.rewrites.some((r) => toRe(r.source).test(path));
const header = (k) => vercel.headers[0].headers.find((h) => h.key === k)?.value;

describe('vercel.json', () => {
  it('sends the security headers', () => {
    const csp = header('Content-Security-Policy');
    for (const part of ["default-src 'self'", 'https://fonts.googleapis.com', 'https://fonts.gstatic.com', 'https://checkout.razorpay.com', 'https://nm7-api.onrender.com', "frame-ancestors 'none'", "object-src 'none'"]) expect(csp).toContain(part);
    expect(csp).not.toContain('unsafe-eval');
    expect(header('X-Frame-Options')).toBe('DENY');
    expect(header('X-Content-Type-Options')).toBe('nosniff');
    expect(header('Referrer-Policy')).toBe('strict-origin-when-cross-origin');
    expect(header('Permissions-Policy')).toContain('camera=()');
  });

  it('serves every route of the app and nothing else', () => {
    const routes = [...app.matchAll(/<Route path="([^"]+)"/g)].map((m) => m[1]).filter((p) => p.startsWith('/'));
    expect(routes.length).toBeGreaterThan(20);
    for (const r of routes) expect(served(r.replace(/:[a-z]+/g, 'x')), r).toBe(true);
    for (const p of ['/me/orders/RS-1001', '/admin/team', '/expert/orders/RS-1', '/orders/RS-1/refund', '/r/asha']) expect(served(p), p).toBe(true);
    for (const p of ['/nope', '/wp-admin', '/me-too', '/assets/x.js']) expect(served(p), p).toBe(false);
  });
});
