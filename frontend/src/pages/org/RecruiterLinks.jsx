// Recruiter links (Phase 3C): every link this organization made — company, how many candidates are still on it,
// views, downloads, shortlisted — with Extend and Revoke. Links are made from Shared resumes ("Share with a
// recruiter…"). Used in the coordinator portal (/org/:orgId/recruiters) and the admin console.
import { Link } from 'react-router-dom';
import { useState } from 'react';
import { useToast } from '../../components/ui';
import { DAY_CHOICES, LINK_STATE } from '../../lib/recruiter';
import { http, useAction, useApi, when } from '../admin/live/common';
import { Chip, Empty, Skel } from '../me/kit';
import { SHAPE_COLORS, TINTS } from '../newhome/shapes';
import '../../styles/me-kit.css';
import '../../styles/org-team.css';

TINTS.college = SHAPE_COLORS.college;
const tone = { active: 'ok', expired: 'neutral', revoked: 'warn' };

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
  // round P, Phase 4: each link is a card (company, state chip, numbers as tiles, Extend / Revoke in its footer)
  return (
    <section className="mcard" aria-label="Recruiter links">
      <header className="mcard-h">
        <span className="mcard-ic" aria-hidden="true">⇄</span>
        <span className="mcard-ht"><strong className="mcard-title">Recruiter links</strong>
          <span className="mcard-sub">Make a link from Shared resumes: tick the resumes (or filter) and choose “Share with a recruiter…”. Only approved members who allowed sharing with recruiters are on a link, and anyone who leaves or stops sharing disappears from it at once. Recruiters need no account.</span></span>
        <span className="mcard-actions"><button type="button" className="btn btn-outline btn-sm-ot" onClick={st.reload}>Refresh</button></span>
      </header>
      {st.error ? (
        <div className="stack g8" role="alert"><strong>Couldn’t load this</strong><span className="small muted">{st.error.message}</span><button type="button" className="btn btn-outline" style={{ alignSelf: 'flex-start' }} onClick={st.reload}>Try again</button></div>
      ) : !st.data ? <Skel cards={2} lines={2} label="Loading recruiter links" /> : st.data.length === 0 ? (
        <Empty shape="handshake" tint="college" title="No recruiter links yet." compact>Open Shared resumes, tick the resumes and choose “Share with a recruiter…”.</Empty>
      ) : (
        <ul className="ot-cards">
          {st.data.map((l) => (
            <li key={l.id} className={`ot-card ot-${l.state}`} data-testid="recruiter-link">
              <div className="ot-card-top">
                <span className="mavatar ot-av" aria-hidden="true">{(l.company || '?').trim().charAt(0).toUpperCase()}</span>
                <span className="ot-card-name"><strong>{l.company}</strong>{l.label && <span className="xs faint">{l.label}</span>}</span>
                <Chip tone={tone[l.state]}>{LINK_STATE[l.state]}</Chip>
              </div>
              <span className="ot-chips">
                <span className="ot-pill">{l.allowDownloads ? 'downloads on' : 'view only'}</span>
                {l.includeContact && <span className="ot-pill">contact details</span>}
                {l.hasCode && <span className="ot-pill">access code</span>}
              </span>
              <dl className="ot-facts">
                <div><dt>Candidates</dt><dd>{l.state === 'active' ? `${l.candidates} of ${l.added}` : l.added}</dd></div>
                <div><dt>Views · downloads</dt><dd data-testid="link-stats">{l.views} view{l.views === 1 ? '' : 's'} · {l.downloads} download{l.downloads === 1 ? '' : 's'}</dd></div>
                <div><dt>Shortlisted</dt><dd>{l.shortlisted ? (sharedUrl ? <Link to={sharedUrl({ shortlistedBy: l.id, approval: 'all' })}>{l.shortlisted} shortlisted</Link> : `${l.shortlisted} shortlisted`) : '—'}</dd></div>
                <div><dt>Expires</dt><dd>{when(l.expiresAt)}</dd></div>
              </dl>
              {canManage && l.state !== 'revoked' && (
                <div className="ot-card-actions">
                  <select aria-label={`Extend ${l.company} by`} className="input ot-select" value={days[l.id] || 14} onChange={(e) => setDays({ ...days, [l.id]: Number(e.target.value) })}>{DAY_CHOICES.map((n) => <option key={n} value={n}>{n} days</option>)}</select>
                  <button type="button" className="btn btn-outline btn-sm-ot" disabled={busy} onClick={() => extend(l)}>Extend</button>
                  <button type="button" className="btn btn-ghost btn-sm-ot ot-danger" disabled={busy} onClick={() => revoke(l)}>Revoke</button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
