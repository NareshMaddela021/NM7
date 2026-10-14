// Admin home: money, orders, on-time %, funnel, charts, expert health and "needs you now".
import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { useAdmin, atRisk, isLate } from './AdminContext';
import { PageHead, Kpi, BarChart, HBars, Funnel, inr, fmtDate } from './AdminUI';
import { FUNNEL_DAILY, NOW_MS, DOMAINS } from '../../data/adminData';

const DAY = 86400000;

export default function Dashboard() {
  const { orders, refunds, payouts, experts, loads, range, settings, exName } = useAdmin();
  const fees = settings.fees;
  const from = NOW_MS - range * DAY;
  const inRange = orders.filter((o) => o.createdAt >= from);

  const m = useMemo(() => {
    const paid = inRange.filter((o) => o.stage !== 'Refunded');
    const sales = inRange.reduce((s, o) => s + o.price, 0);
    const refunded = refunds.filter((r) => r.at >= from && r.status === 'refunded').reduce((s, r) => s + r.amount, 0);
    const expertSales = paid.filter((o) => o.planId !== 'diy').reduce((s, o) => s + o.price, 0);
    const diySales = paid.filter((o) => o.planId === 'diy').reduce((s, o) => s + o.price, 0);
    const platform = diySales + expertSales * fees.platformPct / 100; // DIY is 100% platform revenue
    const gst = expertSales * fees.platformPct / 100 * fees.gstPct / 100;
    const tx = sales * fees.txPct / 100;
    const delivered = inRange.filter((o) => o.deliveredAt);
    const onTime = delivered.length ? Math.round((delivered.filter((o) => o.deliveredAt <= o.deadline).length / delivered.length) * 100) : 100;
    const live = orders.filter((o) => o.deadline && !o.deliveredAt && !['Refunded', 'Cancelled'].includes(o.stage));
    const rated = inRange.filter((o) => o.rating);
    return { sales, refunded, platform, gst, tx, onTime, live, rated: rated.length ? (rated.reduce((s, o) => s + o.rating, 0) / rated.length).toFixed(1) : '—', count: inRange.length, delivered: delivered.length };
  }, [inRange, refunds, from, fees, orders]);

  const days = Math.max(range, 7);
  const daily = Array.from({ length: days }, (_, i) => {
    const start = NOW_MS - (days - 1 - i) * DAY - (NOW_MS % DAY);
    const os = orders.filter((o) => o.createdAt >= start && o.createdAt < start + DAY);
    return { label: fmtDate(start + DAY / 2), orders: os.length, diy: os.filter((o) => o.planId === 'diy').reduce((s, o) => s + o.price, 0), expert: os.filter((o) => o.planId === 'expert').reduce((s, o) => s + o.price, 0), launch: os.filter((o) => o.planId === 'launch').reduce((s, o) => s + o.price, 0) };
  });
  const fd = FUNNEL_DAILY.slice(-range);
  const scans = fd.reduce((s, d) => s + d.scans, 0);
  const checkouts = Math.max(fd.reduce((s, d) => s + d.checkouts, 0), m.count);
  const byDomain = DOMAINS.map((dm) => ({ label: dm, value: inRange.filter((o) => o.domain === dm).length })).sort((a, b) => b.value - a.value);
  const unassigned = orders.filter((o) => !o.expert && o.stage === 'Placed');
  const risky = m.live.filter(atRisk).sort((a, b) => a.deadline - b.deadline);

  return (
    <>
      <PageHead title="Dashboard" sub={`${range === 1 ? 'Today' : `Last ${range} days`} · sample data in this preview`} />
      <div className="kpis">
        <Kpi label="Total sales" value={inr(m.sales)} sub={`${m.count} orders`} />
        <Kpi label="Your platform earnings" value={inr(m.platform)} sub={`DIY 100% + ${fees.platformPct}% of expert orders`} />
        <Kpi label="GST collected on fee" value={inr(m.gst)} sub={`${fees.gstPct}% · pay to govt`} />
        <Kpi label="Transaction charges" value={inr(m.tx)} sub={`~${fees.txPct}% Razorpay`} />
        <Kpi label="Refunds" value={inr(m.refunded)} sub={`${refunds.filter((r) => r.status === 'review').length} to review`} tone={m.refunded ? 'var(--danger)' : undefined} />
        <Kpi label="On-time delivery" value={`${m.onTime}%`} sub={`${m.delivered} delivered · promise ${settings.rules.minDeliveryHours}–${settings.rules.deliveryHours}h`} tone={m.onTime >= 90 ? 'var(--success)' : 'var(--warning)'} />
        <Kpi label="In progress" value={m.live.length} sub={`${m.live.filter(isLate).length} late · ${unassigned.length} unassigned`} />
        <Kpi label="Average rating" value={`★ ${m.rated}`} sub="From approved orders" />
      </div>

      <div className="row g16" style={{ alignItems: 'stretch' }}>
        <div className="card" style={{ flex: '2 1 460px', padding: 20 }}>
          <BarChart title="Sales per day by plan" data={daily} fmt={(v) => (v >= 1000 ? `₹${Math.round(v / 100) / 10}k` : `₹${Math.round(v)}`)}
            series={[{ key: 'diy', label: 'DIY ₹99', color: 'var(--viz-1)' }, { key: 'expert', label: 'Expert ₹999', color: 'var(--viz-2)' }, { key: 'launch', label: 'Launch ₹2,999', color: 'var(--viz-3)' }]} />
        </div>
        <div className="card" style={{ flex: '1 1 280px', padding: 20 }}><Funnel steps={[{ label: 'Free scans', value: scans }, { label: 'Checkouts started', value: checkouts }, { label: 'Paid orders', value: m.count }]} /></div>
      </div>

      <div className="row g16" style={{ alignItems: 'stretch' }}>
        <div className="card" style={{ flex: '2 1 460px', padding: 20 }}><BarChart title="Orders per day" data={daily} series={[{ key: 'orders', label: 'Orders', color: 'var(--viz-1)' }]} height={150} /></div>
        <div className="card" style={{ flex: '1 1 280px', padding: 20 }}><HBars title="Orders by domain" rows={byDomain} /></div>
      </div>

      <div className="row g16" style={{ alignItems: 'flex-start' }}>
        <section className="card stack g8" style={{ flex: '1 1 380px', padding: 20 }}>
          <strong>Needs you now</strong>
          {risky.slice(0, 5).map((o) => <Link key={o.id} to={`/admin/orders?id=${o.id}`} className="row between g8 small well" style={{ textDecoration: 'none', color: 'inherit' }}><span>{o.id} · {o.role} · {exName(o.expert)}</span><span className="strong" style={{ color: isLate(o) ? 'var(--danger)' : 'var(--warning)' }}>{isLate(o) ? 'Late' : 'Due < 6h'}</span></Link>)}
          {unassigned.length > 0 && <Link to="/admin/orders?view=unassigned" className="small well" style={{ textDecoration: 'none', color: 'inherit' }}>{unassigned.length} unassigned order{unassigned.length > 1 ? 's' : ''} → assign</Link>}
          {refunds.filter((r) => r.status === 'review').map((r) => <Link key={r.id} to={`/admin/refunds?id=${r.id}`} className="small well" style={{ textDecoration: 'none', color: 'inherit' }}>Refund {r.id} waiting for a decision</Link>)}
          {payouts.filter((p) => p.status !== 'paid').length > 0 && <Link to="/admin/payments?tab=payouts" className="small well" style={{ textDecoration: 'none', color: 'inherit' }}>{payouts.filter((p) => p.status !== 'paid').length} payouts to approve or send</Link>}
        </section>
        <section className="card stack g12" style={{ flex: '1 1 380px', padding: 20 }}>
          <strong>Expert health · load vs capacity</strong>
          {experts.map((x) => {
            const l = loads[x.id] || 0; const pct = Math.min(100, (l / x.cap) * 100);
            return (
              <Link key={x.id} to={`/admin/experts?id=${x.id}`} className="stack g4" style={{ textDecoration: 'none', color: 'inherit' }}>
                <div className="row between xs"><span><strong>{x.name}</strong> <span className="faint">· ★ {x.rating} · {x.onTime}% on time{x.status !== 'active' ? ` · ${x.status}` : ''}</span></span><span className="mono muted">{l}/{x.cap}</span></div>
                <div style={{ height: 6, borderRadius: 3, background: 'var(--sunken)' }}><div style={{ height: 6, borderRadius: 3, width: `${pct}%`, background: pct >= 85 ? 'var(--danger)' : pct >= 60 ? 'var(--warning)' : 'var(--success)' }} /></div>
              </Link>
            );
          })}
        </section>
      </div>
    </>
  );
}
