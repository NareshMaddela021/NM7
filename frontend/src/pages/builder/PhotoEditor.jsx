// Photo editor: drag to move, zoom, rotate (90° steps + fine straighten), flip, brightness/contrast,
// black & white. Saves a sharp 600×600 JPEG; the original is kept so it can be re-cropped later.
import { useEffect, useRef, useState } from 'react';
import { Dialog } from '../../components/ui';

export const PHOTO_OUT = 400; // saved size in px (≈ 35 mm at 290 dpi; small enough to save inside the resume)
const FRAME = 300; // on-screen frame in px
export const DEFAULT_ADJ = { zoom: 1, x: 0, y: 0, quarter: 0, fine: 0, flip: false, bright: 100, contrast: 100, gray: false };

const loadImg = (src) => new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = src; });

/** Draws the adjusted photo onto a square canvas of `size` px. Offsets are stored in output px. */
export function drawAdjusted(ctx, img, a, size) {
  const k = size / PHOTO_OUT;
  ctx.clearRect(0, 0, size, size);
  ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, size, size);
  const rot = ((a.quarter * 90 + a.fine) * Math.PI) / 180;
  const turned = a.quarter % 2 === 1;
  const w = turned ? img.height : img.width;
  const h = turned ? img.width : img.height;
  const base = Math.max(size / w, size / h); // "cover" the square
  ctx.save();
  ctx.translate(size / 2 + a.x * k, size / 2 + a.y * k);
  ctx.rotate(rot);
  ctx.scale((a.flip ? -1 : 1) * base * a.zoom, base * a.zoom);
  ctx.drawImage(img, -img.width / 2, -img.height / 2);
  ctx.restore();
  // brightness / contrast / black & white — done on pixels so it works in every browser
  if (a.bright !== 100 || a.contrast !== 100 || a.gray) {
    const data = ctx.getImageData(0, 0, size, size);
    const p = data.data;
    const b = a.bright / 100;
    const c = a.contrast / 100;
    for (let i = 0; i < p.length; i += 4) {
      let r = p[i] * b; let g = p[i + 1] * b; let bl = p[i + 2] * b;
      r = (r - 128) * c + 128; g = (g - 128) * c + 128; bl = (bl - 128) * c + 128;
      if (a.gray) { const y = 0.299 * r + 0.587 * g + 0.114 * bl; r = y; g = y; bl = y; }
      p[i] = r; p[i + 1] = g; p[i + 2] = bl;
    }
    ctx.putImageData(data, 0, 0);
  }
}

/** Returns a PNG with transparent corners in the chosen shape (for the PDF and Word file). */
export async function shapePhoto(src, shape = 'circle', size = 400) {
  const img = await loadImg(src);
  const cv = document.createElement('canvas');
  cv.width = size; cv.height = size;
  const ctx = cv.getContext('2d');
  ctx.save();
  ctx.beginPath();
  if (shape === 'circle') ctx.arc(size / 2, size / 2, size / 2, 0, Math.PI * 2);
  else if (shape === 'rounded') { const r = size * 0.14; ctx.moveTo(r, 0); ctx.arcTo(size, 0, size, size, r); ctx.arcTo(size, size, 0, size, r); ctx.arcTo(0, size, 0, 0, r); ctx.arcTo(0, 0, size, 0, r); }
  else ctx.rect(0, 0, size, size);
  ctx.closePath();
  ctx.clip();
  ctx.drawImage(img, 0, 0, size, size);
  ctx.restore();
  return cv.toDataURL('image/png');
}

function Range({ id, label, value, min, max, step = 1, unit = '', onChange }) {
  return (
    <div className="field" style={{ gap: 4 }}>
      <div className="row between"><label htmlFor={id} className="label" style={{ margin: 0 }}>{label}</label><span className="mono xs muted">{value}{unit}</span></div>
      <input id={id} type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(+e.target.value)} style={{ width: '100%', accentColor: 'var(--ink)', minHeight: 26 }} />
    </div>
  );
}

export default function PhotoEditor({ src, initial, shape = 'circle', onSave, onClose }) {
  const [img, setImg] = useState(null);
  const [a, setA] = useState({ ...DEFAULT_ADJ, ...initial });
  const view = useRef();
  const thumb = useRef();
  const drag = useRef(null);
  const set = (patch) => setA((p) => ({ ...p, ...patch }));

  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => { loadImg(src).then(setImg).catch(() => closeRef.current()); }, [src]);
  useEffect(() => {
    if (!img) return;
    drawAdjusted(view.current.getContext('2d'), img, a, FRAME * 2); // 2× for sharp screens
    drawAdjusted(thumb.current.getContext('2d'), img, a, 128);
  }, [img, a]);

  const k = PHOTO_OUT / FRAME; // screen px → output px
  const onDown = (e) => { e.currentTarget.setPointerCapture(e.pointerId); drag.current = { x: e.clientX, y: e.clientY, ox: a.x, oy: a.y }; };
  const onMove = (e) => { if (!drag.current) return; const d0 = drag.current; set({ x: d0.ox + (e.clientX - d0.x) * k, y: d0.oy + (e.clientY - d0.y) * k }); };
  const onUp = () => { drag.current = null; };
  const onWheel = (e) => { e.preventDefault(); set({ zoom: Math.min(3, Math.max(1, +(a.zoom - e.deltaY * 0.0015).toFixed(2))) }); };
  const onKey = (e) => {
    const step = e.shiftKey ? 40 : 10;
    const map = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
    if (map[e.key]) { e.preventDefault(); set({ x: a.x + map[e.key][0], y: a.y + map[e.key][1] }); }
    if (e.key === '+' || e.key === '=') set({ zoom: Math.min(3, +(a.zoom + 0.1).toFixed(2)) });
    if (e.key === '-') set({ zoom: Math.max(1, +(a.zoom - 0.1).toFixed(2)) });
  };
  useEffect(() => {
    const el = view.current;
    if (!el) return undefined;
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  });

  const save = () => {
    const cv = document.createElement('canvas');
    cv.width = PHOTO_OUT; cv.height = PHOTO_OUT;
    drawAdjusted(cv.getContext('2d'), img, a, PHOTO_OUT);
    onSave(cv.toDataURL('image/jpeg', 0.82), a); // ~30–70 KB: saved inside the resume
  };
  const lowRes = img && Math.min(img.width, img.height) < 300;
  const radius = shape === 'circle' ? '50%' : shape === 'rounded' ? '14%' : '0';

  return (
    <Dialog title="Adjust your photo" onClose={onClose} wide>
      <div className="stack g4"><h2 style={{ fontSize: 24 }}>Adjust your photo</h2><span className="small muted">Drag to move · scroll or use the slider to zoom · arrow keys nudge it.</span></div>
      <div className="row g20" style={{ alignItems: 'flex-start' }}>
        <div className="stack g8" style={{ alignItems: 'center' }}>
          <div style={{ position: 'relative', width: FRAME, height: FRAME, borderRadius: 8, overflow: 'hidden', background: '#e8e8e8', touchAction: 'none' }}>
            <canvas ref={view} width={FRAME * 2} height={FRAME * 2} tabIndex={0} role="img" aria-label="Photo crop area. Drag or use arrow keys to move, plus and minus to zoom."
              onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp} onKeyDown={onKey}
              style={{ width: FRAME, height: FRAME, cursor: drag.current ? 'grabbing' : 'grab', display: 'block' }} />
            {/* shape mask + face guide */}
            <div aria-hidden="true" style={{ position: 'absolute', inset: 0, pointerEvents: 'none', borderRadius: radius, boxShadow: '0 0 0 400px rgba(0,0,0,.38)' }} />
            <div aria-hidden="true" style={{ position: 'absolute', left: '30%', top: '16%', width: '40%', height: '52%', border: '1.5px dashed rgba(255,255,255,.75)', borderRadius: '50%', pointerEvents: 'none' }} />
          </div>
          <span className="xs faint">Keep your face inside the dotted oval.</span>
          {lowRes && <span className="xs" role="alert" style={{ color: 'var(--warning)' }}>This photo is small ({img.width}×{img.height}) and may look blurry when printed.</span>}
        </div>
        <div className="stack g12" style={{ flex: '1 1 240px', minWidth: 220 }}>
          <Range id="pe-zoom" label="Zoom" value={Math.round(a.zoom * 100)} min={100} max={300} unit="%" onChange={(v) => set({ zoom: v / 100 })} />
          <div className="field" style={{ gap: 6 }}>
            <span className="label" style={{ margin: 0 }}>Rotate & flip</span>
            <div className="row g8">
              <button type="button" className="btn btn-outline" style={{ minHeight: 38 }} aria-label="Rotate left" onClick={() => set({ quarter: (a.quarter + 3) % 4 })}>⟲ Left</button>
              <button type="button" className="btn btn-outline" style={{ minHeight: 38 }} aria-label="Rotate right" onClick={() => set({ quarter: (a.quarter + 1) % 4 })}>Right ⟳</button>
              <button type="button" className="btn btn-outline" style={{ minHeight: 38 }} aria-pressed={a.flip} onClick={() => set({ flip: !a.flip })}>⇋ Flip</button>
            </div>
          </div>
          <Range id="pe-fine" label="Straighten" value={a.fine} min={-15} max={15} step={0.5} unit="°" onChange={(v) => set({ fine: v })} />
          <Range id="pe-bri" label="Brightness" value={a.bright} min={60} max={140} unit="%" onChange={(v) => set({ bright: v })} />
          <Range id="pe-con" label="Contrast" value={a.contrast} min={60} max={140} unit="%" onChange={(v) => set({ contrast: v })} />
          <label className="check small"><input type="checkbox" checked={a.gray} onChange={(e) => set({ gray: e.target.checked })} />Black & white</label>
          <div className="row g12" style={{ alignItems: 'center' }}>
            <canvas ref={thumb} width={128} height={128} aria-hidden="true" style={{ width: 64, height: 64, borderRadius: radius, border: '1px solid var(--border2)' }} />
            <span className="xs muted">How it looks on your resume</span>
          </div>
        </div>
      </div>
      <div className="row between g8">
        <button type="button" className="btn btn-ghost" onClick={() => setA({ ...DEFAULT_ADJ })}>Reset</button>
        <span className="row g8">
          <button type="button" className="btn btn-outline" onClick={onClose}>Cancel</button>
          <button type="button" className="btn btn-ink" onClick={save} disabled={!img}>Save photo</button>
        </span>
      </div>
    </Dialog>
  );
}
