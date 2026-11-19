// Admin → Skill checks → Vetting Trust → Integrity rating (T8). One card, in the admin chunk:
//   the review queue (High risk, an explanation from the candidate, or opened by Nm7) → each person's evidence view:
//   every signal with where / when, its weight → what it counts now (60-day half-life, cap), its status, the detail
//   (reviewers only), and Clear / Confirm / Reopen; the person's explanation; Ask them to explain (email to testers only
//   while the switch is off) and Finish the review (companies then see "Reviewed by Nm7"). Webcam snapshots: listed,
//   each photo opened on its own (every look recorded in the audit log). Settings: snapshots on / off, photos per
//   session (3–5), the face check, the spread; how long photos are kept is the "Webcam snapshots" row in Retention.
//   The weighting table (no black box). Nobody is rejected or hidden by the rating. /api/admin/trust/integrity.
import { useEffect, useState } from 'react';
import { useToast } from '../../../components/ui';
import { Loading, http, useAction, useApi, when } from './common';

const STONE = { open: 'mchip-warn', cleared: 'mchip-ok', confirmed: 'mchip-bad' };

function Photo({ uid, p }) {
  const toast = useToast();
  const [img, setImg] = useState(null);
  const open = async () => { try { setImg((await http(`/api/admin/trust/integrity/${uid}/snapshots/${p.id}`)).image); } catch (x) { toast(x.message); } };
  const chk = p.check || {};
  return (
    <li className="stack g4" data-testid="ti-photo" style={{ minWidth: 0 }}>
      <span className="small">{when(p.at)} · {p.where} · {chk.faces == null ? 'not checked' : `${chk.faces} face${chk.faces === 1 ? '' : 's'}`}{chk.same === false ? ' · not the same person' : chk.same ? ' · same person' : ''}{chk.test ? ' (test)' : ''}</span>
      {img ? <img src={img} alt={`Webcam snapshot, ${when(p.at)}`} style={{ maxWidth: 240, width: '100%', borderRadius: 8 }} data-testid="ti-photo-img" />
        : <button type="button" className="btn btn-ghost btn-sm" style={{ minHeight: 44, alignSelf: 'flex-start' }} onClick={open} data-testid="ti-photo-open">View photo (recorded)</button>}
    </li>
  );
}

function Evidence({ uid, onChange }) {
  const st = useApi(`/api/admin/trust/integrity/${uid}`);
  const toast = useToast();
  const [busy, run] = useAction(toast);
  const [note, setNote] = useState('');
  const [d, setD] = useState(null);
  useEffect(() => { if (st.data) setD(st.data); }, [st.data]);
  const act = (path, body, ok) => run(async () => { setD(await http(`/api/admin/trust/integrity/${uid}/${path}`, { method: 'POST', body })); onChange(); }, ok);
  if (!d) return <Loading st={st}>{() => null}</Loading>;
  const rv = d.review;
  return (
    <div className="stack g8" data-testid="ti-evidence">
      <span className="small"><strong data-testid="ti-ev-label">{d.label}</strong> · score {d.score} · {d.observations} things done{d.snapshotConsent ? ' · snapshots on' : ' · no snapshots'}</span>
      {rv && <span className="small" style={{ overflowWrap: 'anywhere' }} data-testid="ti-ev-review">Review: {rv.status}{rv.whyText ? ` (${rv.whyText})` : ''}{rv.askNote ? ` · asked: “${rv.askNote}”` : ''}{rv.explanation ? ` · their words: “${rv.explanation}”` : ''}</span>}
      <ul className="stack g8" style={{ listStyle: 'none', padding: 0, margin: 0 }}>
        {d.signals.map((s) => (
          <li key={s.key} className="well stack g4" data-testid="ti-signal" style={{ minWidth: 0 }}>
            <span className="row g8" style={{ flexWrap: 'wrap', justifyContent: 'space-between' }}>
              <strong className="small" style={{ overflowWrap: 'anywhere' }}>{s.label}</strong>
              <span className={`mchip ${STONE[s.status] || ''}`} data-testid="ti-signal-status">{s.statusText}</span>
            </span>
            <span className="xs" style={{ overflowWrap: 'anywhere' }}>{s.where} · {when(s.at)} · {s.source} · weight {s.baseWeight} → counts {s.weight} (cap {s.cap}){s.by ? ` · ${s.by}` : ''}</span>
            {s.detail && <span className="xs muted" style={{ overflowWrap: 'anywhere' }}>{s.detail}</span>}
            <span className="row g8" style={{ flexWrap: 'wrap' }}>
              {s.status !== 'cleared' && <button type="button" className="btn btn-outline btn-sm" style={{ minHeight: 44 }} disabled={busy} onClick={() => act('signals', { key: s.key, decision: 'clear', note }, 'Cleared: it counts nothing now')} data-testid="ti-clear">Clear</button>}
              {s.status !== 'confirmed' && <button type="button" className="btn btn-ghost btn-sm" style={{ minHeight: 44 }} disabled={busy} onClick={() => act('signals', { key: s.key, decision: 'confirm', note }, 'Confirmed')} data-testid="ti-confirm">Confirm</button>}
              {s.status !== s.sourceStatus && <button type="button" className="btn btn-ghost btn-sm" style={{ minHeight: 44 }} disabled={busy} onClick={() => act('signals', { key: s.key, decision: 'reopen', note }, 'Back to open')}>Undo</button>}
            </span>
          </li>
        ))}
      </ul>
      {!d.signals.length && <p className="small muted" style={{ margin: 0 }}>Nothing noticed.</p>}
      {d.snapshots.length > 0 && <><span className="label">Webcam snapshots</span><ul className="stack g8" style={{ listStyle: 'none', padding: 0, margin: 0 }}>{d.snapshots.map((p) => <Photo key={p.id} uid={uid} p={p} />)}</ul></>}
      <div className="field"><label className="label" htmlFor={`ti-n-${uid}`}>Note (to the person when you ask or finish; kept with a decision)</label>
        <input id={`ti-n-${uid}`} className="input" maxLength={600} value={note} onChange={(e) => setNote(e.target.value)} data-testid="ti-note" /></div>
      <div className="row g8" style={{ flexWrap: 'wrap' }}>
        <button type="button" className="btn btn-outline" style={{ minHeight: 44 }} disabled={busy} onClick={() => act('ask', { note }, 'Asked: the person sees it in Profile & settings')} data-testid="ti-ask">Ask them to explain</button>
        {rv && rv.status !== 'closed'
          ? <button type="button" className="btn btn-signal" style={{ minHeight: 44 }} disabled={busy} onClick={() => act('close', { note }, 'Review finished: companies see “Reviewed by Nm7”')} data-testid="ti-close">Finish the review</button>
          : <button type="button" className="btn btn-ghost" style={{ minHeight: 44 }} disabled={busy} onClick={() => act('open', {}, 'Review opened')} data-testid="ti-open">Open a review</button>}
      </div>
    </div>
  );
}

function Item({ r, reload }) {
  const [open, setOpen] = useState(false);
  return (
    <li className="card stack g8" data-testid="ti-item" style={{ minWidth: 0 }}>
      <strong style={{ overflowWrap: 'anywhere' }}>{r.name || r.userId} · {r.label || 'Not rated yet'}{r.score != null ? ` · ${r.score}` : ''}</strong>
      <span className="small" style={{ overflowWrap: 'anywhere' }}>{r.email} · {r.review?.whyText} · {when(r.review?.openedAt)}{r.review?.status === 'asked' ? ' · asked to explain' : ''}</span>
      {r.review?.explanation && <span className="small" style={{ overflowWrap: 'anywhere' }}>Their words: “{r.review.explanation}”</span>}
      <div><button type="button" className="btn btn-outline btn-sm" style={{ minHeight: 44 }} onClick={() => setOpen(!open)} aria-expanded={open} data-testid="ti-evidence-open">{open ? 'Hide the evidence' : 'Open the evidence'}</button></div>
      {open && <Evidence uid={r.userId} onChange={reload} />}
    </li>
  );
}

export default function TrustIntegrityAdmin() {
  const st = useApi('/api/admin/trust/integrity');
  const toast = useToast();
  const [busy, run] = useAction(toast);
  const [f, setF] = useState(null);
  const [fresh, setFresh] = useState(null); // a quiet reload after a review action (the open evidence stays open)
  useEffect(() => { if (st.data) { setFresh(null); setF({ snapshots: st.data.snapshots, perSession: st.data.perSession, checkFaces: st.data.checkFaces, windowMinutes: st.data.windowMinutes }); } }, [st.data]);
  const quiet = () => http('/api/admin/trust/integrity').then(setFresh, () => {});
  return (
    <section className="card stack g12" aria-labelledby="ti-h" data-testid="ti-card">
      <h2 id="ti-h" className="h3" style={{ margin: 0 }}>Integrity rating</h2>
      <Loading st={st}>{(loaded) => {
        if (!f) return null;
        const d = fresh || loaded;
        const save = () => run(async () => { await http('/api/admin/trust/integrity', { method: 'PUT', body: { ...f, perSession: Number(f.perSession), windowMinutes: Number(f.windowMinutes) } }); st.reload(); }, 'Saved');
        const check = () => run(async () => { const r = await http('/api/admin/trust/integrity/run', { method: 'POST' }); st.reload(); return r; }, 'Everyone with signals was rated again');
        return (
          <>
            <p className="small" style={{ margin: 0 }}>One rating per candidate (Low / Medium / High risk, or Not enough data) from the test, interview, account, document and ID signals, with the weights below. High risk comes here for a person; nothing is rejected or hidden automatically. Companies see only the label, or “Under review by Nm7” while a review is open.</p>
            <dl className="row g16" style={{ flexWrap: 'wrap', margin: 0 }} data-testid="ti-counts">
              {[['review', 'To review'], ['asked', 'Asked to explain'], ['high', 'High'], ['medium', 'Medium'], ['low', 'Low'], ['snapshots', 'Snapshots kept']].map(([k, l]) => (
                <div key={k} className="stack g4"><dt className="xs faint">{l}</dt><dd style={{ margin: 0 }} className="h3">{d.counts[k]}</dd></div>
              ))}
            </dl>
            <div className="row g8" style={{ flexWrap: 'wrap', alignItems: 'center' }}>
              <button type="button" className="btn btn-outline" style={{ minHeight: 44 }} disabled={busy} onClick={check} data-testid="ti-run">Check everyone now</button>
              <span className="xs muted">Also every 6 hours by itself. Last: {when(d.lastRun?.at)}</span>
            </div>
            <h3 className="h4" style={{ margin: 0 }}>Review queue</h3>
            {d.queue.length ? <ul className="stack g8" style={{ listStyle: 'none', padding: 0, margin: 0 }} data-testid="ti-queue">{d.queue.map((r) => <Item key={r.userId} r={r} reload={quiet} />)}</ul>
              : <p className="small muted" style={{ margin: 0 }}>Nothing to review.</p>}
            <h3 className="h4" style={{ margin: 0 }}>Webcam snapshots (optional for candidates)</h3>
            <label className="row g8 small" style={{ minHeight: 44, alignItems: 'center' }}><input type="checkbox" checked={f.snapshots} onChange={(e) => setF({ ...f, snapshots: e.target.checked })} data-testid="ti-snap-on" />Offer webcam snapshots (only with the person’s own consent)</label>
            <label className="row g8 small" style={{ minHeight: 44, alignItems: 'center' }}><input type="checkbox" checked={f.checkFaces} onChange={(e) => setF({ ...f, checkFaces: e.target.checked })} data-testid="ti-snap-faces" />Check faces with the ID + selfie partner (no face / more than one / same person)</label>
            <div className="row g8" style={{ flexWrap: 'wrap' }}>
              <div className="field" style={{ flex: '1 1 150px' }}><label className="label" htmlFor="ti-per">Photos per test (3–5)</label><input id="ti-per" type="number" min={3} max={5} className="input" value={f.perSession} onChange={(e) => setF({ ...f, perSession: e.target.value })} data-testid="ti-per" /></div>
              <div className="field" style={{ flex: '1 1 150px' }}><label className="label" htmlFor="ti-win">Spread over (minutes, 2–30)</label><input id="ti-win" type="number" min={2} max={30} className="input" value={f.windowMinutes} onChange={(e) => setF({ ...f, windowMinutes: e.target.value })} /></div>
            </div>
            <span className="xs muted" data-testid="ti-days">Photos are kept {d.snapshotDays} days, then deleted automatically (change it in Retention: “Webcam snapshots during a test”).</span>
            <div><button type="button" className="btn btn-outline" style={{ minHeight: 44 }} disabled={busy} onClick={save} data-testid="ti-save">Save</button></div>
            <details className="small" data-testid="ti-method">
              <summary style={{ minHeight: 44, display: 'flex', alignItems: 'center', cursor: 'pointer' }}>How the rating is worked out</summary>
              <p style={{ margin: '4px 0' }}>Weight halves every {d.method.halfLifeDays} days; nothing after {d.method.maxAgeDays} days. Cleared = 0; confirmed = {d.method.confirmedFactor}× and doesn’t fade. Each kind is capped. Below {d.method.mediumAt} Low, {d.method.mediumAt}–{d.method.highAt} Medium, {d.method.highAt}+ High.</p>
              <ul style={{ margin: 0, paddingLeft: 18 }}>{d.method.kinds.map((k) => <li key={k.kind}>{k.label} ({k.source}): {k.weight}, cap {k.cap}</li>)}</ul>
            </details>
          </>
        );
      }}</Loading>
    </section>
  );
}
