// The 3D dots behind the new home page, or a still picture of the same shape when 3D isn't a good idea: no WebGL,
// "reduce motion" switched on, data saver, or a low-power phone. The page paints with the still picture first; the
// three.js chunk (particles.js) loads only after that, when the browser is idle. ?fx=static forces the picture.
import { memo, useEffect, useRef, useState } from 'react';
import { colorsFor, projectPoints } from './shapes';

/** Why 3D is off on this device ('' when it can run). */
export function why3dOff(win = typeof window !== 'undefined' ? window : null) {
  if (!win) return 'server';
  if (new URLSearchParams(win.location.search).get('fx') === 'static') return 'forced';
  if (win.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return 'reduced-motion';
  const nav = win.navigator || {};
  if (nav.connection?.saveData) return 'save-data';
  const coarse = win.matchMedia?.('(pointer: coarse)').matches;
  if (coarse && ((nav.hardwareConcurrency || 8) <= 4 || (nav.deviceMemory || 8) <= 2)) return 'low-power';
  try {
    const c = win.document.createElement('canvas');
    const opts = { failIfMajorPerformanceCaveat: true };
    const gl = c.getContext('webgl2', opts) || c.getContext('webgl', opts);
    if (!gl) return 'no-webgl';
    gl.getExtension('WEBGL_lose_context')?.loseContext();
  } catch {
    return 'no-webgl';
  }
  return '';
}

const STILL_DOTS = 650;

/** The still picture: the same shape's dots, drawn once as an SVG. */
export const Still = memo(function Still({ shape, className = 'nh-still' }) {
  const pts = projectPoints(shape, STILL_DOTS, 400);
  const c = colorsFor(shape);
  const id = `nh-dot-${shape}`;
  return (
    <svg className={className} viewBox="0 0 400 400" aria-hidden="true" focusable="false" data-shape={shape}>
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="0" y2="400" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor={c.b} />
          <stop offset="1" stopColor={c.a} />
        </linearGradient>
      </defs>
      <g fill={`url(#${id})`}>
        {pts.map(([x, y, z], i) => <circle key={i} cx={x.toFixed(1)} cy={y.toFixed(1)} r="2.4" opacity={(0.7 + z * 0.25).toFixed(2)} />)}
      </g>
    </svg>
  );
});

/** shape: the shape to show now; side: -1 left … 1 right (desktop), 0 centre; dim: behind full-width content. */
export default function ParticleStage({ shape, side = 0, dim = false }) {
  const host = useRef(null);
  const scene = useRef(null);
  const [mode, setMode] = useState('still'); // still → 3d once the scene is running
  const [off, setOff] = useState(null);
  const latest = useRef({ shape, side });
  latest.current = { shape, side };

  useEffect(() => {
    const reason = why3dOff();
    setOff(reason);
    if (reason) return undefined;
    let dead = false;
    const go = () => import('./particles').then(({ startParticles }) => {
      if (dead || !host.current) return;
      try {
        const phone = window.innerWidth < 700;
        scene.current = startParticles(host.current, { count: phone ? 700 : 1100, shape: latest.current.shape, phone });
        scene.current.setSide(latest.current.side);
        setMode('3d');
      } catch {
        setOff('no-webgl');
      }
    }).catch(() => setOff('load-failed'));
    // after the first paint, when the browser has a moment
    const idle = window.requestIdleCallback ? window.requestIdleCallback(go, { timeout: 2000 }) : window.setTimeout(go, 700);
    return () => {
      dead = true;
      if (window.cancelIdleCallback) window.cancelIdleCallback(idle); else window.clearTimeout(idle);
      scene.current?.stop();
      scene.current = null;
    };
  }, []);

  useEffect(() => { scene.current?.morph(shape); }, [shape, mode]);
  useEffect(() => { scene.current?.setSide(side); }, [side, mode]);

  return (
    <div className="nh-stage" data-testid="nh-stage" data-mode={mode} data-off={off || ''} data-shape={shape} data-dim={dim ? '1' : '0'} style={{ '--side': side }} aria-hidden="true">
      <div className="nh-stage-glow" style={{ color: colorsFor(shape).glow }} />
      {mode === 'still' && <Still shape={shape} />}
      <div ref={host} className="nh-canvas" />
    </div>
  );
}
