// Vetting Trust T4 on Ready to join (MeHire): on each interview invite and offer from a company, the "Verified employer"
// badge (when its business registration was checked), the "Never pay" promise and "Report fraud". Lazy, and only
// rendered when the Trust switch lets this person in (useTrustOn in MeHire). One GET /api/me/trust/employer per page.
import { useEffect, useState } from 'react';
import { http } from '../../../services/http';
import { EmployerBadge, FraudReport, NeverPay } from '../../jobs/EmployerTrust';

let asked = null;
const load = () => { if (!asked) asked = http('/api/me/trust/employer').catch(() => null); return asked; };

/** promise: just the promise line (top of the invites / offers cards); else the badge + report for one item. */
export default function HireSafety({ promise = false, context, id, companyId }) {
  const [d, setD] = useState(null);
  useEffect(() => { let live = true; load().then((x) => { if (live) setD(x); }); return () => { live = false; }; }, []);
  if (!d) return null;
  if (promise) return <NeverPay safety={d} />;
  return (
    <div className="stack g4" style={{ minWidth: 0 }} data-testid={`hire-safety-${context}`}>
      <EmployerBadge v={d.badges?.[companyId]} chip />
      <FraudReport safety={d} context={context} id={id} label={context === 'offer' ? 'Report this offer' : 'Report this invite'} />
    </div>
  );
}
