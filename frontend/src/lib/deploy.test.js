// vercel.json: security headers are set, every app route is served, unknown paths get a real 404.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const vercel = JSON.parse(readFileSync(new URL('../../vercel.json', import.meta.url), 'utf8'));
const app = readFileSync(new URL('../App.jsx', import.meta.url), 'utf8');
const toRe = (src) => new RegExp(`^${src.replace(/:path\*/g, '.*').replace(/:[a-z]+/g, '[^/]+')}$`);
const served = (path) => [...vercel.rewrites, ...(vercel.redirects || [])].some((r) => toRe(r.source).test(path)); // a redirect serves its path too
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

  it('payments: only Razorpay’s own domains (checkout script + frame, api, lumberjack, images)', () => {
    const dir = (name) => header('Content-Security-Policy').split(';').map((d) => d.trim()).find((d) => d.startsWith(`${name} `)) || '';
    expect(dir('script-src')).toContain('https://checkout.razorpay.com');
    expect(dir('frame-src').split(' ').slice(1).filter((h) => !h.startsWith('https://accounts.google.com/gsi/')).sort()).toEqual(['https://api.razorpay.com', 'https://checkout.razorpay.com']);
    expect(dir('connect-src')).toContain('https://api.razorpay.com');
    expect(dir('connect-src')).toContain('https://lumberjack.razorpay.com');
    expect(dir('img-src')).toContain('https://*.razorpay.com');
    const paymentHosts = header('Content-Security-Policy').match(/https:\/\/[^\s;]*(pay|upi|stripe|paytm|cashfree)[^\s;]*/gi) || [];
    expect(paymentHosts.every((h) => /razorpay\.com$/.test(h))).toBe(true);
  });

  it('Sign in with Google: only the Google Identity Services paths Google documents, nothing broader', () => {
    const csp = header('Content-Security-Policy');
    const dir = (name) => csp.split(';').map((d) => d.trim()).find((d) => d.startsWith(`${name} `)) || '';
    const google = (name) => dir(name).split(' ').filter((h) => h.includes('google.com'));
    expect(google('script-src')).toEqual(['https://accounts.google.com/gsi/client']);
    expect(google('style-src')).toEqual(['https://accounts.google.com/gsi/style']);
    expect(google('frame-src')).toEqual(['https://accounts.google.com/gsi/']);
    expect(google('connect-src')).toEqual(['https://accounts.google.com/gsi/']);
    expect(csp.match(/[^\s;]*google\.com[^\s;]*/g).every((h) => h.startsWith('https://accounts.google.com/gsi/'))).toBe(true);
    expect(csp).not.toMatch(/\*\.google\.com|googleapis\.com\/[^\s;]*gsi/);
  });

  it('recruiter links and kiosks are never cached or indexed', () => {
    const rule = vercel.headers.find((h) => new RegExp(`^${h.source}$`).test('/r/abc') && h.source !== '/(.*)');
    expect(rule.headers).toEqual(expect.arrayContaining([{ key: 'Cache-Control', value: 'no-store' }, { key: 'X-Robots-Tag', value: 'noindex, nofollow' }]));
    expect(new RegExp(`^${rule.source}$`).test('/kiosk/tok')).toBe(true);
  });

  it('serves every route of the app and nothing else', () => {
    const routes = [...app.matchAll(/<Route path="([^"]+)"/g)].map((m) => m[1]).filter((p) => p.startsWith('/'));
    expect(routes.length).toBeGreaterThan(20);
    for (const r of routes) expect(served(r.replace(/:[a-z]+/g, 'x')), r).toBe(true);
    for (const p of ['/me/orders/RS-1001', '/admin/team', '/expert/orders/RS-1', '/orders/RS-1/refund', '/r/asha']) expect(served(p), p).toBe(true);
    for (const p of ['/nope', '/wp-admin', '/me-too', '/assets/x.js']) expect(served(p), p).toBe(false);
  });
});

describe('fix round item 26', () => {
  // round P: /pricing is its own page now (the new home page has no pricing section)
  it('/pricing is its own pre-rendered page', () => {
    expect((vercel.redirects || []).some((r) => r.source === '/pricing')).toBe(false);
    expect(vercel.rewrites).toContainEqual({ source: '/pricing', destination: '/pricing/index.html' });
  });
});

describe('shared job links show a preview card', () => {
  const rules = vercel.rewrites.filter((r) => r.source === '/jobs/:slug');
  const robots = new RegExp(`^${rules[0].has?.[0]?.value}$`);
  it('link-preview robots get the API\'s preview page, everyone else the app', () => {
    expect(rules).toHaveLength(2);
    expect(rules[0].destination).toBe('https://nm7-api.onrender.com/api/jobs/:slug/preview');
    expect(rules[0].has[0]).toMatchObject({ type: 'header', key: 'user-agent' });
    expect(rules[1]).toEqual({ source: '/jobs/:slug', destination: '/index.html' });
    for (const ua of ['WhatsApp/2.23.20.0', 'facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)', 'LinkedInBot/1.0 (compatible; Mozilla/5.0)', 'Twitterbot/1.0', 'TelegramBot (like TwitterBot)', 'Mozilla/5.0 (compatible; Discordbot/2.0)']) expect(robots.test(ua), ua).toBe(true);
    for (const ua of ['Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/126 Mobile Safari/537.36', 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)', 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0) Safari/604.1']) expect(robots.test(ua), ua).toBe(false);
  });
});
