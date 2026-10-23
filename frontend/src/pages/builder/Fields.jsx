import { useLayoutEffect, useRef, useState } from 'react';
import { Icon } from '../../components/ui';
import { BOLD_TIP, htmlToRich, sanitizeRich, toggleBold, tooMuchBold } from '../../lib/bold';
import { COURSES_HINT, COURSES_PH, MAX_COURSES, addCourses, coursesOf, suggestCourses } from '../../lib/courses';
import ChipList from './ChipList';

/** Renders one schema field. `value` / `onChange(value)` are plain values. */
export function SchemaField({ field, value, onChange, disabled, onAi, idBase, error, entry }) {
  const id = `${idBase}-${field.key}`;
  const style = { gridColumn: field.full ? '1 / -1' : 'auto' };
  const t = field.type;

  if (t === 'check') {
    return (
      <div style={style}>
        <label className="check"><input type="checkbox" checked={!!value} onChange={(e) => onChange(e.target.checked)} />{field.label}</label>
      </div>
    );
  }
  if (t === 'courses') {
    return (
      <div className="field" style={style}>
        <label htmlFor={id} className="label">{field.label}</label>
        <ChipList id={id} label={field.label} value={coursesOf({ courses: value })} onChange={onChange} add={addCourses} max={MAX_COURSES}
          placeholder={COURSES_PH} hint={COURSES_HINT} suggestions={suggestCourses({ ...entry, courses: value })} />
      </div>
    );
  }
  if (t === 'chips') {
    const arr = value || [];
    return (
      <div className="field" style={style}>
        <span className="label" id={`${id}-l`}>{field.label}</span>
        <div className="row g8" role="group" aria-labelledby={`${id}-l`}>
          {field.options.map((o) => {
            const on = arr.includes(o);
            return <button key={o} type="button" className="chip" aria-pressed={on} onClick={() => onChange(on ? arr.filter((x) => x !== o) : [...arr, o])}>{on ? '✓ ' : ''}{o}</button>;
          })}
        </div>
      </div>
    );
  }
  return (
    <div className="field" style={style}>
      <label htmlFor={id} className="label">{field.label}</label>
      {t === 'select' ? (
        <select id={id} className="input" value={value || ''} onChange={(e) => onChange(e.target.value)}>
          <option value="">Select…</option>
          {field.options.map((o) => <option key={o} value={o}>{o}</option>)}
        </select>
      ) : t === 'area' ? (
        <>
          {field.rich ? <RichArea id={id} rows={4} value={value || ''} placeholder={field.ph} onChange={onChange} />
            : <textarea id={id} className="input" rows={4} value={value || ''} placeholder={field.ph} onChange={(e) => onChange(e.target.value)} />}
          {field.ai && (
            <span className="row g8">
              <button type="button" className="btn btn-signal" style={{ minHeight: 38, fontSize: 13 }} onClick={() => onAi('rewrite')}><Icon name="spark" size={14} />Rewrite with results</button>
              <button type="button" className="btn btn-outline" style={{ minHeight: 38, fontSize: 13 }} disabled={!value} onClick={() => onAi('shorten')}>Shorten</button>
              <button type="button" className="btn btn-outline" style={{ minHeight: 38, fontSize: 13 }} disabled={!value} onClick={() => onAi('ats')}>Make ATS-friendly</button>
            </span>
          )}
        </>
      ) : (
        <input id={id} className="input" type={t} value={value || ''} placeholder={field.ph} disabled={disabled} onChange={(e) => onChange(e.target.value)}
          aria-invalid={error ? 'true' : undefined} aria-describedby={error ? `${id}-err` : undefined} />
      )}
      {error && <span id={`${id}-err`} role="alert" className="error">{error}</span>}
    </div>
  );
}

export function FieldGrid({ children }) {
  return <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(220px, 100%), 1fr))', gap: 14 }}>{children}</div>;
}

/**
 * Link + clickable word shown right after the title on the resume ("Sales Dashboard | Live Demo").
 * The word is free text; quick-tap words just fill it in.
 */
export function LinkFields({ idBase, links = [], slots = 1, words = ['Link'], max = 20, error, onChange }) {
  const rows = Array.from({ length: slots }, (_, i) => links[i] || { url: '', label: '' });
  const set = (i, patch) => {
    const next = rows.map((r, j) => (j === i ? { ...r, ...patch } : r));
    onChange(next.filter((r) => r.url || r.label));
  };
  return (
    <div className="well stack g12" style={{ gridColumn: '1 / -1' }}>
      <span className="xs muted">Shows after the title on your resume as a clickable word, e.g. <strong>Title | {words[1] || words[0]}</strong>. Optional.</span>
      {rows.map((r, i) => {
        const err = error?.(r.url);
        return (
          <div key={i} className="stack g8">
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(200px, 100%), 1fr))', gap: 10 }}>
              <div className="field">
                <label htmlFor={`${idBase}-lu${i}`} className="label">{slots > 1 ? `Link ${i + 1}` : 'Link'} · optional</label>
                <input id={`${idBase}-lu${i}`} className="input" type="url" value={r.url} placeholder={i === 1 ? 'github.com/you/project' : 'https://…'} onChange={(e) => set(i, { url: e.target.value })}
                  aria-invalid={err ? 'true' : undefined} aria-describedby={err ? `${idBase}-lu${i}-e` : undefined} />
                {err && <span id={`${idBase}-lu${i}-e`} role="alert" className="error">{err}</span>}
              </div>
              <div className="field">
                <label htmlFor={`${idBase}-lw${i}`} className="label row between"><span>Link word</span><span className="faint">{(r.label || '').length}/{max}</span></label>
                <input id={`${idBase}-lw${i}`} className="input" value={r.label} maxLength={max} placeholder="Link" onChange={(e) => set(i, { label: e.target.value })} />
              </div>
            </div>
            {r.label && !r.url && <span className="xs" style={{ color: 'var(--warning)' }}>Add the link too — the word only shows when it has a link.</span>}
            <div className="row g4" role="group" aria-label={`Quick words for link ${i + 1}`}>
              {words.map((w) => <button key={w} type="button" className="chip" aria-pressed={(r.label || '') === w} style={{ minHeight: 30, fontSize: 12, padding: '0 10px' }} onClick={() => set(i, { label: w })}>{w}</button>)}
            </div>
          </div>
        );
      })}
    </div>
  );
}

/**
 * A text box for resume text that can hold **bold** words: a small toolbar with B above it (or Ctrl/Cmd+B). Works
 * with a long-press selection on a phone: the button never takes the focus, and the last selection is remembered.
 * Pasting from Word, Google Docs or a website keeps the text and its bold only; any other markup is removed when the
 * box is left. Bold only — no italic, underline or colour.
 */
export function RichArea({ id, value, onChange, rows = 4, placeholder, style, inputStyle, maxLength, label = 'Formatting' }) {
  const ref = useRef(null);
  const selRef = useRef({ start: 0, end: 0 });
  const [restore, setRestore] = useState(null);
  useLayoutEffect(() => {
    if (!restore || !ref.current) return;
    ref.current.focus();
    ref.current.setSelectionRange(restore.start, restore.end);
    selRef.current = restore;
    setRestore(null);
  }, [restore, value]);
  const remember = () => { const el = ref.current; if (el) selRef.current = { start: el.selectionStart, end: el.selectionEnd }; };
  const bold = () => {
    const el = ref.current;
    const { start, end } = document.activeElement === el ? { start: el.selectionStart, end: el.selectionEnd } : selRef.current;
    const r = toggleBold(value || '', start, end);
    if (r.value !== (value || '')) onChange(r.value);
    setRestore({ start: r.start, end: r.end });
  };
  const onKeyDown = (e) => {
    if ((e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && e.key.toLowerCase() === 'b') { e.preventDefault(); bold(); }
  };
  const onPaste = (e) => {
    const html = e.clipboardData?.getData('text/html');
    if (!html) return; // plain text: the browser pastes it as it is (hand-typed ** stays)
    e.preventDefault();
    const el = ref.current;
    const text = htmlToRich(html);
    const v = value || '';
    const next = v.slice(0, el.selectionStart) + text + v.slice(el.selectionEnd);
    onChange(next);
    const at = el.selectionStart + text.length;
    setRestore({ start: at, end: at });
  };
  const keep = (e) => e.preventDefault(); // the B button never takes the focus (keeps a phone's selection)
  return (
    <div className="stack g4" style={style}>
      <div role="toolbar" aria-label={label} aria-controls={id} className="row g8" style={{ alignItems: 'center' }}>
        <button type="button" className="btn btn-outline" aria-label="Bold (Ctrl+B)" title="Bold (Ctrl+B)" data-testid={`${id}-bold`}
          onMouseDown={keep} onPointerDown={keep} onClick={bold}
          style={{ minHeight: 36, minWidth: 44, padding: '0 12px', fontWeight: 800, fontSize: 15 }}>B</button>
        <span className="xs faint">Select words, then B to make them bold</span>
      </div>
      <textarea ref={ref} id={id} className="input" rows={rows} value={value} placeholder={placeholder} style={inputStyle} maxLength={maxLength}
        onChange={(e) => onChange(e.target.value)} onKeyDown={onKeyDown} onPaste={onPaste}
        onSelect={remember} onKeyUp={remember} onMouseUp={remember} onTouchEnd={remember}
        onBlur={() => { remember(); const clean = sanitizeRich(value || ''); if (clean !== (value || '')) onChange(clean); }} />
      {tooMuchBold(value) && <span className="xs" role="status" data-testid={`${id}-bold-tip`} style={{ color: 'var(--warning)' }}>{BOLD_TIP}</span>}
    </div>
  );
}
