// A list of short names edited as chips: type and press Enter or comma (a pasted comma list works too), × removes,
// drag a chip (mouse or finger) or Alt+←/→ to reorder. Used by "Relevant courses" in Education. The B button bolds
// the selected chip (or the words selected in the box) with **markers**, like the rest of the resume text.
import { useRef, useState } from 'react';
import { parseBold, toggleBold } from '../../lib/bold';
import { GrowArea } from './GrowArea';

const Rich = ({ t }) => parseBold(t).map((p, i) => (p.b ? <strong key={i}>{p.t}</strong> : <span key={i}>{p.t}</span>));

/**
 * value: string[]; onChange(list). add(list, items) applies the field's own rules (limit, length, duplicates).
 * dupes: indexes to flag (e.g. "SQL appears twice"); suggestions: quick-add names (added only when tapped).
 */
export default function ChipList({ id, label, value, onChange, add, placeholder, max, suggestions = [], hint, dupes = [] }) {
  const list = value || [];
  const [text, setText] = useState('');
  const [picked, setPicked] = useState(null); // index of the chip the B button works on
  const drag = useRef(null);
  const full = max && list.length >= max;

  const commit = (raw = text) => {
    const parts = String(raw).split(/[,;\n]+/).map((x) => x.trim()).filter(Boolean);
    if (parts.length) onChange(add(list, parts));
    setText('');
  };
  const remove = (i) => { onChange(list.filter((_, j) => j !== i)); setPicked(null); };
  const move = (from, to) => {
    if (to < 0 || to >= list.length || from === to) return;
    const next = [...list];
    const [x] = next.splice(from, 1);
    next.splice(to, 0, x);
    onChange(next);
    setPicked((p) => (p === from ? to : p));
  };
  const bold = () => {
    const el = document.getElementById(id);
    if (text.trim()) { // words selected in the box (or the word at the cursor)
      const r = toggleBold(text, el.selectionStart, el.selectionEnd);
      setText(r.value);
      requestAnimationFrame(() => { el.focus(); el.setSelectionRange(r.start, r.end); });
      return;
    }
    if (picked == null || !list[picked]) return;
    const c = list[picked];
    onChange(list.map((x, j) => (j === picked ? toggleBold(c, 0, c.length).value : x)));
  };

  // drag to reorder: pointer events, so it works with a mouse and with a finger
  const onPointerDown = (e, i) => {
    if (e.target.closest('button')) return;
    drag.current = { i, x: e.clientX, y: e.clientY, moved: false };
    e.currentTarget.setPointerCapture?.(e.pointerId);
  };
  const onPointerMove = (e) => {
    const g = drag.current;
    if (!g) return;
    if (!g.moved && Math.hypot(e.clientX - g.x, e.clientY - g.y) < 6) return;
    g.moved = true;
    const over = document.elementFromPoint(e.clientX, e.clientY)?.closest?.(`[data-chip-of="${id}"]`);
    const to = over ? Number(over.dataset.index) : -1;
    if (to >= 0 && to !== g.i) { move(g.i, to); g.i = to; }
  };
  const onPointerUp = (i) => { const g = drag.current; drag.current = null; if (g && !g.moved) setPicked((p) => (p === i ? null : i)); };

  return (
    <div className="stack g8">
      {!!list.length && (
        <ul className="row g8" aria-label={label} style={{ flexWrap: 'wrap', listStyle: 'none', margin: 0, padding: 0 }}>
          {list.map((c, i) => (
            <li key={`${c}-${i}`} data-chip-of={id} data-index={i} data-testid={`${id}-chip`}
              className="chip" aria-pressed={picked === i} tabIndex={0}
              onPointerDown={(e) => onPointerDown(e, i)} onPointerMove={onPointerMove} onPointerUp={() => onPointerUp(i)} onPointerCancel={() => { drag.current = null; }}
              onKeyDown={(e) => {
                if (e.altKey && e.key === 'ArrowLeft') { e.preventDefault(); move(i, i - 1); }
                if (e.altKey && e.key === 'ArrowRight') { e.preventDefault(); move(i, i + 1); }
                if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); remove(i); }
              }}
              style={{ touchAction: 'none', cursor: 'grab', userSelect: 'none', display: 'inline-flex', alignItems: 'center', gap: 6, outline: picked === i ? '2px solid var(--ink)' : undefined, ...(dupes.includes(i) ? { borderColor: 'var(--warning)', background: 'var(--warningbg, #FFF4E5)' } : {}) }}>
              <span><Rich t={c} /></span>
              <button type="button" aria-label={`Remove ${c.replace(/\*\*/g, '')}`} className="link-btn" onClick={() => remove(i)} style={{ minWidth: 24, minHeight: 24, fontSize: 16, lineHeight: 1 }}>×</button>
            </li>
          ))}
        </ul>
      )}
      <div className="row g8" style={{ alignItems: 'center' }}>
        <button type="button" className="btn btn-outline" aria-label="Bold (selected course or words)" data-testid={`${id}-bold`}
          onMouseDown={(e) => e.preventDefault()} onClick={bold} style={{ minHeight: 40, minWidth: 44, padding: '0 12px', fontWeight: 800 }}>B</button>
        <GrowArea id={id} style={{ flex: 1, minWidth: 0 }} value={text} placeholder={full ? `${max} added (the most)` : placeholder} disabled={full}
          autoComplete="off" onChange={(v) => { if (/[,;]/.test(v)) commit(v); else setText(v); }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') { e.preventDefault(); commit(); }
            if (e.key === 'Backspace' && !text && list.length) remove(list.length - 1);
          }}
          onPaste={(e) => { const t = e.clipboardData?.getData('text/plain') || ''; if (/[,;\n]/.test(t)) { e.preventDefault(); commit(`${text},${t}`); } }}
          onBlur={() => { if (text.trim()) commit(); }} />
      </div>
      {(hint || max) && <span className="xs faint">{hint}{max ? ` ${list.length} of ${max}.` : ''} Drag a chip to reorder.</span>}
      {!!suggestions.length && !full && (
        <div className="row g8" style={{ flexWrap: 'wrap', alignItems: 'center' }} data-testid={`${id}-ideas`}>
          <span className="xs muted">Quick add:</span>
          {suggestions.map((sg) => <button key={sg} type="button" className="chip" onClick={() => onChange(add(list, [sg]))}>+ {sg}</button>)}
        </div>
      )}
    </div>
  );
}
