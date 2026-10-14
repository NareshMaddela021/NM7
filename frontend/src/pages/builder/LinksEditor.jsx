// Links step: each profile link with its logo, a smart Portfolio field, and up to 3 extra links.
import { LINK_FIELDS, fieldError } from './schema';
import { BRANDS } from './brands';
import { PICKABLE, brandName, detectBrand, iconInner } from './icons';
import { MAX_EXTRA_LINKS, extraIcon, portfolioIcon } from './ContactLine';

const SLOT_BRAND = { linkedin: 'linkedin', github: 'github', twitter: 'x', stackoverflow: 'stackoverflow', medium: 'medium' };
const SLOT_ICON = { ...SLOT_BRAND, resume: 'resume' };

export function Logo({ k, size = 20 }) {
  const color = BRANDS[k]?.hex || 'currentColor';
  return <svg aria-hidden="true" viewBox="0 0 24 24" style={{ width: size, height: size, flex: 'none' }} dangerouslySetInnerHTML={{ __html: iconInner(k, color) }} />;
}

function IconPicker({ name, value, detected, onChange }) {
  const opts = [['auto', detected ? `Auto · ${brandName(detected)}` : 'Auto'], ...PICKABLE];
  return (
    <div className="row g4" role="radiogroup" aria-label={`${name} icon`}>
      {opts.map(([v, l]) => (
        <button key={v} type="button" role="radio" aria-checked={(value || 'auto') === v} className="chip" aria-pressed={(value || 'auto') === v}
          style={{ minHeight: 32, fontSize: 12, padding: '0 10px', gap: 6 }} onClick={() => onChange(v)}>
          {v !== 'auto' && <Logo k={v} size={14} />}{l}
        </button>
      ))}
    </div>
  );
}

export default function LinksEditor({ d, setD }) {
  const links = d.links || {};
  const extras = d.linkExtras || [];
  const setLink = (k, v) => setD((p) => ({ ...p, links: { ...p.links, [k]: v } }));
  const setExtra = (i, patch) => setD((p) => ({ ...p, linkExtras: (p.linkExtras || []).map((x, j) => (j === i ? { ...x, ...patch } : x)) }));
  const detectedP = detectBrand(links.portfolio);

  return (
    <div className="stack g12">
      <div className="card stack g16" style={{ padding: 20 }}>
        {LINK_FIELDS.filter((f) => f.key !== 'portfolio').map((f) => {
          const v = links[f.key] || '';
          const err = fieldError('url', v);
          const want = SLOT_BRAND[f.key];
          const got = detectBrand(v);
          const mismatch = v && !err && want && got !== want;
          return (
            <div key={f.key} className="field">
              <label htmlFor={`ln-${f.key}`} className="label row g8" style={{ alignItems: 'center' }}><Logo k={SLOT_ICON[f.key]} />{f.label}</label>
              <input id={`ln-${f.key}`} className="input" type="url" value={v} placeholder={f.ph} onChange={(e) => setLink(f.key, e.target.value)}
                aria-invalid={err ? 'true' : undefined} aria-describedby={err || mismatch ? `ln-${f.key}-h` : undefined} />
              {err && <span id={`ln-${f.key}-h`} role="alert" className="error">{err}</span>}
              {mismatch && <span id={`ln-${f.key}-h`} className="xs" style={{ color: 'var(--warning)' }}>This doesn’t look like a {BRANDS[want].name} link. {got ? `It looks like ${brandName(got)} — it will still show with the ${BRANDS[want].name} logo.` : ''}</span>}
            </div>
          );
        })}
      </div>

      {/* Portfolio */}
      <div className="card stack g12" style={{ padding: 20 }}>
        <div className="field">
          <label htmlFor="ln-portfolio" className="label row g8" style={{ alignItems: 'center' }}><Logo k={portfolioIcon(d)} />Portfolio / website · optional</label>
          <input id="ln-portfolio" className="input" type="url" value={links.portfolio || ''} placeholder="yourname.dev, kaggle.com/you, behance.net/you…" onChange={(e) => setLink('portfolio', e.target.value)} />
          {fieldError('url', links.portfolio) && <span role="alert" className="error">{fieldError('url', links.portfolio)}</span>}
          {links.portfolio && detectedP && (d.portfolioIcon || 'auto') === 'auto' && <span className="xs" style={{ color: 'var(--success)' }}>✓ {brandName(detectedP)} link — its logo will show on your resume.</span>}
        </div>
        <div className="stack g4">
          <span className="label">Icon on your resume</span>
          <IconPicker name="Portfolio" value={d.portfolioIcon} detected={detectedP} onChange={(v) => setD((p) => ({ ...p, portfolioIcon: v }))} />
        </div>
        <div className="field">
          <label htmlFor="ln-plabel" className="label">Show as · optional</label>
          <input id="ln-plabel" className="input" maxLength={24} value={d.portfolioLabel || ''} placeholder={links.portfolio ? links.portfolio.replace(/^https?:\/\//, '').replace(/^www\./, '').split('/')[0] : 'e.g. Portfolio, My Work'} onChange={(e) => setD((p) => ({ ...p, portfolioLabel: e.target.value }))} />
          <span className="xs faint">Leave blank to show the address. A word like “Portfolio” stays clickable in the PDF.</span>
        </div>
      </div>

      {/* Extra links */}
      <div className="card stack g12" style={{ padding: 20 }}>
        <div className="stack g4"><strong>More profile links</strong><span className="xs muted">LeetCode, Kaggle, HackerRank, CodeChef, Behance, YouTube… Up to {MAX_EXTRA_LINKS}. Known sites get their logo automatically.</span></div>
        {extras.map((x, i) => {
          const det = detectBrand(x.url);
          const err = x.url && fieldError('url', x.url);
          return (
            <div key={i} className="well stack g8">
              <div className="row between g8"><span className="row g8 strong small" style={{ alignItems: 'center' }}><Logo k={extraIcon(x)} />Link {i + 1}{det ? ` · ${brandName(det)}` : ''}</span>
                <button type="button" className="btn btn-danger-soft" onClick={() => setD((p) => ({ ...p, linkExtras: p.linkExtras.filter((_, j) => j !== i) }))}>Remove</button></div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(200px, 100%), 1fr))', gap: 10 }}>
                <div className="field">
                  <label htmlFor={`lx-${i}`} className="label">Link</label>
                  <input id={`lx-${i}`} className="input" type="url" value={x.url} placeholder="leetcode.com/u/you" onChange={(e) => setExtra(i, { url: e.target.value })} aria-invalid={err ? 'true' : undefined} />
                  {err && <span role="alert" className="error">{err}</span>}
                </div>
                <div className="field">
                  <label htmlFor={`lxl-${i}`} className="label">Show as · optional</label>
                  <input id={`lxl-${i}`} className="input" maxLength={24} value={x.label || ''} placeholder="Your handle" onChange={(e) => setExtra(i, { label: e.target.value })} />
                </div>
              </div>
              {!det && <IconPicker name={`Link ${i + 1}`} value={x.icon} detected={null} onChange={(v) => setExtra(i, { icon: v })} />}
            </div>
          );
        })}
        {extras.length < MAX_EXTRA_LINKS && (
          <button type="button" className="btn btn-outline" style={{ borderStyle: 'dashed', alignSelf: 'flex-start' }} onClick={() => setD((p) => ({ ...p, linkExtras: [...(p.linkExtras || []), { url: '', label: '', icon: 'auto' }] }))}>+ Add another link</button>
        )}
      </div>
    </div>
  );
}
