// The new home page's particle shapes (/new-home), drawn like the asuraa.ai "CUTE" orb: neat dots of one size.
// Each shape is a line drawing: most dots sit on its outlines and key details (edges, the handle, the stopwatch
// hands and ticks, the columns and roof lines, the cap's brim and tassel), evenly spaced along every line; a light
// fill inside is laid out in tidy rows or rings, never scattered. The sphere is made of latitude rings.
// Every shape has exactly N dots (so they can morph point to point), and all shapes share one spatial order (height
// bands, then angle), so each dot travels to a nearby spot. Coordinates sit roughly inside a unit sphere (x right, y
// up, z towards you). Pure functions, no three.js: the still picture uses them too.

/** Small seeded random numbers (kept for anything that needs a repeatable shuffle). */
export function rng(seed = 7) {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13; s >>>= 0;
    s ^= s >>> 17;
    s ^= s << 5; s >>>= 0;
    return s / 4294967296;
  };
}

/* ---------- drawing helpers: each returns strokes { pts: [[x, y, z], …], closed, w } ---------- */
// w = how many dots per unit of length, relative to an outline (1). Details get more (1.3–1.6) so they read clearly;
// the inside fill gets far fewer (FILL), so it stays light.
const FILL = 0.32;
/** The gap between neighbouring dots on an outline (w = 1), in shape units: wide enough that every dot stays a dot. */
export const SPACING = 0.055;
const DETAIL = 1.5;
const TAU = Math.PI * 2;

const line = (a, b, w = 1) => ({ pts: [a, b], closed: false, w });
const path = (pts, w = 1, closed = false) => ({ pts, closed, w });
/** An arc around centre c in the x-y plane at depth z, from angle a0 to a1 (radians). */
const arc = (c, r, a0, a1, z = 0, w = 1, ry = r) => {
  const n = Math.max(8, Math.ceil(Math.abs(a1 - a0) * 24));
  return path(Array.from({ length: n + 1 }, (_, i) => { const a = a0 + ((a1 - a0) * i) / n; return [c[0] + Math.cos(a) * r, c[1] + Math.sin(a) * ry, z]; }), w);
};
const circle = (c, r, z = 0, w = 1) => ({ ...arc(c, r, 0, TAU, z, w), closed: true });
/** A rectangle outline in the x-y plane at depth z. */
const rect = (x0, y0, x1, y1, z = 0, w = 1) => path([[x0, y0, z], [x1, y0, z], [x1, y1, z], [x0, y1, z]], w, true);
/** A rectangle with rounded corners. */
function roundRect(x0, y0, x1, y1, r, z = 0, w = 1) {
  const pts = [];
  const corner = (cx, cy, a0) => { for (let i = 0; i <= 6; i += 1) { const a = a0 + (Math.PI / 2) * (i / 6); pts.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r, z]); } };
  corner(x1 - r, y0 + r, -Math.PI / 2); corner(x1 - r, y1 - r, 0); corner(x0 + r, y1 - r, Math.PI / 2); corner(x0 + r, y0 + r, Math.PI);
  return path(pts, w, true);
}
/** Tidy fill rows: horizontal lines from x0 to x1 at each y (inset already applied by the caller). */
const rows = (x0, x1, ys, z = 0, w = FILL) => ys.map((y) => line([x0, y, z], [x1, y, z], w));
/** Tidy fill rings: concentric circles. */
const rings = (c, radii, z = 0, w = FILL) => radii.map((r) => circle(c, r, z, w));
/** Depth: the same strokes copied to another depth (for the back edges of a solid). */
const at = (strokes, z, w) => strokes.map((s) => ({ ...s, pts: s.pts.map(([x, y]) => [x, y, z]), w: w ?? s.w }));

/* ---------- placing the dots ---------- */

function strokeLength({ pts, closed }) {
  let len = 0;
  const m = closed ? pts.length : pts.length - 1;
  for (let i = 0; i < m; i += 1) {
    const a = pts[i]; const b = pts[(i + 1) % pts.length];
    len += Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
  }
  return len;
}

/** k dots evenly spaced along a stroke by length (open lines keep half a gap at each end, so lines that meet
 * never put two dots on the same spot). */
function along(stroke, k, out) {
  const { pts, closed } = stroke;
  const total = strokeLength(stroke);
  const m = closed ? pts.length : pts.length - 1;
  let seg = 0; let segStart = 0;
  for (let j = 0; j < k; j += 1) {
    const d = ((j + (closed ? 0 : 0.5)) / k) * total;
    for (;;) {
      const a = pts[seg]; const b = pts[(seg + 1) % pts.length];
      const len = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
      if (d <= segStart + len || seg >= m - 1) {
        const t = len ? Math.min(1, (d - segStart) / len) : 0;
        out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]);
        break;
      }
      segStart += len; seg += 1;
    }
  }
}

/**
 * Exactly n dots for the strokes. The drawing itself uses as many dots as its lines need at SPACING (shared out by
 * length × weight, largest remainder, evenly along each stroke); any dots left over sit exactly on top of drawn
 * ones, spread evenly over the drawing, so they look like one dot, and fan out to their own places in a morph.
 */
function draw(n, strokes) {
  const want = strokes.map((s) => strokeLength(s) * s.w);
  const sum = want.reduce((a, b) => a + b, 0);
  const k = Math.max(1, Math.min(n, Math.round(sum / SPACING)));
  const share = want.map((v) => (v / sum) * k);
  const counts = share.map(Math.floor);
  let left = k - counts.reduce((a, b) => a + b, 0);
  share.map((v, i) => [v - Math.floor(v), i]).sort((a, b) => b[0] - a[0]).forEach(([, i]) => { if (left > 0) { counts[i] += 1; left -= 1; } });
  const pts = [];
  const kinds = [];
  strokes.forEach((s, i) => { const before = pts.length; along(s, counts[i], pts); for (let j = before; j < pts.length; j += 1) kinds.push(s.w <= FILL ? 0 : 1); });
  const drawn = pts.length;
  for (let j = 0; pts.length < n; j += 1) { const from = Math.floor((j * drawn) / (n - drawn)) % drawn; pts.push(pts[from]); kinds.push(kinds[from]); }
  return { pts, kinds };
}

/** The same spatial order for every shape: height bands from the top, then the angle around the vertical axis. */
function tidyOrder({ pts, kinds }) {
  const key = ([x, y, z]) => Math.round((1.2 - y) * 12) * 10 + ((Math.atan2(z, x) + Math.PI) / TAU) * 9.99;
  const idx = pts.map((p, i) => [key(p), i]).sort((a, b) => a[0] - b[0]).map(([, i]) => i);
  const out = new Float32Array(pts.length * 3);
  idx.forEach((from, to) => out.set(pts[from], to * 3));
  out.outline = idx.reduce((a, i) => a + kinds[i], 0) / pts.length; // the share of dots on outlines and details
  return out;
}

const make = (strokesFor) => (n) => tidyOrder(draw(n, strokesFor()));

/* ---------- the shapes ---------- */

/** Sphere: latitude rings like the CUTE orb, each ring's dots evenly spaced and the rings evenly spread. */
function sphere(n) {
  const ringCount = Math.max(6, Math.round(Math.sqrt((n * Math.PI) / 4)));
  const lat = Array.from({ length: ringCount }, (_, i) => Math.PI * ((i + 0.5) / ringCount)); // from the top
  const circ = lat.map((t) => Math.sin(t));
  const total = circ.reduce((a, b) => a + b, 0);
  const share = circ.map((c) => (c / total) * n);
  const counts = share.map(Math.floor);
  let left = n - counts.reduce((a, b) => a + b, 0);
  share.map((v, i) => [v - Math.floor(v), i]).sort((a, b) => b[0] - a[0]).forEach(([, i]) => { if (left > 0) { counts[i] += 1; left -= 1; } });
  const pts = [];
  lat.forEach((t, i) => {
    const y = Math.cos(t); const r = Math.sin(t);
    const turn = (i % 2) * 0.5; // alternate rings sit half a step round, like a woven mesh
    for (let j = 0; j < counts[i]; j += 1) { const a = ((j + turn) / counts[i]) * TAU; pts.push([Math.cos(a) * r, y, Math.sin(a) * r]); }
  });
  const out = new Float32Array(n * 3); // rings stay in order (top to bottom), which is the tidy order already
  pts.forEach((p, i) => out.set(p, i * 3));
  out.outline = 1;
  return out;
}

/** Stopwatch: two rims (front and back), the dial ring, 12 ticks, both hands, the centre, crown and side button. */
const stopwatch = make(() => {
  const c = [0, -0.1];
  const ticks = Array.from({ length: 12 }, (_, i) => {
    const a = (i / 12) * TAU; const r0 = i % 3 === 0 ? 0.44 : 0.5;
    return line([c[0] + Math.cos(a) * r0, c[1] + Math.sin(a) * r0, 0.04], [c[0] + Math.cos(a) * 0.58, c[1] + Math.sin(a) * 0.58, 0.04], DETAIL);
  });
  return [
    circle(c, 0.74, 0.06), circle(c, 0.74, -0.06, 0.6), circle(c, 0.64, 0.05),
    ...ticks,
    line([c[0], c[1] + 0.07, 0.06], [c[0], c[1] + 0.42, 0.06], 1.7), // minute hand
    line([c[0] + 0.06, c[1] + 0.03, 0.06], [c[0] + 0.27, c[1] + 0.15, 0.06], 1.7), // hour hand
    circle(c, 0.04, 0.06, DETAIL),
    rect(-0.05, 0.64, 0.05, 0.8, 0.02), roundRect(-0.15, 0.8, 0.15, 0.92, 0.03, 0.02, DETAIL), // crown
    line([0.47, 0.5, 0.02], [0.56, 0.6, 0.02], DETAIL), line([0.5, 0.64, 0.02], [0.63, 0.51, 0.02], DETAIL), // side button
    ...rings(c, [0.22], 0.04),
  ];
});

/** College building: steps, six columns, the beam, the roof triangle with an emblem, a flag; a light row on the steps. */
const college = make(() => {
  const front = 0.22;
  const cols = [-0.62, -0.37, -0.12, 0.13, 0.38, 0.63].map((x) => line([x, -0.5, front], [x, 0.2, front], 1.3));
  const roof = path([[-0.95, 0.34, front], [0, 0.74, front], [0.95, 0.34, front]], 1.2); // its base is the beam's top edge
  return [
    rect(-0.98, -0.72, 0.98, -0.62, front), path([[-0.88, -0.62, front], [-0.88, -0.52, front], [0.88, -0.52, front], [0.88, -0.62, front]]), // steps
    ...cols,
    rect(-0.9, 0.2, 0.9, 0.34, front),
    roof, path([[-0.62, 0.42, front], [0, 0.65, front], [0.62, 0.42, front]], 0.7, true),
    circle([0, 0.5], 0.05, front, DETAIL),
    line([0, 0.74, 0], [0, 1.0, 0], DETAIL), path([[0, 1.0, 0], [0.2, 0.95, 0], [0, 0.9, 0]], DETAIL),
    ...at([rect(-0.98, -0.72, 0.98, -0.62), path([[-0.95, 0.34], [0, 0.74], [0.95, 0.34]], 1, true)], -front, 0.45), // back edges
    ...rows(-0.8, 0.8, [-0.57], front),
  ];
});

/** Briefcase: the case (front and back edges, corners joined), the lid seam, the handle, two latches; light rows. */
const briefcase = make(() => {
  const f = 0.2;
  return [
    roundRect(-0.82, -0.62, 0.82, 0.36, 0.09, f), roundRect(-0.82, -0.62, 0.82, 0.36, 0.09, -f, 0.45),
    ...[[-0.82, -0.53], [0.82, -0.53], [-0.82, 0.27], [0.82, 0.27]].map(([x, y]) => line([x, y, -f], [x, y, f], 0.8)),
    line([-0.82, 0.08, f], [0.82, 0.08, f], 1.2), // lid seam
    arc([0, 0.36], 0.25, 0, Math.PI, 0, DETAIL), arc([0, 0.36], 0.16, 0, Math.PI, 0, DETAIL), // handle
    line([-0.25, 0.36, 0], [-0.16, 0.36, 0], DETAIL), line([0.16, 0.36, 0], [0.25, 0.36, 0], DETAIL),
    roundRect(-0.5, 0.02, -0.36, 0.14, 0.02, f + 0.01, DETAIL), roundRect(0.36, 0.02, 0.5, 0.14, 0.02, f + 0.01, DETAIL), // latches
    ...rows(-0.66, 0.66, [-0.42, -0.2], f), ...rows(-0.66, 0.66, [0.22], f),
  ];
});

/** Graduation cap: the board (seen from the front, with its back edge), the cap below with a curved brim, the
 * button, and the tassel with its fringe; light rows on the cap. */
const cap = make(() => {
  const board = path([[-0.98, 0.3, 0.05], [0, 0.52, -0.05], [0.98, 0.3, 0.05], [0, 0.08, 0.15]], 1.2, true);
  return [
    board, path([[-0.6, 0.3, 0.05], [0, 0.43, -0.02], [0.6, 0.3, 0.05], [0, 0.17, 0.11]], FILL, true),
    line([-0.5, 0.14, 0.1], [-0.5, -0.24, 0.1]), line([0.5, 0.14, 0.1], [0.5, -0.24, 0.1]),
    arc([0, -0.24], 0.5, Math.PI, TAU, 0.12, 1.3, 0.12), // the brim, curving down at the front
    arc([0, -0.24], 0.5, 0, Math.PI, 0.02, 0.5, 0.06), // its back edge
    circle([0, 0.3], 0.045, 0.06, DETAIL),
    line([0.04, 0.3, 0.06], [0.74, 0.24, 0.08], DETAIL), line([0.74, 0.24, 0.08], [0.74, -0.28, 0.08], DETAIL), // tassel cord
    ...[-0.08, -0.03, 0.02, 0.07].map((dx) => line([0.74 + dx * 0.5, -0.31, 0.08], [0.74 + dx, -0.52, 0.08], DETAIL)), // fringe
    ...[-0.02, -0.12].map((y) => arc([0, y], 0.42, Math.PI * 1.08, Math.PI * 1.92, 0.12, FILL, 0.08)),
  ];
});

/** Resume page: the sheet with a folded corner, a photo, a name line and text lines. */
const resume = make(() => [
  path([[-0.55, -0.8, 0], [0.55, -0.8, 0], [0.55, 0.52, 0], [0.37, 0.7, 0], [-0.55, 0.7, 0]], 1, true),
  path([[0.37, 0.7, 0.01], [0.37, 0.52, 0.01], [0.55, 0.52, 0.01]], DETAIL),
  roundRect(-0.43, 0.32, -0.15, 0.6, 0.03, 0.01, DETAIL),
  line([-0.06, 0.52, 0.01], [0.28, 0.52, 0.01], DETAIL), line([-0.06, 0.4, 0.01], [0.18, 0.4, 0.01], 1.1),
  ...[0.18, 0.04, -0.1, -0.24, -0.38, -0.52, -0.66].map((y, i) => line([-0.43, y, 0.01], [i % 3 === 2 ? 0.1 : 0.43, y, 0.01], 0.9)),
]);

/** Magnifier: the lens rim (two rings), a glint, the handle. */
const magnifier = make(() => [
  circle([-0.18, 0.18], 0.52, 0.02), circle([-0.18, 0.18], 0.43, 0.02),
  arc([-0.18, 0.18], 0.3, Math.PI * 0.6, Math.PI * 0.95, 0.02, DETAIL),
  path([[0.17, -0.22, 0], [0.7, -0.75, 0], [0.78, -0.67, 0], [0.25, -0.14, 0]], 1.3, true),
  ...rings([-0.18, 0.18], [0.18], 0.02),
]);

/** Check badge: a scalloped rim, an inner ring and a bold tick. */
const badge = make(() => [
  path(Array.from({ length: 120 }, (_, i) => { const a = (i / 120) * TAU; const r = 0.76 + 0.06 * Math.cos(a * 12); return [Math.cos(a) * r, Math.sin(a) * r, 0]; }), 1, true),
  circle([0, 0], 0.58, 0.02),
  path([[-0.32, 0.0, 0.04], [-0.08, -0.24, 0.04], [0.38, 0.3, 0.04]], 2),
  ...rings([0, 0], [0.4], 0.02),
]);

/** Handshake (drawn simply): two sleeves with cuffs meeting at clasped hands with finger lines. */
const handshake = make(() => [
  path([[-1.0, -0.45, 0], [-0.4, -0.1, 0], [-0.32, -0.26, 0], [-0.92, -0.62, 0]], 1, true),
  path([[1.0, -0.45, 0], [0.4, -0.1, 0], [0.32, -0.26, 0], [0.92, -0.62, 0]], 1, true),
  line([-0.48, -0.06, 0.01], [-0.36, -0.3, 0.01], DETAIL), line([0.48, -0.06, 0.01], [0.36, -0.3, 0.01], DETAIL), // cuffs
  roundRect(-0.34, -0.2, 0.34, 0.18, 0.08, 0.02),
  ...[-0.08, 0.0, 0.08].map((y) => line([-0.26, y, 0.04], [0.26, y + 0.03, 0.04], DETAIL)),
  line([-0.12, 0.18, 0.04], [0.16, 0.3, 0.04], DETAIL),
]);

/**
 * Each shape's colours: dots go from `a` (bottom) to `b` (top); `glow` is the soft light behind the shape. Chosen to
 * stand out on the light page (3:1 or more against white for the dots), not neon. Shapes without their own colours
 * (the journey and trust shapes) use the Nm7 purple of the sphere.
 */
export const SHAPE_COLORS = {
  sphere: { a: '#5b52f0', b: '#9b55f2', glow: '#cbbfff' }, // Nm7 purple, lavender glow
  stopwatch: { a: '#1d4ed8', b: '#2563eb', glow: '#bcd2ff' }, // companies: deep blue, soft blue glow
  college: { a: '#0f766e', b: '#0d9488', glow: '#a9efd6' }, // colleges: teal, soft mint glow
  briefcase: { a: '#c2570c', b: '#e0701a', glow: '#ffd2ad' }, // job seekers: orange, soft peach glow
  cap: { a: '#be185d', b: '#db2777', glow: '#fbc4da' }, // students: magenta, soft pink glow
};
export const colorsFor = (name) => SHAPE_COLORS[name] || SHAPE_COLORS.sphere;

export const SHAPES = { sphere, stopwatch, college, briefcase, cap, resume, magnifier, badge, handshake };
export const SHAPE_NAMES = Object.keys(SHAPES);

const cache = new Map();
/** The points of a shape (cached per shape and size). Unknown names give the sphere. `.outline` on the result is
 * the share of dots on outlines and details. */
export function shapePoints(name, n) {
  const key = `${name}:${n}`;
  if (!cache.has(key)) cache.set(key, (SHAPES[name] || sphere)(n));
  return cache.get(key);
}

/** A 2D picture of a shape for the static fallback: [x, y, depth] in a size × size box, turned a little. */
export function projectPoints(name, n, size, turn = -0.5, tilt = 0.18) {
  const p = shapePoints(name, n);
  const out = [];
  const [cy, sy, cx, sx] = [Math.cos(turn), Math.sin(turn), Math.cos(tilt), Math.sin(tilt)];
  for (let i = 0; i < n; i += 1) {
    const x = p[i * 3]; const y = p[i * 3 + 1]; const z = p[i * 3 + 2];
    const x1 = x * cy + z * sy; const z1 = -x * sy + z * cy;
    const y2 = y * cx - z1 * sx; const z2 = y * sx + z1 * cx;
    out.push([size / 2 + x1 * size * 0.4, size / 2 - y2 * size * 0.4, z2]);
  }
  return out;
}
