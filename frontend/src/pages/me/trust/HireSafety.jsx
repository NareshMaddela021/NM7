// Vetting Trust T4 for candidates on their dashboard (one lazy chunk; only rendered when the Trust switch lets this
// person in, useTrustOn). One GET /api/me/trust/employer per page.
//   HireSafety (default): on Ready to join (MeHire), on each interview invite and offer from a company, the "Verified
//     employer" badge (when its business registration was checked), the "Never pay" promise and "Report fraud".
//   NeverPayHelp: Help & referral → "Never pay for a job on Nm7": the promise and what to do if anyone asks for money.
import { useEffect, useState } from 'react';
import { http } from '../../../services/http';
import { EmployerBadge, FraudReport, NeverPay } from '../../jobs/EmployerTrust';
import { MeCard } from '../kit';

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

export function NeverPayHelp() {
  const [d, setD] = useState(null);
  useEffect(() => { let live = true; load().then((x) => { if (live) setD(x); }); return () => { live = false; }; }, []);
  if (!d) return null;
  return (
    <MeCard as="section" id="never-pay" label="Never pay for a job" icon="🛡" title="Never pay for a job on Nm7" testid="never-pay-card"
      sub={d.promise.split('. ').slice(1).join('. ')}>
      <ol className="stack g8 small" style={{ margin: 0, paddingLeft: 18 }}>{d.help.map((h) => <li key={h}>{h}</li>)}</ol>
      <p className="xs muted" style={{ margin: 0 }}>Look for <strong>✓ Verified employer</strong> on jobs, companies, invites and offers: it means Nm7 checked the company’s business registration in the GST, Udyam or MCA registry. It doesn’t mean a job is right for you, and even a verified company may never ask you for money.</p>
    </MeCard>
  );
}
