// Reports: monthly finance summary for the CA (sales, GST on fee, fees, payouts, refunds) + exports.
import { useAdmin } from './AdminContext';
import { PageHead, inr, downloadCsv, fmtDT } from './AdminUI';
import { PLANS, expertPayout } from '../../lib/pricing';

const MONTH = (t) => new Date(t).toLocaleDateString('en-IN', { month: 'short', year: 'numeric' });

export default function Reports() {
  const { orders, refunds, payouts, experts, settings, exName } = useAdmin();
  const f = settings.fees;
  const months = {};
  orders.forEach((o) => {
    const k = MONTH(o.createdAt);
    const m = months[k] || (months[k] = { month: k, orders: 0, sales: 0, diy: 0, expert: 0, fee: 0, gst: 0, tx: 0, expertNet: 0, refunds: 0 });
    m.orders += 1; m.sales += o.price; m.tx += o.price * f.txPct / 100;
    if (o.planId === 'diy') m.diy += o.price;
    else { m.expert += o.price; const fee = o.price * f.platformPct / 100; m.fee += fee; m.gst += fee * f.gstPct / 100; m.expertNet += expertPayout(o.price).net; }
  });
  refunds.filter((r) => r.status === 'refunded' || r.status === 'auto-approved').forEach((r) => { const k = MONTH(r.at); if (months[k]) months[k].refunds += r.amount; });
  const rows = Object.values(months);
  const finance = [['Month', 'Orders', 'Total sales', 'DIY sales', 'Expert sales', `Platform fee (${f.platformPct}%)`, `GST on fee (${f.gstPct}%)`, 'Transaction charges', 'Owed to experts', 'Refunds'], ...rows.map((m) => [m.month, m.orders, m.sales, m.diy, m.expert, Math.round(m.fee), Math.round(m.gst), Math.round(m.tx), Math.round(m.expertNet), m.refunds])];

  const exports = [
    ['Finance summary (for your CA)', 'finance-summary.csv', finance],
    ['All orders', 'orders.csv', [['Order', 'Customer', 'Plan', 'Price', 'Domain', 'Expert', 'Stage', 'Placed'], ...orders.map((o) => [o.id, o.customer, PLANS[o.planId].name, o.price, o.domain, exName(o.expert), o.stage, fmtDT(o.createdAt)])]],
    ['Expert performance', 'experts.csv', [['Expert', 'Domains', 'On time %', 'Rating', 'Revisions/order', 'Refunds', 'Tier', 'Status'], ...experts.map((x) => [x.name, x.domains.join(' / '), x.onTime, x.rating, x.revisions, x.refunds, x.tier, x.status])]],
    ['Payouts', 'payouts.csv', [['Request', 'Expert', 'Amount', 'Status', 'UTR', 'Requested'], ...payouts.map((p) => [p.id, exName(p.expert), p.amount, p.status, p.utr || '', fmtDT(p.at)])]],
    ['Refunds', 'refunds.csv', [['Case', 'Order', 'Type', 'Amount', 'Status', 'Opened'], ...refunds.map((r) => [r.id, r.orderId, r.type, r.amount, r.status, fmtDT(r.at)])]],
  ];

  return (
    <>
      <PageHead title="Reports" sub="Monthly numbers and downloads. CSV files open in Excel." />
      <div className="card table-wrap" style={{ padding: 0 }}>
        <table className="table">
          <thead><tr>{finance[0].map((h) => <th key={h}>{h}</th>)}</tr></thead>
          <tbody>{rows.map((m) => <tr key={m.month}><td><strong>{m.month}</strong></td><td>{m.orders}</td><td>{inr(m.sales)}</td><td>{inr(m.diy)}</td><td>{inr(m.expert)}</td><td>{inr(m.fee)}</td><td>{inr(m.gst)}</td><td>{inr(m.tx)}</td><td>{inr(m.expertNet)}</td><td style={{ color: m.refunds ? 'var(--danger)' : undefined }}>{inr(m.refunds)}</td></tr>)}</tbody>
        </table>
      </div>
      <span className="xs faint">GST shown is on your platform fee for expert orders. DIY sales are fully yours — check with your CA how GST applies to them. TDS: {f.tdsPct == null ? 'rate pending from your CA' : `${f.tdsPct}%`}.</span>
      <div className="grid-auto g12" style={{ '--min': '240px' }}>
        {exports.map(([t, file, data]) => (
          <div key={file} className="card stack g8">
            <strong className="small">{t}</strong><span className="xs muted">{data.length - 1} rows</span>
            <button type="button" className="btn btn-outline" onClick={() => downloadCsv(file, data)}>Download CSV</button>
          </div>
        ))}
      </div>
    </>
  );
}
