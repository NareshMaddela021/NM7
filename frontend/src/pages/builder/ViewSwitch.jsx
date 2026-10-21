// "Sample resume | My details" — above the template grids and inside the large preview. The choice is remembered on
// this device (see templatePick.saveView). Also the "draw only when on screen" wrapper for template thumbnails, and
// the prompt shown when there are no details of one's own to show yet.
import { useEffect, useRef, useState } from 'react';

export const VIEWS = [['sample', 'Sample resume'], ['mine', 'My details']];

export function ViewSwitch({ view, onChange }) {
  return (
    <div className="view-switch" role="group" aria-label="Show the templates with">
      {VIEWS.map(([v, l]) => <button key={v} type="button" aria-pressed={view === v} onClick={() => onChange(v)}>{l}</button>)}
    </div>
  );
}

/** Renders its children once they come near the screen (and keeps them); a same-size blank box until then. */
export function InView({ height, children }) {
  const ref = useRef();
  const [on, setOn] = useState(typeof IntersectionObserver === 'undefined');
  useEffect(() => {
    if (on || !ref.current) return undefined;
    const io = new IntersectionObserver((es) => { if (es.some((e) => e.isIntersecting)) { setOn(true); io.disconnect(); } }, { rootMargin: '300px 0px' });
    io.observe(ref.current);
    return () => io.disconnect();
  }, [on]);
  return <div ref={ref} style={{ height, overflow: 'hidden', borderRadius: 6 }}>{on ? children : <div className="tp-thumb-wait" />}</div>;
}

/** My details with nothing to show yet (signed out, or a resume without a name). */
export function NoDetails({ onStart, compact = false }) {
  return (
    <div className={`card stack g8 no-details${compact ? ' xs' : ''}`} data-testid="no-details" style={{ alignItems: 'flex-start' }}>
      <strong>Add your details to see them here</strong>
      {!compact && <span className="small muted">Every template will show your own name, experience and skills.</span>}
      <button type="button" className="btn btn-ink" onClick={onStart}>Start my resume</button>
    </div>
  );
}
