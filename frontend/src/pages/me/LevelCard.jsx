// Vetting V1: "You are L1 · Profile ready. Do this to reach L2:" on the candidate dashboard. The level, the ⚡ ready-now
// state and the steps come from GET /api/me/level (one rule module on the server); nothing is guessed here. Each
// missing step links to the page where it is done. "Still looking? Tap to confirm" (POST /api/me/hire/confirm) puts the
// ⚡ back for another week. Nothing shows until the level has loaded, or if it can't load.
import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { http } from '../../services/http';
import LevelBadge from '../../components/LevelBadge';

const LABELS = { 0: 'Signed up', 1: 'Profile ready', 2: 'Skill verified', 3: 'Interview-ready', 4: 'Nm7 verified' };

/** Where each step is done: [match, page, link text]; no page = not open yet. */
const STEP_LINKS = [
  [/email/i, '/me/settings', 'Account settings'],
  [/resume/i, '/me/resumes', 'My resumes'],
  [/ATS/, '/me/ats', 'Check my ATS score'],
  [/Ready to join/i, '/me/hire', 'Ready to join'],
  [/skill check/i, '/me/skill-checks', 'Skill checks'],
  [/AI screening|human check/i, null, 'Coming soon'],
];
export const stepLink = (s) => { const m = STEP_LINKS.find(([re]) => re.test(s)); return m ? { to: m[1], cta: m[2] } : { to: null, cta: '' }; };

/** The person's level from the server: { d, reload }; d is null while loading and 'failed' when it can't load. */
export function useMyLevel() {
  const [d, setD] = useState(null);
  const reload = useCallback(() => http('/api/me/level').then(setD, () => setD('failed')), []);
  useEffect(() => { reload(); }, [reload]);
  return { d, reload };
}

export function Ladder({ level }) {
  return (
    <ol className="lvl-ladder" aria-label={`Level ${level} of 4`}>
      {[0, 1, 2, 3, 4].map((n) => (
        <li key={n} className={n < level ? 'done' : n === level ? 'now' : ''} aria-current={n === level ? 'step' : undefined}>
          <span className="lvl-rung" aria-hidden="true">{n < level ? '✓' : `L${n}`}</span>
          <span className="lvl-rung-l"><span className="sr-only">L{n} </span>{LABELS[n]}<span className="sr-only">{n < level ? ' (done)' : n === level ? ' (you are here)' : ''}</span></span>
        </li>
      ))}
    </ol>
  );
}

export default function LevelCard() {
  const { d, reload } = useMyLevel();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  if (!d || d === 'failed') return null;
  const up = Math.min(4, d.level + 1);
  const top = d.level >= 4 && !d.next?.length;
  const confirm = async () => {
    setBusy(true); setMsg('');
    try { await http('/api/me/hire/confirm', { method: 'POST' }); await reload(); setMsg('Thanks: companies hiring now will see you as ready for another week.'); }
    catch { setMsg('Turn on “Ready to join” first, then confirm.'); }
    finally { setBusy(false); }
  };
  return (
    <section className="mcard lvl-card" aria-labelledby="lvl-card-h" data-testid="level-card">
      <header className="mcard-h">
        <span className="mcard-ic violet" aria-hidden="true">▲</span>
        <span className="mcard-ht">
          <h2 id="lvl-card-h" className="mcard-title">You are L{d.level} · {d.label}</h2>
          <span className="mcard-sub">Higher levels show first to companies hiring now.</span>
        </span>
        <LevelBadge level={d.level} label={d.label} readyNow={d.readyNow} className="lvl-card-badge" />
      </header>
      <Ladder level={d.level} />
      {top ? <p className="small lvl-top" data-testid="level-top">You are at the top level. Keep “Ready to join” confirmed so companies see you first.</p> : d.next?.length > 0 && (
        <div className="stack g8">
          <strong className="lvl-next-h">Do this to reach L{up} · {LABELS[up]}:</strong>
          <ul className="lvl-next" data-testid="level-next">
            {d.next.map((s) => {
              const { to, cta } = stepLink(s);
              return (
                <li key={s}>
                  {to ? <Link to={to} className="lvl-step"><span className="lvl-step-t">{s}</span><span className="lvl-step-cta">{cta} <span aria-hidden="true">→</span></span></Link>
                    : <span className="lvl-step lvl-step-off"><span className="lvl-step-t">{s}</span><span className="lvl-step-cta">{cta}</span></span>}
                </li>
              );
            })}
          </ul>
        </div>
      )}
      <div className={`lvl-ready ${d.readyNow ? 'on' : ''}`} data-testid="level-ready">
        {d.readyNow ? (
          <span className="small"><strong><span aria-hidden="true">⚡ </span>Ready now.</strong> Companies hiring now see you first for {d.readyDays} days after you confirm.</span>
        ) : (
          <>
            <span className="small"><strong>Not shown as ready now.</strong> Confirm that you can still join so companies see the ⚡.</span>
            <button type="button" className="btn btn-signal lvl-confirm" disabled={busy} onClick={confirm} data-testid="level-confirm">Still looking? Tap to confirm</button>
          </>
        )}
      </div>
      {msg && <p className="small lvl-msg" role="status">{msg}</p>}
    </section>
  );
}
