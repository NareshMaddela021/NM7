// Dashboard: "Resume health" — small things to fix, each with one button that opens the exact place, and a ✕ to
// dismiss it. The same alerts go out by email at most once every two weeks (switch off in Settings).
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { http, LIVE } from '../../services/http';

export default function HealthCard() {
  const [alerts, setAlerts] = useState(null);
  useEffect(() => {
    if (!LIVE) return undefined;
    let on = true;
    http('/api/me/health').then((d) => on && setAlerts(d.alerts || []), () => on && setAlerts([]));
    return () => { on = false; };
  }, []);
  if (!alerts?.length) return null;
  const dismiss = async (id) => {
    setAlerts((a) => a.filter((x) => x.id !== id));
    try { setAlerts((await http('/api/me/health/dismiss', { method: 'POST', body: { id } })).alerts); } catch { /* shown again next time */ }
  };
  return (
    <section className="card stack g12" aria-labelledby="health-h" data-testid="health-card">
      <div className="row between g8" style={{ alignItems: 'baseline', flexWrap: 'wrap' }}>
        <h2 id="health-h" className="h3" style={{ margin: 0 }}>Resume health</h2>
        <span className="xs muted">{alerts.length} thing{alerts.length > 1 ? 's' : ''} to fix</span>
      </div>
      <ul className="stack g8" style={{ listStyle: 'none', margin: 0, padding: 0 }}>
        {alerts.map((a) => (
          <li key={a.id} className="well row g8" style={{ alignItems: 'flex-start', flexWrap: 'wrap' }} data-testid={`health-${a.kind}`}>
            <span className="stack g4" style={{ flex: '1 1 220px', minWidth: 0 }}>
              <strong className="small">{a.title}</strong>
              <span className="xs muted">{a.text}</span>
            </span>
            <span className="row g8" style={{ alignItems: 'center' }}>
              <Link to={a.fix.path} className="btn btn-outline" style={{ minHeight: 36 }} data-testid={`health-fix-${a.kind}`}>{a.fix.label}</Link>
              <button type="button" className="btn btn-icon" aria-label={`Dismiss: ${a.title}`} onClick={() => dismiss(a.id)} data-testid={`health-dismiss-${a.kind}`}>✕</button>
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
