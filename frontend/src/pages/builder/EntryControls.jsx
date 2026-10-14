// Header of one entry card (Education 2, Project 1, a hobby…): move up / down, on/off switch, remove (asks first).
// Off = kept in the builder but left out of the resume everywhere (preview, PDF, Word, share link, ATS).
import { useState } from 'react';
import { Dialog, Icon } from '../../components/ui';

/** Ids used to put focus back after a move: entry-<list>-<index>-up|down|title. */
export const entryId = (list, i, part) => `entry-${list}-${i}-${part}`;
/** After moving an entry, keep focus on the moved card: the same arrow if it is still usable, else its title. */
export function focusMoved(list, to, dir) {
  setTimeout(() => {
    const btn = document.getElementById(entryId(list, to, dir < 0 ? 'up' : 'down'));
    if (btn && !btn.disabled) btn.focus();
    else document.getElementById(entryId(list, to, 'title'))?.focus();
  }, 0);
}

export function EntryHeader({ list, index, count, label, off, onMove, onToggle, onRemove, title }) {
  const [ask, setAsk] = useState(false);
  return (
    <div className="entry-head">
      <span className="entry-title">
        <strong id={entryId(list, index, 'title')} tabIndex={-1}>{title || label}</strong>
        {off && <span className="badge b-neutral entry-hidden">Hidden from resume</span>}
      </span>
      <span className="entry-tools" role="group" aria-label={`${label} controls`}>
        <button type="button" id={entryId(list, index, 'up')} className="btn btn-icon entry-btn" aria-label={`Move ${label} up`} disabled={index === 0} onClick={() => onMove(-1)}><Icon name="up" size={16} /></button>
        <button type="button" id={entryId(list, index, 'down')} className="btn btn-icon entry-btn" aria-label={`Move ${label} down`} disabled={index === count - 1} onClick={() => onMove(1)}><Icon name="down" size={16} /></button>
        <label className="entry-switch">
          <input type="checkbox" role="switch" checked={!off} aria-label={off ? `Show ${label} on resume` : `Hide ${label} from resume`} onChange={onToggle} />
          <span aria-hidden="true" className="entry-switch-text">{off ? 'Off' : 'On'}</span>
        </label>
        {onRemove && (
          <button type="button" className="btn btn-danger-soft entry-btn entry-remove" aria-label={`Remove ${label}`} onClick={() => setAsk(true)}>
            <Icon name="trash" size={16} /><span className="entry-remove-text">Remove</span>
          </button>
        )}
      </span>
      {ask && (
        <Dialog title={`Remove ${label}?`} onClose={() => setAsk(false)}>
          <strong style={{ fontSize: 18 }}>Remove {label}?</strong>
          <span className="small muted">Everything typed in it is deleted. To keep it but leave it off your resume, switch it off instead.</span>
          <div className="row g8">
            <button type="button" className="btn btn-outline" onClick={() => setAsk(false)}>Cancel</button>
            <button type="button" className="btn btn-ink" style={{ background: 'var(--danger)', borderColor: 'var(--danger)' }} onClick={() => { setAsk(false); onRemove(); }}>Remove</button>
          </div>
        </Dialog>
      )}
    </div>
  );
}
