// The dashboard's building blocks in the new design (round P, Phase 2B): white glass cards with a header, status
// chips, friendly empty states with a small dotted picture, skeletons, a score ring, progress bars, a status pipeline,
// stat tiles, grouped form cards and a sticky action bar for phones. Styles: styles/me-kit.css.
import { useEffect } from 'react';
import { Still } from '../newhome/ParticleStage';

/** A link's #part (a setup step's "/me/profile#skills") scrolls to that section once the page has drawn it (Batch C
 * items 21, 22). ids: the hash's word -> the element id on this page. */
export function useHashScroll(ready, ids = {}) {
  useEffect(() => {
    if (!ready || typeof window === 'undefined') return undefined;
    const h = decodeURIComponent(window.location.hash.slice(1));
    if (!h) return undefined;
    const id = setTimeout(() => {
      const el = document.getElementById(ids[h] || h);
      if (!el) return;
      el.scrollIntoView({ block: 'start' });
      el.querySelector('input, textarea, select, button')?.focus({ preventScroll: true });
    }, 50);
    return () => clearTimeout(id);
  }, [ready]); // eslint-disable-line react-hooks/exhaustive-deps
}

/** A white glass card. title/sub: its header; icon: a small symbol in a tinted circle; actions: buttons on the right. */
export function MeCard({ title, sub, icon, actions, children, tone, as: Tag = 'section', className = '', testid, label, headingLevel = 2, ...rest }) {
  const H = `h${headingLevel}`;
  return (
    <Tag className={`mcard ${tone ? `mcard-${tone}` : ''} ${className}`} data-testid={testid} aria-label={label || (typeof title === 'string' ? title : undefined)} {...rest}>
      {(title || actions) && (
        <header className="mcard-h">
          {icon && <span className="mcard-ic" aria-hidden="true">{icon}</span>}
          <span className="mcard-ht">{title && <H className="mcard-title">{title}</H>}{sub && <span className="mcard-sub">{sub}</span>}</span>
          {actions && <span className="mcard-actions">{actions}</span>}
        </header>
      )}
      {children}
    </Tag>
  );
}

/** A status chip. tone: ok | warn | bad | info | accent | neutral. */
export function Chip({ tone = 'neutral', children, testid, ...rest }) {
  return <span className={`mchip mchip-${tone}`} data-testid={testid} {...rest}>{children}</span>;
}

/** A friendly empty state: a small dotted picture, a line or two, and one clear next step. */
export function Empty({ shape = 'sphere', tint = 'seeker', title, children, action, testid, compact }) {
  return (
    <div className={`mempty ${compact ? 'mempty-sm' : ''}`} data-testid={testid}>
      <span className="mempty-art" aria-hidden="true" data-tint={tint}><Still shape={shape} tint={tint} className="mempty-still" /></span>
      {title && <strong className="mempty-title">{title}</strong>}
      {children && <span className="mempty-text">{children}</span>}
      {action}
    </div>
  );
}

/** Loading placeholders shaped like cards. */
export function Skel({ cards = 2, lines = 3, label = 'Loading' }) {
  return (
    <div className="mgrid" role="status" aria-label={label}>
      {Array.from({ length: cards }, (_, i) => (
        <div key={i} className="mcard stack g12" aria-hidden="true">
          <span className="skeleton" style={{ width: '45%', height: 18 }} />
          {Array.from({ length: lines }, (__, j) => <span key={j} className="skeleton" style={{ width: `${90 - j * 15}%` }} />)}
        </div>
      ))}
    </div>
  );
}

/** A score ring (0–100). good / fair set the colour bands. */
export function ScoreRing({ value, size = 132, label = 'Score', good = 80, fair = 60, testid, sub }) {
  const v = Math.max(0, Math.min(100, Math.round(value || 0)));
  const r = 52; const c = 2 * Math.PI * r;
  const tone = v >= good ? 'ok' : v >= fair ? 'warn' : 'bad';
  return (
    <div className={`mring mring-${tone}`} style={{ width: size, height: size }} role="img" aria-label={`${label}: ${v} out of 100`} data-testid={testid}>
      <svg viewBox="0 0 120 120" aria-hidden="true">
        <circle cx="60" cy="60" r={r} className="mring-track" />
        <circle cx="60" cy="60" r={r} className="mring-val" strokeDasharray={`${(c * v) / 100} ${c}`} transform="rotate(-90 60 60)" />
      </svg>
      <span className="mring-num" aria-hidden="true">{v}<small>{sub || '/100'}</small></span>
    </div>
  );
}

/** A labelled progress bar. */
export function Bar({ value, max = 100, label, tone = 'accent', showValue = true, testid }) {
  const pct = max ? Math.max(0, Math.min(100, (value / max) * 100)) : 0;
  return (
    <div className="mbar-wrap" data-testid={testid}>
      {(label || showValue) && <span className="mbar-row"><span className="mbar-label">{label}</span>{showValue && <span className="mbar-val">{max === 100 ? `${Math.round(value)}%` : `${value} / ${max}`}</span>}</span>}
      <span className={`mbar mbar-${tone}`} role="progressbar" aria-label={typeof label === 'string' ? label : 'Progress'} aria-valuemin={0} aria-valuemax={max} aria-valuenow={value}><span style={{ width: `${pct}%` }} /></span>
    </div>
  );
}

/** A row of steps with counts (an application pipeline). steps: [{ key, label, count, tone }]. */
export function Pipeline({ steps, label = 'Status', active, onPick }) {
  return (
    <ol className="mpipe" aria-label={label} role={onPick ? 'radiogroup' : undefined}>
      {steps.map((s) => {
        const body = <><span className="mpipe-n">{s.count}</span><span className="mpipe-l">{s.label}</span></>;
        return (
          <li key={s.key} className={`mpipe-step mpipe-${s.tone || 'neutral'} ${active === s.key ? 'on' : ''}`}>
            {/* a filter, so a radio (not a button): "Saved" must not answer to a search for a "Save" button */}
            {onPick ? <button type="button" role="radio" aria-checked={active === s.key} onClick={() => onPick(active === s.key ? null : s.key)}>{body}</button> : <span>{body}</span>}
          </li>
        );
      })}
    </ol>
  );
}

/** A small number tile. */
export function Stat({ label, value, sub, testid, tone }) {
  return (
    <div className={`mstat ${tone ? `mstat-${tone}` : ''}`}>
      <span className="mstat-l">{label}</span>
      <strong className="mstat-v" data-testid={testid}>{value}</strong>
      {sub && <span className="mstat-s">{sub}</span>}
    </div>
  );
}

/** A group of form fields inside a card, with a heading and a helper line. */
export function FieldGroup({ title, help, children, testid }) {
  return (
    <fieldset className="mfields" data-testid={testid}>
      {title && <legend className="mfields-h">{title}</legend>}
      {help && <p className="mfields-help">{help}</p>}
      <div className="mfields-body">{children}</div>
    </fieldset>
  );
}

/** Buttons that stick to the bottom of the screen on a phone (above the tab bar); inline on a desktop. */
export function StickyBar({ children, label = 'Actions' }) {
  return <div className="msticky" role="group" aria-label={label}>{children}</div>;
}
