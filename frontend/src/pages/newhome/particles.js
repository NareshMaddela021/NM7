// The new home page's 3D dots (/new-home): a few thousand deep indigo-violet points on the light page that sway
// gently (never more than about 25°, so a shape always faces you and stays recognisable), lean towards the mouse, and morph from one shape to another (shapes.js). This file and three.js are their own chunk,
// loaded only after the page has painted, and only where WebGL works (ParticleStage.jsx decides).
import { BufferAttribute, BufferGeometry, Color, NormalBlending, PerspectiveCamera, Points, Scene, ShaderMaterial, WebGLRenderer } from 'three';
import { shapePoints } from './shapes';

const MORPH_MS = 1600;
const MAX_TURN = (25 * Math.PI) / 180; // the most a shape turns either way
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const SPREAD = 0.45; // per-dot delay share of the morph: dots leave one after another, not all at once

const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);
/** How far one dot is through the morph (the same formula as the vertex shader). */
const dotT = (mix, rand) => ease(Math.min(1, Math.max(0, (mix * (1 + SPREAD) - rand * SPREAD))));

const VERT = /* glsl */ `
  attribute vec3 aTarget;
  attribute float aRand;
  uniform float uMix;
  uniform float uTime;
  uniform float uSize;
  uniform float uPixel;
  varying float vMix;
  varying float vY;
  varying float vTw;
  float ease(float t) { return t < 0.5 ? 4.0 * t * t * t : 1.0 - pow(-2.0 * t + 2.0, 3.0) / 2.0; }
  void main() {
    float t = ease(clamp(uMix * ${(1 + SPREAD).toFixed(2)} - aRand * ${SPREAD.toFixed(2)}, 0.0, 1.0));
    vec3 p = mix(position, aTarget, t);
    // a soft lift in the middle of the morph, and a slow drift
    float mid = sin(t * 3.14159);
    p += normalize(p + 0.0001) * mid * 0.18 * (0.4 + aRand);
    p += 0.012 * vec3(sin(uTime * 0.9 + aRand * 20.0), cos(uTime * 0.7 + aRand * 13.0), sin(uTime * 0.8 + aRand * 7.0));
    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    gl_Position = projectionMatrix * mv;
    gl_PointSize = uSize * uPixel * (0.6 + aRand * 0.8) / -mv.z;
    vMix = t;
    vY = p.y;
    vTw = 0.65 + 0.35 * sin(uTime * 2.0 + aRand * 40.0);
  }
`;

const FRAG = /* glsl */ `
  uniform vec3 uBlue;
  uniform vec3 uPurple;
  varying float vY;
  varying float vTw;
  void main() {
    vec2 c = gl_PointCoord - 0.5;
    float d = length(c);
    if (d > 0.5) discard;
    vec3 col = mix(uBlue, uPurple, clamp(vY * 0.6 + 0.5, 0.0, 1.0));
    // solid violet dots with a soft edge: visible on a light page (normal blending, no white bloom)
    float a = smoothstep(0.5, 0.18, d);
    gl_FragColor = vec4(col, a * (0.55 + 0.45 * vTw));
  }
`;

/**
 * Starts the scene in `host` (a div). count = number of dots. Returns { morph(name), setSide(x), stop() }.
 * Throws if WebGL can't start (the caller keeps the static picture).
 */
export function startParticles(host, { count = 4000, shape = 'sphere' } = {}) {
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
  const rand = new Float32Array(count);
  for (let i = 0; i < count; i += 1) rand[i] = Math.random();
  const geo = new BufferGeometry();
  geo.setAttribute('position', new BufferAttribute(from, 3));
  geo.setAttribute('aTarget', new BufferAttribute(new Float32Array(to), 3));
  geo.setAttribute('aRand', new BufferAttribute(rand, 1));
  const mat = new ShaderMaterial({
    vertexShader: VERT,
    fragmentShader: FRAG,
    transparent: true,
    depthWrite: false,
    blending: NormalBlending,
    uniforms: {
      uMix: { value: 0 }, uTime: { value: 0 }, uSize: { value: count > 3000 ? 13 : 16 }, uPixel: { value: pixel },
      uBlue: { value: new Color('#5b52f0') }, uPurple: { value: new Color('#9b55f2') },
    },
  });
  const dots = new Points(geo, mat);
  dots.frustumCulled = false;
  scene.add(dots);

  let morphStart = performance.now();
  let current = shape;
  let side = 0; // where the shape sits: -1 left … 1 right of the screen
  let sideNow = 0;
  let placed = false;
  const pointer = { x: 0, y: 0, sx: 0, sy: 0 };
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
  };
  size();

  const onMove = (e) => { pointer.x = (e.clientX / window.innerWidth) * 2 - 1; pointer.y = (e.clientY / window.innerHeight) * 2 - 1; };
  const onScroll = () => { const y = window.scrollY; scrollKick += (y - lastScroll) * 0.0009; lastScroll = y; };
  window.addEventListener('pointermove', onMove, { passive: true });
  window.addEventListener('scroll', onScroll, { passive: true });
  window.addEventListener('resize', size);

  const t0 = performance.now();
  let spin = 0;
  const frame = (now) => {
    const mix = Math.min(1, (now - morphStart) / MORPH_MS);
    mat.uniforms.uMix.value = mix;
    mat.uniforms.uTime.value = (now - t0) / 1000;
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

  return {
    morph(name) {
      if (name === current) return;
      const mix = Math.min(1, (performance.now() - morphStart) / MORPH_MS);
      const fromAttr = geo.getAttribute('position');
      const toAttr = geo.getAttribute('aTarget');
      // start from where each dot is right now, so a morph can begin halfway through another
      for (let i = 0; i < count; i += 1) {
        const t = dotT(mix, rand[i]);
        for (let k = 0; k < 3; k += 1) fromAttr.array[i * 3 + k] += (toAttr.array[i * 3 + k] - fromAttr.array[i * 3 + k]) * t;
      }
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
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', size);
      document.removeEventListener('visibilitychange', onVisible);
      geo.dispose(); mat.dispose(); renderer.dispose();
      renderer.domElement.remove();
    },
  };
}
