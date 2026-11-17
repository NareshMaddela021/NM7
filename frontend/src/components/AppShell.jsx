// Round W: the frame for signed-in work areas (Admin first; company, college and expert dashboards next). Content
// fills the screen (24 px side padding, 16 px on a phone). On a desktop the side menu runs the full height, stays put and
// scrolls on its own, and folds to icons with a button (remembered in this browser). On a phone the menu is a sideways
// strip (phone="strip") or a drawer behind a Menu button (phone="drawer": Esc or a tap outside closes it).
// Each menu link: <a ...><span aria-hidden="true">{icon}</span><span className="app-side-text">{label}</span></a> —
// the words stay readable to screen readers when folded. Styles: styles/app-shell.css.
import { useEffect, useRef, useState } from 'react';
import '../styles/app-shell.css';

function readFolded(key) {
  try { return localStorage.getItem(key) === '1'; } catch { return false; }
}
function saveFolded(key, v) {
  try { localStorage.setItem(key, v ? '1' : '0'); } catch { /* private window: not remembered */ }
}

/** The header's height, so the side menu starts right under it. */
function useHeaderHeight(ref) {
  useEffect(() => {
    const shell = ref.current;
    const header = shell?.previousElementSibling?.matches?.('.site-header') ? shell.previousElementSibling : document.querySelector('.site-header');
    if (!shell || !header) return undefined;
    const set = () => shell.style.setProperty('--app-top', `${Math.round(header.getBoundingClientRect().height)}px`);
    set();
    if (typeof ResizeObserver === 'undefined') return undefined;
    const ro = new ResizeObserver(set);
    ro.observe(header);
    return () => ro.disconnect();
  }, [ref]);
}

export default function AppShell({ label, nav, foot, storageKey, phone = 'drawer', routeKey, className = '', sideClassName = '', mainClassName = '', mainId = 'main', children }) {
  const ref = useRef(null);
  const sideRef = useRef(null);
  const menuBtn = useRef(null);
  const [folded, setFolded] = useState(() => (storageKey ? readFolded(storageKey) : false));
  const [open, setOpen] = useState(false);
  useHeaderHeight(ref);
  useEffect(() => { setOpen(false); }, [routeKey]); // a link was followed: close the drawer
  useEffect(() => {
    if (!open) return undefined;
    sideRef.current?.querySelector('a, button')?.focus();
    const onKey = (e) => { if (e.key === 'Escape') { setOpen(false); menuBtn.current?.focus(); } };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open]);
  const fold = () => { const v = !folded; setFolded(v); if (storageKey) saveFolded(storageKey, v); };
  const sideId = `${mainId}-side`;
  return (
    <div ref={ref} className={`app-shell ${className}`} data-collapsed={folded || undefined} data-phone={phone} data-open={open || undefined}>
      {phone === 'drawer' && (
        <div className="app-phonebar">
          <button ref={menuBtn} type="button" className="btn btn-outline" aria-expanded={open} aria-controls={sideId} onClick={() => setOpen(!open)}>☰ Menu</button>
        </div>
      )}
      <nav ref={sideRef} id={sideId} aria-label={label} className={`app-side ${sideClassName}`}>
        <button type="button" className="app-collapse" onClick={fold} title={folded ? 'Show the menu words' : 'Fold the menu to icons'}>
          <span aria-hidden="true">{folded ? '»' : '«'}</span><span className="app-side-text">{folded ? 'Show menu' : 'Fold menu'}</span>
        </button>
        {nav}
        {foot && <div className="app-side-foot">{foot}</div>}
      </nav>
      {phone === 'drawer' && open && <button type="button" className="app-scrim" aria-label="Close the menu" tabIndex={-1} onClick={() => setOpen(false)} />}
      <main id={mainId} className={`app-main ${mainClassName}`}>{children}</main>
    </div>
  );
}
