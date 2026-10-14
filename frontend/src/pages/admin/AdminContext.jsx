// One shared store for the whole admin console (sample data in the preview). Every change is written to the audit log.
import { createContext, useContext, useMemo, useState } from 'react';
import { ORDERS, EXPERTS_FULL, CUSTOMERS, PAYMENTS, PAYOUTS, REFUNDS, AUDITS, DEFAULT_SETTINGS, DEFAULT_RULES, TEAM, AUDIT_SEED, NOW_MS } from '../../data/adminData';

const Ctx = createContext(null);
export const useAdmin = () => useContext(Ctx);

export { ROLES } from './roles';

export const hoursLeft = (o) => (o.deadline && !o.deliveredAt && !['Refunded', 'Cancelled'].includes(o.stage) ? (o.deadline - NOW_MS) / 3600000 : null);
export const atRisk = (o) => { const h = hoursLeft(o); return h !== null && h < 6; };
export const isLate = (o) => { const h = hoursLeft(o); return h !== null && h < 0; };

/** Best expert for an order: covers the domain, active, has room; then rating, on-time and free capacity. */
export function bestExpert(o, experts, loads) {
  const ok = experts.filter((x) => x.status === 'active' && x.domains.includes(o.domain) && (loads[x.id] || 0) < x.cap);
  const pool = ok.length ? ok : experts.filter((x) => x.status === 'active' && (loads[x.id] || 0) < x.cap);
  const tierBonus = { 'Top expert': 2, Trusted: 1, New: 0 };
  return pool.sort((a, b) => (b.rating * 10 + b.onTime / 10 + (o.planId === 'launch' ? tierBonus[b.tier] * 5 : 0) + (b.cap - (loads[b.id] || 0)))
    - (a.rating * 10 + a.onTime / 10 + (o.planId === 'launch' ? tierBonus[a.tier] * 5 : 0) + (a.cap - (loads[a.id] || 0))))[0] || null;
}

export function AdminProvider({ children }) {
  const [orders, setOrders] = useState(ORDERS);
  const [experts, setExperts] = useState(EXPERTS_FULL);
  const [customers, setCustomers] = useState(CUSTOMERS);
  const [payments] = useState(PAYMENTS);
  const [payouts, setPayouts] = useState(PAYOUTS);
  const [refunds, setRefunds] = useState(REFUNDS);
  const [audits, setAudits] = useState(AUDITS);
  const [settings, setSettings] = useState(DEFAULT_SETTINGS);
  const [rules, setRules] = useState(DEFAULT_RULES);
  const [team, setTeam] = useState(TEAM);
  const [log, setLog] = useState(AUDIT_SEED);
  const [notes, setNotes] = useState({}); // orderId → [{ at, who, text }]
  const [role, setRole] = useState('owner');
  const [range, setRange] = useState(30);
  const me = team.find((t) => t.role === role)?.name || 'Admin';

  const record = (area, what, from = '—', to = '—') => setLog((l) => [{ at: Date.now(), who: me, area, what, from: String(from), to: String(to) }, ...l]);

  const loads = useMemo(() => {
    const m = {};
    orders.forEach((o) => { if (o.expert && !['Delivered', 'Approved', 'Refunded', 'Cancelled', 'Self-serve'].includes(o.stage)) m[o.expert] = (m[o.expert] || 0) + 1; });
    return m;
  }, [orders]);
  const exName = (id) => experts.find((x) => x.id === id)?.name || 'Unassigned';

  const actions = {
    assign(orderId, expertId) {
      const o = orders.find((x) => x.id === orderId);
      setOrders((os) => os.map((x) => (x.id === orderId ? { ...x, expert: expertId, stage: x.stage === 'Placed' ? 'Expert assigned' : x.stage } : x)));
      record('Orders', `${o.expert ? 'Reassigned' : 'Assigned'} ${orderId}`, exName(o.expert), exName(expertId));
    },
    autoAssign(ids) {
      const l = { ...loads };
      let n = 0;
      const next = orders.map((o) => {
        if (!ids.includes(o.id) || o.expert) return o;
        const x = bestExpert(o, experts, l);
        if (!x) return o;
        l[x.id] = (l[x.id] || 0) + 1; n += 1;
        return { ...o, expert: x.id, stage: o.stage === 'Placed' ? 'Expert assigned' : o.stage };
      });
      setOrders(next);
      record('Orders', `Auto-assigned ${n} order${n === 1 ? '' : 's'}`);
      return n;
    },
    extend(orderId, hours, reason) {
      const o = orders.find((x) => x.id === orderId);
      setOrders((os) => os.map((x) => (x.id === orderId ? { ...x, deadline: x.deadline + hours * 3600000 } : x)));
      record('Orders', `Extended ${orderId} by ${hours}h — ${reason}`, new Date(o.deadline).toLocaleString('en-IN'), new Date(o.deadline + hours * 3600000).toLocaleString('en-IN'));
    },
    setStage(orderId, stage, why = '') {
      const o = orders.find((x) => x.id === orderId);
      setOrders((os) => os.map((x) => (x.id === orderId ? { ...x, stage } : x)));
      record('Orders', `${orderId}: ${stage}${why ? ` — ${why}` : ''}`, o.stage, stage);
    },
    addNote(orderId, text) { setNotes((n) => ({ ...n, [orderId]: [...(n[orderId] || []), { at: Date.now(), who: me, text }] })); record('Orders', `Note on ${orderId}`); },
    openRefund(orderId, reason) {
      const o = orders.find((x) => x.id === orderId);
      const id = `RF-${42 + refunds.length}`;
      setRefunds((r) => [{ id, orderId, type: 'other', status: 'review', amount: o.price, reason, expertSide: '—', at: Date.now(), rp: null }, ...r]);
      record('Refunds', `Opened ${id} for ${orderId}`);
      return id;
    },
    decideRefund(id, decision, amount, note) {
      const r = refunds.find((x) => x.id === id);
      const status = { approve: 'refunded', partial: 'refunded', reject: 'rejected', redo: 'redo-offered' }[decision];
      setRefunds((rs) => rs.map((x) => (x.id === id ? { ...x, status, amount: decision === 'partial' ? amount : x.amount, note, rp: decision === 'approve' || decision === 'partial' ? 'processing' : x.rp } : x)));
      if (decision === 'approve' || decision === 'partial') setOrders((os) => os.map((o) => (o.id === r.orderId ? { ...o, stage: 'Refunded' } : o)));
      record('Refunds', `${id}: ${decision}${decision === 'partial' ? ` ₹${amount}` : ''}${note ? ` — ${note}` : ''}`, r.status, status);
    },
    expert(id, patch, what) {
      const x = experts.find((e) => e.id === id);
      setExperts((xs) => xs.map((e) => (e.id === id ? { ...e, ...patch } : e)));
      record('Experts', `${x.name}: ${what}`, Object.keys(patch).map((k) => x[k]).join(', '), Object.values(patch).join(', '));
    },
    payout(ids, status, utr) {
      setPayouts((ps) => ps.map((p) => (ids.includes(p.id) ? { ...p, status, ...(status === 'paid' ? { paidAt: Date.now(), utr: utr || p.utr } : {}) } : p)));
      record('Payouts', `${status === 'paid' ? 'Marked paid' : 'Approved'}: ${ids.join(', ')}`, status === 'paid' ? 'approved' : 'pending', status);
    },
    customer(id, patch, what) {
      setCustomers((cs) => cs.map((c) => (c.id === id ? { ...c, ...patch } : c)));
      record('Customers', `${customers.find((c) => c.id === id)?.name}: ${what}`);
    },
    deleteCustomerData(id) {
      const c = customers.find((x) => x.id === id);
      setCustomers((cs) => cs.map((x) => (x.id === id ? { ...x, name: '[Deleted user]', email: '—', deleted: true, builder: false, scans: 0 } : x)));
      record('Customers', `Deleted personal data for ${c.name} (${id})`, 'stored', 'deleted');
    },
    audit(orderId, scores) { setAudits((a) => a.map((x) => (x.orderId === orderId ? { ...x, scores } : x))); record('Quality', `Scored ${orderId}: ${scores.filter(Boolean).length}/${scores.length}`); },
    addAudit(orderId, expert) { setAudits((a) => (a.some((x) => x.orderId === orderId) ? a : [{ orderId, expert, scores: null }, ...a])); },
    settings(patch, what, from, to) { setSettings((s) => ({ ...s, ...patch })); record('Settings', what, from, to); },
    rules(next, what) { setRules(next); record('Automation', what); },
    team(next, what, from, to) { setTeam(next); record('Team', what, from, to); },
  };

  const value = { orders, experts, customers, payments, payouts, refunds, audits, settings, rules, team, log, notes, role, setRole, range, setRange, loads, exName, actions, me };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
