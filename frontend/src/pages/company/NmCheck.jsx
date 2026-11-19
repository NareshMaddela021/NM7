// Vetting V4: "Request Nm7 check" on a Hire now card and in an applicant's profile, for people at level 3 or more.
// POST /api/company/{cid}/hire/l4/{uid} asks Nm7 for the human check (a 15-minute call with an Nm7 reviewer and a
// reference from a past manager or teacher); the answer is the request's status, shown as a chip (requested -> call
// booked -> checked -> verified). Verified shows "tick Nm7 verified · Confirmed by a past manager at <company>". After an
// interview with a verified person, "Rate this candidate" (1–5 stars, POST …/rating) tells Nm7 how well the check
// predicted them. The row may already carry `l4` ({ status, referenceLine }); L4 people count as verified.
// English only for now.
import { useState } from 'react';
import { rq } from '../../lib/company';
import { l4Status } from '../../lib/l4';
import '../../styles/vetting-l4.css';
import { IcCheck, IcStar } from '../../components/icons';

function Stars({ c, uid, name }) {
  const [stars, setStars] = useState(0);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const rate = async (n) => {
    setBusy(true); setMsg('');
    try { await rq(`/api/company/${c.id}/hire/l4/${encodeURIComponent(uid)}/rating`, { method: 'POST', body: { stars: n } }); setStars(n); setMsg('Thanks: this helps Nm7 keep its checks honest.'); }
    catch (x) { setMsg(x.message); } finally { setBusy(false); }
  };
  const onKey = (e) => {
    const n = { ArrowRight: stars + 1, ArrowUp: stars + 1, ArrowLeft: stars - 1, ArrowDown: stars - 1 }[e.key];
    if (n == null || n < 1 || n > 5) return;
    e.preventDefault(); rate(n);
    e.currentTarget.querySelectorAll('button')[n - 1]?.focus();
  };
  return (
    <div className="stack g4">
      <span className="l4-legend" id={`l4-rate-${uid}`}>After you interview them: rate this candidate<span className="sr-only"> ({name})</span></span>
      <div className="l4-choices l4-stars" role="radiogroup" aria-labelledby={`l4-rate-${uid}`} onKeyDown={onKey} data-testid="co-l4-stars">
        {[1, 2, 3, 4, 5].map((n) => (
          <button key={n} type="button" role="radio" className={`l4-choice ${n <= stars ? 'on' : ''}`} aria-checked={stars === n} tabIndex={(stars || 1) === n ? 0 : -1}
            aria-label={`${n} out of 5${n === 1 ? ' (not as the check said)' : n === 5 ? ' (just as the check said)' : ''}`} disabled={busy} onClick={() => rate(n)} data-testid={`co-l4-star-${n}`}>
            <IcStar fill={n <= stars ? 'currentColor' : 'none'} />
          </button>
        ))}
      </div>
      {msg && <span className="xs" role="status" data-testid="co-l4-rated">{msg}</span>}
    </div>
  );
}

/** `level`: the person's level number (nothing shows below 3). `row`: the Hire now / applicant row (may carry l4). */
export default function NmCheck({ c, uid, name, level, row, canRequest = true }) {
  const fromRow = row?.l4 || (level >= 4 ? { status: 'verified', referenceLine: row?.l4Line || row?.referenceLine || '' } : null);
  const [st, setSt] = useState(fromRow);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  if (!uid || !(level >= 3)) return null;
  const ask = async () => {
    setBusy(true); setErr('');
    try { setSt(await rq(`/api/company/${c.id}/hire/l4/${encodeURIComponent(uid)}`, { method: 'POST' })); }
    catch (x) { setErr(x.message); } finally { setBusy(false); }
  };
  const [words, tone] = l4Status(st?.status);
  return (
    <div className="l4-co" data-testid="co-l4">
      {st?.status === 'verified' ? (
        <p className="l4-verified" data-testid="co-l4-verified"><IcCheck size={14} /> Nm7 verified{st.referenceLine ? ` · ${st.referenceLine}` : ''}</p>
      ) : st ? (
        <div className="l4-co-row">
          <span className={`mchip mchip-${tone}`} role="status" data-testid="co-l4-status">Nm7 check: {words}</span>
          {st.status === 'requested' && <span className="xs muted">They pick a call time; answer within 24 hours.</span>}
        </div>
      ) : canRequest && (
        <div className="l4-co-row">
          <button type="button" className="btn btn-outline btn-sm" disabled={busy} onClick={ask} aria-label={`Request Nm7 check: ${name}`} data-testid="co-l4-request">
            {busy ? 'Requesting…' : 'Request Nm7 check'}
          </button>
          <span className="xs muted">A 15-minute call with an Nm7 reviewer + a past manager’s reference. Free.</span>
        </div>
      )}
      {err && <p className="error small" role="alert" style={{ margin: 0 }}>{err}</p>}
      {st?.status === 'verified' && <Stars c={c} uid={uid} name={name} />}
    </div>
  );
}
