import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { onSaveError } from '../services/http';

/* ---------- Icons (24px grid, 2px stroke) ---------- */
const P = {
  check: <path d="M5 12l5 5L20 7" />,
  moon: <path d="M21 12.8A9 9 0 1111.2 3a7 7 0 009.8 9.8z" />,
  sun: <><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" /></>,
  upload: <><path d="M14 3H7a2 2 0 00-2 2v14a2 2 0 002 2h10a2 2 0 002-2V8z" /><path d="M14 3v5h5M12 18v-6M9 15l3-3 3 3" /></>,
  spark: <path d="M12 3l1.8 4.7L18.5 9.5 13.8 11.3 12 16l-1.8-4.7L5.5 9.5l4.7-1.8z" />,
  arrow: <path d="M5 12h14M13 6l6 6-6 6" />,
  back: <path d="M19 12H5M11 6l-6 6 6 6" />,
  mic: <><rect x="9" y="3" width="6" height="11" rx="3" /><path d="M5 11a7 7 0 0014 0M12 18v3" /></>,
  clip: <path d="M21 11l-8.5 8.5a5 5 0 01-7-7L14 4a3.5 3.5 0 015 5l-8.5 8.5a2 2 0 01-3-3L15 7" />,
  x: <path d="M6 6l12 12M18 6L6 18" />,
  up: <path d="M12 19V5M6 11l6-6 6 6" />,
  down: <path d="M12 5v14M6 13l6 6 6-6" />,
  trash: <><path d="M4 7h16M10 11v6M14 11v6" /><path d="M6 7l1 12a2 2 0 002 2h6a2 2 0 002-2l1-12M9 7V4h6v3" /></>,
};
export function Icon({ name, size = 18, stroke = 2, color = 'currentColor', ...rest }) {
  return (
    <svg aria-hidden="true" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={stroke} strokeLinecap="round" strokeLinejoin="round" {...rest}>
      {P[name]}
    </svg>
  );
}

export const Spinner = () => <span className="spin" aria-hidden="true" />;

/* ---------- Form fields ---------- */
let uid = 0;
const useId = (id) => useRef(id || `f${++uid}`).current;

export function TextField({ label, hint, error, id, textarea, rows = 4, ...props }) {
  const fid = useId(id);
  const Tag = textarea ? 'textarea' : 'input';
  return (
    <div className="field">
      {label && <label htmlFor={fid} className="label">{label}</label>}
      <Tag id={fid} className="input" rows={textarea ? rows : undefined} aria-invalid={error ? 'true' : undefined}
        aria-describedby={error || hint ? `${fid}-msg` : undefined} {...props} />
      {(error || hint) && <span id={`${fid}-msg`} className={error ? 'error' : 'help'}>{error || hint}</span>}
    </div>
  );
}

export function SelectField({ label, options, id, placeholder = 'Select…', ...props }) {
  const fid = useId(id);
  return (
    <div className="field">
      {label && <label htmlFor={fid} className="label">{label}</label>}
      <select id={fid} className="input" {...props}>
        <option value="">{placeholder}</option>
        {options.map((o) => <option key={o} value={o}>{o}</option>)}
      </select>
    </div>
  );
}

export function Check({ label, ...props }) {
  return <label className="check"><input type="checkbox" {...props} />{label}</label>;
}

/* ---------- Toast with Undo ---------- */
const ToastCtx = createContext(() => {});
export function ToastProvider({ children }) {
  const [t, setT] = useState(null);
  const timer = useRef();
  const show = useCallback((message, onUndo) => {
    clearTimeout(timer.current);
    setT({ message, onUndo });
    timer.current = setTimeout(() => setT(null), 5000);
  }, []);
  useEffect(() => () => clearTimeout(timer.current), []);
  // changes saved in the background (dashboard, order chat) that the server refused
  useEffect(() => onSaveError((e) => show(e?.message ? `Not saved: ${e.message}` : 'A change wasn’t saved. Please try again.')), [show]);
  return (
    <ToastCtx.Provider value={show}>
      {children}
      {t && (
        <div role="status" className="toast">
          <span>{t.message}</span>
          {t.onUndo && <button type="button" className="btn btn-signal" style={{ minHeight: 36 }} onClick={() => { t.onUndo(); setT(null); }}>Undo</button>}
        </div>
      )}
    </ToastCtx.Provider>
  );
}
export const useToast = () => useContext(ToastCtx);

/* ---------- Dialog ---------- */
export function Dialog({ title, children, onClose, wide, showTitle }) {
  const ref = useRef();
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    const prev = document.activeElement;
    const node = ref.current;
    node?.querySelector('button, input, [href]')?.focus();
    const onKey = (e) => { if (e.key === 'Escape') closeRef.current(); };
    node?.addEventListener('keydown', onKey);
    return () => { node?.removeEventListener('keydown', onKey); prev?.focus?.(); };
  }, []);
  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div ref={ref} role="dialog" aria-modal="true" aria-label={title} className="dialog rise stack g16" style={wide ? { maxWidth: 780, maxHeight: 'calc(100vh - 32px)', overflow: 'auto' } : { maxHeight: 'calc(100vh - 32px)', overflow: 'auto' }}>
        {showTitle && <div className="row between g8"><strong style={{ fontSize: 18 }}>{title}</strong><button type="button" className="btn btn-icon" aria-label="Close" onClick={onClose}>✕</button></div>}
        {children}
      </div>
    </div>
  );
}

/* ---------- Score meter ---------- */
export function Meter({ value, color = 'var(--ink)', label }) {
  return (
    <div className="meter" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={value} aria-label={label}>
      <span style={{ width: `${value}%`, background: color }} />
    </div>
  );
}

export function Segmented({ options, value, onChange, label }) {
  return (
    <div className="segmented" role="group" aria-label={label}>
      {options.map(([id, text]) => (
        <button key={id} type="button" aria-pressed={value === id} onClick={() => onChange(id)}>{text}</button>
      ))}
    </div>
  );
}
