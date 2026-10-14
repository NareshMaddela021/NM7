import { useState } from 'react';
import { ACCENTS, BULLETS, FONTS, HEADING_STYLES, MARGINS, PAGE, TEMPLATE_PRESETS, TEXT_COLORS, atsCheck, contrastOnWhite } from './design';
import { PRINTABLE, sectionLabel, resolveOrder } from './schema';

function Group({ title, children, open: initial = true }) {
  const [open, setOpen] = useState(initial);
  return (
    <section className="card" style={{ padding: 0 }}>
      <button type="button" onClick={() => setOpen(!open)} aria-expanded={open} className="row between" style={{ width: '100%', padding: '16px 20px', border: 0, background: 'transparent', fontWeight: 700, fontSize: 15, textAlign: 'left' }}>
        {title}<span aria-hidden="true" className="faint">{open ? '−' : '+'}</span>
      </button>
      {open && <div className="stack g16" style={{ padding: '0 20px 20px' }}>{children}</div>}
    </section>
  );
}

function Slider({ id, label, value, min, max, step, unit = '', onChange }) {
  return (
    <div className="field">
      <div className="row between"><label htmlFor={id} className="label">{label}</label><span className="mono muted">{value}{unit}</span></div>
      <input id={id} type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(+e.target.value)} style={{ width: '100%', accentColor: 'var(--ink)', minHeight: 28 }} />
    </div>
  );
}

function Choice({ label, value, options, onChange, name }) {
  return (
    <div className="field">
      <span className="label" id={`${name}-l`}>{label}</span>
      <div className="segmented" role="radiogroup" aria-labelledby={`${name}-l`} style={{ flexWrap: 'wrap', display: 'flex' }}>
        {options.map(([v, l]) => <button key={String(v)} type="button" role="radio" aria-checked={value === v} aria-pressed={value === v} onClick={() => onChange(v)}>{l}</button>)}
      </div>
    </div>
  );
}

function Toggle({ label, checked, onChange }) {
  return <label className="check small" style={{ minHeight: 36 }}><input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />{label}</label>;
}

export default function DesignPanel({ d, ds, set, applyPreset, setTitle, fit, fitting, pages, history, savedStyles, saveStyle, applySaved, deleteSaved, reset }) {
  const ats = atsCheck(ds, d);
  const [styleName, setStyleName] = useState('');
  const fontOpts = Object.entries(FONTS);
  const lowContrast = contrastOnWhite(ds.accent) < 4.5;

  return (
    <div className="stack g12">
      {/* Smart tools first: they matter most */}
      <section className="card stack g12" aria-label="Smart tools">
        <div className="row between g12">
          <div className="stack g4">
            <span className="xs muted">ATS-safety</span>
            <span className="row g8" style={{ alignItems: 'baseline' }}><strong className="display" style={{ fontSize: 30 }}>{ats.score}</strong><span className={`badge ${ats.score >= 90 ? 'b-success' : ats.score >= 75 ? 'b-warning' : 'b-danger'}`}>{ats.label}</span></span>
          </div>
          <div className="row g8">
            <button type="button" className="btn btn-outline" onClick={history.undo} disabled={!history.canUndo} aria-label="Undo design change">↶ Undo</button>
            <button type="button" className="btn btn-outline" onClick={history.redo} disabled={!history.canRedo} aria-label="Redo design change">↷ Redo</button>
          </div>
        </div>
        {ats.issues.length > 0 && <ul className="stack g4 xs muted" style={{ margin: 0, paddingLeft: 18 }}>{ats.issues.map((m) => <li key={m}>{m}</li>)}</ul>}
        <div className="row g8">
          <button type="button" className="btn btn-ink" onClick={fit} disabled={fitting || pages <= 1}>{fitting ? 'Fitting…' : pages > 1 ? `Fit to one page (now ${pages})` : 'Fits on one page ✓'}</button>
          <button type="button" className="btn btn-ghost" onClick={reset}>Reset to template</button>
        </div>
      </section>

      <Group title="Template">
        <div className="grid-auto g8" style={{ '--min': '150px' }}>
          {Object.entries(TEMPLATE_PRESETS).map(([k, t]) => (
            <button key={k} type="button" className="option stack g4" data-on={ds.preset === k} onClick={() => applyPreset(k)} style={{ fontSize: 13 }}>
              <strong style={{ fontFamily: FONTS[t.design.font].css, color: t.design.accent, fontSize: 15 }}>{t.name}</strong>
              <span className="faint xs">{t.desc}</span>
            </button>
          ))}
        </div>
        <span className="xs faint">A template sets everything below. You can still change anything afterwards.</span>
      </Group>

      <Group title="Fonts & text">
        <div className="field">
          <label htmlFor="ds-font" className="label">Font</label>
          <select id="ds-font" className="input" value={ds.font} onChange={(e) => set({ font: e.target.value })} style={{ fontFamily: FONTS[ds.font].css }}>
            {['Sans', 'Serif'].map((kind) => (
              <optgroup key={kind} label={kind === 'Sans' ? 'Clean (sans-serif)' : 'Classic (serif)'}>
                {fontOpts.filter(([, f]) => f.kind === kind).map(([id, f]) => <option key={id} value={id}>{f.label}</option>)}
              </optgroup>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="ds-hfont" className="label">Heading & name font</label>
          <select id="ds-hfont" className="input" value={ds.headFont} onChange={(e) => set({ headFont: e.target.value })}>
            <option value="same">Same as body</option>
            {fontOpts.map(([id, f]) => <option key={id} value={id}>{f.label}</option>)}
          </select>
        </div>
        <Slider id="ds-name" label="Name size" value={ds.nameSize} min={16} max={34} step={1} unit=" pt" onChange={(v) => set({ nameSize: v })} />
        <Slider id="ds-head" label="Section heading size" value={ds.headSize} min={9} max={14} step={0.5} unit=" pt" onChange={(v) => set({ headSize: v })} />
        <Slider id="ds-body" label="Body text size" value={ds.bodySize} min={9} max={12} step={0.5} unit=" pt" onChange={(v) => set({ bodySize: v })} />
        <Slider id="ds-lh" label="Line spacing" value={ds.lineHeight} min={1.1} max={1.7} step={0.05} unit="×" onChange={(v) => set({ lineHeight: +v.toFixed(2) })} />
        <Slider id="ds-sg" label="Space between sections" value={ds.sectionGap} min={4} max={24} step={1} unit=" pt" onChange={(v) => set({ sectionGap: v })} />
        <Slider id="ds-ig" label="Space between entries" value={ds.itemGap} min={2} max={14} step={1} unit=" pt" onChange={(v) => set({ itemGap: v })} />
        <Choice name="bw" label="Body weight" value={ds.bodyWeight} onChange={(v) => set({ bodyWeight: v })} options={[[400, 'Regular'], [500, 'Medium']]} />
        <Choice name="hw" label="Heading weight" value={ds.headWeight} onChange={(v) => set({ headWeight: v })} options={[[600, 'Semi-bold'], [700, 'Bold']]} />
        <span className="xs faint">The PDF uses regular and bold weights of your font. Medium and semi-bold show as regular and bold there.</span>
      </Group>

      <Group title="Colours">
        <div className="field">
          <span className="label" id="acc-l">Accent colour</span>
          <div className="row g8" role="radiogroup" aria-labelledby="acc-l">
            {ACCENTS.map((c) => (
              <button key={c} type="button" role="radio" aria-checked={ds.accent === c} aria-label={`Accent ${c}`} onClick={() => set({ accent: c })}
                style={{ width: 32, height: 32, borderRadius: '50%', background: c, border: ds.accent === c ? '3px solid var(--surface)' : '0', boxShadow: ds.accent === c ? '0 0 0 2px var(--ink)' : 'none' }} />
            ))}
            <label className="row g8 small" style={{ cursor: 'pointer' }}>
              <input type="color" value={ds.accent} onChange={(e) => set({ accent: e.target.value.toUpperCase() })} style={{ width: 36, height: 32, border: 0, background: 'transparent', padding: 0 }} aria-label="Custom accent colour" />Custom
            </label>
          </div>
          {lowContrast && <span className="error">This colour is light for text — fine for lines, but pick darker for headings or the name.</span>}
        </div>
        <div className="field">
          <span className="label">Use the accent on</span>
          <div className="row g16">
            {[['name', 'Name'], ['headings', 'Headings'], ['lines', 'Lines'], ['links', 'Links']].map(([k, l]) => (
              <Toggle key={k} label={l} checked={ds.accentOn[k]} onChange={(v) => set({ accentOn: { ...ds.accentOn, [k]: v } })} />
            ))}
          </div>
        </div>
        <Choice name="tc" label="Text colour" value={ds.textColor} onChange={(v) => set({ textColor: v })} options={TEXT_COLORS} />
      </Group>

      <Group title="Page & layout">
        <Choice name="ps" label="Page size" value={ds.pageSize} onChange={(v) => set({ pageSize: v })} options={Object.entries(PAGE).map(([k, p]) => [k, p.label])} />
        <Choice name="mg" label="Margins" value={ds.margin} onChange={(v) => set(v === 'custom' ? { margin: v } : { margin: v, marginPt: MARGINS[v] })} options={[['narrow', 'Narrow'], ['normal', 'Normal'], ['wide', 'Wide'], ['custom', 'Custom']]} />
        {ds.margin === 'custom' && <Slider id="ds-mpt" label="Margin" value={ds.marginPt} min={24} max={80} step={2} unit=" pt" onChange={(v) => set({ marginPt: v })} />}
        <Choice name="ly" label="Layout" value={ds.layout} onChange={(v) => set({ layout: v })} options={[['one', 'One column'], ['two', 'Two columns']]} />
        {ds.layout === 'two' && <span className="xs" style={{ color: 'var(--warning)' }}>Two columns put Skills, Languages and Certifications in a side panel. Some tracking systems read across columns — one column is safest.</span>}
        <Choice name="ha" label="Header" value={ds.headerAlign} onChange={(v) => set({ headerAlign: v })} options={[['left', 'Left'], ['center', 'Centred']]} />
        {d.showPhoto && ds.headerAlign === 'center' && <span className="xs faint">With your photo on, the header sits on the left next to it.</span>}
        <Choice name="hst" label="Header style" value={ds.headerStyle || 'line'} onChange={(v) => set({ headerStyle: v })} options={[['line', 'Line under'], ['band', 'Colour band'], ['none', 'No line']]} />
        {ds.layout === 'two' && <Toggle label="Pale background behind the side column" checked={!!ds.sideTint} onChange={(v) => set({ sideTint: v })} />}
        <Choice name="cl" label="Contact details" value={ds.contactLines} onChange={(v) => set({ contactLines: v })} options={[['one', 'One line'], ['two', 'Contact / links on two lines']]} />
      </Group>

      <Group title="Photo" open={false}>
        {!d.showPhoto && <span className="xs faint">Your photo isn’t on the resume. Turn on “Show my photo on the resume too” in Personal Info to use these.</span>}
        <Choice name="psh" label="Shape" value={ds.photoShape} onChange={(v) => set({ photoShape: v })} options={[['circle', 'Circle'], ['rounded', 'Rounded square'], ['square', 'Square']]} />
        <Slider id="ds-psz" label="Size" value={ds.photoSize} min={44} max={96} step={2} unit=" pt" onChange={(v) => set({ photoSize: v })} />
        <div className="row g8">{[['Small', 50], ['Medium', 62], ['Large', 80]].map(([l, v]) => <button key={l} type="button" className="chip" aria-pressed={ds.photoSize === v} style={{ minHeight: 32, fontSize: 12 }} onClick={() => set({ photoSize: v })}>{l}</button>)}</div>
        <Choice name="ppo" label="Position" value={ds.photoPos} onChange={(v) => set({ photoPos: v })} options={[['left', 'Left of name'], ['right', 'Right of name'], ['top', 'Above name']]} />
        <Choice name="pbd" label="Border" value={ds.photoBorder} onChange={(v) => set({ photoBorder: v })} options={[['none', 'None'], ['thin', 'Thin'], ['thick', 'Thick']]} />
        {ds.photoBorder !== 'none' && <Choice name="pbc" label="Border colour" value={ds.photoBorderColor} onChange={(v) => set({ photoBorderColor: v })} options={[['accent', 'Accent colour'], ['grey', 'Grey']]} />}
      </Group>

      <Group title="Style details" open={false}>
        <Choice name="hs" label="Section heading style" value={ds.headingStyle} onChange={(v) => set({ headingStyle: v })} options={HEADING_STYLES} />
        <Choice name="bl" label="Bullets" value={ds.bullet} onChange={(v) => set({ bullet: v })} options={BULLETS} />
        <Choice name="df" label="Date format" value={ds.dateFormat} onChange={(v) => set({ dateFormat: v })} options={[['mon', 'Jan 2025'], ['num', '01/2025'], ['year', '2025']]} />
        <Choice name="dp" label="Date position" value={ds.datePos} onChange={(v) => set({ datePos: v })} options={[['right', 'Right side'], ['below', 'Under the title']]} />
        <Choice name="sk" label="Skills style" value={ds.skillsStyle} onChange={(v) => set({ skillsStyle: v })} options={[['lines', 'One category per line'], ['comma', 'One comma list'], ['chips', 'Chips']]} />
        <Toggle label="Bold the numbers in bullets (20%, ₹2L, 3x) so results stand out" checked={!!ds.boldNumbers} onChange={(v) => set({ boldNumbers: v })} />
        <Toggle label="Also print the full link under projects, certificates and other entries (for paper copies)" checked={!!ds.printLinks} onChange={(v) => set({ printLinks: v })} />
        <Toggle label="Show icons and logos next to contact details and links" checked={ds.icons} onChange={(v) => set({ icons: v })} />
        {ds.icons && <Choice name="lgc" label="Logo colour" value={ds.logoColor || 'brand'} onChange={(v) => set({ logoColor: v })} options={[['brand', 'Brand colours'], ['mono', 'One colour (prints best)']]} />}
      </Group>

      <Group title="Section names" open={false}>
        <span className="xs faint">Rename how a section appears on your resume, e.g. “Work Experience” or “Academic Projects”.</span>
        {resolveOrder(d).map((id) => (
          <div key={id} className="field">
            <label htmlFor={`ttl-${id}`} className="label">{PRINTABLE[id] || d.custom.find((c) => c.id === id)?.title}</label>
            <input id={`ttl-${id}`} className="input" style={{ height: 42 }} value={d.titles?.[id] ?? ''} placeholder={sectionLabel({ ...d, titles: {} }, id)} onChange={(e) => setTitle(id, e.target.value)} />
          </div>
        ))}
      </Group>

      <Group title="My saved styles" open={false}>
        <form className="row g8" style={{ flexWrap: 'nowrap' }} onSubmit={(e) => { e.preventDefault(); if (styleName.trim()) { saveStyle(styleName.trim()); setStyleName(''); } }}>
          <label htmlFor="sty" className="sr-only">Style name</label>
          <input id="sty" className="input" style={{ height: 44 }} value={styleName} onChange={(e) => setStyleName(e.target.value)} placeholder="Name this look, e.g. Tech applications" />
          <button type="submit" className="btn btn-ink" disabled={!styleName.trim()}>Save</button>
        </form>
        {savedStyles.length === 0 && <span className="xs faint">Saved looks appear here so you can reuse them on another resume. They’re kept in this browser.</span>}
        {savedStyles.map((st, i) => (
          <div key={st.name + i} className="row between g8 well" style={{ padding: '8px 12px' }}>
            <span className="strong small">{st.name}</span>
            <span className="row g8"><button type="button" className="btn btn-outline" style={{ minHeight: 36 }} onClick={() => applySaved(i)}>Apply</button><button type="button" className="btn btn-danger-soft" onClick={() => deleteSaved(i)}>Delete</button></span>
          </div>
        ))}
      </Group>
    </div>
  );
}
