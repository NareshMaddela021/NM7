// Company account → Settings → "Verify your business" (Vetting Trust T4). Only where the Trust switch lets this company
// in (GET /api/company/{id}/trust/employer answers 404 otherwise, and nothing shows). The company enters its GSTIN, Udyam
// (MSME) number or CIN; Nm7 checks the format first, then looks it up in the registry. Active + the same name → the
// "Verified employer" badge on its jobs and page; anything else goes to a person at Nm7 (never a rejection), and the
// card says plainly what didn't match. English only for now.
import { useCallback, useEffect, useState } from 'react';
import { rq } from '../../lib/company';
import { Chip } from '../me/kit';

const day = (v) => (v ? new Date(v).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '');
const TONE = { verified: 'ok', review: 'warn', not_verified: 'bad', none: 'neutral' };
const HINT = { gstin: '15 characters, like 27AAPFU0939F1ZV', udyam: 'Like UDYAM-TS-02-0001234', cin: '21 characters, like U72900TG2019PTC123456' };

export default function VerifyBusiness({ c, manage }) {
  const [d, setD] = useState(null);
  const [f, setF] = useState({ kind: 'gstin', number: '', agree: false });
  const [st, setSt] = useState({});
  const load = useCallback(() => rq(`/api/company/${c.id}/trust/employer`).then((x) => {
    setD(x);
    if (x.suggest) setF((v) => (v.number ? v : { ...v, kind: x.suggest.kind, number: x.suggest.number }));
  }, () => setD(null)), [c.id]);
  useEffect(() => { load(); }, [load]);
  if (!d) return null;
  const s = d.state;
  const send = async (e) => {
    e.preventDefault();
    if (!f.agree) { setSt({ error: 'Please tick that Nm7 may look this number up.' }); return; }
    setSt({ busy: true });
    try { setD(await rq(`/api/company/${c.id}/trust/employer`, { method: 'POST', body: f })); setSt({}); } catch (x) { setSt({ error: x.message }); }
  };
  const remove = async () => {
    setSt({ busy: true });
    try { setD(await rq(`/api/company/${c.id}/trust/employer`, { method: 'DELETE' })); setSt({}); } catch (x) { setSt({ error: x.message }); }
  };
  return (
    <section className="mcard" aria-labelledby="vb-h" data-testid="co-verify-business" style={{ minWidth: 0 }}>
      <header className="mcard-h"><span className="mcard-ic" aria-hidden="true">✓</span><span className="mcard-ht">
        <h2 id="vb-h" className="mcard-title">Verify your business</h2>
        <span className="mcard-sub">Candidates see “✓ Verified employer” on your jobs and company page once your GST, Udyam (MSME) or company (MCA) registration is checked.</span>
      </span></header>
      <span className="row g8" style={{ flexWrap: 'wrap', alignItems: 'center' }}>
        <Chip tone={TONE[s.status]} data-testid="vb-state">{s.status === 'verified' ? '✓ ' : ''}{s.statusText}{s.status === 'verified' && s.registry ? ` · ${s.registry}` : ''}{s.test ? ' (test)' : ''}</Chip>
        {s.numberMasked && <span className="xs muted mono" data-testid="vb-number">{s.kindText}: {s.numberMasked}</span>}
      </span>
      {s.facts?.found && (
        <dl className="ch-facts" data-testid="vb-facts">
          <div className="ch-fact"><dt>Registered name</dt><dd>{s.facts.legalName || s.facts.tradeName}</dd></div>
          <div className="ch-fact"><dt>Status in the registry</dt><dd style={{ textTransform: 'capitalize' }}>{s.facts.status}</dd></div>
          {s.facts.registeredOn && <div className="ch-fact"><dt>Registered on</dt><dd>{day(s.facts.registeredOn)}</dd></div>}
          {(s.facts.city || s.facts.state) && <div className="ch-fact"><dt>Place</dt><dd>{[s.facts.city, s.facts.state].filter(Boolean).join(', ')}</dd></div>}
          <div className="ch-fact"><dt>Checked</dt><dd>{day(s.checkedAt)}{s.status === 'verified' && s.nextCheckAt ? ` · next check ${day(s.nextCheckAt)}` : ''}</dd></div>
        </dl>
      )}
      {s.reasons?.length > 0 && s.status !== 'verified' && (
        <div className="mcard mcard-warn mcard-tight" role="status" data-testid="vb-reasons">
          <ul className="small" style={{ margin: 0, paddingLeft: 18 }}>{s.reasons.map((r) => <li key={r}>{r}</li>)}</ul>
          {s.reviewNote && <span className="small">{s.reviewNote}</span>}
          {s.review?.note && <span className="small"><strong>Nm7:</strong> {s.review.note}</span>}
        </div>
      )}
      {!d.provider.ready && <p className="small" role="status" style={{ margin: 0 }}>Business verification isn’t connected yet.</p>}
      {manage && d.provider.ready && s.status !== 'verified' && (
        <form className="stack g8" onSubmit={send} noValidate data-testid="vb-form">
          <div className="row g8" style={{ flexWrap: 'wrap' }}>
            <div className="field" style={{ flex: '1 1 160px' }}><label className="label" htmlFor="vb-kind">Registration</label>
              <select id="vb-kind" className="input" value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value })} data-testid="vb-kind">{d.kinds.map((k) => <option key={k.key} value={k.key}>{k.title}</option>)}</select></div>
            <div className="field" style={{ flex: '2 1 220px' }}><label className="label" htmlFor="vb-number">Number</label>
              <input id="vb-number" className="input mono" autoCapitalize="characters" spellCheck={false} maxLength={40} value={f.number} onChange={(e) => setF({ ...f, number: e.target.value })} aria-describedby="vb-hint" data-testid="vb-number-input" />
              <span id="vb-hint" className="xs muted">{HINT[f.kind]}</span></div>
          </div>
          <label className="row g8 small" style={{ alignItems: 'flex-start', flexWrap: 'nowrap', minHeight: 44 }}>
            <input type="checkbox" checked={f.agree} onChange={(e) => setF({ ...f, agree: e.target.checked })} style={{ marginTop: 3, width: 18, height: 18, flex: 'none' }} data-testid="vb-agree" />
            <span>{d.consentText}</span>
          </label>
          {st.error && <p className="error" role="alert" style={{ margin: 0 }}>{st.error}</p>}
          <button type="submit" className="btn btn-signal" style={{ alignSelf: 'flex-start', minHeight: 44 }} disabled={st.busy || f.number.trim().length < 6} data-testid="vb-send">{st.busy ? 'Checking…' : s.status === 'none' ? 'Check my business' : 'Check again'}</button>
        </form>
      )}
      {manage && s.status !== 'none' && <button type="button" className="link-btn small" style={{ alignSelf: 'flex-start', minHeight: 44 }} disabled={st.busy} onClick={remove} data-testid="vb-remove">Remove this check</button>}
      {!manage && <p className="small muted" style={{ margin: 0 }}>Only the company’s main or full admins can change this.</p>}
    </section>
  );
}
