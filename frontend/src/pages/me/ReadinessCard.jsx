// The job readiness score on the full dashboard (Phase 4, E5): the same score as the Easy dashboard, small, with the
// next thing to do. Only the person sees it; it is never compared with anyone.
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useLang } from '../../lib/i18n';
import { http } from '../../services/http';

export default function ReadinessCard() {
  const [t] = useLang();
  const [r, setR] = useState(null);
  useEffect(() => { http('/api/me/simple/readiness').then(setR, () => {}); }, []);
  if (!r) return null;
  const next = r.left[0];
  return (
    <section className="card row g16" style={{ flex: '1 1 300px', alignItems: 'center' }} aria-label={t('simple.ready.card')} data-testid="readiness-card">
      <svg width="64" height="64" viewBox="0 0 100 100" aria-hidden="true" style={{ flex: 'none' }}>
        <circle cx="50" cy="50" r="42" fill="none" stroke="var(--border2)" strokeWidth="12" />
        <circle cx="50" cy="50" r="42" fill="none" stroke="var(--success)" strokeWidth="12" strokeLinecap="round" strokeDasharray={`${(264 * r.score) / 100} 264`} transform="rotate(-90 50 50)" />
      </svg>
      <div className="stack g4" style={{ flex: 1, minWidth: 180 }}>
        <strong>{t('simple.ready.card')}: {r.score}%</strong>
        {next ? <Link to={next.path} className="small" data-testid="readiness-next">{t('simple.ready.next', { thing: t(`simple.ready.item.${next.key}`) })} →</Link> : <span className="small muted">{t('simple.ready.done')}</span>}
        <span className="xs muted">{t('simple.ready.private')}</span>
      </div>
    </section>
  );
}
