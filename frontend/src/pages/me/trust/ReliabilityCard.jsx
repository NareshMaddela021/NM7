// Vetting Trust T15: "Your reliability record" on My hiring (lazy; only for people the Trust switch lets in — the
// server answers 404 to everyone else and this card shows nothing). The consent in plain words (show it to companies
// or not; taking it back deletes the record), the summary companies see ("Showed up 4/4 · Joined 2/2 · confirmed by
// employers", or "No history yet", never a negative), each record with its state, the 48-hour chance to say what
// happened before a company's "no" counts, disputes (a person at Nm7 checks) and "I'm still working there".
import { useEffect, useState } from 'react';
import { http } from '../../../services/http';
import { MeCard } from '../kit';
import { RelItems } from './ReliabilityLink';

const API = '/api/me/trust/reliability';

export default function ReliabilityCard() {
  const [d, setD] = useState(null);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const load = () => http(API).then(setD, () => setD(false));
  useEffect(() => { load(); }, []);
  if (!d) return null;
  const on = d.consent.status === 'granted';
  const toggle = async () => {
    setBusy(true); setErr('');
    try { await http(`/api/me/trust/consents/reliability_record`, { method: on ? 'DELETE' : 'POST' }); await load(); } catch (e) { setErr(e.message); } finally { setBusy(false); }
  };
  return (
    <MeCard icon="🤝" title="Your reliability record" sub="Showed up, joined and stayed, as confirmed by employers. A signal for companies, never a reason to turn anyone down." testid="rel-card" headingLevel={2}>
      <details className="small" data-testid="rel-consent-text"><summary>What this is and how it works</summary><p style={{ margin: '8px 0 0' }}>{d.consent.text}</p></details>
      <label className="vet-check">
        <input type="checkbox" checked={on} disabled={busy} onChange={toggle} data-testid="rel-consent" />
        <span>Show my reliability record to companies hiring on Nm7{on ? '' : ' (off: nothing is kept or shown)'}</span>
      </label>
      {err && <p className="error" role="alert">{err}</p>}
      {on && <RelItems d={d} onAnswer={async (id, why, text) => setD(await http(`${API}/${encodeURIComponent(id)}/answer`, { method: 'POST', body: { why, text } }))}
        onStay={async (offer, days) => setD(await http(`${API}/stay`, { method: 'POST', body: { offer, days } }))} />}
    </MeCard>
  );
}
