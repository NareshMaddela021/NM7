// /partner — a signed-in, approved partner: their code and link, the organizations they referred (name and plan
// only) and their commission: earned, pending (not yet payable), payable and paid.
import { useState } from 'react';
import { Link } from 'react-router-dom';
import Header from '../../components/Header';
import { usePageMeta } from '../../lib/meta';
import { rupees } from '../../lib/orgBilling';
import { Loading, day, useApi } from '../admin/live/common';

const STATE = { pending: ['Pending', 'b-neutral'], payable: ['Payable', 'b-warning'], paid: ['Paid', 'b-success'] };

function Copy({ text, label }) {
  const [done, setDone] = useState(false);
  return <button type="button" className="btn btn-outline btn-sm" onClick={() => { navigator.clipboard?.writeText(text).then(() => { setDone(true); setTimeout(() => setDone(false), 1500); }, () => {}); }}>{done ? 'Copied' : label}</button>;
}

export default function PartnerHome() {
  usePageMeta({ title: 'Your partner page · Nm7', description: 'Your Nm7 partner code, link, referred organizations and commission.', path: '/partner', noindex: true });
  const st = useApi('/api/partner');
  return (
    <>
      <Header />
      <main id="main" className="container stack g16" style={{ maxWidth: 900, padding: '24px 16px 64px' }}>
        <h1 className="display h2">Partner page</h1>
        <Loading st={st}>{(d) => (
          <>
            {d.status === 'paused' && <div className="well small" role="note">Your partner code is paused: new organizations can’t use it. Commission on organizations already credited to you continues.</div>}
            <section className="card stack g8" aria-label="Your link">
              <span className="row between g8" style={{ flexWrap: 'wrap' }}><strong>Your code</strong><span className="mono" data-testid="partner-code" style={{ fontSize: 20 }}>{d.code}</span></span>
              <span className="small mono" style={{ wordBreak: 'break-all' }}>{d.link}</span>
              <span className="row g8"><Copy text={d.link} label="Copy link" /><Copy text={d.code} label="Copy code" /></span>
              <span className="xs muted">{d.terms.commissionPct}% of the plan price (before GST) on every payment in an organization’s first {d.terms.commissionMonths} months, payable {d.terms.payableDays} days after each payment.{d.terms.discountPct ? ` Organizations using your code get ${d.terms.discountPct}% off their first plan.` : ''}</span>
            </section>
            <section className="kpis" aria-label="Commission">
              {[['Earned', d.totals.earned], ['Pending', d.totals.pending], ['Payable', d.totals.payable], ['Paid', d.totals.paid]].map(([l, v]) => (
                <div key={l} className="card stack g4"><span className="xs muted">{l}</span><strong style={{ fontSize: 22 }}>{rupees(v)}</strong></div>
              ))}
            </section>
            <section className="card stack g8" aria-label="Referred organizations">
              <strong>Referred organizations</strong>
              {d.orgs.length === 0 ? <span className="small muted">None yet. Organizations appear here after their first payment.</span> : (
                <div className="table-wrap"><table className="table"><thead><tr><th>Organization</th><th>Plan</th><th>Since</th></tr></thead>
                  <tbody>{d.orgs.map((o, i) => <tr key={i}><td>{o.name}</td><td>{o.plan}</td><td className="small">{day(o.since)}</td></tr>)}</tbody></table></div>
              )}
            </section>
            <section className="card stack g8" aria-label="Commission entries">
              <strong>Commission</strong>
              {d.entries.length === 0 ? <span className="small muted">No commission yet.</span> : (
                <div className="table-wrap"><table className="table"><thead><tr><th>Date</th><th>Organization</th><th>Document</th><th>Amount</th><th>Status</th></tr></thead>
                  <tbody>{d.entries.map((e) => { const [l, c] = STATE[e.state]; return (
                    <tr key={e.id}><td className="small">{day(e.earnedOn)}</td><td>{e.orgName}</td><td className="mono small">{e.document}{e.kind === 'reversal' ? <div className="xs faint">refund</div> : null}</td><td className="small">{e.amount < 0 ? '−' : ''}{rupees(Math.abs(e.amount))}<div className="xs faint">{e.pct}% of {rupees(e.base)}</div></td><td><span className={`badge ${c}`}>{l}</span>{e.state === 'pending' ? <div className="xs faint">from {day(e.payableOn)}</div> : null}</td></tr>
                  ); })}</tbody></table></div>
              )}
              <span className="xs muted">Payouts are made by bank transfer. Before your first payout we’ll ask for your bank and tax details by email; they aren’t stored on this page.</span>
            </section>
          </>
        )}</Loading>
        <span className="xs muted"><Link to="/partners">About the partner programme</Link></span>
      </main>
    </>
  );
}
