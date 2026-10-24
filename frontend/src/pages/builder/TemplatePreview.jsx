// The large preview of one template (template gallery, home gallery cards, the builder's "Pick a starting look").
// Opening it only shows the template: it never makes a file. "Use this template" applies it and opens the builder;
// the Download button (shown with the person's own resume) is the only thing here that makes a file.
import { Dialog } from '../../components/ui';
import ResumePreview from './ResumePreview';
import { TEMPLATE_PRESETS } from './design';
import { INITIAL } from './schema';
import { audienceOf, layoutOf, PHOTO_PLACEHOLDER, withTemplate } from './templatePick';
import { NoDetails, ViewSwitch } from './ViewSwitch';

/**
 * view: 'sample' (the example person) or 'mine' (`data`, the person's own resume; null = nothing to show yet).
 * accent: a colour picked on the card. onView shows the "Sample resume | My details" switch; onStart is "Start my resume"; onDownload adds a Download button.
 */
export default function TemplatePreview({ id, view = 'sample', data, accent, onView, onStart, onUse, onDownload, busy = false, onClose }) {
  const t = TEMPLATE_PRESETS[id];
  if (!t) return null;
  const sample = view === 'sample';
  const shown = sample ? { data: { ...INITIAL, ...layoutOf(id) }, design: withTemplate(INITIAL, id).design } : data ? withTemplate(data, id) : null;
  if (shown && accent) shown.design = { ...shown.design, accent }; // a colour picked on the card
  const two = t.design.layout === 'two';
  return (
    <Dialog title={`${t.name} template preview`} onClose={onClose} wide>
      <div className="row between g8" style={{ alignItems: 'flex-start' }}>
        <div className="stack g4">
          <strong style={{ fontSize: 20 }}>{t.name}{sample && <span className="badge b-neutral" style={{ marginLeft: 8, verticalAlign: 'middle' }}>Sample</span>}</strong>
          <span className="xs muted">{two ? '2 columns' : '1 column'} · {audienceOf(t)}{t.photo ? ' · Photo' : ''}</span>
        </div>
        <button type="button" className="btn btn-icon" aria-label="Close" onClick={onClose}>✕</button>
      </div>
      {onView && <ViewSwitch view={view} onChange={onView} />}
      {shown ? (
        <div className="tpv-page" data-testid="template-preview" data-view={view}>
          <ResumePreview decorative data={shown.data} design={shown.design} photo={t.photo ? (shown.data.photo || PHOTO_PLACEHOLDER) : shown.data.photo || null} />
        </div>
      ) : <NoDetails onStart={onStart} />}
      <div className="row g8 tpv-actions">
        <button type="button" className="btn btn-ink btn-lg" onClick={onUse}>Use this template</button>
        {onDownload && !sample && shown && <button type="button" className="btn btn-outline btn-lg" onClick={() => onDownload(shown)} disabled={busy}>{busy ? 'Preparing…' : 'Download PDF'}</button>}
        <button type="button" className="btn btn-outline btn-lg" onClick={onClose}>Close</button>
      </div>
    </Dialog>
  );
}
