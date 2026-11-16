import { useEffect, useRef, useState } from 'react';
import { Link, NavLink, useLocation, useNavigate } from 'react-router-dom';
import { BRAND } from '../lib/brand';
import { useAuth, signOut, homeFor, LIVE } from '../lib/auth';
import { track } from '../lib/track';

export function Logo({ suffix }) {
  return (
    <Link to="/" className="logo" aria-label={`${BRAND.name} home`}>
      <b>Nm<mark>7</mark></b>
      {suffix && <span className="mono faint">{suffix}</span>}
    </Link>
  );
}

/** The light/dark switch: hidden while the site is light only (round P). Kept so it can return in one place. */
export function ThemeToggle() {
  return null;
}

/** Signed in: name + menu (my home, sign out). Signed out: "Sign in". */
export function AccountMenu() {
  const { user } = useAuth();
  const nav = useNavigate();
  const [open, setOpen] = useState(false);
  const ref = useRef();
  const { pathname } = useLocation();
  useEffect(() => { setOpen(false); }, [pathname]);
  useEffect(() => {
    if (!open) return undefined;
    const close = (e) => { if (!ref.current?.contains(e.target)) setOpen(false); };
    const esc = (e) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', close); document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('mousedown', close); document.removeEventListener('keydown', esc); };
  }, [open]);
  if (!user) return <Link to={`/login?next=${encodeURIComponent(pathname)}`} className="btn">Sign in</Link>;
  const homeLabel = { customer: 'My dashboard', expert: 'Expert home', admin: 'Admin console' }[user.role];
  return (
    <span ref={ref} style={{ position: 'relative' }}>
      <button type="button" className="btn btn-outline" style={{ minHeight: 40, gap: 8 }} aria-expanded={open} aria-haspopup="menu" aria-label={`Account menu: ${user.name}`} onClick={() => setOpen(!open)}>
        <span aria-hidden="true" style={{ width: 24, height: 24, borderRadius: '50%', background: 'var(--ink)', color: 'var(--onink)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 700 }}>{user.name.trim()[0]?.toUpperCase()}</span>
        <span className="hide-sm">{user.name.split(' ')[0]}</span>
      </button>
      {open && (
        <div role="menu" className="card stack g4" style={{ position: 'absolute', right: 0, top: 48, width: 230, zIndex: 30, padding: 8, boxShadow: 'var(--shadow)' }}>
          <span className="xs muted" style={{ padding: '4px 8px' }}>{user.email}</span>
          <Link role="menuitem" to={homeFor(user)} className="admin-link">{homeLabel}</Link>
          {user.role === 'customer' && <Link role="menuitem" to="/me/settings" className="admin-link">Profile & settings</Link>}
          {user.role === 'expert' && <Link role="menuitem" to="/expert/profile" className="admin-link">Expert profile</Link>}
          <button role="menuitem" type="button" className="admin-link" style={{ border: 0, background: 'transparent', width: '100%', textAlign: 'left', cursor: 'pointer' }} onClick={async () => { const to = user.role === 'admin' ? '/admin/login' : '/'; await signOut(); nav(to); }}>Sign out</button>
        </div>
      )}
    </span>
  );
}

const FLOW = [
  ['scan', 'Scan', ['/scan']],
  ['pay', 'Checkout', ['/checkout']],
  ['track', 'Track', ['/orders']],
];

// Public header links. The home page passes them translated (labels), with the language code (lang).
const LABELS = { build: 'Build a resume', jobs: 'Jobs', templates: 'Templates', linkedin: 'LinkedIn', pricing: 'Pricing', orgs: 'For organizations', blog: 'Blog', scan: 'Free scan', buildFree: 'Build free', menu: 'Menu',
  companies: 'For companies', colleges: 'For colleges', students: 'For students', studentHome: 'Student home' };

/**
 * "For students" in the main menu (round P): a small dropdown with the student tools that used to sit in the menu
 * (Build a resume, Templates, LinkedIn) plus the free scan and the home page's student tab. Desktop: a panel under
 * the button; phone (inside the open Menu): the links open in place. Escape, a click outside or a new page closes it.
 */
function StudentsMenu({ L }) {
  const [open, setOpen] = useState(false);
  const ref = useRef();
  const { pathname, hash } = useLocation();
  useEffect(() => { setOpen(false); }, [pathname, hash]);
  useEffect(() => {
    if (!open) return undefined;
    const close = (e) => { if (!ref.current?.contains(e.target)) setOpen(false); };
    const esc = (e) => { if (e.key === 'Escape') { setOpen(false); ref.current?.querySelector('button')?.focus(); } };
    // on a finished click, not on mousedown: closing first would shrink the phone menu under the finger, and the tap
    // meant for the next link (Pricing, Blog) would land on empty space
    document.addEventListener('click', close); document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('click', close); document.removeEventListener('keydown', esc); };
  }, [open]);
  const here = ['/builder', '/templates', '/linkedin'].some((p) => pathname.startsWith(p));
  return (
    <div ref={ref} className="nav-drop" data-open={open}>
      <button type="button" className="nav-drop-btn" aria-expanded={open} aria-controls="students-menu" data-here={here} onClick={() => setOpen(!open)}>
        {L.students}<span aria-hidden="true" className="nav-drop-caret">▾</span>
      </button>
      <div id="students-menu" className="nav-sub" hidden={!open}>
        <Link to="/?for=student">{L.studentHome}</Link>
        <NavLink to="/builder">{L.build}</NavLink>
        <NavLink to="/templates">{L.templates}</NavLink>
        <NavLink to="/linkedin">{L.linkedin}</NavLink>
        <Link to="/pricing#scan">{L.scan}</Link>
      </div>
    </div>
  );
}

/** variant: public | flow | expert | admin | builder | me */
export default function Header({ variant = 'public', right, labels, lang }) {
  const L = { ...LABELS, ...labels };
  const { pathname } = useLocation();
  const { user } = useAuth();
  const flowIdx = FLOW.findIndex(([, , paths]) => paths.some((p) => pathname.startsWith(p)));
  const [menu, setMenu] = useState(false); // phones: the public links open from a Menu button
  const { hash } = useLocation();
  useEffect(() => { setMenu(false); }, [pathname, hash]);

  return (
    <header className="site-header" data-variant={variant} data-menu={menu} lang="en">
      <div className="bar">
        <Logo suffix={variant === 'expert' ? '/expert' : variant === 'admin' ? '/admin' : variant === 'builder' ? '/builder' : variant === 'me' ? '/me' : undefined} />

        {variant === 'public' && (
          <span className="row g8 hdr-quick" lang={lang}>
            <button type="button" className="btn btn-outline nav-toggle" aria-expanded={menu} aria-controls="main-nav" aria-label={L.menu} onClick={() => setMenu(!menu)}>
              <span aria-hidden="true">{menu ? '✕' : '☰'}</span><span className="nav-toggle-text">{L.menu}</span>
            </button>
          </span>
        )}
        {variant === 'public' && (
          <nav id="main-nav" className="nav nav-public" data-open={menu} aria-label="Main" lang={lang}>
            <NavLink to="/jobs">{L.jobs}</NavLink>
            <NavLink to="/for-companies">{L.companies}</NavLink>
            <NavLink to="/for-orgs" onClick={() => track('to_for_orgs')}>{L.colleges}</NavLink>
            <StudentsMenu L={L} />
            <NavLink to="/pricing">{L.pricing}</NavLink>
            <NavLink to="/blog">{L.blog}</NavLink>
          </nav>
        )}

        {variant === 'flow' && (
          <ol className="steps" aria-label="Progress">
            {FLOW.map(([id, label], i) => (
              <li key={id} aria-current={i === flowIdx ? 'step' : undefined} data-state={i < flowIdx ? 'done' : undefined}>
                <span className="mono">{i < flowIdx ? '✓' : i + 1}</span>{label}
              </li>
            ))}
          </ol>
        )}

        {variant === 'expert' && user?.role === 'expert' && user.expertStatus !== 'approved' && (
          <nav className="nav" aria-label="Expert">
            <NavLink to="/expert/profile">Profile</NavLink>
            {['test', 'testReview'].includes(user.expertStatus) && <NavLink to="/expert/test">Test task</NavLink>}
            <NavLink to="/expert/help">Help</NavLink>
          </nav>
        )}

        {variant === 'expert' && !(user?.role === 'expert' && user.expertStatus !== 'approved') && (
          <nav className="nav" aria-label="Expert">
            <NavLink to="/expert" end>Home</NavLink>
            <NavLink to="/expert/orders">Orders</NavLink>
            <NavLink to="/expert/snippets">Snippets</NavLink>
            <NavLink to="/expert/earnings">Earnings</NavLink>
            <NavLink to="/expert/performance">Performance</NavLink>
            <NavLink to="/expert/profile">Profile</NavLink>
            <NavLink to="/expert/help">Help</NavLink>
          </nav>
        )}

        {/* the sample console can hop to the sample expert view; on the live site an admin isn't an expert */}
        {variant === 'admin' && !LIVE && (
          <nav className="nav" aria-label="Admin">
            <NavLink to="/expert" end>Expert view</NavLink>
          </nav>
        )}

        <div className="row g8 hdr-right">
          {right}
          <ThemeToggle />
          <AccountMenu />
        </div>
      </div>
    </header>
  );
}
