// Admin console frame: sidebar, global search (Ctrl/⌘ + K), date range, alerts bell, role preview.
import { useEffect, useMemo, useRef, useState } from 'react';
import ErrorBoundary from '../../components/ErrorBoundary';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import Header from '../../components/Header';
import { Dialog } from '../../components/ui';
import { AdminProvider, ROLES, atRisk, isLate, useAdmin } from './AdminContext';

export const NAV = [
  ['dashboard', '/admin', 'Dashboard', '▦'],
  ['orders', '/admin/orders', 'Orders', '☰'],
  ['experts', '/admin/experts', 'Experts', '✦'],
  ['refunds', '/admin/refunds', 'Refunds & disputes', '↺'],
  ['payments', '/admin/payments', 'Payments & payouts', '₹'],
  ['customers', '/admin/customers', 'Customers', '☺'],
  ['quality', '/admin/quality', 'Quality', '✓'],
  ['reports', '/admin/reports', 'Reports', '⇩'],
  ['settings', '/admin/settings', 'Settings', '⚙'],
  ['automation', '/admin/automation', 'Automation', '⚡'],
  ['team', '/admin/team', 'Team & audit log', '⚿'],
];

function useAlerts() {
  const { orders, refunds, payouts } = useAdmin();
  return useMemo(() => {
    const late = orders.filter(isLate);
    const risk = orders.filter((o) => atRisk(o) && !isLate(o));
    const un = orders.filter((o) => !o.expert && o.stage === 'Placed');
    const rf = refunds.filter((r) => r.status === 'review');
    const po = payouts.filter((p) => p.status !== 'paid');
    return [
      late.length && { tone: 'var(--danger)', text: `${late.length} order${late.length > 1 ? 's' : ''} past the deadline`, to: '/admin/orders?view=late' },
      risk.length && { tone: 'var(--warning)', text: `${risk.length} order${risk.length > 1 ? 's' : ''} due within 6 hours`, to: '/admin/orders?view=risk' },
      un.length && { tone: 'var(--warning)', text: `${un.length} unassigned order${un.length > 1 ? 's' : ''}`, to: '/admin/orders?view=unassigned' },
      rf.length && { tone: 'var(--text)', text: `${rf.length} refund${rf.length > 1 ? 's' : ''} to review (24h rule)`, to: '/admin/refunds' },
      po.length && { tone: 'var(--text)', text: `${po.length} payout${po.length > 1 ? 's' : ''} to approve or send`, to: '/admin/payments?tab=payouts' },
    ].filter(Boolean);
  }, [orders, refunds, payouts]);
}

function Search({ onClose }) {
  const { orders, customers, experts } = useAdmin();
  const nav = useNavigate();
  const [q, setQ] = useState('');
  const [i, setI] = useState(0);
  const ref = useRef();
  useEffect(() => { ref.current?.focus(); }, []);
  const t = q.trim().toLowerCase();
  const results = !t ? NAV.map(([, to, l]) => ({ kind: 'Page', label: l, to })) : [
    ...NAV.filter(([, , l]) => l.toLowerCase().includes(t)).map(([, to, l]) => ({ kind: 'Page', label: l, to })),
    ...orders.filter((o) => `${o.id} ${o.customer} ${o.role}`.toLowerCase().includes(t)).slice(0, 6).map((o) => ({ kind: 'Order', label: `${o.id} · ${o.customer} · ${o.role}`, to: `/admin/orders?id=${o.id}` })),
    ...customers.filter((c) => `${c.name} ${c.email} ${c.id}`.toLowerCase().includes(t)).slice(0, 4).map((c) => ({ kind: 'Customer', label: `${c.name} · ${c.email}`, to: `/admin/customers?id=${c.id}` })),
    ...experts.filter((x) => `${x.name} ${x.domains.join(' ')}`.toLowerCase().includes(t)).slice(0, 4).map((x) => ({ kind: 'Expert', label: `${x.name} · ${x.domains.join(', ')}`, to: `/admin/experts?id=${x.id}` })),
  ];
  const go = (r) => { if (r) { nav(r.to); onClose(); } };
  return (
    <Dialog title="Search" onClose={onClose} overlayStyle={{ alignItems: 'flex-start', paddingTop: '12vh' }} panelStyle={{ maxWidth: 620, gap: 8 }}>
        <input ref={ref} className="input" value={q} placeholder="Search orders, customers, experts, pages…" aria-label="Search"
          onChange={(e) => { setQ(e.target.value); setI(0); }}
          onKeyDown={(e) => { if (e.key === 'ArrowDown') { e.preventDefault(); setI((n) => Math.min(results.length - 1, n + 1)); } if (e.key === 'ArrowUp') { e.preventDefault(); setI((n) => Math.max(0, n - 1)); } if (e.key === 'Enter') go(results[i]); }} />
        <div role="listbox" aria-label="Results" className="stack" style={{ maxHeight: 360, overflow: 'auto' }}>
          {results.length === 0 && <span className="small muted" style={{ padding: 12 }}>Nothing found.</span>}
          {results.map((r, n) => (
            <button key={r.kind + r.label} type="button" role="option" aria-selected={n === i} onMouseEnter={() => setI(n)} onClick={() => go(r)}
              className="row g8" style={{ border: 0, textAlign: 'left', padding: '10px 12px', borderRadius: 8, background: n === i ? 'var(--sunken)' : 'transparent' }}>
              <span className="badge b-neutral" style={{ width: 72, justifyContent: 'center' }}>{r.kind}</span><span className="small">{r.label}</span>
            </button>
          ))}
        </div>
        <span className="xs faint">↑ ↓ to move · Enter to open · Esc to close</span>
    </Dialog>
  );
}

function Shell() {
  const { role, setRole, range, setRange } = useAdmin();
  const alerts = useAlerts();
  const [search, setSearch] = useState(false);
  const [bell, setBell] = useState(false);
  const { pathname, search: query } = useLocation();
  const nav = useNavigate();
  const can = ROLES[role].can;
  const current = NAV.find(([, to]) => (to === '/admin' ? pathname === '/admin' || pathname === '/admin/' : pathname.startsWith(to)));
  const allowed = !current || can.includes(current[0]);

  useEffect(() => {
    const k = (e) => { if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); setSearch(true); } };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, []);
  useEffect(() => { setBell(false); }, [pathname]);

  return (
    <>
      <Header variant="admin" right={
        <span className="row g8" style={{ flexWrap: 'nowrap' }}>
          <button type="button" className="btn btn-outline" style={{ minHeight: 40, gap: 8 }} onClick={() => setSearch(true)}>⌕ <span className="hide-sm">Search</span> <kbd className="mono xs faint hide-sm">Ctrl K</kbd></button>
          <label htmlFor="adm-range" className="sr-only">Date range</label>
          <select id="adm-range" className="input" style={{ height: 40, width: 'auto', fontSize: 13 }} value={range} onChange={(e) => setRange(+e.target.value)}>
            <option value={1}>Today</option><option value={7}>Last 7 days</option><option value={30}>Last 30 days</option>
          </select>
          <span style={{ position: 'relative' }}>
            <button type="button" className="btn btn-icon" aria-label={`Alerts: ${alerts.length}`} aria-expanded={bell} onClick={() => setBell(!bell)}>🔔{alerts.length > 0 && <span className="badge b-danger" style={{ position: 'absolute', top: -4, right: -6, padding: '1px 6px', fontSize: 10 }}>{alerts.length}</span>}</button>
            {bell && (
              <div className="card stack g4" style={{ position: 'absolute', right: 0, top: 48, width: 320, zIndex: 30, padding: 8, boxShadow: 'var(--shadow)' }}>
                <strong className="small" style={{ padding: '4px 8px' }}>Needs you now</strong>
                {alerts.length === 0 && <span className="small muted" style={{ padding: 8 }}>All clear.</span>}
                {alerts.map((a) => <button key={a.text} type="button" onClick={() => nav(a.to)} className="row g8 small" style={{ border: 0, background: 'transparent', textAlign: 'left', padding: '8px', borderRadius: 8 }}><span aria-hidden="true" style={{ width: 8, height: 8, borderRadius: '50%', background: a.tone, flex: 'none' }} />{a.text}</button>)}
              </div>
            )}
          </span>
        </span>
      } />
      <div className="container-wide row g24" style={{ padding: '20px 24px 64px', alignItems: 'flex-start' }}>
        <nav aria-label="Admin sections" className="stack sticky admin-side" style={{ flex: '0 0 220px', top: 88, gap: 2 }}>
          {NAV.filter(([k]) => can.includes(k)).map(([k, to, l, ic]) => (
            <NavLink key={k} to={to} end={to === '/admin'} className="admin-link"><span aria-hidden="true" style={{ width: 18, textAlign: 'center' }}>{ic}</span>{l}</NavLink>
          ))}
          <hr className="divider" />
          <label htmlFor="adm-role" className="xs muted" style={{ padding: '0 10px' }}>Preview as role</label>
          <select id="adm-role" className="input" style={{ height: 40, fontSize: 13 }} value={role} onChange={(e) => setRole(e.target.value)}>
            {Object.entries(ROLES).map(([k, r]) => <option key={k} value={k}>{r.label}</option>)}
          </select>
          <span className="xs faint" style={{ padding: '0 10px' }}>Each team member only sees their sections.</span>
        </nav>
        <main className="stack g20" style={{ flex: '1 1 600px', minWidth: 0 }}>
          {allowed ? <ErrorBoundary resetKey={`${pathname}${query}`}><Outlet /></ErrorBoundary> : <div className="card stack g8"><strong>No access</strong><span className="small muted">The {ROLES[role].label} role can’t open {current[2]}. Switch role or ask the owner.</span></div>}
        </main>
      </div>
      {search && <Search onClose={() => setSearch(false)} />}
    </>
  );
}

export default function AdminLayout() {
  return <AdminProvider><Shell /></AdminProvider>;
}
