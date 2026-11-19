// Profile & settings -> Job requirements (Vetting Trust T7). Rendered by PrivacyConsent (same lazy chunk), so only for
// people who get Vetting Trust. GET /api/me/trust/criteria. For each job I applied to that lists requirements: what I
// was checked on, Met / Not met / Unknown, and the exact words it came from (my own evidence only, never anyone
// else's). I can add evidence: a certificate from my wallet (Profile -> Certificates), which counts only after Nm7 has
// checked it; a document verified with DigiLocker or a skill check counts by itself. Needs the "Matching you to a
// job's requirements" consent (asked here; taken back in Privacy & consent). English only while it is tested.
import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useToast } from '../../../components/ui';
import { http } from '../../../services/http';
import { MeCard } from '../kit';
import { IcCheckCircle } from '../../../components/icons';

const WORD = { met: 'Met', not_met: 'Not met', unknown: 'Unknown' };
const TONE = { met: 'ok', not_met: 'warn', unknown: 'neutral' };
const STATE = { pending: 'Waiting for Nm7 to check', verified: 'Checked: counts as evidence', rejected: 'Not accepted' };

function AddEvidence({ app, item, certs, onDone }) {
  const [cert, setCert] = useState(certs[0]?.id || '');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  if (!certs.length) {
    return <p className="xs" style={{ margin: 0 }}>Add the certificate in <Link to="/me/certificates">Profile > Certificates</Link> first, then pick it here. A document verified with DigiLocker (below) or a <Link to="/me/skill-checks">skill check</Link> counts by itself.</p>;
  }
  const send = async (e) => {
    e.preventDefault();
    setBusy(true); setErr('');
    try { await http('/api/me/trust/criteria/claims', { method: 'POST', body: { jobId: app.jobId, criterionId: item.id, certId: cert, note } }); onDone(); } catch (x) { setErr(x.message); } finally { setBusy(false); }
  };
  return (
    <form className="row g8" style={{ flexWrap: 'wrap', alignItems: 'flex-end' }} onSubmit={send} data-testid="cr-add-form">
      <div className="field" style={{ flex: '1 1 200px', minWidth: 0 }}>
        <label className="label" htmlFor={`cr-c-${app.appId}-${item.id}`}>Certificate</label>
        <select id={`cr-c-${app.appId}-${item.id}`} className="input" value={cert} onChange={(e) => setCert(e.target.value)} data-testid="cr-cert">
          {certs.map((c) => <option key={c.id} value={c.id}>{c.title}{c.issuer ? ` – ${c.issuer}` : ''}</option>)}
        </select>
      </div>
      <div className="field" style={{ flex: '1 1 200px', minWidth: 0 }}>
        <label className="label" htmlFor={`cr-n-${app.appId}-${item.id}`}>Note (optional)</label>
        <input id={`cr-n-${app.appId}-${item.id}`} className="input" maxLength={300} value={note} onChange={(e) => setNote(e.target.value)} />
      </div>
      <button type="submit" className="btn btn-outline" style={{ minHeight: 44 }} disabled={busy || !cert} data-testid="cr-send">Send for checking</button>
      {err && <p className="error" role="alert" style={{ flexBasis: '100%' }}>{err}</p>}
    </form>
  );
}

export default function CriteriaCard() {
  const toast = useToast();
  const [d, setD] = useState(null);
  const [adding, setAdding] = useState('');
  const [busy, setBusy] = useState(false);
  const load = useCallback(() => http('/api/me/trust/criteria').then(setD, () => setD(null)), []);
  useEffect(() => {
    load();
    window.addEventListener('trust-consent', load);
    return () => window.removeEventListener('trust-consent', load);
  }, [load]);
  if (!d) return null;
  const agree = async () => {
    setBusy(true);
    try { await http('/api/me/trust/consents/criteria_match', { method: 'POST' }); window.dispatchEvent(new Event('trust-consent')); toast('Saved'); } catch (x) { toast(x.message); } finally { setBusy(false); }
  };
  const remove = async (id) => { try { await http(`/api/me/trust/criteria/claims/${id}`, { method: 'DELETE' }); load(); } catch (x) { toast(x.message); } };
  return (
    <MeCard as="section" id="s-criteria" className="acc-sec" label="Job requirements" icon={<IcCheckCircle />} title="Job requirements you were checked on" testid="cr-card"
      sub="Companies see, for each requirement of their job, Met, Not met or Unknown with the words it came from. It is only a label: nobody is rejected because of it.">
      {!d.consent ? (
        <div className="stack g8" data-testid="cr-consent">
          <p className="small" style={{ margin: 0 }}>{d.consentText}</p>
          <div><button type="button" className="btn btn-outline" style={{ minHeight: 44 }} disabled={busy} onClick={agree} data-testid="cr-agree">I agree: match me to job requirements</button></div>
        </div>
      ) : d.applications.length === 0 ? (
        <p className="small muted" style={{ margin: 0 }} data-testid="cr-none">When you apply to a job that lists requirements, you will see here what you were checked on.</p>
      ) : (
        <ul className="stack g12" style={{ margin: 0, padding: 0, listStyle: 'none' }}>
          {d.applications.map((a) => (
            <li key={a.appId} className="stack g8" data-testid="cr-app">
              <strong className="small" style={{ overflowWrap: 'anywhere' }}>{a.job}{a.company ? ` · ${a.company}` : ''}</strong>
              <ul className="stack g8" style={{ margin: 0, padding: 0, listStyle: 'none' }}>
                {a.items.map((x) => {
                  const k = `${a.appId}:${x.id}`;
                  const mine = d.claims.filter((c) => c.jobId === a.jobId && c.criterion === x.text);
                  return (
                    <li key={x.id} className="xs stack g4" style={{ overflowWrap: 'anywhere' }} data-testid="cr-item">
                      <span><span className={`mchip mchip-${TONE[x.status]}`} style={{ minHeight: 0 }} data-testid="cr-status">{WORD[x.status]}</span>{' '}
                        <strong>{x.text}</strong>{x.must ? ' · must-have' : ''}
                        {x.quote ? <> · {x.sourceLabel}: <q>{x.quote}</q></> : <span className="muted"> · no evidence found</span>}</span>
                      {mine.map((c) => (
                        <span key={c.id} className="muted" data-testid="cr-claim">Your evidence: {c.title} · {STATE[c.status]}{c.reviewNote ? ` (${c.reviewNote})` : ''}{c.status === 'pending' && <> · <button type="button" className="link-btn xs" onClick={() => remove(c.id)}>Remove</button></>}</span>
                      ))}
                      {x.status !== 'met' && (adding === k
                        ? <AddEvidence app={a} item={x} certs={d.certificates} onDone={() => { setAdding(''); toast('Sent: Nm7 will check it'); load(); }} />
                        : <span><button type="button" className="link-btn xs" onClick={() => setAdding(k)} data-testid="cr-add">Add evidence</button></span>)}
                    </li>
                  );
                })}
              </ul>
            </li>
          ))}
        </ul>
      )}
    </MeCard>
  );
}
