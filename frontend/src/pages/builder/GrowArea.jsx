// Boxes for short text that can run long (a skill list, a headline, a tech line): an auto-growing textarea that starts
// at 2 lines, grows to about 6 and then scrolls inside, and wraps instead of scrolling sideways. The saved value never
// holds a line break: in a list box Enter types ", ", elsewhere a break becomes a space. On a phone the box scrolls
// into view above the keyboard while it has the focus.
import { useLayoutEffect, useRef, useState } from 'react';
import ChipList from './ChipList';

const oneLine = (v, list) => String(v ?? '').replace(/\s*\r?\n+\s*/g, list ? ', ' : ' ');

export function GrowArea({ id, value, onChange, list = false, minRows = 2, maxRows = 6, placeholder, disabled, describedBy, invalid, style, ...rest }) {
  const ref = useRef(null);
  const caret = useRef(null); // where the caret goes once the value from `insert` is on screen
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    // placed as the new value commits (before the next key is handled), so fast typing after Enter can't land
    // in front of a late caret move
    if (caret.current && el.value === caret.current.value) el.setSelectionRange(caret.current.at, caret.current.at);
    caret.current = null;
    const cs = getComputedStyle(el);
    const line = parseFloat(cs.lineHeight) || parseFloat(cs.fontSize) * 1.4;
    const pad = parseFloat(cs.paddingTop) + parseFloat(cs.paddingBottom) + parseFloat(cs.borderTopWidth) + parseFloat(cs.borderBottomWidth);
    el.style.height = 'auto';
    const h = Math.min(Math.max(el.scrollHeight, line * minRows + pad), line * maxRows + pad);
    el.style.height = `${Math.ceil(h)}px`;
    el.style.overflowY = el.scrollHeight > h + 1 ? 'auto' : 'hidden';
  }, [value, minRows, maxRows]);
  const keepInView = () => {
    const el = ref.current;
    const go = () => el?.scrollIntoView?.({ block: 'center', behavior: 'smooth' });
    setTimeout(go, 300); // after the phone keyboard has opened
    window.visualViewport?.addEventListener('resize', go, { once: true });
  };
  const insert = (text) => {
    const el = ref.current;
    const v = String(value ?? '');
    const a = el.selectionStart; const b = el.selectionEnd;
    const before = v.slice(0, a).replace(/[\s,]+$/, '');
    const next = before + (before ? text : '') + v.slice(b).replace(/^[\s,]+/, '');
    caret.current = { value: next, at: before.length + (before ? text.length : 0) };
    onChange(next);
  };
  return (
    <textarea ref={ref} id={id} className="input" rows={minRows} value={value ?? ''} placeholder={placeholder} disabled={disabled}
      aria-describedby={describedBy} aria-invalid={invalid ? 'true' : undefined} enterKeyHint={list ? 'enter' : 'done'}
      style={{ resize: 'none', overflowWrap: 'anywhere', lineHeight: 1.45, ...style }}
      onFocus={keepInView}
      onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); if (list) insert(', '); } }}
      onChange={(e) => onChange(oneLine(e.target.value, list))} {...rest} />
  );
}

/* ---------- skill lists ---------- */

const norm = (s) => s.trim().toLowerCase().replace(/\s+/g, ' ');
const splitList = (v) => String(v || '').split(',').map((s) => s.trim()).filter(Boolean);
export const SKILL_TIP = 'Recruiters skim. Keep your strongest 8-12 here and move the rest to another group.';
export const TIP_AT = 15;
export const LONG_SKILL = 40;
/** "14 skills · about 2 lines on your resume" (a printed line holds about 95 characters of a skill list). */
export function skillCount(value, perLine = 95) {
  const items = splitList(value);
  if (!items.length) return '';
  const lines = Math.max(1, Math.ceil(items.join(', ').length / perLine));
  return `${items.length} skill${items.length === 1 ? '' : 's'} · about ${lines} line${lines === 1 ? '' : 's'} on your resume`;
}
/** Indexes of repeated skills (the second and later copies) and the message for the first one. */
export function skillDupes(value) {
  const items = splitList(value);
  const seen = new Map(); const idx = [];
  let first = '';
  items.forEach((s, i) => { const k = norm(s); if (seen.has(k)) { idx.push(i, seen.get(k)); if (!first) first = items[seen.get(k)]; } else seen.set(k, i); });
  const n = first ? items.filter((s) => norm(s) === norm(first)).length : 0;
  return { idx: [...new Set(idx)], msg: first ? `${first} appears ${n === 2 ? 'twice' : `${n} times`}` : '' };
}

/** A skill group's list: Edit as text | Edit as chips; both save the same "a, b, c" text. */
export function SkillBox({ id, value, onChange, placeholder, label }) {
  const [mode, setMode] = useState('text');
  const items = splitList(value);
  const dup = skillDupes(value);
  const long = items.find((s) => s.length > LONG_SKILL);
  return (
    <div className="stack g6">
      {mode === 'text'
        ? <GrowArea id={id} list value={value} onChange={onChange} placeholder={placeholder} describedBy={`${id}-count`} />
        : <ChipList id={id} label={label} value={items} onChange={(list) => onChange(list.join(', '))} add={(list, adds) => [...list, ...adds]} dupes={dup.idx} placeholder="Type a skill and press Enter" />}
      <div className="row between g8" style={{ flexWrap: 'wrap', alignItems: 'center' }}>
        <span id={`${id}-count`} className="xs faint" data-testid={`${id}-count`}>{skillCount(value)}</span>
        <div className="segmented" role="radiogroup" aria-label="How to edit this list" style={{ display: 'flex' }}>
          {[['text', 'Edit as text'], ['chips', 'Edit as chips']].map(([v, l]) => <button key={v} type="button" role="radio" aria-checked={mode === v} onClick={() => setMode(v)}>{l}</button>)}
        </div>
      </div>
      {items.length > TIP_AT && <span className="xs" role="status" data-testid={`${id}-tip`} style={{ color: 'var(--warning)' }}>{SKILL_TIP}</span>}
      {dup.msg && <span className="xs" role="status" data-testid={`${id}-dupe`} style={{ color: 'var(--warning)' }}>{dup.msg}</span>}
      {long && <span className="xs" role="status" data-testid={`${id}-long`} style={{ color: 'var(--warning)' }}>“{long.slice(0, 30)}…” is long for a skill. Keep each one to a few words.</span>}
    </div>
  );
}
