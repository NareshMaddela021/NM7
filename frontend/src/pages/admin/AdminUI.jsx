// Small building blocks for the admin console: KPI tiles, charts (inline SVG), tabs, side panel, helpers.
import { useState } from 'react';
import { inr } from '../../lib/pricing';
import { savePdf } from '../builder/resumePdf';

export const fmtDate = (t) => new Date(t).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
export const fmtDT = (t) => new Date(t).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
export const ago = (t, now = Date.now()) => { const h = (now - t) / 3600000; return h < 1 ? `${Math.max(1, Math.round(h * 60))} min ago` : h < 24 ? `${Math.round(h)} h ago` : `${Math.round(h / 24)} d ago`; };
export { inr };

/** Downloads rows as a CSV file (opens in Excel). */
export async function downloadCsv(name, rows) {
  const esc = (v) => { const s = v == null ? '' : String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  const csv = rows.map((r) => r.map(esc).join(',')).join('\n');
  await savePdf(new Blob([`﻿${csv}`], { type: 'text/csv' }), name);
}

export function PageHead({ title, sub, right }) {
  return (
    <div className="row between g16" style={{ alignItems: 'flex-end' }}>
      <div className="stack g4"><h1 className="display" style={{ fontSize: 30 }}>{title}</h1>{sub && <span className="small muted">{sub}</span>}</div>
      {right && <div className="row g8">{right}</div>}
    </div>
  );
}

export function Kpi({ label, value, sub, tone }) {
  return (
    <div className="card stack g4" style={{ padding: 16 }}>
      <span className="xs muted">{label}</span>
      <strong className="display" style={{ fontSize: 26, color: tone }}>{value}</strong>
      {sub && <span className="xs faint">{sub}</span>}
    </div>
  );
}

export function Tabs({ tabs, value, onChange, label }) {
  return (
    <div className="segmented" role="tablist" aria-label={label} style={{ alignSelf: 'flex-start', flexWrap: 'wrap' }}>
      {tabs.map(([v, l]) => <button key={v} type="button" role="tab" aria-selected={value === v} onClick={() => onChange(v)}>{l}</button>)}
    </div>
  );
}

export function Panel({ title, onClose, children }) {
  return (
    <aside aria-label={title} className="card stack g16 sticky" style={{ flex: '2 1 380px', maxWidth: 520, top: 88, maxHeight: 'calc(100vh - 110px)', overflow: 'auto', padding: 20 }}>
      <div className="row between g8"><strong style={{ fontSize: 18 }}>{title}</strong>{onClose && <button type="button" className="btn btn-icon" aria-label="Close panel" onClick={onClose}>✕</button>}</div>
      {children}
    </aside>
  );
}

export const Empty = ({ children }) => <div className="well small muted" style={{ textAlign: 'center', padding: 24 }}>{children}</div>;

/* ---------- charts ---------- */
function Tip({ tip }) {
  if (!tip) return null;
  return (
    <div role="status" style={{ position: 'absolute', left: tip.x, top: tip.y, transform: 'translate(-50%, -110%)', background: 'var(--ink)', color: 'var(--onink)', borderRadius: 8, padding: '6px 10px', fontSize: 12, pointerEvents: 'none', whiteSpace: 'nowrap', zIndex: 5 }}>
      {tip.lines.map((l, i) => <div key={i} style={{ fontWeight: i === 0 ? 700 : 400 }}>{l}</div>)}
    </div>
  );
}

/**
 * Bars per day. series = [{ key, label, color }]; data = [{ label, [key]: number }].
 * One series → simple bars; several → stacked with a 2px gap, legend, hover tooltip and a table view.
 */
export function BarChart({ title, data, series, fmt = (v) => v, height = 180 }) {
  const [tip, setTip] = useState(null);
  const [table, setTable] = useState(false);
  const W = 640; const pad = { l: 36, r: 8, t: 8, b: 22 };
  const totals = data.map((d) => series.reduce((s, x) => s + (d[x.key] || 0), 0));
  const max = Math.max(1, ...totals);
  const nice = (() => { const p = 10 ** Math.floor(Math.log10(max)); return Math.ceil(max / p) * p; })();
  const bw = (W - pad.l - pad.r) / data.length;
  const step = Math.ceil(data.length / 8);
  const y = (v) => pad.t + (height - pad.t - pad.b) * (1 - v / nice);
  return (
    <div className="stack g8">
      <div className="row between g8">
        <strong className="small">{title}</strong>
        <span className="row g12 xs muted">
          {series.length > 1 && series.map((s) => <span key={s.key} className="row g4" style={{ alignItems: 'center' }}><span aria-hidden="true" style={{ width: 10, height: 10, borderRadius: 3, background: s.color }} />{s.label}</span>)}
          <button type="button" className="link-btn xs" style={{ minHeight: 24 }} onClick={() => setTable(!table)}>{table ? 'Chart' : 'Table'}</button>
        </span>
      </div>
      {table ? (
        <div style={{ maxHeight: height + 20, overflow: 'auto' }}>
          <table className="table xs"><thead><tr><th>Day</th>{series.map((s) => <th key={s.key}>{s.label}</th>)}{series.length > 1 && <th>Total</th>}</tr></thead>
            <tbody>{data.map((d, i) => <tr key={i}><td>{d.label}</td>{series.map((s) => <td key={s.key}>{fmt(d[s.key] || 0)}</td>)}{series.length > 1 && <td>{fmt(totals[i])}</td>}</tr>)}</tbody></table>
        </div>
      ) : (
        <div style={{ position: 'relative' }} onMouseLeave={() => setTip(null)}>
          <svg viewBox={`0 0 ${W} ${height}`} role="img" aria-label={`${title}. Highest ${fmt(max)}.`} style={{ width: '100%', height: 'auto', display: 'block' }}>
            {[0, 0.5, 1].map((f) => <g key={f}><line x1={pad.l} x2={W - pad.r} y1={y(nice * f)} y2={y(nice * f)} stroke="var(--viz-grid)" strokeWidth="1" /><text x={pad.l - 6} y={y(nice * f) + 4} textAnchor="end" fontSize="10" fill="var(--text3)">{fmt(nice * f)}</text></g>)}
            {data.map((d, i) => {
              let acc = 0;
              const x = pad.l + i * bw + bw * 0.18; const w = bw * 0.64;
              return (
                <g key={i}>
                  {series.map((s, si) => {
                    const v = d[s.key] || 0; if (!v) return null;
                    const y0 = y(acc); const y1 = y(acc + v); acc += v;
                    const top = si === series.length - 1 || series.slice(si + 1).every((n) => !d[n.key]);
                    const h = Math.max(0, y0 - y1 - (series.length > 1 && si > 0 ? 2 : 0));
                    return <rect key={s.key} x={x} y={y1} width={w} height={h} rx={top ? Math.min(4, w / 2) : 0} fill={s.color} />;
                  })}
                  {(i % step === 0 || (i === data.length - 1 && i % step >= step / 2)) && <text x={x + w / 2} y={height - 6} textAnchor="middle" fontSize="10" fill="var(--text3)">{d.label}</text>}
                  <rect x={pad.l + i * bw} y={pad.t} width={bw} height={height - pad.t - pad.b} fill="transparent"
                    onMouseEnter={(e) => { const box = e.currentTarget.ownerSVGElement.getBoundingClientRect(); const sx = box.width / W; setTip({ x: (x + w / 2) * sx, y: y(totals[i]) * sx, lines: [d.label, ...(series.length > 1 ? series.map((s) => `${s.label}: ${fmt(d[s.key] || 0)}`) : []), `${series.length > 1 ? 'Total' : series[0].label}: ${fmt(totals[i])}`] }); }} />
                </g>
              );
            })}
          </svg>
          <Tip tip={tip} />
        </div>
      )}
    </div>
  );
}

/** Horizontal bars with values written at the end (one series). */
export function HBars({ title, rows, fmt = (v) => v, color = 'var(--viz-1)' }) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  return (
    <div className="stack g8">
      <strong className="small">{title}</strong>
      {rows.map((r) => (
        <div key={r.label} className="stack g4" title={`${r.label}: ${fmt(r.value)}`}>
          <div className="row between xs"><span>{r.label}</span><span className="mono muted">{fmt(r.value)}</span></div>
          <div style={{ height: 8, borderRadius: 4, background: 'var(--sunken)' }}><div style={{ height: 8, borderRadius: 4, width: `${(r.value / max) * 100}%`, background: color }} /></div>
        </div>
      ))}
    </div>
  );
}

/** Funnel: each step's bar + conversion from the step before. */
export function Funnel({ steps }) {
  const max = steps[0].value || 1;
  return (
    <div className="stack g12">
      <strong className="small">Funnel · free scan → checkout → paid</strong>
      {steps.map((s, i) => (
        <div key={s.label} className="stack g4">
          <div className="row between xs"><strong>{s.label}</strong><span className="mono">{s.value.toLocaleString('en-IN')}{i > 0 && <span className="muted"> · {Math.round((s.value / (steps[i - 1].value || 1)) * 100)}% of previous</span>}</span></div>
          <div style={{ height: 14, borderRadius: 4, background: 'var(--sunken)' }}><div style={{ height: 14, borderRadius: 4, width: `${Math.max(2, (s.value / max) * 100)}%`, background: 'var(--viz-1)', opacity: 1 - i * 0.22 }} /></div>
        </div>
      ))}
    </div>
  );
}
