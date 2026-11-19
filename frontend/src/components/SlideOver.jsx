// Round W: a panel that slides over the page from the right (about 520 px; the whole screen on a phone) instead of
// squeezing the list beside it. It is a modal dialog (components/ui Dialog): focus moves into it and stays there, Esc or
// a click on the dimmed page closes it, and focus goes back to the button that opened it. Styles: styles/app-shell.css.
import { Dialog } from './ui';
import { IcX } from './icons';
import '../styles/app-shell.css';

export default function SlideOver({ title, onClose, children, width = 520, closeLabel = 'Close panel', testid }) {
  return (
    <Dialog
      title={title}
      onClose={onClose}
      overlayStyle={{ justifyContent: 'flex-end', alignItems: 'stretch', padding: 0 }}
      panelStyle={{ '--so-w': `${width}px` }}
    >
      <div className="so-panel-in" data-testid={testid}>
        <div className="so-head">
          <strong className="so-title">{title}</strong>
          <button type="button" className="btn btn-icon so-close" aria-label={closeLabel} onClick={onClose}><IcX /></button>
        </div>
        <div className="so-body stack g16">{children}</div>
      </div>
    </Dialog>
  );
}
