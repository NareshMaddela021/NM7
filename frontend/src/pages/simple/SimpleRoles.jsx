// /me/simple/roles (Phase 6, S1): the role finder in the easy dashboard. Its own small chunk, loaded when it opens.
// It shows the three roles with their reasons; the ten questions open on the full page (/me/roles).
import { useEffect } from 'react';
import { useScreen } from '../../lib/simple';
import { Big, WaitNote } from './SimpleApp';

export default function SimpleRoles({ t, setSay }) {
  const [d, err] = useScreen('/api/me/roles');
  const roles = d?.roles || [];
  useEffect(() => { if (d) setSay([['simple.rf.title'], ...(roles.length ? [] : [['simple.rf.none']])]); }, [d]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!d) return <WaitNote t={t} err={err} />;
  return (
    <section className="sx-stack" aria-labelledby="sx-r-h" data-testid="sx-roles">
      <h1 id="sx-r-h" className="sx-h1">{t('simple.rf.title')}</h1>
      {!roles.length && <p className="sx-p">{t('simple.rf.none')}</p>}
      {roles.map((r, i) => (
        <div key={r.id} className="sx-next" data-testid="sx-role">
          <strong className="sx-p">{i + 1}. {r.title}</strong>
          <p className="sx-hint">{r.why}</p>
          {r.jobs.length > 0 && <p className="sx-note">{t('simple.rf.jobs', { n: r.jobs.length })}</p>}
        </div>
      ))}
      <Big to="/me/roles" icon={roles.length ? '✏️' : '🎯'} label={t(roles.length ? 'simple.rf.change' : 'simple.rf.start')} ink={!roles.length} testid="sx-roles-go" />
      <Big to="/me/simple" icon="←" label={t('simple.back')} />
    </section>
  );
}
