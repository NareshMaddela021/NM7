// The new home page's particle shapes (/new-home): each one is a cloud of N points drawn from simple geometry we
// define here (boxes, rings, tubes, discs, lines). Every shape has exactly N points, so the dots can morph from one
// shape to another point by point. Coordinates sit roughly inside a unit sphere (x right, y up, z towards you).
// Pure functions, no three.js: the static fallback picture uses them too.

/** Small seeded random numbers, so a shape is the same on every visit (and in tests). */
export function rng(seed = 7) {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13; s >>>= 0;
    s ^= s >>> 17;
    s ^= s << 5; s >>>= 0;
    return s / 4294967296;
  };
}

/* ---------- samplers: (r = random()) → [x, y, z] on a surface or line ---------- */

const lerp = (a, b, t) => a + (b - a) * t;

/** A point on the surface of a box centred at c with size s (picks a face by its area). */
const box = (c, s) => (r) => {
  const [w, h, d] = s;
  const areas = [h * d, h * d, w * d, w * d, w * h, w * h];
  let pick = r() * areas.reduce((a, b) => a + b, 0);
  let f = 0;
  while (pick > areas[f] && f < 5) { pick -= areas[f]; f += 1; }
  const u = r() - 0.5;
  const v = r() - 0.5;
  const p = [
    [Math.sign(f % 2 - 0.5) * 0.5, u, v],
    [Math.sign(f % 2 - 0.5) * 0.5, u, v],
    [u, Math.sign(f % 2 - 0.5) * 0.5, v],
    [u, Math.sign(f % 2 - 0.5) * 0.5, v],
    [u, v, Math.sign(f % 2 - 0.5) * 0.5],
    [u, v, Math.sign(f % 2 - 0.5) * 0.5],
  ][f];
  return [c[0] + p[0] * w, c[1] + p[1] * h, c[2] + p[2] * d];
};

/** A ring (torus) in the plane given by axis 'z' (x-y plane) or 'y' (x-z plane); arc in radians from a0 to a1. */
const torus = (c, R, tube, axis = 'z', a0 = 0, a1 = Math.PI * 2) => (r) => {
  const a = lerp(a0, a1, r());
  const b = r() * Math.PI * 2;
  const rr = R + tube * Math.cos(b);
  const q = [rr * Math.cos(a), rr * Math.sin(a), tube * Math.sin(b)];
  return axis === 'y' ? [c[0] + q[0], c[1] + q[2], c[2] + q[1]] : [c[0] + q[0], c[1] + q[1], c[2] + q[2]];
};

/** A thick line from a to b (a tube of radius rad). */
const segment = (a, b, rad) => (r) => {
  const t = r();
  const ang = r() * Math.PI * 2;
  const k = rad * Math.sqrt(r());
  return [lerp(a[0], b[0], t) + Math.cos(ang) * k, lerp(a[1], b[1], t) + Math.sin(ang) * k, lerp(a[2], b[2], t) + (r() - 0.5) * rad * 2];
};

/** A vertical cylinder surface (axis y) from y0 to y1. */
const cylinder = (c, rad, y0, y1) => (r) => {
  const a = r() * Math.PI * 2;
  return [c[0] + Math.cos(a) * rad, lerp(y0, y1, r()), c[2] + Math.sin(a) * rad];
};

/** A filled disc facing z (x-y plane). */
const disc = (c, rad) => (r) => {
  const a = r() * Math.PI * 2;
  const k = rad * Math.sqrt(r());
  return [c[0] + Math.cos(a) * k, c[1] + Math.sin(a) * k, c[2] + (r() - 0.5) * 0.04];
};

/** Points spread through several parts: parts = [[weight, sampler], …]. Always exactly n points. */
function build(n, parts, seed) {
  const r = rng(seed);
  const total = parts.reduce((a, [w]) => a + w, 0);
  const counts = parts.map(([w]) => Math.floor((w / total) * n));
  let left = n - counts.reduce((a, b) => a + b, 0);
  for (let i = 0; left > 0; i = (i + 1) % counts.length, left -= 1) counts[i] += 1;
  const out = new Float32Array(n * 3);
  let k = 0;
  parts.forEach(([, sample], i) => {
    for (let j = 0; j < counts[i]; j += 1) {
      const p = sample(r);
      out[k] = p[0]; out[k + 1] = p[1]; out[k + 2] = p[2];
      k += 3;
    }
  });
  return out;
}

/* ---------- the shapes ---------- */

function sphere(n) {
  const out = new Float32Array(n * 3);
  const golden = Math.PI * (3 - Math.sqrt(5));
  const r = rng(3);
  for (let i = 0; i < n; i += 1) {
    const y = 1 - (i / (n - 1)) * 2;
    const rad = Math.sqrt(1 - y * y);
    const a = golden * i;
    const k = 0.92 + r() * 0.08; // a little depth, so it reads as a cloud and not a shell
    out[i * 3] = Math.cos(a) * rad * k; out[i * 3 + 1] = y * k; out[i * 3 + 2] = Math.sin(a) * rad * k;
  }
  return out;
}

const ticks = (n, R) => Array.from({ length: n }, (_, i) => {
  const a = (i / n) * Math.PI * 2;
  const r0 = i % 3 === 0 ? R - 0.14 : R - 0.08;
  return [1, segment([Math.cos(a) * r0, Math.sin(a) * r0 - 0.08, 0], [Math.cos(a) * R, Math.sin(a) * R - 0.08, 0], 0.012)];
});

/** Stopwatch: a thick ring, tick marks, two hands, the crown and a side button. */
const stopwatch = (n) => build(n, [
  [34, torus([0, -0.08, 0], 0.72, 0.07)],
  [12, disc([0, -0.08, -0.05], 0.62)],
  ...ticks(12, 0.6),
  [6, segment([0, -0.08, 0.02], [0, 0.4, 0.02], 0.025)],
  [5, segment([0, -0.08, 0.02], [0.3, 0.05, 0.02], 0.025)],
  [5, segment([0, 0.72, 0], [0, 0.86, 0], 0.05)],
  [5, box([0, 0.92, 0], [0.26, 0.1, 0.14])],
  [3, segment([0.5, 0.52, 0], [0.62, 0.64, 0], 0.04)],
], 11);

/** College building: steps, a row of columns, a beam, a triangular roof and a flag. */
function college(n) {
  const cols = [-0.6, -0.36, -0.12, 0.12, 0.36, 0.6].map((x) => [4, cylinder([x, 0, 0.18], 0.055, -0.5, 0.22)]);
  const roof = (r) => { // the roof's triangle (front and back): corners (-0.88, 0.34), (0.88, 0.34), (0, 0.72)
    const u = r(); const v = r();
    const [a, b] = u + v > 1 ? [1 - u, 1 - v] : [u, v];
    return [-0.88 + a * 1.76 + b * 0.88, 0.34 + b * 0.38, r() < 0.5 ? 0.25 : -0.25];
  };
  return build(n, [
    [10, box([0, -0.62, 0], [1.9, 0.08, 0.7])],
    [8, box([0, -0.54, 0], [1.75, 0.08, 0.62])],
    ...cols,
    [10, box([0, 0.28, 0], [1.8, 0.12, 0.56])],
    [16, roof],
    [6, segment([-0.88, 0.34, 0.25], [0, 0.72, 0.25], 0.02)],
    [6, segment([0.88, 0.34, 0.25], [0, 0.72, 0.25], 0.02)],
    [8, box([0, -0.16, -0.12], [1.5, 0.68, 0.3])],
    [3, segment([0, 0.72, 0], [0, 0.98, 0], 0.012)],
    [2, box([0.09, 0.92, 0], [0.16, 0.1, 0.02])],
  ], 13);
}

/** Briefcase: the case, its lid line, a handle and two latches. */
const briefcase = (n) => build(n, [
  [62, box([0, -0.14, 0], [1.6, 1.0, 0.42])],
  [8, segment([-0.8, 0.12, 0.22], [0.8, 0.12, 0.22], 0.015)],
  [14, torus([0, 0.36, 0], 0.22, 0.045, 'z', 0, Math.PI)],
  [4, box([-0.42, 0.12, 0.22], [0.14, 0.1, 0.04])],
  [4, box([0.42, 0.12, 0.22], [0.14, 0.1, 0.04])],
  [8, box([0, 0.38, 0], [0.62, 0.05, 0.12])],
], 17);

/** Graduation cap: the square board (turned like a diamond), the cap under it, and the tassel. */
function cap(n) {
  const board = (r) => { // a flat square in the x-z plane, turned 45°
    const u = r() - 0.5; const v = r() - 0.5;
    const s = 1.5;
    const x = (u - v) * s * 0.7071; const z = (u + v) * s * 0.7071;
    return [x, 0.22 + (r() - 0.5) * 0.05, z * 0.75];
  };
  return build(n, [
    [46, board],
    [24, cylinder([0, 0, 0], 0.46, -0.24, 0.2)],
    [8, torus([0, -0.24, 0], 0.46, 0.04, 'y')],
    [4, segment([0, 0.25, 0], [0.62, 0.22, 0.35], 0.012)],
    [6, segment([0.62, 0.22, 0.35], [0.62, -0.4, 0.35], 0.015)],
    [5, segment([0.62, -0.4, 0.35], [0.62, -0.58, 0.35], 0.06)],
    [2, box([0, 0.27, 0], [0.1, 0.04, 0.1])],
  ], 19);
}

/** Resume page: a sheet, a photo square, a name line and rows of text lines. */
function resume(n) {
  const lines = [0.32, 0.18, 0.06, -0.06, -0.18, -0.3, -0.42, -0.54].map((y, i) => [5, segment([-0.42, y, 0.02], [i % 3 === 2 ? 0.1 : 0.42, y, 0.02], 0.014)]);
  return build(n, [
    [34, box([0, -0.05, 0], [1.1, 1.5, 0.04])],
    [6, box([-0.3, 0.52, 0.02], [0.28, 0.28, 0.02])],
    [5, segment([0.0, 0.58, 0.02], [0.42, 0.58, 0.02], 0.02)],
    [3, segment([0.0, 0.48, 0.02], [0.3, 0.48, 0.02], 0.014)],
    ...lines,
    [5, segment([0.3, 0.7, 0.03], [0.55, 0.45, 0.03], 0.015)],
  ], 23);
}

/** Magnifier: a lens ring, the glass and a handle. */
const magnifier = (n) => build(n, [
  [42, torus([-0.18, 0.18, 0], 0.5, 0.07)],
  [14, disc([-0.18, 0.18, 0], 0.42)],
  [28, segment([0.2, -0.2, 0], [0.7, -0.7, 0], 0.08)],
  [6, torus([0.2, -0.2, 0], 0.06, 0.03)],
], 29);

/** Check badge: a scalloped round badge with a tick inside. */
function badge(n) {
  const scallop = (r) => {
    const a = r() * Math.PI * 2;
    const R = 0.74 + 0.06 * Math.cos(a * 12);
    const k = R + (r() - 0.5) * 0.08;
    return [Math.cos(a) * k, Math.sin(a) * k, (r() - 0.5) * 0.1];
  };
  return build(n, [
    [40, scallop],
    [16, disc([0, 0, -0.04], 0.6)],
    [14, segment([-0.32, 0.0, 0.05], [-0.08, -0.24, 0.05], 0.06)],
    [22, segment([-0.08, -0.24, 0.05], [0.38, 0.3, 0.05], 0.06)],
  ], 31);
}

/** Handshake (drawn simply): two sleeves meeting at clasped hands, with finger lines. */
const handshake = (n) => build(n, [
  [20, segment([-1.0, -0.35, 0], [-0.32, 0.0, 0], 0.13)],
  [20, segment([1.0, -0.35, 0], [0.32, 0.0, 0], 0.13)],
  [6, torus([-0.95, -0.32, 0], 0.14, 0.03, 'z')],
  [6, torus([0.95, -0.32, 0], 0.14, 0.03, 'z')],
  [22, box([0, 0.02, 0], [0.7, 0.36, 0.3])],
  ...[-0.12, -0.02, 0.08].map((y) => [4, segment([-0.3, y, 0.16], [0.3, y + 0.04, 0.16], 0.02)]),
  [6, segment([-0.1, 0.2, 0.12], [0.2, 0.32, 0.12], 0.04)],
], 37);

export const SHAPES = { sphere, stopwatch, college, briefcase, cap, resume, magnifier, badge, handshake };
export const SHAPE_NAMES = Object.keys(SHAPES);

const cache = new Map();
/** The points of a shape (cached per shape and size). Unknown names give the sphere. */
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
