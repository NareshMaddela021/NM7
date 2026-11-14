// Where to go after signing in (?next=…): only a path on this site. Never another site, including the tricks a browser
// reads as one: "//evil.com", "/\evil.com" (a backslash counts as a slash, the React Router 6 open-redirect advisory),
// "/%5Cevil.com", or control characters / spaces that browsers strip before the slashes.
export function safeNext(n) {
  if (typeof n !== 'string' || !n.startsWith('/')) return null;
  let decoded = n;
  try { decoded = decodeURIComponent(n); } catch { return null; }
  for (const s of [n, decoded]) {
    const head = [...s.slice(0, 3)];
    if (head.some((c) => c.charCodeAt(0) < 32 || c.charCodeAt(0) === 127 || /\s/.test(c)) || s.startsWith('//') || s.includes('\\')) return null;
  }
  return n;
}
