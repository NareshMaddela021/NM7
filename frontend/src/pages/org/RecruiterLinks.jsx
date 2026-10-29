// Recruiter links (Phase 3C): every link this organization made — company, how many candidates are still on it,
// views, downloads, shortlisted — with Extend and Revoke. Links are made from Shared resumes ("Share with a
// recruiter…"). Used in the coordinator portal (/org/:orgId/recruiters) and the admin console.
import { Link } from 'react-router-dom';
import { useState } from 'react';
import { useToast } from '../../components/ui';
import { DAY_CHOICES, LINK_STATE } from '../../lib/recruiter';
import { Loading, emptyIf, http, useAction, useApi, when } from '../admin/live/common';

const tone = { active: 'b-success', expired: 'b-neutral', revoked: 'b-warning' };

export default function RecruiterLinks({ orgId, canManage, sharedUrl }) {
  const base = `/api/org/${encodeURIComponent(orgId)}/recruiter-links`;
  const st = useApi(base);
  const toast = useToast();
  const [busy, run] = useAction(toast);
  const [days, setDays] = useState({});
  const extend = (l) => run(async () => { await http(`${base}/${l.id}/extend`, { method: 'POST', body: { days: days[l.id] || 14 } }); st.reload(); }, 'Link extended');
  const revoke = (l) => {
    if (!window.confirm(`Revoke the link for ${l.company}? It stops working at once.`)) return;
    run(async () => { await http(`${base}/${l.id}/revoke`, { method: 'POST', body: {} }); st.reload(); }, 'Link revoked');
  };
  return (
    <section className="card stack g12" aria-label="Recruiter links">
      <div className="row between g8"><strong>Recruiter links</strong><button type="button" className="link-btn small" onClick={st.reload}>Refresh</button></div>
      <span className="xs faint">Make a link from Shared resumes: tick the resumes (or filter) and choose “Share with a recruiter…”. Only approved members who allowed sharing with recruiters are on a link, and anyone who leaves or stops sharing disappears from it at once. Recruiters need no account.</span>
      <Loading st={st} empty={emptyIf((d) => !d.length, 'No recruiter links yet.')}>{(rows) => (
        <div className="table-wrap" tabIndex={0} role="region" aria-label="Table — scroll sideways to see all columns"><table className="table"><thead><tr><th>Company</th><th>Status</th><th>Candidates</th><th>Views · downloads</th><th>Shortlisted</th><th>Expires</th><th /></tr></thead>
          <tbody>{rows.map((l) => (
            <tr key={l.id} data-testid="recruiter-link">
              <td className="small"><strong>{l.company}</strong>{l.label && <div className="xs faint">{l.label}</div>}<div className="xs faint">{l.allowDownloads ? 'downloads on' : 'view only'}{l.includeContact ? ' · contact details' : ''}{l.hasCode ? ' · access code' : ''}</div></td>
              <td className="small"><span className={`badge ${tone[l.state]}`}>{LINK_STATE[l.state]}</span></td>
              <td className="small">{l.state === 'active' ? `${l.candidates} of ${l.added}` : l.added}</td>
              <td className="small" data-testid="link-stats">{l.views} view{l.views === 1 ? '' : 's'} · {l.downloads} download{l.downloads === 1 ? '' : 's'}</td>
              <td className="small">{l.shortlisted ? (sharedUrl ? <Link to={sharedUrl({ shortlistedBy: l.id, approval: 'all' })}>{l.shortlisted} shortlisted</Link> : `${l.shortlisted} shortlisted`) : '—'}</td>
              <td className="small">{when(l.expiresAt)}</td>
              <td>{canManage && l.state !== 'revoked' && (
                <div className="row g8" style={{ flexWrap: 'nowrap', alignItems: 'center' }}>
                  <select aria-label={`Extend ${l.company} by`} className="input" style={{ height: 32, width: 'auto' }} value={days[l.id] || 14} onChange={(e) => setDays({ ...days, [l.id]: Number(e.target.value) })}>{DAY_CHOICES.map((n) => <option key={n} value={n}>{n} days</option>)}</select>
                  <button type="button" className="link-btn small" disabled={busy} onClick={() => extend(l)}>Extend</button>
                  <button type="button" className="link-btn small" disabled={busy} onClick={() => revoke(l)}>Revoke</button>
                </div>
              )}</td>
            </tr>
          ))}</tbody></table></div>
      )}</Loading>
    </section>
  );
}
