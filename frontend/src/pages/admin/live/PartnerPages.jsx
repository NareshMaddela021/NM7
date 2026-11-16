// Admin → Partners: applications to approve (with a code like ASX-RAVI), approved partners with what they're owed,
// one partner's referred organizations, commission ledger and payouts, and "mark paid" with a reference and a TDS
// note. All money arithmetic is on the server; every action is logged.
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useToast } from '../../../components/ui';
import { rupees } from '../../../lib/orgBilling';
import { PageHead } from '../AdminUI';
import { Loading, day, emptyIf, http, useAction, useApi } from './common';
import { Chip, Stat } from '../../me/kit';
import '../../../styles/me-kit.css';
import '../../../styles/admin-orgs.css';

const STATUS = { applied: ['Applied', 'b-warning'], approved: ['Approved', 'b-success'], paused: ['Paused', 'b-neutral'], rejected: ['Rejected', 'b-neutral'] };
const STATE = { pending: 'Pending', payable: 'Payable', paid: 'Paid' };
const inputStyle = { height: 40 };

function Partner({ id, onChanged }) {
  const toast = useToast();
  const st = useApi(`/api/admin/partners/${id}`);
  const [busy, run] = useAction(toast);
  const [code, setCode] = useState(null);
  const [pay, setPay] = useState({ reference: '', tdsNote: '' });
  const again = () => { st.reload(); onChanged(); };
  const status = (s) => run(async () => { await http(`/api/admin/partners/${id}/status`, { method: 'PUT', body: { status: s } }); again(); }, 'Saved');
  return (
    <Loading st={st}>{(p) => (
      <section className="mcard ao-card ao-partner" aria-label={`Partner ${p.name}`}>
        <header className="ao-partner-head">
          <span className="ao-av ao-av-lg" aria-hidden="true">{(p.name || '?').trim().charAt(0).toUpperCase()}</span>
          <span className="ao-partner-t">
            <strong className="ao-partner-name">{p.name}{p.organisation ? <span className="muted"> · {p.organisation}</span> : null}</strong>
            <span className="small">{p.email} · {p.phone}{p.hasAccount ? ' · has an Nm7 account' : ' · no account yet (linked when they sign up with this email)'}</span>
          </span>
          <span className={`badge ${STATUS[p.status][1]}`}>{STATUS[p.status][0]}</span>
        </header>
        {p.note && <span className="small muted ao-quote">“{p.note}”</span>}
        {p.code ? <span className="ao-code small">Code <span className="mono ao-code-v">{p.code}</span> · <span className="mono xs">{p.link}</span></span> : null}
        {(p.status === 'applied' || p.status === 'rejected') && (
          <form className="ao-sub ao-sub-row" onSubmit={(e) => { e.preventDefault(); run(async () => { await http(`/api/admin/partners/${id}/approve`, { method: 'POST', body: { code: (code ?? p.suggestedCode) || null } }); again(); }, 'Approved · code emailed'); }}>
            <label className="small ao-lbl">Code <input className="input mono" style={{ ...inputStyle, width: 170 }} maxLength={16} value={code ?? p.suggestedCode ?? ''} onChange={(e) => setCode(e.target.value.toUpperCase())} /></label>
            <button type="submit" className="btn btn-signal" disabled={busy}>Approve</button>
            {p.status === 'applied' && <button type="button" className="btn btn-outline" disabled={busy} onClick={() => status('rejected')}>Reject</button>}
          </form>
        )}
        {p.status === 'approved' && <button type="button" className="btn btn-outline" style={{ alignSelf: 'flex-start' }} disabled={busy} onClick={() => status('paused')}>Pause the code</button>}
        {p.status === 'paused' && <button type="button" className="btn btn-outline" style={{ alignSelf: 'flex-start' }} disabled={busy} onClick={() => status('approved')}>Resume the code</button>}
        {p.code && (
          <>
            <div className="ao-stats">
              <Stat label="Earned" value={rupees(p.totals.earned)} sub={`${p.orgs} organization(s)`} />
              <Stat label="Pending" value={rupees(p.totals.pending)} sub="not yet payable" />
              <Stat label="Payable now" value={rupees(p.totals.payable)} sub="due today or earlier" tone={p.totals.payable > 0 ? 'warn' : undefined} />
              <Stat label="Paid" value={rupees(p.totals.paid)} sub={`${p.payouts.length} payout(s)`} />
            </div>
            {p.totals.payable > 0 && (
              <form className="ao-sub" aria-label="Mark paid" onSubmit={(e) => { e.preventDefault(); if (!window.confirm(`Mark ${rupees(p.totals.payable)} as paid to ${p.name}?`)) return; run(async () => { await http(`/api/admin/partners/${id}/payouts`, { method: 'POST', body: pay }); setPay({ reference: '', tdsNote: '' }); again(); }, 'Marked paid'); }}>
                <strong className="small">Pay {rupees(p.totals.payable)}</strong>
                <div className="ao-fields">
                  <label className="small ao-lbl">Transfer reference (UTR) <input required minLength={3} maxLength={80} className="input" style={inputStyle} value={pay.reference} onChange={(e) => setPay({ ...pay, reference: e.target.value })} /></label>
                  <label className="small ao-lbl ao-span2">TDS note (optional) <input maxLength={300} className="input" style={inputStyle} placeholder="e.g. TDS u/s 194H deducted ₹…" value={pay.tdsNote} onChange={(e) => setPay({ ...pay, tdsNote: e.target.value })} /></label>
                </div>
                <span className="xs muted">Send the money by bank transfer first; this only records it. Don’t write PAN or account numbers here.</span>
                <button type="submit" className="btn btn-signal" style={{ alignSelf: 'flex-start' }} disabled={busy}>Mark paid</button>
              </form>
            )}
            <strong className="small ao-sec-k">Referred organizations</strong>
            {p.referredOrgs.length === 0 ? <span className="small muted">None yet.</span> : (
              <div className="table-wrap ao-table" tabIndex={0} role="region" aria-label="Table — scroll sideways to see all columns"><table className="table"><thead><tr><th>Organization</th><th>Plan</th><th>Since</th><th>How</th></tr></thead>
                <tbody>{p.referredOrgs.map((o) => <tr key={o.id}><td><Link to={`/admin/orgs/${o.id}`}>{o.name}</Link></td><td><Chip tone="accent">{o.plan}</Chip></td><td className="small">{day(o.since)}</td><td className="small">{o.via}</td></tr>)}</tbody></table></div>
            )}
            <strong className="small ao-sec-k">Ledger</strong>
            {p.entries.length === 0 ? <span className="small muted">No commission yet.</span> : (
              <div className="table-wrap ao-table" tabIndex={0} role="region" aria-label="Table — scroll sideways to see all columns"><table className="table" aria-label="Commission ledger"><thead><tr><th>Date</th><th>Organization</th><th>Document</th><th>Base</th><th>Amount</th><th>Status</th></tr></thead>
                <tbody>{p.entries.map((e) => <tr key={e.id}><td className="small">{day(e.earnedOn)}</td><td className="small">{e.orgName}</td><td className="mono small">{e.document}</td><td className="small">{e.pct}% of {rupees(e.base)}</td><td className="small ao-num">{e.amount < 0 ? '−' : ''}{rupees(Math.abs(e.amount))}</td><td className="small">{STATE[e.state]}{e.state === 'pending' ? ` · from ${day(e.payableOn)}` : ''}</td></tr>)}</tbody></table></div>
            )}
            {p.payouts.length > 0 && (
              <details className="ao-details"><summary className="small">Payouts ({p.payouts.length})</summary>
                <ul className="small">{p.payouts.map((x) => <li key={x.id}>{day(x.at)} · {rupees(x.amount)} · ref <span className="mono">{x.reference}</span>{x.tdsNote ? ` · ${x.tdsNote}` : ''}</li>)}</ul>
              </details>
            )}
          </>
        )}
      </section>
    )}</Loading>
  );
}

/** /admin/partners */
export function LivePartners() {
  const st = useApi('/api/admin/partners');
  const [open, setOpen] = useState(null);
  const rows = st.data || [];
  return (
    <>
      <PageHead title="Partners" sub="Referral partners: applications, codes, referred organizations and commission." />
      {rows.length > 0 && (
        <div className="ao-stats">
          <Stat label="To review" value={rows.filter((p) => p.status === 'applied').length} tone={rows.some((p) => p.status === 'applied') ? 'warn' : undefined} />
          <Stat label="Approved" value={rows.filter((p) => p.status === 'approved').length} />
          <Stat label="Payable now" value={rupees(rows.reduce((n, p) => n + (p.totals?.payable || 0), 0))} />
          <Stat label="Paid so far" value={rupees(rows.reduce((n, p) => n + (p.totals?.paid || 0), 0))} />
        </div>
      )}
      <Loading st={st} empty={emptyIf((d) => !d.length, 'No applications yet. Partners apply at nm7.si/partners.')}>{(list) => (
        <div className="ao-split">
          <section className="mcard ao-card ao-flush" aria-label="All partners">
            <div className="table-wrap ao-table" tabIndex={0} role="region" aria-label="Table — scroll sideways to see all columns">
              <table className="table"><thead><tr><th>Partner</th><th>Status</th><th>Code</th><th>Orgs</th><th>Payable</th><th>Paid</th><th /></tr></thead>
                <tbody>{list.map((p) => (
                  <tr key={p.id} className={open === p.id ? 'ao-row-on' : ''}>
                    <td className="small"><span className="ao-person"><span className="ao-av" aria-hidden="true">{(p.name || '?').trim().charAt(0).toUpperCase()}</span><span className="ao-person-t">{p.name}<span className="xs faint">{p.email}</span></span></span></td>
                    <td><span className={`badge ${STATUS[p.status][1]}`}>{STATUS[p.status][0]}</span></td>
                    <td className="mono small">{p.code || '—'}</td>
                    <td className="small ao-num">{p.orgs}</td>
                    <td className="small ao-num">{rupees(p.totals.payable)}</td>
                    <td className="small ao-num">{rupees(p.totals.paid)}</td>
                    <td><button type="button" className={`btn btn-sm ${p.status === 'applied' && open !== p.id ? 'btn-signal' : 'btn-outline'} ao-row-btn`} onClick={() => setOpen(open === p.id ? null : p.id)}>{open === p.id ? 'Close' : p.status === 'applied' ? 'Review' : 'Open'}</button></td>
                  </tr>
                ))}</tbody></table>
            </div>
          </section>
          {open && <Partner key={open} id={open} onChanged={st.reload} />}
        </div>
      )}</Loading>
    </>
  );
}

/** Admin → Organization → Plan and billing: which partner the organization is credited to, and correcting it. */
export function OrgPartner({ orgId, partner, reload }) {
  const toast = useToast();
  const [busy, run] = useAction(toast);
  const [edit, setEdit] = useState(null);
  const list = useApi(edit ? '/api/admin/partners' : null);
  return (
    <div className="stack g8">
      <span className="small">Partner: {partner ? <><span className="mono">{partner.code}</span> · since {day(partner.since)} · {partner.via}</> : 'none'} <button type="button" className="link-btn small" onClick={() => setEdit(edit ? null : { partnerId: partner?.partnerId || '', note: '' })}>{edit ? 'Cancel' : 'Change'}</button></span>
      {edit && (
        <form className="ao-sub ao-sub-row" onSubmit={(e) => { e.preventDefault(); run(async () => { await http(`/api/admin/orgs/${orgId}/partner`, { method: 'PUT', body: { partnerId: edit.partnerId || null, note: edit.note } }); setEdit(null); reload(); }, 'Saved'); }}>
          <select aria-label="Partner" className="input" style={inputStyle} value={edit.partnerId} onChange={(e) => setEdit({ ...edit, partnerId: e.target.value })}>
            <option value="">No partner</option>
            {(list.data || []).filter((p) => p.code && p.status !== 'rejected').map((p) => <option key={p.id} value={p.id}>{p.code} · {p.name}</option>)}
          </select>
          <label className="small" style={{ flex: '1 1 220px' }}>Why (for the log) <input required minLength={3} maxLength={300} className="input" style={inputStyle} value={edit.note} onChange={(e) => setEdit({ ...edit, note: e.target.value })} /></label>
          <button type="submit" className="btn btn-ink" disabled={busy}>Save</button>
          <span className="xs muted" style={{ flexBasis: '100%' }}>Commission already booked stays where it is; later payments in the commission period go to the new partner.</span>
        </form>
      )}
    </div>
  );
}
