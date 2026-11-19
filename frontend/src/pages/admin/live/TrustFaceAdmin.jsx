// Admin → Skill checks → Vetting Trust → ID + selfie (T3; owner only, the "settings" permission). One card:
//   the provider (the test provider or Amazon Rekognition), whether each key is set (never the value: keys live in
//   Render env vars, docs/trust/T3-vendors.md), the pass marks (liveness, ID match, same person at joining), how many
//   tries before a person checks, which steps need the check (AI interview, skill check), today's counts, and the review
//   queue (tries used up, a manual-check request, the joining-day check): a person decides after a video call and the
//   decision is recorded. Nobody is rejected automatically. /api/admin/trust/face (every change audited).
import { useEffect, useState } from 'react';
import { useToast } from '../../../components/ui';
import { Loading, http, useAction, useApi, when } from './common';

const DECISIONS = {
  identity: [['verified', 'Verified', 'btn-signal'], ['not_cleared', 'Not cleared', 'btn-outline'], ['reset', 'Give tries again', 'btn-ghost']],
  joining: [['same', 'Same person', 'btn-signal'], ['not_same', 'Not confirmed', 'btn-outline'], ['reset', 'Give tries again', 'btn-ghost']],
};

function Review({ r, methods, reload }) {
  const toast = useToast();
  const [busy, run] = useAction(toast);
  const [note, setNote] = useState('');
  const [method, setMethod] = useState('video_call');
  const rv = r.which === 'joining' ? r.continuity?.review : r.review;
  const last = r.which === 'joining' ? r.continuity?.lastReason : r.lastReason;
  const decide = (decision) => run(async () => { await http(`/api/admin/trust/face/${r.userId}/review`, { method: 'POST', body: { which: r.which, decision, method, note } }); reload(); }, 'Saved: the person sees it');
  return (
    <li className="card stack g8" data-testid="tf-review-item">
      <strong style={{ overflowWrap: 'anywhere' }}>{r.userName} · {r.which === 'joining' ? 'Joining-day check' : 'ID + selfie'}</strong>
      <span className="small" style={{ overflowWrap: 'anywhere' }}>{r.email} · {when(r.updatedAt)}{r.test ? ' · test provider' : ''}</span>
      <span className="small" style={{ overflowWrap: 'anywhere' }} data-testid="tf-why">{rv?.reasonText}{last ? ` Last result: ${last}` : ''}{r.liveness && r.which !== 'joining' ? ` Liveness ${r.liveness.score}, ID match ${r.match?.score}.` : ''}</span>
      {rv?.note && <span className="small" style={{ overflowWrap: 'anywhere' }}>Their note: {rv.note}</span>}
      <div className="row g8" style={{ flexWrap: 'wrap', alignItems: 'flex-end' }}>
        <div className="field" style={{ flex: '1 1 180px' }}><label className="label" htmlFor={`tf-m-${r.userId}`}>How it was checked</label>
          <select id={`tf-m-${r.userId}`} className="input" value={method} onChange={(e) => setMethod(e.target.value)} data-testid="tf-method">{methods.map((m) => <option key={m.key} value={m.key}>{m.title}</option>)}</select></div>
        <div className="field" style={{ flex: '2 1 220px' }}><label className="label" htmlFor={`tf-n-${r.userId}`}>Note to the person (optional)</label><input id={`tf-n-${r.userId}`} className="input" value={note} onChange={(e) => setNote(e.target.value)} data-testid="tf-note" /></div>
      </div>
      <div className="row g8" style={{ flexWrap: 'wrap' }}>
        {DECISIONS[r.which].map(([k, l, cls]) => <button key={k} type="button" className={`btn ${cls}`} style={{ minHeight: 44 }} disabled={busy} onClick={() => decide(k)} data-testid={`tf-${k}`}>{l}</button>)}
      </div>
    </li>
  );
}

const NUMS = [['livenessMin', 'Liveness pass mark'], ['matchMin', 'ID match pass mark'], ['sameMin', 'Same person pass mark'], ['maxTries', 'Tries before a person checks']];

export default function TrustFaceAdmin() {
  const st = useApi('/api/admin/trust/face');
  const toast = useToast();
  const [busy, run] = useAction(toast);
  const [f, setF] = useState(null);
  useEffect(() => { if (st.data) setF({ provider: st.data.provider, require: { ...st.data.require }, livenessMin: st.data.livenessMin, matchMin: st.data.matchMin, sameMin: st.data.sameMin, maxTries: st.data.maxTries }); }, [st.data]);
  return (
    <section className="card stack g12" aria-labelledby="tf-h" data-testid="tf-card">
      <h2 id="tf-h" className="h3" style={{ margin: 0 }}>ID + selfie</h2>
      <Loading st={st}>{(d) => {
        if (!f) return null;
        const chosen = d.providers.find((p) => p.key === d.provider);
        const save = () => run(async () => { await http('/api/admin/trust/face', { method: 'PUT', body: { ...f, livenessMin: Number(f.livenessMin), matchMin: Number(f.matchMin), sameMin: Number(f.sameMin), maxTries: Number(f.maxTries) } }); st.reload(); }, 'Saved');
        return (
          <>
            <p className="small" style={{ margin: 0 }}>Before the AI interview or a skill check, candidates photograph their driving licence or PAN card (never Aadhaar) and take a live selfie; on the joining day a fresh selfie is matched with it. Photos are never stored: only the results and the partner’s face reference. Only people Vetting Trust is on for are asked.</p>
            <div className="row g8" style={{ flexWrap: 'wrap', alignItems: 'flex-end' }}>
              <div className="field" style={{ flex: '1 1 240px' }}><label className="label" htmlFor="tf-p">Provider</label>
                <select id="tf-p" className="input" value={f.provider} onChange={(e) => setF({ ...f, provider: e.target.value })} data-testid="tf-provider">{d.providers.map((p) => <option key={p.key} value={p.key}>{p.label}{p.test || p.ready ? '' : ' (keys not set)'}</option>)}</select></div>
              <span className={`mchip ${chosen?.test ? 'mchip-warn' : chosen?.ready ? 'mchip-ok' : 'mchip-bad'}`} role="status" data-testid="tf-state">{chosen?.test ? 'Test mode: only testers and demo accounts on the live site' : chosen?.ready ? 'Connected' : 'Keys not set: nobody is asked'}</span>
            </div>
            <fieldset className="stack g4" style={{ border: 0, padding: 0, margin: 0 }}>
              <legend className="label">Ask for it before</legend>
              <label className="row g8 small" style={{ minHeight: 44, alignItems: 'center' }}><input type="checkbox" checked={f.require.interview} onChange={(e) => setF({ ...f, require: { ...f.require, interview: e.target.checked } })} data-testid="tf-req-interview" />the AI interview</label>
              <label className="row g8 small" style={{ minHeight: 44, alignItems: 'center' }}><input type="checkbox" checked={f.require.skillCheck} onChange={(e) => setF({ ...f, require: { ...f.require, skillCheck: e.target.checked } })} data-testid="tf-req-skill" />a skill check</label>
            </fieldset>
            <div className="row g8" style={{ flexWrap: 'wrap' }}>
              {NUMS.map(([k, l]) => (
                <div key={k} className="field" style={{ flex: '1 1 150px' }}><label className="label" htmlFor={`tf-${k}`}>{l}</label>
                  <input id={`tf-${k}`} className="input" type="number" min={k === 'maxTries' ? 1 : 50} max={k === 'maxTries' ? 5 : 99} value={f[k]} onChange={(e) => setF({ ...f, [k]: e.target.value })} data-testid={`tf-${k}`} /></div>
              ))}
            </div>
            <div><button type="button" className="btn btn-outline" style={{ minHeight: 44 }} disabled={busy} onClick={save} data-testid="tf-save">Save</button></div>
            {d.providers.filter((p) => !p.test).map((p) => (
              <div key={p.key} className="stack g4" data-testid={`tf-keys-${p.key}`}>
                <span className="label">{p.label}: keys (Render → Environment)</span>
                <ul className="small" style={{ margin: 0, paddingLeft: 18 }}>{Object.entries(p.keys).map(([k, v]) => <li key={k}><code>{k}</code>: {v ? 'set' : 'not set'}</li>)}</ul>
              </div>
            ))}
            <dl className="row g16" style={{ flexWrap: 'wrap', margin: 0 }} data-testid="tf-counts">
              {[['checksToday', 'Checks today'], ['passedToday', 'Passed today'], ['failedToday', 'Didn’t pass today'], ['verified', 'Verified'], ['samePerson', 'Same person at joining'], ['review', 'With a person']].map(([k, l]) => (
                <div key={k} className="stack g4"><dt className="xs faint">{l}</dt><dd style={{ margin: 0 }} className="h3">{d.counts[k]}</dd></div>
              ))}
            </dl>
            <h3 className="h4" style={{ margin: 0 }}>Review queue</h3>
            {d.review.length ? <ul className="stack g8" style={{ listStyle: 'none', padding: 0, margin: 0 }}>{d.review.map((r) => <Review key={`${r.userId}-${r.which}`} r={r} methods={d.methods} reload={st.reload} />)}</ul>
              : <p className="small muted" style={{ margin: 0 }}>Nothing to check.</p>}
          </>
        );
      }}</Loading>
    </section>
  );
}
