// Contact icons as vector shapes for the PDF (no images, no icon fonts, no emoji): the same 24×24 icon set the
// preview draws as SVG (icons.js / brands.js), turned into plain path segments both PDF engines can draw.
import { BRANDS } from './brands';

// the line icons of icons.js as single paths (rects and circles written out), stroked
const LINE_PATHS = {
  email: ['M5 5h14a2 2 0 012 2v10a2 2 0 01-2 2H5a2 2 0 01-2-2V7a2 2 0 012-2z', 'M3 7l9 6 9-6'],
  phone: ['M22 16.9v3a2 2 0 01-2.2 2 19.8 19.8 0 01-8.6-3.1 19.5 19.5 0 01-6-6A19.8 19.8 0 012.1 4.2 2 2 0 014.1 2h3a2 2 0 012 1.7c.1.9.4 1.8.7 2.7a2 2 0 01-.5 2.1L8 9.8a16 16 0 006 6l1.3-1.3a2 2 0 012.1-.4c.9.3 1.8.6 2.7.7a2 2 0 011.7 2z'],
  location: ['M12 21s-7-6.2-7-11a7 7 0 0114 0c0 4.8-7 11-7 11z', 'M9.5 10a2.5 2.5 0 105 0a2.5 2.5 0 10-5 0'],
  globe: ['M3 12a9 9 0 1018 0a9 9 0 10-18 0', 'M3 12h18M12 3a14 14 0 010 18M12 3a14 14 0 000 18'],
  briefcase: ['M5 7h14a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9a2 2 0 012-2z', 'M9 7V5a2 2 0 012-2h2a2 2 0 012 2v2M3 13h18'],
  code: ['M8 7l-5 5 5 5M16 7l5 5-5 5M14 4l-4 16'],
  link: ['M10 14a4 4 0 005.7 0l3-3a4 4 0 00-5.7-5.7l-1 1', 'M14 10a4 4 0 00-5.7 0l-3 3a4 4 0 005.7 5.7l1-1'],
  pen: ['M12 20h9', 'M16.5 3.5a2.1 2.1 0 013 3L7 19l-4 1 1-4z'],
  resume: ['M14 3H7a2 2 0 00-2 2v14a2 2 0 002 2h10a2 2 0 002-2V8z', 'M14 3v5h5M9 13h6M9 17h4'],
};

/** { fill: true, paths } for brand logos (filled), { fill: false, paths } for line icons (2/24 stroke). */
export const iconShape = (key) => (BRANDS[key] ? { fill: true, paths: [BRANDS[key].path] } : { fill: false, paths: LINE_PATHS[key] || LINE_PATHS.link });

/* ---------- SVG path data → absolute M / L / C / Z segments ---------- */

const NUM = /-?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?/gi;
/** Splits "M3 7l9 6" into [['M', [3, 7]], ['l', [9, 6]]]; arc flags may be written without separators ("a2 2 0 012 2"). */
function tokens(d) {
  const out = [];
  const re = /([MmLlHhVvCcSsQqTtAaZz])([^MmLlHhVvCcSsQqTtAaZz]*)/g;
  for (const m of d.matchAll(re)) {
    const cmd = m[1];
    let nums;
    if (cmd === 'a' || cmd === 'A') { // rx ry rot large sweep x y: the two flags are single digits
      nums = [];
      let s = m[2];
      while (s.trim()) {
        const take = (flag) => {
          s = s.replace(/^[\s,]+/, '');
          if (flag) { const f = s[0]; s = s.slice(1); return Number(f); }
          const n = s.match(/^-?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?/i);
          if (!n) { s = ''; return NaN; }
          s = s.slice(n[0].length);
          return Number(n[0]);
        };
        const g = [take(), take(), take(), take(true), take(true), take(), take()];
        if (g.some(Number.isNaN)) break;
        nums.push(...g);
        s = s.replace(/^[\s,]+/, '');
      }
    } else nums = (m[2].match(NUM) || []).map(Number);
    out.push([cmd, nums]);
  }
  return out;
}

// an elliptical arc as cubic Béziers (SVG spec, appendix F.6)
function arcToCubics(x1, y1, rx, ry, phi, large, sweep, x2, y2) {
  if (!rx || !ry) return [[x1, y1, x2, y2, x2, y2]];
  rx = Math.abs(rx); ry = Math.abs(ry);
  const sin = Math.sin((phi * Math.PI) / 180); const cos = Math.cos((phi * Math.PI) / 180);
  const dx = (x1 - x2) / 2; const dy = (y1 - y2) / 2;
  const x1p = cos * dx + sin * dy; const y1p = -sin * dx + cos * dy;
  const lam = (x1p * x1p) / (rx * rx) + (y1p * y1p) / (ry * ry);
  if (lam > 1) { rx *= Math.sqrt(lam); ry *= Math.sqrt(lam); }
  const sign = large === sweep ? -1 : 1;
  const num = rx * rx * ry * ry - rx * rx * y1p * y1p - ry * ry * x1p * x1p;
  const co = sign * Math.sqrt(Math.max(0, num / (rx * rx * y1p * y1p + ry * ry * x1p * x1p)));
  const cxp = (co * rx * y1p) / ry; const cyp = (-co * ry * x1p) / rx;
  const cx = cos * cxp - sin * cyp + (x1 + x2) / 2; const cy = sin * cxp + cos * cyp + (y1 + y2) / 2;
  const ang = (ux, uy, vx, vy) => { const a = Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy); return a; };
  const t1 = ang(1, 0, (x1p - cxp) / rx, (y1p - cyp) / ry);
  let dt = ang((x1p - cxp) / rx, (y1p - cyp) / ry, (-x1p - cxp) / rx, (-y1p - cyp) / ry);
  if (!sweep && dt > 0) dt -= 2 * Math.PI;
  if (sweep && dt < 0) dt += 2 * Math.PI;
  const n = Math.max(1, Math.ceil(Math.abs(dt) / (Math.PI / 2)));
  const step = dt / n;
  const k = (4 / 3) * Math.tan(step / 4);
  const pt = (t) => { const ex = rx * Math.cos(t); const ey = ry * Math.sin(t); return [cos * ex - sin * ey + cx, sin * ex + cos * ey + cy]; };
  const der = (t) => { const ex = -rx * Math.sin(t); const ey = ry * Math.cos(t); return [cos * ex - sin * ey, sin * ex + cos * ey]; };
  const out = [];
  for (let i = 0; i < n; i += 1) {
    const a = t1 + i * step; const b = a + step;
    const [ax, ay] = pt(a); const [bx, by] = pt(b); const [dax, day] = der(a); const [dbx, dby] = der(b);
    out.push([ax + k * dax, ay + k * day, bx - k * dbx, by - k * dby, bx, by]);
  }
  return out;
}

/** SVG path data → [['M', x, y] | ['L', x, y] | ['C', x1, y1, x2, y2, x, y] | ['Z']] in absolute coordinates. */
export function pathSegments(d) {
  const segs = [];
  let x = 0; let y = 0; let sx = 0; let sy = 0; let lastC = null; let lastQ = null;
  for (const [cmd, n] of tokens(d)) {
    const rel = cmd === cmd.toLowerCase() && cmd !== 'z';
    const C = cmd.toUpperCase();
    const ax = (v) => (rel ? x + v : v); const ay = (v) => (rel ? y + v : v);
    const per = { M: 2, L: 2, H: 1, V: 1, C: 6, S: 4, Q: 4, T: 2, A: 7, Z: 0 }[C];
    if (C === 'Z') { segs.push(['Z']); x = sx; y = sy; lastC = null; lastQ = null; continue; }
    for (let i = 0; i + per <= n.length; i += per) {
      const v = n.slice(i, i + per);
      if (C === 'M' && i === 0) { x = ax(v[0]); y = ay(v[1]); sx = x; sy = y; segs.push(['M', x, y]); lastC = null; lastQ = null; continue; }
      if (C === 'M' || C === 'L') { x = ax(v[0]); y = ay(v[1]); segs.push(['L', x, y]); lastC = null; lastQ = null; continue; }
      if (C === 'H') { x = rel ? x + v[0] : v[0]; segs.push(['L', x, y]); lastC = null; lastQ = null; continue; }
      if (C === 'V') { y = rel ? y + v[0] : v[0]; segs.push(['L', x, y]); lastC = null; lastQ = null; continue; }
      if (C === 'C' || C === 'S') {
        const [x1, y1] = C === 'C' ? [ax(v[0]), ay(v[1])] : lastC ? [2 * x - lastC[0], 2 * y - lastC[1]] : [x, y];
        const o = C === 'C' ? 2 : 0;
        const x2 = ax(v[o]); const y2 = ay(v[o + 1]); const ex = ax(v[o + 2]); const ey = ay(v[o + 3]);
        segs.push(['C', x1, y1, x2, y2, ex, ey]); lastC = [x2, y2]; lastQ = null; x = ex; y = ey; continue;
      }
      if (C === 'Q' || C === 'T') {
        const [qx, qy] = C === 'Q' ? [ax(v[0]), ay(v[1])] : lastQ ? [2 * x - lastQ[0], 2 * y - lastQ[1]] : [x, y];
        const o = C === 'Q' ? 2 : 0;
        const ex = ax(v[o]); const ey = ay(v[o + 1]);
        segs.push(['C', x + (2 / 3) * (qx - x), y + (2 / 3) * (qy - y), ex + (2 / 3) * (qx - ex), ey + (2 / 3) * (qy - ey), ex, ey]);
        lastQ = [qx, qy]; lastC = null; x = ex; y = ey; continue;
      }
      if (C === 'A') {
        const ex = ax(v[5]); const ey = ay(v[6]);
        arcToCubics(x, y, v[0], v[1], v[2], v[3], v[4], ex, ey).forEach((c) => segs.push(['C', ...c]));
        x = ex; y = ey; lastC = null; lastQ = null;
      }
    }
  }
  return segs;
}

const cache = new Map();
/** The icon's segments (24×24 grid), parsed once. */
export function iconSegments(key) {
  if (!cache.has(key)) { const s = iconShape(key); cache.set(key, { fill: s.fill, paths: s.paths.map(pathSegments) }); }
  return cache.get(key);
}
