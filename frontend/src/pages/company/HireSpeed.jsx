// Hiring speed (Phase 5, H9), at the top of the Hire now tab: for each role, minutes from posting to the first
// candidate shown, the first invite accepted, the first interview booked and the first offer sent; the share of roles
// that reached an interview or offer within 60 minutes; the funnel. All from real events. The "Hired in 60 minutes"
// badge shows only when a real role did it. English, Telugu and Hindi (co.speed.*).
import { useEffect, useState } from 'react';
import { rq } from '../../lib/company';

const STEPS = ['shown', 'accepted', 'interview', 'offer'];
const FUNNEL = ['invited', 'accepted', 'interviews', 'offers', 'offersAccepted', 'joined'];

export default function HireSpeed({ t, c }) {
  const [d, setD] = useState(null);
  useEffect(() => { rq(`/api/company/${c.id}/hire/speed`).then(setD, () => setD(null)); }, [c.id]);
  if (!d || !d.roles) return null;
  const mins = (m) => (m == null ? '—' : t('co.speed.min', { n: m }));
  return (
    <details className="card-sm" data-testid="co-speed">
      <summary className="small">
        <strong>{t('co.speed.title')}</strong> · <span data-testid="co-speed-pct">{t('co.speed.pct', { pct: d.in30Pct, n: d.in30, total: d.roles })}</span>
        {d.badge && <> · <span className="badge b-success" data-testid="co-speed-badge">{t('co.speed.badge')}</span></>}
      </summary>
      <div className="stack g8" style={{ marginTop: 8 }}>
        <span className="xs muted">{t('co.speed.avg')}: {STEPS.map((k) => `${t(`co.speed.step.${k}`)} ${mins(d.avgMinutes[k])}`).join(' · ')}</span>
        <span className="xs muted">{FUNNEL.map((k) => `${t(`co.speed.f.${k}`)} ${d.funnel[k]}`).join(' → ')}</span>
        <ul className="stack g4" style={{ listStyle: 'none', padding: 0, margin: 0 }}>
          {d.items.filter((r) => r.minutes.shown != null).map((r) => (
            <li key={r.id} className="small" data-testid="co-speed-role"><strong>{r.title}</strong>{r.in30 ? ' ✓' : ''}: {STEPS.map((k) => `${t(`co.speed.step.${k}`)} ${mins(r.minutes[k])}`).join(' · ')}</li>
          ))}
        </ul>
      </div>
    </details>
  );
}
