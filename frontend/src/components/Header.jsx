import { useEffect, useRef, useState } from 'react';
import { Link, NavLink, useLocation, useNavigate } from 'react-router-dom';
import { useTheme } from '../lib/theme';
import { BRAND } from '../lib/brand';
import { useAuth, signOut, homeFor, LIVE } from '../lib/auth';
import { Icon } from './ui';
import { track } from '../lib/track';

export function Logo({ suffix }) {
  return (
    <Link to="/" className="logo" aria-label={`${BRAND.name} home`}>
      <b>Nm<mark>7</mark></b>
      {suffix && <span className="mono faint">{suffix}</span>}
    </Link>
  );
}

export function ThemeToggle() {
  const { theme, toggle } = useTheme();
  return (
    <button type="button" className="btn btn-icon" onClick={toggle} aria-label={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}>
      <Icon name={theme === 'dark' ? 'sun' : 'moon'} />
    </button>
  );
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
      <button type="button" className="btn btn-outline" style={{ minHeight: 40, gap: 8 }} aria-expanded={open} aria-haspopup="menu" onClick={() => setOpen(!open)}>
        <span aria-hidden="true" style={{ width: 24, height: 24, borderRadius: '50%', background: 'var(--ink)', color: 'var(--onink)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 700 }}>{user.name.trim()[0]?.toUpperCase()}</span>
        <span className="hide-sm">{user.name.split(' ')[0]}</span>
      </button>
      {open && (
        <div role="menu" className="card stack g4" style={{ position: 'absolute', right: 0, top: 48, width: 230, zIndex: 30, padding: 8, boxShadow: 'var(--shadow)' }}>
          <span className="xs muted" style={{ padding: '4px 8px' }}>{user.email}</span>
          <Link role="menuitem" to={homeFor(user)} className="admin-link">{homeLabel}</Link>
          {user.role === 'customer' && <Link role="menuitem" to="/me/settings" className="admin-link">Profile & settings</Link>}
          {user.role === 'expert' && <Link role="menuitem" to="/expert/profile" className="admin-link">Expert profile</Link>}
          <button role="menuitem" type="button" className="admin-link" style={{ border: 0, background: 'transparent', width: '100%', textAlign: 'left', cursor: 'pointer' }} onClick={() => { signOut(); nav(user.role === 'admin' ? '/admin/login' : '/'); }}>Sign out</button>
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
const LABELS = { build: 'Build a resume', templates: 'Templates', pricing: 'Pricing', orgs: 'For organizations', blog: 'Blog', scan: 'Free scan', buildFree: 'Build free', menu: 'Menu' };

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
    <header className="site-header" data-variant={variant} data-menu={menu}>
      <div className="bar">
        <Logo suffix={variant === 'expert' ? '/expert' : variant === 'admin' ? '/admin' : variant === 'builder' ? '/builder' : variant === 'me' ? '/me' : '/resume'} />

        {variant === 'public' && (
          <span className="row g8 hdr-quick" lang={lang}>
            <Link to="/builder" className="btn btn-ink show-sm hdr-build">{L.buildFree}</Link>
            <button type="button" className="btn btn-outline nav-toggle" aria-expanded={menu} aria-controls="main-nav" aria-label={L.menu} onClick={() => setMenu(!menu)}>
              <span aria-hidden="true">{menu ? '✕' : '☰'}</span><span className="nav-toggle-text">{L.menu}</span>
            </button>
          </span>
        )}
        {variant === 'public' && (
          <nav id="main-nav" className="nav nav-public" data-open={menu} aria-label="Main" lang={lang}>
            <NavLink to="/builder">{L.build}</NavLink>
            <Link to="/#templates">{L.templates}</Link>
            <Link to="/#pricing">{L.pricing}</Link>
            <NavLink to="/for-orgs" onClick={() => track('to_for_orgs')}>{L.orgs}</NavLink>
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
          {variant === 'public' && <Link to="/#scan" className="btn btn-outline hide-sm hdr-scan" lang={lang}>{L.scan}</Link>}
          {right}
          <ThemeToggle />
          <AccountMenu />
        </div>
      </div>
    </header>
  );
}
