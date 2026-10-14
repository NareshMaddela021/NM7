// Payments (Razorpay, matched to orders) · Payouts (approve, mark paid, fee breakdown) · Invoices.
import { useState } from 'react';
import { useSearchParams, Link } from 'react-router-dom';
import { useToast } from '../../components/ui';
import { useAdmin } from './AdminContext';
import { PageHead, Tabs, Empty, Kpi, inr, fmtDT, downloadCsv } from './AdminUI';
import { payoutGross } from '../../data/adminData';
import { PLANS } from '../../lib/pricing';

const PO = { pending: ['Requested', 'b-warning'], approved: ['Approved', 'b-neutral'], paid: ['Paid', 'b-success'] };

function PaymentsTab() {
  const { payments } = useAdmin();
  const [f, setF] = useState('all');
  const flagged = payments.filter((p) => !p.orderId);
  const list = payments.filter((p) => (f === 'flag' ? !p.orderId : f === 'unsettled' ? !p.settled && p.status === 'captured' : true)).sort((a, b) => b.at - a.at);
  const captured = payments.filter((p) => p.status === 'captured');
  return (
    <>
      <div className="kpis">
        <Kpi label="Captured" value={inr(captured.reduce((s, p) => s + p.amount, 0))} sub={`${captured.length} payments`} />
        <Kpi label="Waiting for settlement" value={inr(captured.filter((p) => !p.settled).reduce((s, p) => s + p.amount, 0))} sub="Razorpay settles in ~2 days" />
        <Kpi label="Needs a look" value={flagged.length} sub="No matching order or failed" tone={flagged.length ? 'var(--warning)' : undefined} />
      </div>
      <div className="row between g8">
        <Tabs label="Payments filter" value={f} onChange={setF} tabs={[['all', 'All'], ['flag', `Mismatches (${flagged.length})`], ['unsettled', 'Not settled']]} />
        <button type="button" className="btn btn-outline" onClick={() => downloadCsv('payments.csv', [['Payment', 'Order', 'Amount', 'Method', 'Status', 'Settled', 'Time'], ...list.map((p) => [p.id, p.orderId || 'NO ORDER', p.amount, p.method, p.status, p.settled ? 'yes' : 'no', fmtDT(p.at)])])}>Export CSV</button>
      </div>
      <div className="card table-wrap" style={{ padding: 0 }}>
        <table className="table"><thead><tr><th>Razorpay payment</th><th>Order</th><th>Amount</th><th>Method</th><th>Status</th><th>Settled</th></tr></thead>
          <tbody>{list.slice(0, 40).map((p) => (
            <tr key={p.id} style={!p.orderId ? { background: 'var(--warningbg)' } : undefined}>
              <td className="mono xs">{p.id}<br /><span className="faint">{fmtDT(p.at)}</span></td>
              <td className="small">{p.orderId ? <Link to={`/admin/orders?id=${p.orderId}`}>{p.orderId}</Link> : <strong style={{ color: 'var(--warning)' }}>No order {p.note ? `— ${p.note}` : ''}</strong>}</td>
              <td>{inr(p.amount)}</td><td className="small">{p.method}</td>
              <td><span className={`badge ${p.status === 'captured' ? 'b-success' : p.status === 'refunded' ? 'b-neutral' : 'b-danger'}`}>{p.status}</span></td>
              <td className="small">{p.settled ? '✓' : '—'}</td>
            </tr>))}</tbody></table>
      </div>
    </>
  );
}

function PayoutsTab() {
  const { payouts, actions, exName, settings } = useAdmin();
  const toast = useToast();
  const [sel, setSel] = useState([]);
  const [utr, setUtr] = useState('');
  const f = settings.fees;
  const pending = payouts.filter((p) => p.status === 'pending');
  const approved = payouts.filter((p) => p.status === 'approved');
  const breakdown = (net) => {
    const gross = payoutGross(net);
    const platform = gross * f.platformPct / 100; const gst = platform * f.gstPct / 100; const tx = gross * f.txPct / 100;
    const tds = f.tdsPct == null ? null : net * f.tdsPct / 100;
    return { gross, platform, gst, tx, tds, final: net - (tds || 0) };
  };
  return (
    <>
      <span className="small muted">Experts can withdraw anytime; money arrives in 3–5 business days. Approve, send via your bank or RazorpayX, then mark as paid with the UTR.</span>
      <div className="row g8">
        <button type="button" className="btn btn-ink" disabled={!sel.some((id) => pending.find((p) => p.id === id))} onClick={() => { const ids = sel.filter((id) => pending.find((p) => p.id === id)); actions.payout(ids, 'approved'); setSel([]); toast(`Approved ${ids.length} payout(s)`); }}>Approve selected</button>
        <label htmlFor="utr" className="sr-only">UTR number</label>
        <input id="utr" className="input" style={{ height: 40, width: 200 }} placeholder="UTR / reference no." value={utr} onChange={(e) => setUtr(e.target.value)} />
        <button type="button" className="btn btn-outline" disabled={!utr.trim() || !sel.some((id) => approved.find((p) => p.id === id))} onClick={() => { const ids = sel.filter((id) => approved.find((p) => p.id === id)); actions.payout(ids, 'paid', utr.trim()); setSel([]); setUtr(''); toast(`Marked ${ids.length} as paid`); }}>Mark selected as paid</button>
      </div>
      <div className="card table-wrap" style={{ padding: 0 }}>
        {payouts.length === 0 ? <Empty>No payout requests.</Empty> : (
          <table className="table"><thead><tr><th><span className="sr-only">Select</span></th><th>Request</th><th>Expert</th><th>Order value</th><th>− {f.platformPct}% fee</th><th>− GST</th><th>− Tx</th><th>TDS</th><th>Pay</th><th>Status</th></tr></thead>
            <tbody>{payouts.map((p) => {
              const b = breakdown(p.amount);
              return (
                <tr key={p.id}>
                  <td>{p.status !== 'paid' && <input type="checkbox" aria-label={`Select ${p.id}`} checked={sel.includes(p.id)} onChange={(e) => setSel((s) => (e.target.checked ? [...s, p.id] : s.filter((x) => x !== p.id)))} />}</td>
                  <td className="small"><strong>{p.id}</strong><br /><span className="faint xs">{fmtDT(p.at)} · {p.orders} orders</span></td>
                  <td className="small">{exName(p.expert)}</td>
                  <td>{inr(b.gross)}</td><td className="muted">{inr(b.platform)}</td><td className="muted">{inr(b.gst)}</td><td className="muted">{inr(b.tx)}</td>
                  <td className="xs muted">{b.tds == null ? 'rate pending (CA)' : inr(b.tds)}</td>
                  <td><strong>{inr(b.final)}</strong></td>
                  <td><span className={`badge ${PO[p.status][1]}`}>{PO[p.status][0]}</span>{p.utr && <div className="xs faint mono">{p.utr}</div>}</td>
                </tr>
              );
            })}</tbody></table>
        )}
      </div>
    </>
  );
}

function InvoicesTab() {
  const { orders, payouts, exName } = useAdmin();
  return (
    <div className="row g16" style={{ alignItems: 'flex-start' }}>
      <div className="card stack g8" style={{ flex: '1 1 360px' }}>
        <strong>Customer invoices</strong>
        {orders.slice(0, 8).map((o) => <span key={o.id} className="row between small well"><span>INV-{o.id.slice(3)} · {o.customer} · {PLANS[o.planId].name}</span><button type="button" className="link-btn xs" onClick={() => downloadCsv(`invoice-${o.id}.csv`, [['Invoice', `INV-${o.id.slice(3)}`], ['Customer', o.customer], ['Item', PLANS[o.planId].name], ['Amount (incl. taxes)', o.price], ['Date', fmtDT(o.createdAt)], ['Seller', 'AsuraaX AI · Nm7']])}>Download</button></span>)}
        <span className="xs faint">Real GST invoices (with your GSTIN) are generated by the backend; these are previews.</span>
      </div>
      <div className="card stack g8" style={{ flex: '1 1 360px' }}>
        <strong>Expert payout statements</strong>
        {payouts.map((p) => <span key={p.id} className="row between small well"><span>{p.id} · {exName(p.expert)} · {inr(p.amount)}</span><span className="xs faint">{p.status}</span></span>)}
      </div>
    </div>
  );
}

export default function Payments() {
  const [params, setParams] = useSearchParams();
  const tab = params.get('tab') || 'payments';
  return (
    <>
      <PageHead title="Payments & payouts" sub="Razorpay payments matched to orders, expert payouts and invoices." />
      <Tabs label="Payments" value={tab} onChange={(v) => setParams(v === 'payments' ? {} : { tab: v })} tabs={[['payments', 'Payments'], ['payouts', 'Payouts'], ['invoices', 'Invoices']]} />
      {tab === 'payments' && <PaymentsTab />}
      {tab === 'payouts' && <PayoutsTab />}
      {tab === 'invoices' && <InvoicesTab />}
    </>
  );
}
