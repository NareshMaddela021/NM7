// Vetting V2: the "Skill verified" line on a Hire now card and in a candidate's profile: test, experience band, test
// score, practical task stars and the month it was earned. An expired badge is muted. Companies only ever get the
// badge and scores (never any integrity information: the API does not send it).
import { badgeLine } from '../../lib/vettingRoles';
import '../../styles/company-hire.css';

export default function SkillBadge({ sv, t }) {
  if (!sv) return null;
  const title = sv.expired ? t('co.hire.sv.expiredTip') : sv.forThisJob ? t('co.hire.sv.tip') : t('co.hire.sv.otherTip');
  return (
    <p className={`sv-badge ${sv.expired ? 'sv-expired' : ''}`} data-testid="co-hire-sv" title={title}>
      <span>{badgeLine(sv)}</span>
      <span className="sr-only"> ({title})</span>
    </p>
  );
}
