// The large preview of one template (home gallery cards, the builder's "Pick a starting look" cards).
// Opening it only shows the template: it never makes a file. "Use this template" applies it and opens the builder.
import { Dialog } from '../../components/ui';
import ResumePreview from './ResumePreview';
import { DEFAULT_DESIGN, TEMPLATE_PRESETS } from './design';
import { INITIAL } from './schema';
import { audienceOf, layoutOf, PHOTO_PLACEHOLDER } from './templatePick';

export default function TemplatePreview({ id, data = INITIAL, design, photo, onUse, onClose }) {
  const t = TEMPLATE_PRESETS[id];
  if (!t) return null;
  const ds = design || { ...DEFAULT_DESIGN, ...t.design, preset: id };
  const two = ds.layout === 'two';
  return (
    <Dialog title={`${t.name} template preview`} onClose={onClose} wide>
      <div className="row between g8" style={{ alignItems: 'flex-start' }}>
        <div className="stack g4">
          <strong style={{ fontSize: 20 }}>{t.name}</strong>
          <span className="xs muted">{two ? '2 columns' : '1 column'} · {audienceOf(t)}{t.photo ? ' · Photo' : ''}</span>
        </div>
        <button type="button" className="btn btn-icon" aria-label="Close" onClick={onClose}>✕</button>
      </div>
      <div className="tpv-page" data-testid="template-preview">
        <ResumePreview decorative data={{ ...data, ...layoutOf(id) }} design={ds} photo={t.photo ? (photo || PHOTO_PLACEHOLDER) : photo} />
      </div>
      <div className="row g8 tpv-actions">
        <button type="button" className="btn btn-ink btn-lg" onClick={onUse}>Use this template</button>
        <button type="button" className="btn btn-outline btn-lg" onClick={onClose}>Close</button>
      </div>
    </Dialog>
  );
}
