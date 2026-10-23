// "LinkedIn" on My dashboard: the latest check (score, top 3 fixes, Re-check), or "Create your LinkedIn" for someone
// who started a new profile, or a free check for someone who hasn't tried it yet.
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { canSave, getLinkedIn } from '../../lib/linkedin/api';

export default function LinkedInCard() {
  const [rec, setRec] = useState(undefined);
  useEffect(() => {
    let off = false;
    if (!canSave()) { setRec(null); return undefined; }
    getLinkedIn().then((r) => { if (!off) setRec(r?.updatedAt ? r : null); }).catch(() => { if (!off) setRec(null); });
    return () => { off = true; };
  }, []);
  if (rec === undefined) return null;
  const score = rec?.path === 'fix' ? rec.result?.score : undefined;
  return (
    <section className="card stack g12" style={{ flex: '1 1 300px' }} aria-label="LinkedIn" data-testid="me-linkedin">
      <div className="row between"><strong>LinkedIn</strong><Link to="/linkedin" className="small">Open →</Link></div>
      {typeof score === 'number' ? (
        <>
          <span className="small">Latest score <strong data-testid="me-li-score" style={{ fontSize: 20 }}>{score}</strong>/100</span>
          {rec.result.top?.length ? (
            <ol className="stack g4 small" style={{ margin: 0, paddingLeft: 18 }} data-testid="me-li-fixes">
              {rec.result.top.slice(0, 3).map((t) => <li key={t.id}><strong>{t.title}:</strong> {t.what}</li>)}
            </ol>
          ) : <span className="small muted">No fixes left. Keep it as it is.</span>}
          <Link to="/linkedin?path=fix" className="btn btn-outline" style={{ alignSelf: 'flex-start' }}>Re-check</Link>
        </>
      ) : rec?.path === 'create' ? (
        <>
          <span className="small muted">{rec.result?.headlines?.length || 0} headline options and your step-by-step guide are ready.</span>
          <Link to="/linkedin?path=create" className="btn btn-outline" style={{ alignSelf: 'flex-start' }}>Create your LinkedIn</Link>
        </>
      ) : (
        <>
          <span className="small muted">Get a free score and fixes for your profile, or headlines and a guide to create one.</span>
          <span className="row g8" style={{ flexWrap: 'wrap' }}>
            <Link to="/linkedin?path=fix" className="btn btn-outline">Check my LinkedIn</Link>
            <Link to="/linkedin?path=create" className="btn btn-ghost">Create your LinkedIn</Link>
          </span>
        </>
      )}
    </section>
  );
}
