// Branded templates (Phase 3B) and the official placement template (colleges, Phase 2): the logo, colour, college
// name, placement cell line, header style, footer, 1-3 allowed templates and (Campus) the college's section order and
// rules, with a live preview on a sample resume. Used in the coordinator portal (/org/:orgId/branding) and the admin
// console. Groups choose "Print with organization template" in their settings; members' own resumes never change,
// and the college format only changes the layout of org-side copies (lib/placementFormat.js).
import { useEffect, useState } from 'react';
import { useToast } from '../../components/ui';
import { BRAND_TEMPLATES, SAMPLE_RESUME, brandDesign, contrastWarning, logoProblem } from '../../lib/branding';
import { TEMPLATE_PRESETS } from '../builder/design';
import { ALL_TEMPLATES, SECTION_NAMES } from '../../lib/placementFormat';
import ResumePreview from '../builder/ResumePreview';
import { Loading, http, useAction, useApi } from '../admin/live/common';

const inputStyle = { height: 40 };
const readFile = (f) => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsDataURL(f); });

export default function Branding({ orgId, canManage }) {
  const url = `/api/org/${encodeURIComponent(orgId)}/branding`;
  const st = useApi(url);
  return <Loading st={st}>{(b) => <BrandForm key={b.updatedAt || 0} url={url} saved={b} canManage={canManage} reload={st.reload} />}</Loading>;
}

function BrandForm({ url, saved, canManage, reload }) {
  const toast = useToast();
  const [busy, run] = useAction(toast);
  const [f, setF] = useState({ color: saved.color, header: saved.header, footer: saved.footer, collegeName: saved.collegeName || '', headerStyle: saved.headerStyle || 'left', templates: saved.templates?.length ? saved.templates : [saved.template] });
  const [rules, setRules] = useState(() => rulesForm(saved.rules));
  const many = saved.rulesAllowed; // Campus: up to 3 templates and the rules
  const [logo, setLogo] = useState(saved.logo);
  const [logoErr, setLogoErr] = useState('');
  useEffect(() => setLogo(saved.logo), [saved.logo]);
  const warn = contrastWarning(f.color);
  const brand = { ...f, template: f.templates[0], logo, rules: many && rules.on ? rulesBody(rules) : null };
  const body = { color: f.color, header: f.header, footer: f.footer, collegeName: f.collegeName, headerStyle: f.headerStyle, templates: f.templates.filter(Boolean),
    template: BRAND_TEMPLATES.includes(f.templates[0]) ? f.templates[0] : 'fresher', ...(many ? (rules.on ? { rules: rulesBody(rules) } : { clearRules: true }) : {}) };
  const setT = (i, v) => { const t = [...f.templates]; t[i] = v; setF({ ...f, templates: t.filter((x, j) => x || j === 0) }); };
  const pick = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    const problem = logoProblem(file);
    setLogoErr(problem);
    if (problem) return;
    const data = await readFile(file);
    run(async () => { const r = await http(`${url}/logo`, { method: 'PUT', body: { data } }); setLogo(r.logo); }, 'Logo saved');
  };
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(340px, 100%), 1fr))', gap: 20, alignItems: 'start' }}>
      <section className="card stack g12" aria-label="Branding" style={{ minWidth: 0 }}>
        <strong>Official placement template</strong>
        <span className="xs faint">Used for every copy your team views, prints or exports from groups with “Print with organization template” on — and for kiosk prints. Members’ own resumes and downloads don’t change. The logo and colour go in the header only; the resume text stays plain, selectable text for ATS.</span>
        <div className="stack g8">
          <span className="label">Logo (PNG, JPG or SVG, up to 300 KB)</span>
          <div className="row g12" style={{ alignItems: 'center' }}>
            {logo ? <img src={logo} alt="Organization logo" style={{ height: 40, maxWidth: 160, objectFit: 'contain', border: '1px solid var(--border)', borderRadius: 6, padding: 4, background: '#fff' }} /> : <span className="xs muted">No logo yet</span>}
            {canManage && <label className="btn btn-outline" style={{ minHeight: 34 }}>Upload logo<input type="file" accept="image/png,image/jpeg,image/svg+xml" onChange={pick} style={{ display: 'none' }} aria-label="Upload logo" /></label>}
            {canManage && logo && <button type="button" className="link-btn small" disabled={busy} onClick={() => run(async () => { await http(`${url}/logo`, { method: 'DELETE' }); setLogo(null); }, 'Logo removed')}>Remove</button>}
          </div>
          {logoErr && <span className="error" role="alert">{logoErr}</span>}
        </div>
        <form className="stack g12" aria-label="Organization template" onSubmit={(e) => { e.preventDefault(); run(async () => { await http(url, { method: 'PUT', body }); reload(); }, 'Branding saved'); }}>
          <div className="field"><label className="label" htmlFor="b-college">College name</label><input id="b-college" className="input" style={inputStyle} maxLength={90} placeholder="e.g. XYZ College of Engineering" value={f.collegeName} disabled={!canManage} onChange={(e) => setF({ ...f, collegeName: e.target.value })} /></div>
          <div className="row g12" style={{ alignItems: 'flex-end' }}>
            <div className="field" style={{ flex: '0 0 auto' }}><label className="label" htmlFor="b-color-pick">Colour</label><input id="b-color-pick" type="color" style={{ height: 40, width: 56, padding: 2 }} value={/^#[0-9a-f]{6}$/i.test(f.color) ? f.color : '#000000'} disabled={!canManage} onChange={(e) => setF({ ...f, color: e.target.value.toUpperCase() })} /></div>
            <div className="field" style={{ flex: '1 1 120px' }}><label className="label" htmlFor="b-color">Colour code</label><input id="b-color" className="input mono" style={inputStyle} maxLength={7} value={f.color} disabled={!canManage} onChange={(e) => setF({ ...f, color: e.target.value.trim() })} /></div>
            <div className="field" style={{ flex: '2 1 200px' }}><label className="label" htmlFor="b-template">Base template</label><select id="b-template" className="input" style={inputStyle} value={f.templates[0]} disabled={!canManage} onChange={(e) => setT(0, e.target.value)}>{ALL_TEMPLATES.map((k) => <option key={k} value={k}>{TEMPLATE_PRESETS[k].name}{BRAND_TEMPLATES.includes(k) ? '' : ' (not single-column)'}</option>)}</select></div>
          </div>
          {many && (
            <div className="row g12" style={{ flexWrap: 'wrap' }}>
              {[1, 2].map((i) => <div key={i} className="field" style={{ flex: '1 1 160px' }}><label className="label" htmlFor={`b-template-${i}`}>Also allow (optional)</label><select id={`b-template-${i}`} className="input" style={inputStyle} value={f.templates[i] || ''} disabled={!canManage || (i === 2 && !f.templates[1])} onChange={(e) => setT(i, e.target.value)}><option value="">—</option>{ALL_TEMPLATES.filter((k) => !f.templates.slice(0, i).includes(k)).map((k) => <option key={k} value={k}>{TEMPLATE_PRESETS[k].name}</option>)}</select></div>)}
              <span className="xs muted" style={{ flexBasis: '100%' }}>A student’s own template is used when it’s one of these; otherwise the first one.</span>
            </div>
          )}
          <div className="field"><label className="label" htmlFor="b-style">Header style</label><select id="b-style" className="input" style={inputStyle} value={f.headerStyle} disabled={!canManage} onChange={(e) => setF({ ...f, headerStyle: e.target.value })}><option value="left">Logo on the left, name beside it</option><option value="center">Logo centred, name under it</option></select></div>
          {warn && <span className="xs" role="alert" data-testid="contrast-warning" style={{ color: 'var(--warning)' }}>{warn}</span>}
          <div className="field"><label className="label" htmlFor="b-header">Header line</label><input id="b-header" className="input" style={inputStyle} maxLength={90} placeholder="e.g. Training & Placement Cell" value={f.header} disabled={!canManage} onChange={(e) => setF({ ...f, header: e.target.value })} /></div>
          <div className="field"><label className="label" htmlFor="b-footer">Footer line (optional)</label><input id="b-footer" className="input" style={inputStyle} maxLength={120} placeholder="e.g. Placement resume · Batch 2026 · Verified by T&P Cell" value={f.footer} disabled={!canManage} onChange={(e) => setF({ ...f, footer: e.target.value })} /><span className="xs faint">With a college name, page numbers (“Page 1 of 2”) are added to every page.</span></div>
          {many ? <Rules r={rules} set={setRules} canManage={canManage} /> : <span className="xs muted" data-testid="rules-upsell">Section order, required sections, a page limit and photo / roll-number rules are in the Campus plan.</span>}
          {canManage && <button type="submit" className="btn btn-ink" style={{ alignSelf: 'flex-start' }} disabled={busy || !/^#[0-9a-f]{6}$/i.test(f.color)}>Save branding</button>}
        </form>
      </section>
      <section className="stack g8" aria-label="Preview" style={{ minWidth: 0 }}>
        <span className="xs muted">Live preview · a sample resume</span>
        <ResumePreview data={SAMPLE_RESUME} design={brandDesign(brand, SAMPLE_RESUME)} brand={{ ...brand, roll: rules.on && rules.showRoll ? '26CS001' : '' }} />
      </section>
    </div>
  );
}

const DEFAULT_ORDER = ['edu', 'proj', 'exp', 'skills', 'certs', 'ach', 'langs', 'summary', 'hobbies', 'strengths', 'pinfo', 'decl'];

function rulesForm(r) {
  const order = [...(r?.order || []), ...DEFAULT_ORDER.filter((id) => !(r?.order || []).includes(id))];
  const allowed = r?.optional ? new Set([...(r.order || []), ...(r.required || []), ...r.optional]) : new Set(DEFAULT_ORDER);
  return { on: !!r, order, allowed: Object.fromEntries(order.map((id) => [id, allowed.has(id)])), required: Object.fromEntries((r?.required || []).map((id) => [id, true])),
    requireCgpa: !!r?.requireCgpa, maxPages: r?.maxPages || '', photo: !!r?.photo, showRoll: !!r?.showRoll };
}

function rulesBody(r) {
  const order = r.order.filter((id) => r.allowed[id]);
  const required = order.filter((id) => r.required[id]);
  const everything = r.order.every((id) => r.allowed[id]);
  return { order, required, requireCgpa: r.requireCgpa, optional: everything ? null : order.filter((id) => !r.required[id]), maxPages: r.maxPages ? Number(r.maxPages) : null, photo: r.photo, showRoll: r.showRoll };
}

/** Campus: the college's section order and rules. Only the layout of org-side copies follows them; students see a
 * checklist of what doesn't (nothing in their resume is changed for them). */
function Rules({ r, set, canManage }) {
  const move = (i, d) => { const o = [...r.order]; [o[i], o[i + d]] = [o[i + d], o[i]]; set({ ...r, order: o }); };
  return (
    <fieldset className="stack g8" style={{ border: '1px solid var(--border)', borderRadius: 8, padding: 12, margin: 0 }} data-testid="rules" disabled={!canManage}>
      <legend className="small" style={{ padding: '0 4px', fontWeight: 600 }}>College rules (Campus)</legend>
      <label className="row g8 small"><input type="checkbox" checked={r.on} onChange={(e) => set({ ...r, on: e.target.checked })} /> Use a section order and rules</label>
      {r.on && (
        <>
          <span className="xs muted">Sections print in this order. Untick a section to leave it out of the format (students are told; their resume isn’t changed). Required sections must have content.</span>
          <ol className="stack g4" style={{ listStyle: 'none', margin: 0, padding: 0 }} aria-label="Section order">
            {r.order.map((id, i) => (
              <li key={id} className="row g8 small" style={{ alignItems: 'center', flexWrap: 'wrap' }}>
                <span className="row g4"><button type="button" className="btn btn-ghost" style={{ minHeight: 30, padding: '0 8px' }} aria-label={`Move ${SECTION_NAMES[id]} up`} disabled={i === 0} onClick={() => move(i, -1)}>↑</button><button type="button" className="btn btn-ghost" style={{ minHeight: 30, padding: '0 8px' }} aria-label={`Move ${SECTION_NAMES[id]} down`} disabled={i === r.order.length - 1} onClick={() => move(i, 1)}>↓</button></span>
                <span style={{ flex: '1 1 140px', minWidth: 0 }}>{SECTION_NAMES[id]}</span>
                <label className="row g4 xs"><input type="checkbox" checked={!!r.allowed[id]} onChange={(e) => set({ ...r, allowed: { ...r.allowed, [id]: e.target.checked }, required: e.target.checked ? r.required : { ...r.required, [id]: false } })} /> Allowed</label>
                <label className="row g4 xs"><input type="checkbox" aria-label={`${SECTION_NAMES[id]} required`} checked={!!r.required[id]} disabled={!r.allowed[id]} onChange={(e) => set({ ...r, required: { ...r.required, [id]: e.target.checked } })} /> Required</label>
              </li>
            ))}
          </ol>
          <label className="row g8 small"><input type="checkbox" checked={r.requireCgpa} onChange={(e) => set({ ...r, requireCgpa: e.target.checked })} /> CGPA or percentage required in Education</label>
          <div className="field"><label className="label" htmlFor="b-pages">Page limit</label><select id="b-pages" className="input" style={{ height: 40, width: 'auto' }} value={r.maxPages} onChange={(e) => set({ ...r, maxPages: e.target.value })}><option value="">No limit</option><option value="1">1 page</option><option value="2">2 pages</option></select></div>
          <label className="row g8 small"><input type="checkbox" checked={r.photo} onChange={(e) => set({ ...r, photo: e.target.checked })} /> Photo may print</label>
          <label className="row g8 small"><input type="checkbox" checked={r.showRoll} onChange={(e) => set({ ...r, showRoll: e.target.checked })} /> Show the roll number in the header</label>
        </>
      )}
    </fieldset>
  );
}
