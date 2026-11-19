// Profile & settings → Your integrity rating (Vetting Trust T8). Rendered by PrivacyConsent (same lazy chunk), so only
// for people who get Vetting Trust. GET /api/me/trust/integrity: the rating in plain words (Low / Medium / High risk or
// Not enough data), what was noticed (what, where, when, how much it counts, and whether a person cleared or confirmed
// it), the review (a person at Nm7 is looking / asked you to explain / has looked), and how the rating is worked out.
// The person can always explain (POST /explain); for a skill check or an interview they can also ask for a free review
// of that result (the V5 appeal, POST /api/me/appeals). The rating never rejects, hides or moves anyone down a list.
import { useEffect, useState } from 'react';
import { useToast } from '../../../components/ui';
import { http } from '../../../services/http';
import { MeCard } from '../kit';

const fmt = (v) => (v ? new Date(v).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '');
const TONE = { low: 'mchip-ok', medium: 'mchip-warn', high: 'mchip-warn', not_enough_data: '' };
const STONE = { open: 'mchip-warn', cleared: 'mchip-ok', confirmed: 'mchip-bad' };
const pts = (n) => `${n} point${n === 1 ? '' : 's'}`;

function Appeal({ a }) {
  const toast = useToast();
  const [done, setDone] = useState(false);
  const send = async () => {
    try { await http('/api/me/appeals', { method: 'POST', body: { kind: a.kind, ref: a.ref, reason: 'Please look at this result again: the integrity check got it wrong.' } }); setDone(true); toast('Sent: a person replies within 72 hours'); } catch (x) { toast(x.message); }
  };
  if (done) return <span className="xs">Asked: a person replies within 72 hours.</span>;
  return <button type="button" className="btn btn-ghost btn-sm" style={{ minHeight: 44 }} onClick={send} data-testid="ig-appeal">Ask for a free review of this {a.kind === 'interview' ? 'interview' : 'test'}</button>;
}

export default function IntegrityCard() {
  const toast = useToast();
  const [d, setD] = useState(null);
  const [err, setErr] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => { http('/api/me/trust/integrity').then(setD, (x) => setErr(x.message)); }, []);
  if (err) return null;
  if (!d) return null;
  const rv = d.review;
  const explain = async (e) => {
    e.preventDefault();
    setBusy(true);
    try { setD(await http('/api/me/trust/integrity/explain', { method: 'POST', body: { note } })); setNote(''); toast('Sent: a person at Nm7 will read it'); } catch (x) { toast(x.message); } finally { setBusy(false); }
  };
  return (
    <MeCard as="section" id="s-integrity" className="acc-sec" label="Integrity rating" icon="⚖" title="Your integrity rating" sub="One rating from your skill checks, interviews and ID checks. Companies only see the label, never what was noticed." testid="ig-card">
      <div className="row g8" style={{ flexWrap: 'wrap', alignItems: 'center' }}>
        <span className={`mchip ${TONE[d.level] || ''}`} data-testid="ig-label">{d.label}</span>
        {d.reviewedAt && (!rv || rv.status === 'closed') && <span className="mchip mchip-ok" data-testid="ig-reviewed">Reviewed by Nm7</span>}
      </div>
      <p className="small" style={{ margin: 0 }} data-testid="ig-plain">{d.plain}</p>
      {rv && (
        <div className="stack g4" role="status" data-testid="ig-review">
          <strong className="small">{rv.text}</strong>
          {rv.askNote && <span className="small" style={{ overflowWrap: 'anywhere' }}>They wrote: “{rv.askNote}”</span>}
          {rv.explanation && <span className="xs muted" style={{ overflowWrap: 'anywhere' }}>Your words ({fmt(rv.explainedAt)}): “{rv.explanation}”</span>}
          {rv.status === 'closed' && rv.note && <span className="small" style={{ overflowWrap: 'anywhere' }} data-testid="ig-outcome">What they found: {rv.note}</span>}
        </div>
      )}
      {d.signals.length > 0 && (
        <ul className="mlist" aria-label="What was noticed" data-testid="ig-signals">
          {d.signals.map((s) => (
            <li key={s.key} className="mitem" style={{ flexWrap: 'wrap' }} data-testid="ig-signal">
              <span className="mitem-main" style={{ minWidth: 0, flex: '1 1 240px' }}>
                <span className="mitem-title" style={{ overflowWrap: 'anywhere' }}>{s.what}</span>
                <span className="mitem-meta">{s.where} · {fmt(s.at)} · counts {s.status === 'cleared' ? 'nothing' : pts(s.weight)}</span>
              </span>
              <span className="mitem-side stack g4" style={{ alignItems: 'flex-end' }}>
                <span className={`mchip ${STONE[s.status] || ''}`} data-testid="ig-status">{s.statusText}</span>
                {s.appeal && s.status !== 'cleared' && <Appeal a={s.appeal} />}
              </span>
            </li>
          ))}
        </ul>
      )}
      <form className="stack g8" onSubmit={explain} data-testid="ig-explain">
        <label className="label" htmlFor="ig-note">{rv?.status === 'asked' ? 'Your answer to Nm7' : 'Explain something (optional)'}</label>
        <textarea id="ig-note" className="input" rows={3} maxLength={1500} value={note} onChange={(e) => setNote(e.target.value)} data-testid="ig-note" />
        <div><button type="submit" className="btn btn-outline" style={{ minHeight: 44 }} disabled={busy || note.trim().length < 5} data-testid="ig-send">Send to Nm7</button></div>
      </form>
      <details className="small">
        <summary style={{ minHeight: 44, display: 'flex', alignItems: 'center', cursor: 'pointer' }}>How it is worked out</summary>
        <p style={{ margin: '4px 0 0' }}>Each thing noticed counts a few points, up to a limit for each kind. Old things count less: half after {d.method.halfLifeDays} days, nothing after {d.method.maxAgeDays} days. Anything a person at Nm7 cleared counts nothing. Below {d.method.mediumAt} points is Low, {d.method.mediumAt} to {d.method.highAt} Medium, {d.method.highAt} or more High (a person then looks at it). {d.snapshots.note}</p>
        <p style={{ margin: '4px 0 0' }}>{d.never}</p>
      </details>
    </MeCard>
  );
}
