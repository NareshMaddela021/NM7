// Admin -> Skill checks -> Vetting Trust -> DigiLocker documents (T2; owner only, the "settings" permission). One card:
//   the provider (the test provider or Setu DigiLocker), whether each key is set (never the value: keys live in Render
//   env vars, docs/trust/T2-vendors.md), the callback URL to give the vendor, today's counts, and the review queue
//   (a name that differs or a PAN on two accounts: a person clears it or not; nobody is rejected automatically).
// /api/admin/trust/documents (every change audited).
import { useEffect, useState } from 'react';
import { useToast } from '../../../components/ui';
import { Loading, http, useAction, useApi, when } from './common';

function Review({ r, reload }) {
  const toast = useToast();
  const [busy, run] = useAction(toast);
  const [note, setNote] = useState('');
  const decide = (decision) => run(async () => { await http(`/api/admin/trust/documents/${r.id}/review`, { method: 'POST', body: { decision, note } }); reload(); },
    decision === 'clear' ? 'Cleared: the badge shows' : 'Marked not cleared: the person is told');
  return (
    <li className="card stack g8" data-testid="td-review-item">
      <strong style={{ overflowWrap: 'anywhere' }}>{r.userName} · {r.title}</strong>
      <span className="small" style={{ overflowWrap: 'anywhere' }}>{r.summary} · fetched {when(r.fetchedAt)}{r.test ? ' · test provider' : ''}</span>
      <span className="small" style={{ overflowWrap: 'anywhere' }}>{r.reasons.join(' ')}{r.nameOnDocument ? ` On the document: “${r.nameOnDocument}”; profile: “${r.userName}”.` : ''}</span>
      {r.note && <span className="small" style={{ overflowWrap: 'anywhere' }}>Their note: {r.note}</span>}
      <div className="row g8" style={{ flexWrap: 'wrap', alignItems: 'flex-end' }}>
        <div className="field" style={{ flex: '1 1 220px' }}><label className="label" htmlFor={`td-n-${r.id}`}>Note to the person (optional)</label><input id={`td-n-${r.id}`} className="input" value={note} onChange={(e) => setNote(e.target.value)} /></div>
        <button type="button" className="btn btn-signal" style={{ minHeight: 44 }} disabled={busy} onClick={() => decide('clear')} data-testid="td-clear">Clear</button>
        <button type="button" className="btn btn-outline" style={{ minHeight: 44 }} disabled={busy} onClick={() => decide('not_cleared')} data-testid="td-not">Not cleared</button>
      </div>
    </li>
  );
}

export default function TrustDocsAdmin() {
  const st = useApi('/api/admin/trust/documents');
  const toast = useToast();
  const [busy, run] = useAction(toast);
  const [pick, setPick] = useState('');
  useEffect(() => { if (st.data) setPick(st.data.provider); }, [st.data]);
  return (
    <section className="card stack g12" aria-labelledby="td-h" data-testid="td-card">
      <h2 id="td-h" className="h3" style={{ margin: 0 }}>DigiLocker documents</h2>
      <Loading st={st}>{(d) => {
        const chosen = d.providers.find((p) => p.key === d.provider);
        const save = () => run(async () => { await http('/api/admin/trust/documents', { method: 'PUT', body: { provider: pick } }); st.reload(); }, 'Provider saved');
        return (
          <>
            <p className="small" style={{ margin: 0 }}>Candidates fetch their driving licence, Class 10 / 12, degree and PAN from DigiLocker through this provider. Aadhaar is never fetched or kept; PAN only as a check value and the last 4 characters.</p>
            <div className="row g8" style={{ flexWrap: 'wrap', alignItems: 'flex-end' }}>
              <div className="field" style={{ flex: '1 1 240px' }}><label className="label" htmlFor="td-p">Provider</label>
                <select id="td-p" className="input" value={pick} onChange={(e) => setPick(e.target.value)} data-testid="td-provider">{d.providers.map((p) => <option key={p.key} value={p.key}>{p.label}{p.test ? '' : p.ready ? '' : ' (keys not set)'}</option>)}</select></div>
              <button type="button" className="btn btn-outline" style={{ minHeight: 44 }} disabled={busy || pick === d.provider} onClick={save} data-testid="td-save">Save</button>
              <span className={`mchip ${chosen?.test ? 'mchip-warn' : chosen?.ready ? 'mchip-ok' : 'mchip-bad'}`} role="status" data-testid="td-state">{chosen?.test ? 'Test mode: only testers and demo accounts on the live site' : chosen?.ready ? 'Connected' : 'Keys not set: nobody can fetch'}</span>
            </div>
            {d.providers.filter((p) => !p.test).map((p) => (
              <div key={p.key} className="stack g4" data-testid={`td-keys-${p.key}`}>
                <span className="label">{p.label}: keys (Render &gt; Environment)</span>
                <ul className="small" style={{ margin: 0, paddingLeft: 18 }}>{Object.entries(p.keys).map(([k, v]) => <li key={k}><code>{k}</code>: {v ? 'set' : 'not set'}</li>)}</ul>
                <span className="small" style={{ overflowWrap: 'anywhere' }}>Callback URL to give {p.label}: <code data-testid="td-callback">{p.callbackUrl}</code></span>
              </div>
            ))}
            <dl className="row g16" style={{ flexWrap: 'wrap', margin: 0 }} data-testid="td-counts">
              {[['fetchedToday', 'Fetched today'], ['failedToday', 'Failed today'], ['pending', 'Waiting for DigiLocker'], ['review', 'With a person']].map(([k, l]) => (
                <div key={k} className="stack g4"><dt className="xs faint">{l}</dt><dd style={{ margin: 0 }} className="h3">{d.counts[k]}</dd></div>
              ))}
            </dl>
            <h3 className="h4" style={{ margin: 0 }}>Review queue</h3>
            {d.review.length ? <ul className="stack g8" style={{ listStyle: 'none', padding: 0, margin: 0 }}>{d.review.map((r) => <Review key={r.id} r={r} reload={st.reload} />)}</ul>
              : <p className="small muted" style={{ margin: 0 }}>Nothing to check.</p>}
          </>
        );
      }}</Loading>
    </section>
  );
}
