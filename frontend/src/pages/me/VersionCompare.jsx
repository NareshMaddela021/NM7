// Versions → Compare: any two versions (or a version and the current resume), side by side by section. Added lines
// green, removed red, changed lines with the changed words marked; template / design changes listed on their own.
// Under 600 px the two sides stack (older above newer).
import { useMemo, useState } from 'react';
import { compareResumes, designChanges } from '../../lib/versionDiff';
import { fmtWhen } from './shared';

const RED = { background: 'var(--dangerbg)', color: 'var(--text)', textDecoration: 'line-through', borderRadius: 3 };
const GREEN = { background: 'var(--successbg)', color: 'var(--text)', borderRadius: 3 };
const cell = { padding: '4px 8px', borderRadius: 6, minWidth: 0, overflowWrap: 'anywhere' };

function Words({ parts, mark }) {
  return parts.map((p, i) => (p.op === 'same' ? <span key={i}>{p.t}</span> : <mark key={i} style={{ ...mark, padding: '0 2px' }}>{p.t}</mark>));
}

function Row({ r }) {
  if (r.op === 'same') return <><div className="small muted" style={cell}>{r.a}</div><div className="small muted" style={cell}>{r.b}</div></>;
  if (r.op === 'del') return <><div className="small" style={{ ...cell, ...RED }} data-change="removed">{r.a}</div><div className="vc-blank" style={cell} aria-hidden="true" /></>;
  if (r.op === 'add') return <><div className="vc-blank" style={cell} aria-hidden="true" /><div className="small" style={{ ...cell, ...GREEN }} data-change="added">{r.b}</div></>;
  return (
    <>
      <div className="small" style={{ ...cell, background: 'var(--sunken)' }} data-change="changed-old"><Words parts={r.words.a} mark={RED} /></div>
      <div className="small" style={{ ...cell, background: 'var(--sunken)' }} data-change="changed-new"><Words parts={r.words.b} mark={GREEN} /></div>
    </>
  );
}

/**
 * options: [{ key, label, at?, data }] (the first is "Current"). Picks two; `onRestore(option)` for a version on the
 * left (older) side.
 */
export default function VersionCompare({ options, onRestore }) {
  const [left, setLeft] = useState(options[1]?.key ?? options[0]?.key);
  const [right, setRight] = useState(options[0]?.key);
  const [all, setAll] = useState(false);
  const A = options.find((o) => o.key === left) || options[0];
  const B = options.find((o) => o.key === right) || options[0];
  const sections = useMemo(() => compareResumes(A.data, B.data), [A, B]);
  const look = useMemo(() => designChanges(A.data, B.data), [A, B]);
  const changed = sections.filter((s) => s.changed);
  const label = (o) => (o.at ? `${o.label} · ${fmtWhen(o.at)}` : o.label);
  const pick = (value, set, id, text) => (
    <label className="small stack g4" style={{ flex: '1 1 200px', minWidth: 0 }} htmlFor={id}>{text}
      <select id={id} className="input" style={{ height: 40 }} value={value} onChange={(e) => set(e.target.value)}>
        {options.map((o) => <option key={o.key} value={o.key}>{label(o)}</option>)}
      </select>
    </label>
  );
  return (
    <div className="stack g12" data-testid="version-compare">
      {/* a phone: one column, older line above newer, no empty cells */}
      <style>{'@media (max-width: 599px){.vc-grid{grid-template-columns:1fr !important}.vc-grid .vc-blank,.vc-grid .vc-head{display:none}}'}</style>
      <div className="row g8" style={{ flexWrap: 'wrap', alignItems: 'flex-end' }}>
        {pick(left, setLeft, 'vc-left', 'Compare')}
        {pick(right, setRight, 'vc-right', 'with')}
      </div>
      {A.key !== B.key && A.key !== 'current' && onRestore && (
        <button type="button" className="btn btn-outline" style={{ alignSelf: 'flex-start', minHeight: 36 }} onClick={() => onRestore(A)}>Restore this version</button>
      )}
      {A.key === B.key ? <p className="small muted">Pick two different versions to compare.</p> : (
        <>
          <span className="xs muted" data-testid="vc-summary">
            {changed.length ? `${changed.length} section${changed.length > 1 ? 's' : ''} changed` : 'No content changes'}{look.length ? ` · ${look.length} design change${look.length > 1 ? 's' : ''}` : ''}
            {' · '}<mark style={{ ...RED, padding: '0 4px' }}>removed</mark> <mark style={{ ...GREEN, padding: '0 4px' }}>added</mark>
          </span>
          {look.length > 0 && (
            <div className="well stack g4" data-testid="vc-design">
              <strong className="xs" style={{ textTransform: 'uppercase', letterSpacing: '.06em' }}>Template and design</strong>
              <ul className="small" style={{ margin: 0, paddingLeft: 18 }}>
                {look.map((c) => <li key={c.what}>{c.what}: {c.from} → {c.to}</li>)}
              </ul>
            </div>
          )}
          <label className="xs row g4"><input type="checkbox" checked={all} onChange={(e) => setAll(e.target.checked)} /> Show sections with no changes</label>
          {sections.filter((s) => all || s.changed).map((s) => (
            <section key={s.title} className="stack g4" aria-label={`${s.title} changes`} data-testid={`vc-section-${s.title}`}>
              <strong className="xs" style={{ textTransform: 'uppercase', letterSpacing: '.06em' }}>{s.title}{!s.changed && <span className="faint" style={{ textTransform: 'none', letterSpacing: 0, fontWeight: 400 }}> · no change</span>}</strong>
              <div className="vc-grid" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 4 }}>
                <div className="vc-head xs faint">{A.label}</div><div className="vc-head xs faint">{B.label}</div>
                {s.rows.map((r, i) => <Row key={i} r={r} />)}
              </div>
            </section>
          ))}
        </>
      )}
    </div>
  );
}
