// /linkedin: free LinkedIn help. "I have a LinkedIn profile" → the check (FixPath); "I don't have one yet" → the
// headlines and the guide (CreatePath). Signed-in customers keep their latest check on their account.
import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import Header from '../../components/Header';
import SiteFooter from '../../components/SiteFooter';
import { useAuth } from '../../lib/auth';
import { canSave, getLinkedIn } from '../../lib/linkedin/api';
import CreatePath from './CreatePath';
import FixPath from './FixPath';

const PATHS = [['fix', 'I have a LinkedIn profile', 'Get a free score and fixes'], ['create', 'I don’t have one yet', 'Get headlines and a step-by-step guide']];

export default function LinkedIn() {
  const [params, setParams] = useSearchParams();
  const auth = useAuth();
  const [saved, setSaved] = useState(undefined); // undefined: loading; null: none
  const path = params.get('path') === 'fix' || params.get('path') === 'create' ? params.get('path') : '';
  useEffect(() => {
    let off = false;
    if (!canSave()) { setSaved(null); return undefined; }
    getLinkedIn().then((r) => { if (!off) setSaved(r?.updatedAt ? r : null); }).catch(() => { if (!off) setSaved(null); });
    return () => { off = true; };
  }, [auth.user?.id]);
  const pick = (p) => setParams(p ? { path: p } : {}, { replace: false });
  const chosen = path || (saved?.path || '');

  return (
    <>
      <Header />
      <main id="main" className="container stack g20" style={{ padding: '32px 16px 72px', maxWidth: 860 }}>
        <div className="stack g8">
          <h1 className="h2" style={{ margin: 0 }}>LinkedIn, made simple</h1>
          <p className="muted" style={{ margin: 0 }}>Free. We never ask for your LinkedIn password and never open your LinkedIn account.</p>
        </div>
        <div className="row g12" role="group" aria-label="Your LinkedIn" style={{ flexWrap: 'wrap' }}>
          {PATHS.map(([id, title, sub]) => (
            <button key={id} type="button" className="card stack g4" aria-pressed={chosen === id} data-testid={`li-path-${id}`} onClick={() => pick(id)}
              style={{ flex: '1 1 240px', textAlign: 'left', cursor: 'pointer', font: 'inherit', color: 'inherit', borderColor: chosen === id ? 'var(--ink)' : undefined, borderWidth: chosen === id ? 2 : undefined, minHeight: 88 }}>
              <strong style={{ fontSize: 17 }}>{title}</strong>
              <span className="small muted">{sub}</span>
            </button>
          ))}
        </div>
        {saved !== undefined && chosen === 'fix' && <FixPath key="fix" saved={saved?.path === 'fix' || saved?.url ? saved : null} />}
        {saved !== undefined && chosen === 'create' && <CreatePath key="create" saved={saved?.path === 'create' ? saved : null} />}
      </main>
      <SiteFooter />
    </>
  );
}
