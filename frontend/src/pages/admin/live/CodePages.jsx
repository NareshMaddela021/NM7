// Admin → Codes: every code with its uses and status, create / edit, pause / resume, delete (only a code never used),
// bulk one-time codes with a prefix (+ CSV) and "Who used it" (+ CSV). Owner only: the server answers 403 to anyone
// else, and checks every rule again when a code is used.
import { useState } from 'react';
import { useToast } from '../../../components/ui';
import { savePdf } from '../../builder/resumePdf';
import { API_BASE } from '../../../services/http';
import {
  ITEMS, STATUS, TYPES, blankForm, bodyOf, bulkCsv, bulkFileName, formOf, rs, saveText, toggleItem, usesText,
} from '../../../lib/codes';
import { fileName } from '../../../lib/fileName';
import { Chip } from '../../me/kit';
import { Hero } from './SetupKit';
import { Loading, day, emptyIf, http, useAction, useApi, when } from './common';

const inputStyle = { height: 40 };
const enc = encodeURIComponent;

function Targets({ form, set }) {
  const [q, setQ] = useState('');
  const st = useApi(form.onlyKind ? `/api/admin/coupons/targets?q=${enc(q)}` : null);
  const list = (st.data || []).filter((t) => t.kind === form.onlyKind);
  return form.onlyKind ? (
    <div className="row g8" style={{ flexWrap: 'wrap', alignItems: 'flex-end' }}>
      <label className="small">Search <input className="input" style={{ ...inputStyle, width: 180 }} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Name" /></label>
      <label className="small" style={{ flex: '1 1 220px' }}>{form.onlyKind === 'org' ? 'Organization' : 'Group'}
        <select className="input" style={inputStyle} value={form.onlyId} onChange={(e) => set({ onlyId: e.target.value })} data-testid="code-only-id">
          <option value="">Pick one</option>
          {list.map((t) => <option key={t.id} value={t.id}>{t.name}{t.orgName ? ` · ${t.orgName}` : ''}</option>)}
          {form.onlyId && !list.some((t) => t.id === form.onlyId) && <option value={form.onlyId}>(current)</option>}
        </select>
      </label>
    </div>
  ) : null;
}

/** The create / edit / bulk form. mode: "new" | "edit" | "bulk". */
function CodeForm({ mode, start, onDone, onCancel }) {
  const toast = useToast();
  const [busy, run] = useAction(toast);
  const [f, setF] = useState(start || { ...blankForm(), prefix: '', count: 50 });
  const set = (x) => setF((o) => ({ ...o, ...x }));
  const save = (e) => {
    e.preventDefault();
    const body = bodyOf(f);
    if (body.error) { toast(body.error); return; }
    run(async () => {
      if (mode === 'edit') return onDone(await http(`/api/admin/coupons/${enc(f.code)}`, { method: 'PUT', body }));
      if (mode === 'bulk') return onDone(await http('/api/admin/coupons/bulk', { method: 'POST', body: { ...body, prefix: f.prefix, count: Number(f.count) } }));
      return onDone(await http('/api/admin/coupons', { method: 'POST', body: { ...body, code: f.code } }));
    }, mode === 'edit' ? 'Saved' : mode === 'bulk' ? 'Codes made' : 'Code created');
  };
  const title = mode === 'edit' ? `Edit ${f.code}` : mode === 'bulk' ? 'Bulk one-time codes' : 'New code';
  return (
    <form className="mcard" aria-label={title} onSubmit={save} data-testid="code-form">
      <header className="mcard-h"><span className="mcard-ic violet" aria-hidden="true">%</span><span className="mcard-ht"><strong className="mcard-title">{title}</strong><span className="mcard-sub">{mode === 'bulk' ? 'Many one-time codes with the same rules.' : 'Who can use it, for what, how often and until when.'}</span></span></header>
      {mode === 'edit' && <span className="xs muted">Past uses keep their record (their prices stay as they were).</span>}
      <div className="as-bar" style={{ background: '#faf9ff' }}>
        {mode === 'new' && <label className="small">Code <input className="input mono" style={{ ...inputStyle, width: 200 }} maxLength={32} value={f.code} placeholder="Empty: made up for you" onChange={(e) => set({ code: e.target.value.toUpperCase().replace(/\s+/g, '') })} data-testid="code-code" /></label>}
        {mode === 'bulk' && (
          <>
            <label className="small">Prefix <input required className="input mono" style={{ ...inputStyle, width: 140 }} maxLength={20} value={f.prefix} placeholder="DRIVE" onChange={(e) => set({ prefix: e.target.value.toUpperCase().replace(/[^A-Z0-9-]/g, '') })} data-testid="code-prefix" /></label>
            <label className="small">How many <input required type="number" min={1} max={1000} className="input" style={{ ...inputStyle, width: 110 }} value={f.count} onChange={(e) => set({ count: e.target.value })} data-testid="code-count" /></label>
          </>
        )}
        <label className="small">Type
          <select className="input" style={inputStyle} value={f.type} onChange={(e) => set({ type: e.target.value })} data-testid="code-type">
            {TYPES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </select>
        </label>
        {f.type !== 'free' && <label className="small">{f.type === 'percent' ? 'Percent off' : 'Rupees off'} <input required type="number" min={1} max={f.type === 'percent' ? 99 : 1000000} step={f.type === 'flat' ? '0.01' : '1'} className="input" style={{ ...inputStyle, width: 120 }} value={f.value} onChange={(e) => set({ value: e.target.value })} data-testid="code-value" /></label>}
      </div>
      <fieldset className="stack g4 as-block" style={{ margin: 0 }}>
        <legend className="small">Applies to</legend>
        <div className="row g12" style={{ flexWrap: 'wrap' }}>
          <label className="small row g4"><input type="checkbox" checked={f.items.includes('all')} onChange={() => set({ items: toggleItem(f.items, 'all') })} /> All</label>
          {ITEMS.map(([k, l]) => <label key={k} className="small row g4"><input type="checkbox" checked={f.items.includes(k)} onChange={() => set({ items: toggleItem(f.items, k) })} /> {l}</label>)}
        </div>
      </fieldset>
      <div className="as-bar" style={{ background: '#faf9ff' }}>
        {mode !== 'bulk' && (
          <>
            <label className="small row g4"><input type="checkbox" checked={f.unlimited} onChange={(e) => set({ unlimited: e.target.checked })} /> Unlimited uses</label>
            {!f.unlimited && <label className="small">Total uses <input type="number" min={1} className="input" style={{ ...inputStyle, width: 110 }} value={f.totalLimit} onChange={(e) => set({ totalLimit: e.target.value })} data-testid="code-total" /></label>}
            <label className="small">Per person / org <input type="number" min={1} max={100} className="input" style={{ ...inputStyle, width: 90 }} value={f.perLimit} onChange={(e) => set({ perLimit: e.target.value })} /></label>
          </>
        )}
        {mode === 'bulk' && <span className="small muted">Each code works once, for one person (or one organization).</span>}
        <label className="small">Valid from <input type="date" className="input" style={inputStyle} value={f.validFrom} onChange={(e) => set({ validFrom: e.target.value })} /></label>
        <label className="small">Valid until <input type="date" className="input" style={inputStyle} value={f.validUntil} onChange={(e) => set({ validUntil: e.target.value })} data-testid="code-until" /></label>
      </div>
      <div className="as-bar" style={{ background: '#faf9ff' }}>
        <label className="small">Only for
          <select className="input" style={inputStyle} value={f.onlyKind} onChange={(e) => set({ onlyKind: e.target.value, onlyId: '' })} data-testid="code-only">
            <option value="">Anyone</option><option value="org">Members of one organization</option><option value="group">Members of one group</option>
          </select>
        </label>
        <Targets form={f} set={set} />
      </div>
      <label className="small">Note (for you) <input className="input" style={inputStyle} maxLength={300} value={f.note} onChange={(e) => set({ note: e.target.value })} data-testid="code-note" /></label>
      <div className="as-actions">
        <button type="submit" className="btn btn-signal" disabled={busy} data-testid="code-save">{mode === 'edit' ? 'Save' : mode === 'bulk' ? 'Make codes' : 'Create code'}</button>
        <button type="button" className="btn btn-outline" onClick={onCancel}>Cancel</button>
      </div>
    </form>
  );
}

function WhoUsed({ code, onClose }) {
  const toast = useToast();
  const st = useApi(`/api/admin/coupons/${enc(code)}/uses`);
  const [busy, run] = useAction(toast);
  const csv = () => run(async () => {
    const r = await fetch(`${API_BASE}/api/admin/coupons/${enc(code)}/uses.csv`, { credentials: 'include' });
    if (!r.ok) throw new Error('Could not make the file. Please try again.');
    await savePdf(await r.blob(), fileName(['Nm7', 'code', code, 'uses'], 'csv'));
  }, 'CSV downloaded');
  return (
    <section className="mcard" aria-label={`Who used ${code}`} data-testid="code-uses">
      <span className="row between g8" style={{ flexWrap: 'wrap' }}>
        <strong>Who used <span className="mono">{code}</span></strong>
        <span className="row g8"><button type="button" className="btn btn-outline" disabled={busy} onClick={csv}>Download CSV</button><button type="button" className="btn btn-outline" onClick={onClose}>Close</button></span>
      </span>
      <Loading st={st} empty={emptyIf((d) => !d.uses.length, 'Nobody has used this code yet.')}>{(d) => (
        <div className="table-wrap" tabIndex={0} role="region" aria-label="Table — scroll sideways to see all columns"><table className="table mtable"><thead><tr><th>Used by</th><th>Item</th><th>Date</th><th>Price</th><th>Discount</th><th>Paid</th><th>Order</th></tr></thead>
          <tbody>{d.uses.map((u, i) => (
            <tr key={`${u.orderId}-${i}`}>
              <td className="small">{u.name}{u.who === 'org' ? <span className="xs faint"> · organization</span> : null}{u.email ? <div className="xs faint">{u.email}</div> : null}</td>
              <td className="small" data-label="Item">{u.itemName}</td>
              <td className="small" data-label="Date">{when(u.at)}</td>
              <td className="small as-num" data-label="Price">Rs {rs(u.original)}</td>
              <td className="small as-num" data-label="Discount">Rs {rs(u.discount)}</td>
              <td className="small as-num" data-label="Paid">Rs {rs(u.final)}{u.status === 'reserved' ? <div className="xs faint">waiting for payment</div> : null}</td>
              <td className="mono xs" data-label="Order">{u.orderId}</td>
            </tr>
          ))}</tbody></table></div>
      )}</Loading>
    </section>
  );
}

function BulkDone({ out, onClose }) {
  const [name] = useState(() => bulkFileName(out.codes[0]?.split('-')[0] || 'codes'));
  return (
    <section className="mcard mcard-ok" aria-label="New codes" data-testid="bulk-done">
      <strong>{out.count} codes made</strong>
      <span className="small muted">Each works once. Download them now to share (they also stay in the list).</span>
      <div className="mono xs as-quote" style={{ maxHeight: 160, overflow: 'auto' }}>{out.codes.slice(0, 50).join(' · ')}{out.codes.length > 50 ? ' …' : ''}</div>
      <span className="row g8"><button type="button" className="btn btn-ink" onClick={() => saveText(bulkCsv(out.codes, { note: out.batch }), name)} data-testid="bulk-csv">Download CSV</button><button type="button" className="btn btn-outline" onClick={onClose}>Close</button></span>
    </section>
  );
}

/** /admin/codes */
export function LiveCodes() {
  const toast = useToast();
  const [busy, run] = useAction(toast);
  const [filter, setFilter] = useState({ q: '', status: '', type: '', item: '' });
  const qs = new URLSearchParams(Object.entries(filter).filter(([, v]) => v)).toString();
  const st = useApi(`/api/admin/coupons${qs ? `?${qs}` : ''}`);
  const [panel, setPanel] = useState(null); // {mode:new|bulk|edit, row} | {uses: code} | {bulk: out}
  const done = () => { setPanel(null); st.reload(); };
  const act = (code, what) => run(async () => { await http(`/api/admin/coupons/${enc(code)}/${what}`, { method: 'POST' }); st.reload(); }, what === 'pause' ? 'Paused' : 'Resumed');
  const del = (code) => { if (!window.confirm(`Delete ${code}? This can’t be undone.`)) return; run(async () => { await http(`/api/admin/coupons/${enc(code)}`, { method: 'DELETE' }); st.reload(); }, 'Deleted'); };
  return (
    <>
      <Hero icon="%" title="Codes" sub="Free unlocks and discounts for every paid step. Customers type them at the pay step; links like nm7.si/builder?code=CAMPUS26 fill them in."
        stats={st.data?.codes?.length && !qs ? [['Codes', st.data.codes.length], ['Working now', st.data.codes.filter((c) => c.status === 'active').length, 'ok'], ['Paused', st.data.codes.filter((c) => c.paused).length], ['Times used', st.data.codes.reduce((t, c) => t + (c.uses || 0), 0), 'accent']] : null}
        right={<><button type="button" className="btn btn-signal" onClick={() => setPanel({ mode: 'new' })} data-testid="code-new">New code</button><button type="button" className="btn btn-outline" onClick={() => setPanel({ mode: 'bulk' })} data-testid="code-bulk">Bulk codes</button></>} />
      {panel?.mode && <CodeForm key={panel.mode + (panel.row?.code || '')} mode={panel.mode} start={panel.row ? formOf(panel.row) : null} onCancel={() => setPanel(null)} onDone={(out) => (panel.mode === 'bulk' ? (setPanel({ bulk: out }), st.reload()) : done())} />}
      {panel?.bulk && <BulkDone out={panel.bulk} onClose={() => setPanel(null)} />}
      {panel?.uses && <WhoUsed code={panel.uses} onClose={() => setPanel(null)} />}
      <div className="as-bar" role="search">
        <label className="small" style={{ flex: '1 1 200px' }}>Search <input className="input" style={inputStyle} placeholder="Code or note" value={filter.q} onChange={(e) => setFilter({ ...filter, q: e.target.value })} data-testid="code-search" /></label>
        <label className="small">Status <select className="input" style={inputStyle} value={filter.status} onChange={(e) => setFilter({ ...filter, status: e.target.value })} data-testid="code-filter-status"><option value="">All</option>{Object.entries(STATUS).map(([k, [l]]) => <option key={k} value={k}>{l}</option>)}</select></label>
        <label className="small">Type <select className="input" style={inputStyle} value={filter.type} onChange={(e) => setFilter({ ...filter, type: e.target.value })}><option value="">All</option>{TYPES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></label>
        <label className="small">Applies to <select className="input" style={inputStyle} value={filter.item} onChange={(e) => setFilter({ ...filter, item: e.target.value })}><option value="">Anything</option>{ITEMS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></label>
      </div>
      <Loading st={st} empty={emptyIf((d) => !d.codes.length, qs ? 'No codes match.' : 'No codes yet. Press New code to make the first one.')}>{(d) => (
        <div className="mcard as-tcard">
        <div className="as-tcard-h"><strong>{d.codes.length} code(s)</strong><span className="xs muted">Delete shows only for a code nobody has used</span></div>
        <div className="table-wrap" tabIndex={0} role="region" aria-label="Table — scroll sideways to see all columns">
          <table className="table mtable" aria-label="Codes"><thead><tr><th>Code</th><th>Type</th><th>Applies to</th><th>Uses</th><th>Valid until</th><th>Status</th><th>Note</th><th>Created</th><th /></tr></thead>
            <tbody>{d.codes.map((c) => (
              <tr key={c.code} data-testid={`code-row-${c.code}`}>
                <td className="mono small">{c.code}{c.only ? <div className="xs faint">Only {c.only.name}</div> : null}</td>
                <td className="small" data-label="Type">{c.label}</td>
                <td className="small" data-label="Applies to">{c.itemNames.join(', ')}</td>
                <td className="small as-num" data-label="Uses">{usesText(c)}{c.perLimit > 1 ? <div className="xs faint">{c.perLimit} per person</div> : null}</td>
                <td className="small" data-label="Valid until">{c.validUntil ? day(`${c.validUntil}T12:00:00`) : '—'}{c.validFrom && c.status === 'scheduled' ? <div className="xs faint">from {day(`${c.validFrom}T12:00:00`)}</div> : null}</td>
                <td data-label="Status"><Chip tone={{ 'b-success': 'ok', 'b-warning': 'warn', 'b-danger': 'bad', 'b-signal': 'accent' }[STATUS[c.status][1]] || 'neutral'}>{STATUS[c.status][0]}</Chip></td>
                <td className="small" style={{ maxWidth: 200 }} data-label="Note">{c.note}</td>
                <td className="small" data-label="Created">{day(c.createdAt)}</td>
                <td>
                  <span className="row g8" style={{ flexWrap: 'wrap' }}>
                    <button type="button" className="link-btn small" onClick={() => setPanel({ mode: 'edit', row: c })}>Edit</button>
                    {c.paused ? <button type="button" className="link-btn small" disabled={busy} onClick={() => act(c.code, 'resume')}>Resume</button>
                      : <button type="button" className="link-btn small" disabled={busy} onClick={() => act(c.code, 'pause')}>Pause</button>}
                    <button type="button" className="link-btn small" onClick={() => setPanel({ uses: c.code })}>Who used it</button>
                    {c.uses === 0 && <button type="button" className="link-btn small" disabled={busy} onClick={() => del(c.code)}>Delete</button>}
                  </span>
                </td>
              </tr>
            ))}</tbody></table>
        </div>
        </div>
      )}</Loading>
    </>
  );
}
