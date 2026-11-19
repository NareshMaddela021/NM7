// "Pick up where you left off": on the job seeker and student dashboards, while the role's quick start was started
// and not finished. An admin's persona (a view that isn't read-only) gets "Walk through quick start" instead.
// Shows nothing otherwise (and nothing when the request fails).
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { MeCard } from '../me/kit';
import { getSetup, startPath } from '../../lib/quickStart';

export default function ResumeCard({ user, role }) {
  const [s, setS] = useState(null);
  useEffect(() => { let dead = false; getSetup(role).then((x) => { if (!dead) setS(x); }, () => {}); return () => { dead = true; }; }, [role]);
  const persona = !!user?.view && !user.view.readOnly;
  if (!s || (!persona && (s.done || !s.startedAt || !s.pending))) return null;
  const left = s.pending;
  return (
    <MeCard tone="accent" icon="➜" title={persona ? 'Walk through the quick start' : 'Pick up where you left off'} sub={persona ? 'See the questions a new person answers, then their first results.' : `${left} quick question${left === 1 ? '' : 's'} left, then your first results.`} testid="qs-resume-card">
      <Link to={startPath(role, persona)} className="btn btn-ink" style={{ alignSelf: 'flex-start' }}>{persona ? 'Walk through' : 'Continue'}</Link>
    </MeCard>
  );
}
