// The page header of the new design (round P): a kicker, a big EB Garamond title, a line under it, buttons, and an
// optional dotted shape on the right (the home page's shapes, in their colours). The shape is a still drawing first;
// on a desktop with WebGL and motion allowed, the moving 3D dots (the home page's lazy chunk) take its place once the
// page has painted. Phones show the words only. shape: 'sphere' | 'stopwatch' | 'college' | 'briefcase' | 'cap' |
// 'resume' | 'magnifier' | 'badge' | 'handshake'.
import { useEffect, useRef, useState } from 'react';
import { Still, why3dOff } from '../pages/newhome/ParticleStage';
import { colorsFor } from '../pages/newhome/shapes';

/** The dotted shape on its own, for a page that keeps its own title block (wrap both in .ph-row). */
export function PageArt({ shape }) {
  return <Art shape={shape} />;
}

function Art({ shape }) {
  const box = useRef(null);
  const [mode, setMode] = useState('still');
  useEffect(() => {
    if (typeof window === 'undefined' || window.innerWidth < 900 || why3dOff()) return undefined;
    let scene = null;
    let dead = false;
    const go = () => import('../pages/newhome/particles').then(({ startParticles }) => {
      if (dead || !box.current) return;
      try { scene = startParticles(box.current, { count: 700, shape }); setMode('3d'); } catch { /* keep the still drawing */ }
    }).catch(() => {});
    const idle = window.requestIdleCallback ? window.requestIdleCallback(go, { timeout: 2500 }) : window.setTimeout(go, 900);
    return () => {
      dead = true;
      if (window.cancelIdleCallback) window.cancelIdleCallback(idle); else window.clearTimeout(idle);
      scene?.stop();
    };
  }, [shape]);
  return (
    <div ref={box} className="ph-art" data-mode={mode} data-testid="ph-art" aria-hidden="true" style={{ color: colorsFor(shape).glow }}>
      <Still shape={shape} className="ph-still" />
    </div>
  );
}

/** title (required), sub, kicker, actions (buttons/links), shape (optional), small (a lower header), id for the h1. */
export default function PageHero({ title, sub, kicker, actions, shape, small = false, id, children }) {
  return (
    <section className={`ph${small ? ' ph-sm' : ''}`} aria-labelledby={id}>
      <div className={`container ph-in${shape ? ' has-art' : ''}`}>
        <div className="ph-text">
          {kicker && <p className="kicker">{kicker}</p>}
          <h1 id={id} className="ph-title">{title}</h1>
          {sub && <p className="ph-sub">{sub}</p>}
          {actions && <div className="ph-actions">{actions}</div>}
          {children}
        </div>
        {shape && <Art shape={shape} />}
      </div>
    </section>
  );
}
