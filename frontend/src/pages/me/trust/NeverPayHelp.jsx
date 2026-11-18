// Help & referral → "Never pay for a job on Nm7" (Vetting Trust T4): the promise in plain words and what to do if anyone
// asks for money. Lazy; only for people the Trust switch lets in (useTrustOn in MeHelp). GET /api/me/trust/employer.
import { useEffect, useState } from 'react';
import { http } from '../../../services/http';
import { MeCard } from '../kit';

export default function NeverPayHelp() {
  const [d, setD] = useState(null);
  useEffect(() => { http('/api/me/trust/employer').then(setD, () => setD(null)); }, []);
  if (!d) return null;
  return (
    <MeCard as="section" id="never-pay" label="Never pay for a job" icon="🛡" title="Never pay for a job on Nm7" testid="never-pay-card"
      sub={d.promise.split('. ').slice(1).join('. ')}>
      <ol className="stack g8 small" style={{ margin: 0, paddingLeft: 18 }}>{d.help.map((h) => <li key={h}>{h}</li>)}</ol>
      <p className="xs muted" style={{ margin: 0 }}>Look for <strong>✓ Verified employer</strong> on jobs, companies, invites and offers: it means Nm7 checked the company’s business registration in the GST, Udyam or MCA registry. It doesn’t mean a job is right for you, and even a verified company may never ask you for money.</p>
    </MeCard>
  );
}
