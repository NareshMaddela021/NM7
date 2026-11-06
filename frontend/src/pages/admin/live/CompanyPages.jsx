// Admin → Companies: the trust queue (Phase 2, C1). Tabs by review state with counts; each company shows its automatic
// flags first (duplicate registration or phone, many sign-ups from one address, new domain, no mail server, unusual
// sign-in, individual recruiter), then the details, the registration number with a link to check it on the government
// site (no paid registry), the team and the activity log. Approve, reject / re-verify / block with a reason (each is
// emailed to the main admin), unblock — all on the page, no pop-up dialogs.
import { useState } from 'react';
import { useToast } from '../../../components/ui';
import { PageHead, Panel, Tabs } from '../AdminUI';
import { Loading, day, emptyIf, http, useApi } from './common';

const STATES = [['pending', 'Waiting for review'], ['approved', 'Verified'], ['rejected', 'Rejected'], ['blocked', 'Blocked'], ['draft', 'Not finished'], ['all', 'All']];
const TRUST = { verified: ['Verified', 'b-success'], basic: ['Basic', 'b-signal'], unverified: ['Unverified', 'b-warning'], blocked: ['Blocked', 'b-danger'] };

export function LiveCompanies() {
  const [state, setState] = useState('pending');
  const [q, setQ] = useState('');
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(null);
  const st = useApi(`/api/admin/companies?state=${state}&q=${encodeURIComponent(query)}`);
  const counts = st.data?.counts || {};
  return (
    <>
      <PageHead title="Companies" sub="Check each company before its jobs reach students. Flags come first; the registration number is checked by hand on the government site." />
      <Tabs value={state} onChange={setState} tabs={STATES.map(([k, l]) => [k, k === 'all' ? l : `${l} (${counts[k] ?? 0})`])} label="Companies by state" />
      <form className="row g8" role="search" aria-label="Find companies" onSubmit={(e) => { e.preventDefault(); setQuery(q.trim()); }}>
        <label className="sr-only" htmlFor="co-q">Search companies</label>
        <input id="co-q" className="input" style={{ flex: '1 1 220px', height: 40 }} placeholder="Name, email or registration number" value={q} onChange={(e) => setQ(e.target.value)} />
        <button type="submit" className="btn btn-outline">Search</button>
      </form>
      <Loading st={st} empty={emptyIf((d) => !d.items.length, 'No companies here.')}>{(d) => (
        <ul className="stack g12" style={{ listStyle: 'none', margin: 0, padding: 0 }}>
          {d.items.map((c) => (
            <li key={c.id} className="card stack g8" data-testid="admin-company">
              <div className="row g8" style={{ justifyContent: 'space-between' }}>
                <strong style={{ overflowWrap: 'anywhere' }}>{c.details.legalName}</strong>
                <span className={`badge ${TRUST[c.trust]?.[1]}`}>{TRUST[c.trust]?.[0]}</span>
              </div>
              <span className="small muted" style={{ overflowWrap: 'anywhere' }}>{c.kind === 'individual' ? 'Individual recruiter' : c.details.website} · {c.adminEmail} · signed up {day(c.createdAt)}</span>
              {c.flags.length > 0 ? (
                <ul className="stack g4" style={{ margin: 0, paddingLeft: 18 }} data-testid="company-flags">
                  {c.flags.map((f, i) => <li key={i} className="small" style={{ color: 'var(--warning)' }}>⚠ {f.text}</li>)}
                </ul>
              ) : <span className="small" style={{ color: 'var(--success)' }}>No warnings</span>}
              <button type="button" className="btn btn-outline" style={{ alignSelf: 'flex-start' }} onClick={() => setOpen(c.id)}>Review</button>
            </li>
          ))}
        </ul>
      )}</Loading>
      {open && <CompanyReview id={open} onClose={() => setOpen(null)} onChanged={() => st.reload()} />}
    </>
  );
}

function Reason({ label, cta, onSubmit, busy, onCancel }) {
  const [text, setText] = useState('');
  return (
    <form className="stack g8 card-sm" role="alert" onSubmit={(e) => { e.preventDefault(); onSubmit(text.trim()); }}>
      <label className="label" htmlFor="co-reason">{label}</label>
      <textarea id="co-reason" className="input" rows={3} minLength={5} maxLength={500} required value={text} onChange={(e) => setText(e.target.value)} />
      <span className="xs muted">The main admin gets this reason by email.</span>
      <div className="row g8">
        <button type="submit" className="btn btn-ink" disabled={busy || text.trim().length < 5}>{cta}</button>
        <button type="button" className="link-btn small" onClick={onCancel}>Cancel</button>
      </div>
    </form>
  );
}

function CompanyReview({ id, onClose, onChanged }) {
  const toast = useToast();
  const st = useApi(`/api/admin/companies/${id}`);
  const [ask, setAsk] = useState(''); // reject | reverify | block
  const [busy, setBusy] = useState(false);
  const act = async (path, body, msg) => {
    setBusy(true);
    try { await http(`/api/admin/companies/${id}/${path}`, { method: 'POST', body: body || {} }); toast(msg); setAsk(''); st.reload(); onChanged(); } catch (e) { toast(e.message); } finally { setBusy(false); }
  };
  return (
    <Panel title="Review company" onClose={onClose}>
      <Loading st={st}>{(c) => {
        const state = c.review.state;
        return (
          <div className="stack g12" data-testid="company-review">
            <h3 style={{ margin: 0, overflowWrap: 'anywhere' }}>{c.details.legalName}</h3>
            {c.flags.length > 0 && (
              <section className="card-sm stack g4" aria-label="Warnings">
                <strong className="small">Warnings</strong>
                {c.flags.map((f, i) => <span key={i} className="small" style={{ color: 'var(--warning)' }}>⚠ {f.text}</span>)}
              </section>
            )}
            <dl className="co-review">
              <div><dt>Status</dt><dd>{TRUST[c.trust]?.[0]} · {STATES.find(([k]) => k === state)?.[1] || state}{c.review.reason ? ` (${c.review.reason})` : ''}</dd></div>
              {c.kind === 'company' && <div><dt>Website</dt><dd>{c.details.website}{c.domain.ageDays != null ? ` · domain ${c.domain.ageDays} days old` : ''}{c.domain.mail === false ? ' · no mail server' : ''}</dd></div>}
              {c.registration && (
                <div><dt>{c.registration.kind.toUpperCase()}</dt><dd><span className="mono">{c.registration.number}</span>{' '}
                  <a href={c.checkAt} target="_blank" rel="noopener noreferrer" data-testid="check-reg">Check on {c.registration.kind === 'gstin' ? 'GST portal' : 'MCA site'} ↗</a></dd></div>
              )}
              {c.individual && <div><dt>LinkedIn</dt><dd><a href={c.individual.linkedin} target="_blank" rel="noopener noreferrer nofollow">{c.individual.linkedin}</a> · {c.individual.declared ? 'declaration ticked' : 'no declaration'}</dd></div>}
              <div><dt>Category</dt><dd>{c.details.category} · {c.details.structure} · {c.details.size}</dd></div>
              <div><dt>Emails</dt><dd>{c.adminEmail} (confirmed){c.companyEmail ? ` · ${c.companyEmail} (confirmed)` : ''}</dd></div>
              {c.phone && <div><dt>Phone</dt><dd>{c.phone}</dd></div>}
              <div><dt>Team</dt><dd>{c.members.map((m) => `${m.email} (${m.role}${m.status === 'invited' ? ', invited' : ''})`).join(', ')}</dd></div>
              {c.verifiedUntil && <div><dt>Verified until</dt><dd>{day(c.verifiedUntil)}</dd></div>}
            </dl>
            {c.details.about && <p className="small" style={{ margin: 0, whiteSpace: 'pre-line' }}>{c.details.about}</p>}
            {ask ? (
              <Reason busy={busy} onCancel={() => setAsk('')}
                label={{ reject: 'Why can’t we verify it?', reverify: 'Why does it need a new check?', block: 'Why is it blocked?' }[ask]}
                cta={{ reject: 'Reject', reverify: 'Send back for a check', block: 'Block company' }[ask]}
                onSubmit={(reason) => act(ask, { reason }, { reject: 'Rejected: the main admin was emailed', reverify: 'Back in the queue', block: 'Blocked: its jobs are paused' }[ask])} />
            ) : (
              <div className="row g8">
                {state !== 'approved' && state !== 'blocked' && <button type="button" className="btn btn-ink" disabled={busy || c.trust === 'unverified'} onClick={() => act('approve', null, 'Verified: the main admin was emailed')}>Approve</button>}
                {state !== 'blocked' && state !== 'rejected' && <button type="button" className="btn btn-outline" disabled={busy} onClick={() => setAsk('reject')}>Reject</button>}
                {state === 'approved' && <button type="button" className="btn btn-outline" disabled={busy} onClick={() => setAsk('reverify')}>Re-verify</button>}
                {state !== 'blocked' ? <button type="button" className="btn btn-outline" style={{ color: 'var(--danger)' }} disabled={busy} onClick={() => setAsk('block')}>Block</button>
                  : <button type="button" className="btn btn-outline" disabled={busy} onClick={() => act('unblock', { to: 'pending' }, 'Unblocked: back in the queue')}>Unblock</button>}
              </div>
            )}
            {c.trust === 'unverified' && <span className="xs muted">Approve needs the company email confirmed first.</span>}
            <details>
              <summary className="small">Activity ({c.log.length})</summary>
              <ul className="stack g4" style={{ margin: '8px 0 0', paddingLeft: 18 }}>
                {c.log.map((a, i) => <li key={i} className="xs">{day(a.at)} · {a.action.replace('company.', '')}{a.data?.reason ? `: ${a.data.reason}` : ''}</li>)}
              </ul>
            </details>
          </div>
        );
      }}</Loading>
    </Panel>
  );
}
