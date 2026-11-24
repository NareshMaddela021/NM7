// Auto Apply 2.0, phase A7: the Replies tab (every reply across channels, newest first, unread dots, each linked to its
// tracker row; interview invites stand out) and the This week tab (the last 7 days by channel, the weekly digest list
// and the one-email-a-day rule). Part of the Auto Apply 2.0 page's chunk (no new route). Nothing scrolls sideways at
// 390 px; no pop-up dialogs.
import { useCallback, useEffect, useState } from 'react';
import { http } from '../../services/http';
import { Chip, Empty, Skel } from './kit';
import { IcStar } from '../../components/icons';

const BASE = '/api/me/auto-apply/v2';
const STATUS = { viewed: 'Viewed', shortlisted: 'Shortlisted', interview: 'Interview invite', offer: 'Offer', rejected: 'Not selected', closed: 'Job closed', no_reply: 'No reply' };
const fmtAt = (ms) => (ms ? new Date(ms).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }) : '');

function Entry({ e, onOpen, onRead }) {
  const [open, setOpen] = useState(false);
  const tag = e.source === 'email' ? e.kindText : STATUS[e.status] || 'Update';
  const tone = e.interview ? 'ok' : e.kind === 'rejection' ? 'neutral' : 'info';
  const toggle = () => { setOpen(!open); if (!open && e.unread) onRead(e.id); };
  return (
    <li className={`mcard mcard-tight stack g8 aa2-reply ${e.unread ? 'aa2-unread' : ''} ${e.interview ? 'mcard-accent' : ''}`} data-testid="aa2-inbox-row" data-unread={e.unread ? '1' : '0'} data-interview={e.interview ? '1' : '0'}>
      <div className="aa2-rowtop">
        <span className="stack g4" style={{ flex: '1 1 220px' }}>
          <strong className="small aa2-wrap">{e.unread && <span className="aa2-dot" aria-label="Unread" />}{e.company || 'A company'}{e.title ? <span className="muted"> · {e.title}</span> : null}</strong>
          <span className="xs muted aa2-wrap">{e.label} · {fmtAt(e.at)}</span>
        </span>
        <Chip tone={tone} testid="aa2-inbox-tag">{e.interview ? <IcStar size={14} fill="currentColor" /> : null}{e.interview ? ' ' : ''}{tag}</Chip>
      </div>
      {e.source === 'email' ? (
        <>
          <p className="small aa2-wrap" style={{ margin: 0 }}><strong>{e.subject || '(no subject)'}</strong> <span className="muted">· from {e.fromName || e.from}</span></p>
          {open ? <p className="small aa2-pre aa2-wrap" style={{ margin: 0 }} data-testid="aa2-inbox-text">{e.text || '(no text)'}</p>
            : <p className="small muted aa2-wrap" style={{ margin: 0 }}>{(e.text || '').slice(0, 140)}{(e.text || '').length > 140 ? '…' : ''}</p>}
        </>
      ) : <p className="small aa2-wrap" style={{ margin: 0 }}>{e.text}</p>}
      {e.interview && <p className="xs aa2-wrap" style={{ margin: 0 }} data-testid="aa2-inbox-interview">Reply to the company to confirm a time. Nm7 never answers for you.</p>}
      <div className="row g8 aa2-actions">
        {e.source === 'email' && <button type="button" className="link-btn small" aria-expanded={open} onClick={toggle} data-testid="aa2-inbox-open">{open ? 'Show less' : 'Read the reply'}</button>}
        {e.itemId && <button type="button" className="link-btn small" onClick={() => { if (e.unread) onRead(e.id); onOpen(e.itemId); }} data-testid="aa2-inbox-tracker">See it in the tracker</button>}
        {e.unread && e.source !== 'email' && <button type="button" className="link-btn small" onClick={() => onRead(e.id)} data-testid="aa2-inbox-read">Mark as read</button>}
      </div>
    </li>
  );
}

export function Inbox({ toast, onOpen, onChanged }) {
  const [d, setD] = useState(null);
  const [only, setOnly] = useState('all');
  const load = useCallback(() => http(`${BASE}/inbox`).then(setD).catch(() => setD({ items: [], unread: 0, interviews: 0 })), []);
  useEffect(() => { load(); }, [load]);
  const read = async (ids) => {
    try { setD(await http(`${BASE}/inbox/read`, { method: 'POST', body: { ids } })); onChanged?.(); } catch (x) { toast(x.message); }
  };
  if (!d) return <Skel cards={2} />;
  const rows = d.items.filter((e) => (only === 'interview' ? e.interview : only === 'unread' ? e.unread : true));
  return (
    <div className="stack g12" data-testid="aa2-inbox">
      <div className="aa2-bar">
        <span className="small muted" data-testid="aa2-inbox-count">{d.unread} unread · {d.interviews} interview invite{d.interviews === 1 ? '' : 's'}. Email replies, companies’ updates on Nm7 and hiring-system updates, newest first.</span>
        {d.unread > 0 && <button type="button" className="btn btn-outline btn-sm" onClick={() => read([])} data-testid="aa2-inbox-allread">Mark all as read</button>}
      </div>
      <div className="row g8" role="radiogroup" aria-label="Show" style={{ flexWrap: 'wrap' }}>
        {[['all', 'All'], ['unread', 'Unread'], ['interview', 'Interview invites']].map(([k, l]) => (
          <button key={k} type="button" role="radio" aria-checked={only === k} className={`aa2-tab ${only === k ? 'on' : ''}`} onClick={() => setOnly(k)} data-testid={`aa2-inbox-f-${k}`}>{l}</button>
        ))}
      </div>
      {rows.length === 0 ? <Empty compact title={d.items.length ? 'Nothing here' : 'No replies yet'} testid="aa2-inbox-empty">When a company answers by email, opens or moves your application on Nm7, or its hiring system updates it, it shows here.</Empty>
        : <ul className="stack g8 aa2-list">{rows.map((e) => <Entry key={e.id} e={e} onOpen={onOpen} onRead={(id) => read([id])} />)}</ul>}
    </div>
  );
}

export function Week({ onTab }) {
  const [w, setW] = useState(null);
  useEffect(() => { http(`${BASE}/week`).then(setW).catch(() => setW(false)); }, []);
  if (w === false) return <Empty compact title="Not available">Your week can’t be shown right now.</Empty>;
  if (!w) return <Skel cards={2} />;
  const tiles = [['sent', 'Sent'], ['viewed', 'Viewed'], ['replies', 'Replies'], ['interviews', 'Interviews'], ['waiting', 'Questions waiting'], ['ready', 'Jobs ready']];
  return (
    <div className="stack g12" data-testid="aa2-week">
      <section className="mcard stack g12" aria-labelledby="aa2-week-h">
        <h2 id="aa2-week-h" className="mcard-title">Your last 7 days</h2>
        <div className="aa2-stages">
          {tiles.map(([k, l]) => <div key={k} className="aa2-stage" data-testid={`aa2-week-${k}`}><strong>{w[k]}</strong><span>{l}</span></div>)}
        </div>
        <div className="stack g6">
          <strong className="small">Sent by channel</strong>
          <ul className="aa2-list aa2-week-ch" data-testid="aa2-week-channels">
            {w.byChannel.map((c) => <li key={c.key} className="row g8 small" data-channel={c.key}><span style={{ flex: 1 }}>{c.label}</span><strong>{c.sent}</strong></li>)}
          </ul>
        </div>
        <div className="row g8 aa2-actions">
          {w.waiting > 0 && <button type="button" className="btn btn-signal btn-sm" onClick={() => onTab('waiting')}>Answer {w.waiting} question{w.waiting === 1 ? '' : 's'}</button>}
          {w.ready > 0 && <button type="button" className="btn btn-outline btn-sm" onClick={() => onTab('ready')}>See jobs ready</button>}
          {w.replies > 0 && <button type="button" className="btn btn-outline btn-sm" onClick={() => onTab('replies')}>See replies</button>}
        </div>
      </section>
      {w.mode === 'digest' && (
        <section className="mcard stack g8" aria-labelledby="aa2-digest-h" data-testid="aa2-week-digest">
          <h2 id="aa2-digest-h" className="mcard-title">This week’s list</h2>
          {w.approvals === 0 ? <p className="small muted" style={{ margin: 0 }}>Nothing is waiting for your approval.</p> : (
            <>
              <p className="small" style={{ margin: 0 }}>{w.approvals} job{w.approvals === 1 ? '' : 's'} waiting for your approval. Nothing is sent until you approve.</p>
              <ul className="aa2-plain small">{w.digest.map((x) => <li key={x.id} className="aa2-wrap">{x.title} at {x.company}{x.score != null ? ` · match ${x.score}` : ''}</li>)}</ul>
              <button type="button" className="btn btn-signal btn-sm" style={{ alignSelf: 'flex-start' }} onClick={() => onTab('approve')} data-testid="aa2-week-approve">Open this week’s list</button>
            </>
          )}
        </section>
      )}
      <p className="xs muted" style={{ margin: 0 }} data-testid="aa2-week-rule">{w.rule}</p>
    </div>
  );
}
