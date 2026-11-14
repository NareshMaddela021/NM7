// The frosted-glass widget in the new home page's hero. It loops through three looks, about 9 seconds a loop:
// (a) the widget (big number, icon, small row), (b) loading bars, (c) a short sentence typing in line by line with the
// key words bright, then back to (a). While the live numbers are loading it stays on (b). "Reduce motion": (a) only.
// Screen readers get the whole text once, in a hidden line; the moving parts are hidden from them.
import { useEffect, useState } from 'react';

const VIEW_MS = 4200;
const LOADING_MS = 1100;
const CHAR_MS = 32;
const HOLD_MS = 1700;

export const reducedMotion = () => typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

/** The widget's whole text, for screen readers and tests. */
export const widgetText = (w) => (w ? [`${w.big}${w.unit ? ` ${w.unit}` : ''} ${w.label}`, ...w.row].join(' · ') : 'Loading live numbers');

export function Icon({ name }) {
  const common = { width: 34, height: 34, viewBox: '0 0 32 32', fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true, focusable: 'false' };
  if (name === 'stopwatch') return <svg {...common}><circle cx="16" cy="18" r="10" /><path d="M16 18V12M16 18l4 3M13 4h6M16 4v4M24 9l2-2" /></svg>;
  if (name === 'college') return <svg {...common}><path d="M4 12 16 5l12 7H4ZM7 12v11M12 12v11M20 12v11M25 12v11M3 26h26" /></svg>;
  if (name === 'cap') return <svg {...common}><path d="M2 12 16 6l14 6-14 6L2 12Z" /><path d="M8 15v6c0 2 4 4 8 4s8-2 8-4v-6M28 13v8" /></svg>;
  return <svg {...common}><rect x="4" y="10" width="24" height="16" rx="3" /><path d="M12 10V7a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v3M4 17h24" /></svg>;
}

function Typing({ lines, typed }) {
  let left = typed;
  let caretPlaced = false;
  return (
    <div className="nh-w-type">
      {lines.map((parts, li) => {
        const len = parts.reduce((a, [t]) => a + t.length, 0);
        const caret = !caretPlaced && left <= len; // the line being typed now (or the last one, when done)
        if (caret) caretPlaced = true;
        let room = Math.max(0, left);
        left -= len;
        return (
          <p key={li}>
            {parts.map(([text, bright], pi) => {
              const show = text.slice(0, room);
              room = Math.max(0, room - text.length);
              return show ? <span key={pi} className={bright ? 'nh-hi' : 'nh-lo'}>{show}</span> : null;
            })}
            {caret && <span className="nh-caret" />}
          </p>
        );
      })}
    </div>
  );
}

/** w: the widget content from widgetFor() (null while loading). audience: the key, so a tab change restarts the loop. */
export default function GlassWidget({ w, audience }) {
  const [phase, setPhase] = useState('view');
  const [typed, setTyped] = useState(0);
  const still = reducedMotion();
  const total = w ? w.lines.flat().reduce((a, [t]) => a + t.length, 0) : 0;

  useEffect(() => { setPhase('view'); setTyped(0); }, [audience]);

  useEffect(() => {
    if (!w || still) return undefined;
    let timer;
    if (phase === 'view') timer = setTimeout(() => setPhase('loading'), VIEW_MS);
    else if (phase === 'loading') timer = setTimeout(() => { setTyped(0); setPhase('typing'); }, LOADING_MS);
    else if (phase === 'typing') {
      timer = typed < total ? setTimeout(() => setTyped((n) => n + 1), CHAR_MS) : setTimeout(() => setPhase('view'), HOLD_MS);
    }
    return () => clearTimeout(timer);
  }, [w, still, phase, typed, total]);

  const shown = !w ? 'loading' : still ? 'view' : phase;
  return (
    <div className="nh-widget" data-testid="nh-widget" data-phase={shown} data-audience={audience}>
      <span className="nh-sr" data-testid="nh-widget-text">{widgetText(w)}</span>
      <div className="nh-w-cloud" aria-hidden="true"><i /><i /><i /></div>
      <div className="nh-w-body" aria-hidden="true">
        {shown === 'view' && (
          <div className="nh-w-view" key="view">
            <div className="nh-w-top">
              <span className="nh-w-icon"><Icon name={w.icon} /></span>
              <span className="nh-w-big" data-testid="nh-widget-big">{w.big}{w.unit && <small>{w.unit}</small>}</span>
            </div>
            <span className="nh-w-label">{w.label}</span>
            <span className="nh-w-row">{w.row.map((r) => <span key={r}>{r}</span>)}</span>
          </div>
        )}
        {shown === 'loading' && (
          <div className="nh-w-skel" key="skel"><i style={{ width: '42%' }} /><i style={{ width: '78%' }} /><i style={{ width: '64%' }} /><i style={{ width: '30%' }} /></div>
        )}
        {shown === 'typing' && <Typing key="type" lines={w.lines} typed={typed} />}
      </div>
    </div>
  );
}
