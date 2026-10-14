// Hobbies / Strengths: one entry per line, each with move up/down, on/off and remove (like the other sections).
// Stored as text (one per line) plus the hidden lines in offLines — see entries.js.
import { useEffect, useState } from 'react';
import { EntryHeader, focusMoved } from './EntryControls';
import { lineItems, linesPatch, moveItem, removeItem, toggleItem } from './entries';

export default function LineEntries({ d, setD, k, item, ideas, placeholder }) {
  const [rows, setRows] = useState(() => lineItems(d, k));
  const [draft, setDraft] = useState('');
  // undo, imports or a reload change the data from outside: show that
  const outside = linesPatch(d, k, lineItems(d, k));
  useEffect(() => {
    const mine = linesPatch(d, k, rows.filter((r) => r.text.trim()));
    if (mine[k] !== outside[k] || JSON.stringify(mine.offLines[k]) !== JSON.stringify(outside.offLines[k])) setRows(lineItems(d, k));
  }, [d[k], JSON.stringify(d.offLines?.[k] || [])]); // eslint-disable-line react-hooks/exhaustive-deps
  const save = (next) => { setRows(next); setD((p) => ({ ...p, ...linesPatch(p, k, next.filter((r) => r.text.trim())) })); };
  const add = (text) => { const t = text.trim(); if (t && !rows.some((r) => r.text.toLowerCase() === t.toLowerCase())) save([...rows, { text: t, off: false }]); };
  const shown = rows.filter((r) => r.text.trim() && !r.off).length;
  return (
    <div className="card stack g12" style={{ padding: 20 }}>
      {rows.map((r, i) => {
        const label = `${item} ${i + 1}`;
        return (
          <div key={i} className="stack g8 entry-card well" data-off={!!r.off} style={{ padding: 12 }}>
            <EntryHeader list={k} index={i} count={rows.length} label={label} off={!!r.off}
              onMove={(dir) => { save(moveItem(rows, i, dir)); focusMoved(k, i + dir, dir); }}
              onToggle={() => save(toggleItem(rows, i))}
              onRemove={() => save(removeItem(rows, i))} />
            <div className="entry-body">
              <label htmlFor={`${k}-${i}`} className="sr-only">{label}</label>
              <input id={`${k}-${i}`} className="input" value={r.text} onChange={(e) => save(rows.map((x, j) => (j === i ? { ...x, text: e.target.value } : x)))} />
            </div>
          </div>
        );
      })}
      <form className="row g8" style={{ alignItems: 'flex-end' }} onSubmit={(e) => { e.preventDefault(); add(draft); setDraft(''); }}>
        <div className="field" style={{ flex: '1 1 220px' }}>
          <label htmlFor={`${k}-new`} className="label">Add {item.toLowerCase()}</label>
          <input id={`${k}-new`} className="input" value={draft} placeholder={placeholder} onChange={(e) => setDraft(e.target.value)} />
        </div>
        <button type="submit" className="btn btn-outline" disabled={!draft.trim()}>+ Add</button>
      </form>
      <span className="xs faint">{shown} on your resume{shown > 6 ? ' · 3–5 is usually enough' : ''}</span>
      {ideas.length > 0 && <span className="label">Quick add</span>}
      <div className="row g8">
        {ideas.filter((x) => !rows.some((y) => y.text.toLowerCase() === x.toLowerCase())).map((x) => <button key={x} type="button" className="chip" style={{ minHeight: 36, fontWeight: 500, fontSize: 13 }} onClick={() => add(x)}>+ {x}</button>)}
      </div>
    </div>
  );
}
