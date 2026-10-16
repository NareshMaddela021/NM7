// Branded templates (Phase 3B): the organization's logo, colour, header and footer lines and base template, with a
// live preview on a sample resume. Used in the coordinator portal (/org/:orgId/branding) and the admin console.
// Groups choose "Print with organization template" in their settings; members' own resumes never change.
import { useEffect, useState } from 'react';
import { useToast } from '../../components/ui';
import { BRAND_TEMPLATES, SAMPLE_RESUME, brandDesign, contrastWarning, logoProblem } from '../../lib/branding';
import { TEMPLATE_PRESETS } from '../builder/design';
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
  const [f, setF] = useState({ color: saved.color, header: saved.header, footer: saved.footer, template: saved.template });
  const [logo, setLogo] = useState(saved.logo);
  const [logoErr, setLogoErr] = useState('');
  useEffect(() => setLogo(saved.logo), [saved.logo]);
  const warn = contrastWarning(f.color);
  const brand = { ...f, logo };
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
        <strong>Organization template</strong>
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
        <form className="stack g12" aria-label="Organization template" onSubmit={(e) => { e.preventDefault(); run(async () => { await http(url, { method: 'PUT', body: f }); reload(); }, 'Branding saved'); }}>
          <div className="row g12" style={{ alignItems: 'flex-end' }}>
            <div className="field" style={{ flex: '0 0 auto' }}><label className="label" htmlFor="b-color-pick">Colour</label><input id="b-color-pick" type="color" style={{ height: 40, width: 56, padding: 2 }} value={/^#[0-9a-f]{6}$/i.test(f.color) ? f.color : '#000000'} disabled={!canManage} onChange={(e) => setF({ ...f, color: e.target.value.toUpperCase() })} /></div>
            <div className="field" style={{ flex: '1 1 120px' }}><label className="label" htmlFor="b-color">Colour code</label><input id="b-color" className="input mono" style={inputStyle} maxLength={7} value={f.color} disabled={!canManage} onChange={(e) => setF({ ...f, color: e.target.value.trim() })} /></div>
            <div className="field" style={{ flex: '2 1 200px' }}><label className="label" htmlFor="b-template">Base template</label><select id="b-template" className="input" style={inputStyle} value={f.template} disabled={!canManage} onChange={(e) => setF({ ...f, template: e.target.value })}>{BRAND_TEMPLATES.map((k) => <option key={k} value={k}>{TEMPLATE_PRESETS[k].name}</option>)}</select></div>
          </div>
          {warn && <span className="xs" role="alert" data-testid="contrast-warning" style={{ color: 'var(--warning)' }}>{warn}</span>}
          <div className="field"><label className="label" htmlFor="b-header">Header line</label><input id="b-header" className="input" style={inputStyle} maxLength={90} placeholder="e.g. XYZ College · Placement Cell" value={f.header} disabled={!canManage} onChange={(e) => setF({ ...f, header: e.target.value })} /></div>
          <div className="field"><label className="label" htmlFor="b-footer">Footer line (optional)</label><input id="b-footer" className="input" style={inputStyle} maxLength={120} placeholder="e.g. placements@xyz.edu · +91 …" value={f.footer} disabled={!canManage} onChange={(e) => setF({ ...f, footer: e.target.value })} /></div>
          {canManage && <button type="submit" className="btn btn-ink" style={{ alignSelf: 'flex-start' }} disabled={busy || !/^#[0-9a-f]{6}$/i.test(f.color)}>Save branding</button>}
        </form>
      </section>
      <section className="stack g8" aria-label="Preview" style={{ minWidth: 0 }}>
        <span className="xs muted">Live preview · a sample resume</span>
        <ResumePreview data={SAMPLE_RESUME} design={brandDesign(brand)} brand={brand} />
      </section>
    </div>
  );
}
