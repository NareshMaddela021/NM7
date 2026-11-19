// Hiring speed (Phase 5, H9), at the top of the Hire now tab: for each role, minutes from posting to the first
// candidate shown, the first invite accepted, the first interview booked and the first offer sent; the share of roles
// that reached an interview or offer within 60 minutes; the funnel. All from real events. The "Hired in 60 minutes"
// badge shows only when a real role did it. English, Telugu and Hindi (co.speed.*).
// Round P, Phase 3: a "Minute 0 -> 60" timeline card. The four averages sit on a 60-minute track (a step that took
// longer is pinned at the end, with its real minutes); the funnel is a row of number tiles; each role is a mini track.
import { useEffect, useState } from 'react';
import { rq } from '../../lib/company';
import '../../styles/company-hire.css';
import { IcCheck, IcClock } from '../../components/icons';

const STEPS = ['shown', 'accepted', 'interview', 'offer'];
const FUNNEL = ['invited', 'accepted', 'interviews', 'offers', 'offersAccepted', 'joined'];
const pos = (m) => `${Math.max(0, Math.min(60, m)) / 60 * 100}%`;

export default function HireSpeed({ t, c }) {
  const [d, setD] = useState(null);
  useEffect(() => { rq(`/api/company/${c.id}/hire/speed`).then(setD, () => setD(null)); }, [c.id]);
  if (!d || !d.roles) return null;
  const mins = (m) => (m == null ? '—' : t('co.speed.min', { n: m }));
  const avg = STEPS.filter((k) => d.avgMinutes[k] != null);
  return (
    <section className="mcard hs-card" aria-labelledby="co-speed-h" data-testid="co-speed">
      <header className="hs-head">
        <span className="mcard-ic blue" aria-hidden="true"><IcClock /></span>
        <span className="hs-head-text">
          <strong id="co-speed-h" className="mcard-title">{t('co.speed.title')}</strong>
          <span className="mcard-sub" data-testid="co-speed-pct">{t('co.speed.pct', { pct: d.in30Pct, n: d.in30, total: d.roles })}</span>
        </span>
        {d.badge && <span className="mchip mchip-ok" data-testid="co-speed-badge">{t('co.speed.badge')}</span>}
      </header>

      <div className="hs-track-wrap">
        <span className="mkicker">{t('co.speed.avg')}</span>
        <div className="hs-track" aria-hidden="true">
          <span className="hs-rail"><span style={{ width: pos(Math.max(0, ...avg.map((k) => d.avgMinutes[k]))) }} /></span>
          {STEPS.map((k, i) => d.avgMinutes[k] != null && (
            <span key={k} className={`hs-dot ${d.avgMinutes[k] <= 60 ? 'hs-dot-in' : ''}`} style={{ left: pos(d.avgMinutes[k]) }}>{i + 1}</span>
          ))}
        </div>
        <span className="hs-ticks" aria-hidden="true"><span>{t('co.speed.min', { n: 0 })}</span><span>{t('co.speed.min', { n: 30 })}</span><span>{t('co.speed.min', { n: 60 })}</span></span>
        <ol className="hs-legend">
          {STEPS.map((k, i) => {
            const m = d.avgMinutes[k];
            return (
              <li key={k} className={`hs-step ${m == null ? 'hs-step-none' : ''} ${m != null && m <= 60 ? 'hs-step-in' : ''}`}>
                <span className="hs-step-n" aria-hidden="true">{i + 1}</span>
                <span className="hs-step-label">{t(`co.speed.step.${k}`)}</span>
                <strong className="hs-step-min">{mins(m)}</strong>
              </li>
            );
          })}
        </ol>
      </div>

      <ol className="hs-funnel">
        {FUNNEL.map((k) => <li key={k}><strong>{d.funnel[k]}</strong><span>{t(`co.speed.f.${k}`)}</span></li>)}
      </ol>

      {d.items.some((r) => r.minutes.shown != null) && (
        <ul className="hs-roles">
          {d.items.filter((r) => r.minutes.shown != null).map((r) => (
            <li key={r.id} className="hs-role" data-testid="co-speed-role">
              <span className="hs-role-top"><strong>{r.title}</strong>{r.in30 && <span className="mchip mchip-ok"><IcCheck size={14} /> 60</span>}</span>
              <span className="hs-mini" aria-hidden="true">
                {STEPS.filter((k) => r.minutes[k] != null).map((k, i) => <span key={k} className="hs-mini-dot" style={{ left: pos(r.minutes[k]) }}>{i + 1}</span>)}
              </span>
              <span className="hs-role-line">{STEPS.map((k) => `${t(`co.speed.step.${k}`)} ${mins(r.minutes[k])}`).join(' · ')}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
