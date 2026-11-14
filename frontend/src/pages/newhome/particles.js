// The new home page's 3D dots (/new-home), in the style of the asuraa.ai "CUTE" voice orb: neat, evenly spaced dots
// of one size (shapes.js lays them out), a slow wave that ripples across the rings like the orb breathing, a soft
// dent where the mouse (or a finger) is that springs back when it leaves, and colours that fade to each shape's own
// palette as the dots morph point to point. The shape only sways (never more than about 25°), so it always faces you.
// This file and three.js are their own chunk, loaded only after the page has painted, and only where WebGL works
// (ParticleStage.jsx decides).
import { BufferAttribute, BufferGeometry, Color, NormalBlending, PerspectiveCamera, Points, Scene, ShaderMaterial, Vector2, WebGLRenderer } from 'three';
import { SHAPE_NAMES, colorsFor, shapePoints } from './shapes';

const MORPH_MS = 1700;
const MAX_TURN = (25 * Math.PI) / 180; // the most a shape turns either way
const SPREAD = 0.22; // a small per-dot head start (top dots move first), so the morph flows but stays tidy
/** A page colour (#hex) as the shader needs it: three.js stores colours in linear space, but this shader writes
 * straight to the screen, so convert back, or every colour comes out darker than designed. */
const shown = (hex) => new Color(hex).convertLinearToSRGB();
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);
/** How far one dot is through the morph (the same formula as the vertex shader). */
const dotT = (mix, order) => ease(clamp(mix * (1 + SPREAD) - order * SPREAD, 0, 1));

const VERT = /* glsl */ `
  attribute vec3 aTarget;
  attribute float aOrder;
  uniform float uMix;
  uniform float uTime;
  uniform float uSize;
  uniform float uPixel;
  uniform vec2 uMouse;   // the cursor in screen space (-1…1)
  uniform float uPush;   // 0 … 1: how strongly the dots near it move away (springs back to 0)
  uniform float uAspect;
  varying float vY;
  float ease(float t) { return t < 0.5 ? 4.0 * t * t * t : 1.0 - pow(-2.0 * t + 2.0, 3.0) / 2.0; }
  void main() {
    float t = ease(clamp(uMix * ${(1 + SPREAD).toFixed(2)} - aOrder * ${SPREAD.toFixed(2)}, 0.0, 1.0));
    vec3 p = mix(position, aTarget, t);
    // breathing: a slow wave runs down the rings, moving each dot a little in and out
    vec3 out_ = normalize(p + vec3(0.0001));
    // (small: enough to ripple the sphere's rings, while straight lines in the drawings stay straight)
    p += out_ * 0.012 * sin(p.y * 7.0 - uTime * 1.6) * (0.6 + 0.4 * sin(uTime * 0.5));
    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    vec4 clip = projectionMatrix * mv;
    // the soft dent: dots near the cursor slide away from it on screen
    vec2 d = clip.xy / clip.w - uMouse;
    d.x *= uAspect;
    float near = exp(-dot(d, d) / 0.018);
    mv.xy += normalize(d + vec2(0.00001)) * near * uPush * 0.16;
    gl_Position = projectionMatrix * mv;
    gl_PointSize = uSize * uPixel / -mv.z;
    vY = p.y;
  }
`;

const FRAG = /* glsl */ `
  uniform vec3 uColA;
  uniform vec3 uColB;
  varying float vY;
  void main() {
    float d = length(gl_PointCoord - 0.5);
    if (d > 0.5) discard;
    vec3 col = mix(uColA, uColB, clamp(vY * 0.6 + 0.5, 0.0, 1.0));
    gl_FragColor = vec4(col, smoothstep(0.5, 0.32, d)); // a small round dot with a crisp, soft edge
  }
`;

/**
 * Starts the scene in `host` (a div). count = number of dots; phone = lighter touch push.
 * Returns { morph(name), setSide(x), stop() }. Throws if WebGL can't start (the caller keeps the still picture).
 */
export function startParticles(host, { count = 1100, shape = 'sphere', phone = false } = {}) {
  const renderer = new WebGLRenderer({ antialias: false, alpha: true, powerPreference: 'low-power', failIfMajorPerformanceCaveat: true });
  const pixel = Math.min(window.devicePixelRatio || 1, 1.75);
  renderer.setPixelRatio(pixel);
  renderer.setClearColor(0x000000, 0);
  host.appendChild(renderer.domElement);
  renderer.domElement.setAttribute('aria-hidden', 'true');

  const scene = new Scene();
  const camera = new PerspectiveCamera(40, 1, 0.1, 50);
  camera.position.set(0, 0, 4.2);

  const from = new Float32Array(shapePoints('sphere', count));
  let to = shapePoints(shape, count);
  const order = new Float32Array(count); // the tidy order shapes.js gives every shape: top dots first
  for (let i = 0; i < count; i += 1) order[i] = i / count;
  const geo = new BufferGeometry();
  geo.setAttribute('position', new BufferAttribute(from, 3));
  geo.setAttribute('aTarget', new BufferAttribute(new Float32Array(to), 3));
  geo.setAttribute('aOrder', new BufferAttribute(order, 1));
  const start = colorsFor('sphere');
  const colA = shown(start.a);
  const colB = shown(start.b);
  const mat = new ShaderMaterial({
    vertexShader: VERT,
    fragmentShader: FRAG,
    transparent: true,
    depthWrite: false,
    blending: NormalBlending,
    uniforms: {
      uMix: { value: 0 }, uTime: { value: 0 }, uSize: { value: 21 }, uPixel: { value: pixel },
      uMouse: { value: new Vector2(9, 9) }, uPush: { value: 0 }, uAspect: { value: 1 },
      uColA: { value: colA.clone() }, uColB: { value: colB.clone() },
    },
  });
  const dots = new Points(geo, mat);
  dots.frustumCulled = false;
  scene.add(dots);

  let morphStart = performance.now();
  let current = shape;
  let fromCols = [colA.clone(), colB.clone()];
  let toCols = [shown(colorsFor(shape).a), shown(colorsFor(shape).b)];
  let side = 0; // where the shape sits: -1 left … 1 right of the screen
  let sideNow = 0;
  let placed = false;
  const pointer = { x: 0, y: 0, sx: 0, sy: 0, at: 0, strength: 1 };
  let push = 0;
  let scrollKick = 0;
  let lastScroll = window.scrollY;

  const size = () => {
    const w = host.clientWidth || window.innerWidth;
    const h = host.clientHeight || window.innerHeight;
    renderer.setSize(w, h, false);
    renderer.domElement.style.width = '100%';
    renderer.domElement.style.height = '100%';
    camera.aspect = w / h;
    camera.position.z = w < 700 ? 5.2 : 4.2;
    camera.updateProjectionMatrix();
    mat.uniforms.uAspect.value = camera.aspect;
  };
  size();

  const onMove = (e) => {
    // relative to the canvas, so the dent lands under the cursor whether the canvas fills the window or a small box
    const box = renderer.domElement.getBoundingClientRect();
    pointer.x = ((e.clientX - box.left) / (box.width || 1)) * 2 - 1;
    pointer.y = ((e.clientY - box.top) / (box.height || 1)) * 2 - 1;
    pointer.at = performance.now();
    pointer.strength = e.pointerType === 'touch' || phone ? 0.55 : 1; // lighter on phones
  };
  const onLeave = () => { pointer.at = 0; };
  const onUp = (e) => { if (e.pointerType === 'touch') onLeave(); }; // a finger lifted: spring back
  const onScroll = () => { const y = window.scrollY; scrollKick += (y - lastScroll) * 0.0009; lastScroll = y; };
  window.addEventListener('pointermove', onMove, { passive: true });
  window.addEventListener('pointerdown', onMove, { passive: true });
  window.addEventListener('pointerup', onUp, { passive: true });
  document.addEventListener('pointerleave', onLeave);
  window.addEventListener('blur', onLeave);
  window.addEventListener('scroll', onScroll, { passive: true });
  window.addEventListener('resize', size);

  const t0 = performance.now();
  let spin = 0;
  const frame = (now) => {
    const mix = Math.min(1, (now - morphStart) / MORPH_MS);
    mat.uniforms.uMix.value = mix;
    mat.uniforms.uTime.value = (now - t0) / 1000;
    // colours fade with the morph
    const c = ease(mix);
    mat.uniforms.uColA.value.copy(fromCols[0]).lerp(toCols[0], c);
    mat.uniforms.uColB.value.copy(fromCols[1]).lerp(toCols[1], c);
    // the dent follows the cursor; it fades out (springs back) about a second after the cursor stops or leaves
    const active = pointer.at && now - pointer.at < 1200;
    push += ((active ? pointer.strength : 0) - push) * (active ? 0.12 : 0.05);
    mat.uniforms.uPush.value = push;
    mat.uniforms.uMouse.value.set(pointer.x, -pointer.y);
    pointer.sx += (pointer.x - pointer.sx) * 0.04;
    pointer.sy += (pointer.y - pointer.sy) * 0.04;
    scrollKick *= 0.92;
    spin += 0.006;
    // a gentle sway only (±25° at most): the shape always faces forward, never turns side-on into a thin stick
    dots.rotation.y = clamp(Math.sin(spin) * 0.3 + pointer.sx * 0.12 + scrollKick, -MAX_TURN, MAX_TURN);
    dots.rotation.x = clamp(Math.sin(spin * 0.7) * 0.08 + pointer.sy * 0.08, -0.2, 0.2);
    sideNow += (side - sideNow) * 0.05;
    // on a wide screen the shape sits in the outer ~38% of the screen and is sized to fit there, clear of the text
    const halfWidth = Math.tan((camera.fov * Math.PI) / 360) * camera.position.z * camera.aspect;
    const away = Math.abs(sideNow);
    dots.position.x = sideNow * halfWidth * 0.64;
    dots.scale.setScalar(away > 0.01 ? Math.min(1, 1 - away + away * halfWidth * 0.3) : 1);
    renderer.render(scene, camera);
  };
  renderer.setAnimationLoop(frame);

  const onVisible = () => renderer.setAnimationLoop(document.hidden ? null : frame);
  document.addEventListener('visibilitychange', onVisible);

  // lay out the other shapes ahead of time, one per idle moment, so a tab switch or a scroll never waits for one
  const idle = window.requestIdleCallback || ((fn) => window.setTimeout(fn, 200));
  const unidle = window.cancelIdleCallback || window.clearTimeout;
  const todo = SHAPE_NAMES.filter((n) => n !== shape && n !== 'sphere');
  let warm = 0;
  const prepare = () => { const next = todo.shift(); if (next) { shapePoints(next, count); warm = idle(prepare, { timeout: 3000 }); } };
  warm = idle(prepare, { timeout: 3000 });

  return {
    morph(name) {
      if (name === current) return;
      const mix = Math.min(1, (performance.now() - morphStart) / MORPH_MS);
      const fromAttr = geo.getAttribute('position');
      const toAttr = geo.getAttribute('aTarget');
      // start from where each dot (and the colour) is right now, so a morph can begin halfway through another
      for (let i = 0; i < count; i += 1) {
        const t = dotT(mix, order[i]);
        for (let k = 0; k < 3; k += 1) fromAttr.array[i * 3 + k] += (toAttr.array[i * 3 + k] - fromAttr.array[i * 3 + k]) * t;
      }
      fromCols = [mat.uniforms.uColA.value.clone(), mat.uniforms.uColB.value.clone()];
      const next = colorsFor(name);
      toCols = [shown(next.a), shown(next.b)];
      to = shapePoints(name, count);
      toAttr.array.set(to);
      fromAttr.needsUpdate = true;
      toAttr.needsUpdate = true;
      morphStart = performance.now();
      current = name;
    },
    setSide(x) {
      if (!placed) { sideNow = x; placed = true; } // the first position is set at once, not slid in from the centre
      side = x;
    },
    stop() {
      renderer.setAnimationLoop(null);
      unidle(warm);
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerdown', onMove);
      window.removeEventListener('pointerup', onUp);
      document.removeEventListener('pointerleave', onLeave);
      window.removeEventListener('blur', onLeave);
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', size);
      document.removeEventListener('visibilitychange', onVisible);
      geo.dispose(); mat.dispose(); renderer.dispose();
      renderer.domElement.remove();
    },
  };
}
