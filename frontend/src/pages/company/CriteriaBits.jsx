// Vetting Trust T7: a job's requirements ("criteria") and each person's Met / Not met / Unknown with the quoted evidence.
//   CriteriaEditor  the list on the job (Jobs tab, Applicants with one job picked, Hire now): add, remove, reword, kind,
//                   must-have on / off. Ticking must-have or removing one saves at once (the list re-sorts at once);
//                   new or reworded ones are saved with Save. The server refuses requirements about gender, religion,
//                   caste, age, looks, names or colleges and says why.
//   CriteriaStrip   the compact chip strip on an applicant / Hire now card (tick met · cross not met · ? unknown,
//                   "evaluating…"), opening the list with each quote and where it came from.
//   criteriaSort    must-haves met, then nice-to-haves met, then the score (the server's order, done here after an edit).
// Shown only when the API sends `criteria` (the Trust switch lets the company in). Not met is a label only: nobody is
// rejected. English only while it is tested. Statically imported by the company page chunk (no new lazy chunk).
import { useEffect, useState } from 'react';
import { FairnessNotes } from './FairnessBits'; // Vetting Trust T12
import { rq } from '../../lib/company';

export const KINDS = [['skill', 'Skill'], ['experience', 'Experience'], ['education', 'Education'], ['certification', 'Certification'],
  ['language', 'Language'], ['licence', 'Licence'], ['location', 'Location'], ['shift', 'Shift / timing'], ['other', 'Other']];
const MAX = 10;
const MARK = { met: '✓', not_met: '✗', unknown: '?' };
const WORD = { met: 'Met', not_met: 'Not met', unknown: 'Unknown' };
const TONE = { met: 'ok', not_met: 'warn', unknown: 'neutral' };

/** Must-haves met, then nice-to-haves met, then the score (stable: ties keep their order). */
export function criteriaSort(rows, stripOf, scoreOf) {
  return rows.map((r, i) => [r, i]).sort(([a, i], [b, j]) => {
    const sa = stripOf(a) || {};
    const sb = stripOf(b) || {};
    return (sb.mustMet || 0) - (sa.mustMet || 0) || (sb.niceMet || 0) - (sa.niceMet || 0) || (scoreOf(b) || 0) - (scoreOf(a) || 0) || i - j;
  }).map(([r]) => r);
}

/** The body PUT /trust/criteria/{job} takes. */
export const criteriaBody = (items) => ({ items: items.filter((x) => x.text.trim()).map((x) => ({ kind: x.kind, text: x.text.trim(), must: !!x.must })) });

/** "2 of 3 must-haves · 1 of 2 nice-to-haves". */
export function stripLine(s) {
  if (!s) return '';
  const bits = [];
  if (s.mustTotal) bits.push(`${s.mustMet} of ${s.mustTotal} must-haves`);
  if (s.niceTotal) bits.push(`${s.niceMet} of ${s.niceTotal} nice-to-haves`);
  return bits.join(' · ');
}

export function CriteriaStrip({ cr, testid = 'crit-strip' }) {
  const [open, setOpen] = useState(false);
  if (!cr || !cr.items?.length) return null;
  return (
    <div className="stack g4" data-testid={testid} style={{ minWidth: 0 }}>
      <div className="row g4" style={{ flexWrap: 'wrap', alignItems: 'center' }}>
        <span className="xs muted" data-testid="crit-line">{stripLine(cr)}{cr.pending ? ' · evaluating…' : ''}</span>
        <span className="row g4" style={{ flexWrap: 'wrap' }} aria-hidden="true">
          {cr.items.map((x) => (
            <span key={x.id} className={`mchip mchip-${x.pending ? 'info' : TONE[x.status]}`} title={`${x.text}: ${x.pending ? 'evaluating…' : WORD[x.status]}`}
              style={{ padding: '0 6px', minHeight: 0, fontWeight: x.must ? 700 : 400 }} data-testid={`crit-chip-${x.status}`}>{x.pending ? '…' : MARK[x.status]}</span>
          ))}
        </span>
        <button type="button" className="link-btn xs" aria-expanded={open} onClick={() => setOpen(!open)} data-testid="crit-why">{open ? 'Hide requirements' : 'Requirements and evidence'}</button>
      </div>
      {!cr.consent && <span className="xs muted" data-testid="crit-noconsent">This person hasn’t agreed to matching yet, so every requirement shows Unknown.</span>}
      {open && (
        <ul className="stack g4" style={{ margin: 0, paddingLeft: 0, listStyle: 'none' }} data-testid="crit-list">
          {cr.items.map((x) => (
            <li key={x.id} className="xs" style={{ overflowWrap: 'anywhere' }} data-testid="crit-item">
              <span className={`mchip mchip-${x.pending ? 'info' : TONE[x.status]}`} style={{ minHeight: 0 }}>{x.pending ? 'Evaluating…' : `${MARK[x.status]} ${WORD[x.status]}`}</span>{' '}
              <strong>{x.text}</strong>{x.must ? ' · must-have' : ' · nice to have'}
              {x.quote && <> · {x.sourceLabel}: <q data-testid="crit-quote">{x.quote}</q></>}
              {x.note && <span className="muted"> ({x.note})</span>}
              {!x.quote && !x.pending && x.status === 'unknown' && <span className="muted"> · no evidence yet</span>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** The company's editor. `criteria`: what the list call sent (or null: it loads it). `onSaved(criteria)`. */
export function CriteriaEditor({ c, jobId, criteria, can, onSaved, open: startOpen = false }) {
  const [d, setD] = useState(criteria || null);
  const [rows, setRows] = useState(null);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [open, setOpen] = useState(startOpen);
  const [fair, setFair] = useState([]); // T12: proxies kept in the saved list (why + a neutral wording)
  const url = `/api/company/${c.id}/trust/criteria/${encodeURIComponent(jobId)}`;
  useEffect(() => { if (criteria) setD(criteria); }, [criteria]);
  useEffect(() => { if (!criteria && open && !d) rq(url).then(setD, (x) => setErr(x.message)); }, [criteria, open, d, url]);
  useEffect(() => { if (d && !dirty) setRows(d.items.map((x) => ({ ...x }))); }, [d, dirty]);
  const save = async (list) => {
    setBusy(true); setErr('');
    try { const x = await rq(url, { method: 'PUT', body: criteriaBody(list) }); setD(x); setFair(x.fairness || []); setDirty(false); setRows(x.items.map((y) => ({ ...y }))); onSaved?.(x); } catch (x) { setErr(x.message); } finally { setBusy(false); }
  };
  const again = async () => {
    setBusy(true); setErr('');
    try { const x = await rq(`${url}/reextract`, { method: 'POST' }); setD(x); setDirty(false); onSaved?.(x); } catch (x) { setErr(x.message); } finally { setBusy(false); }
  };
  const edit = (i, k, v) => { setRows(rows.map((x, j) => (j === i ? { ...x, [k]: v } : x))); setDirty(true); };
  const n = d?.items?.length;
  return (
    <details className="mcard mcard-tight stack g8" open={open} onToggle={(e) => setOpen(e.currentTarget.open)} data-testid="crit-editor">
      <summary className="small" style={{ cursor: 'pointer', minHeight: 44, display: 'flex', alignItems: 'center' }}>
        <strong>Requirements for this job{n ? ` (${n})` : ''}</strong><span className="xs muted" style={{ marginLeft: 8 }}>{d ? (d.edited ? 'edited by you' : d.by === 'ai' ? 'read from the description by AI' : 'read from the job by rules') : ''}</span>
      </summary>
      {!d || !rows ? (err ? <p className="error" role="alert">{err}</p> : <p className="xs muted">Loading…</p>) : (
        <div className="stack g8">
          <p className="xs muted" style={{ margin: 0 }}>Each person is checked against these: Met, Not met or Unknown, with the words it came from. Must-haves met come first. It is only a label: nobody is rejected because of it.</p>
          {d.stale && <p className="xs" role="status" data-testid="crit-stale">The description changed since you edited this list.{can && <> <button type="button" className="link-btn xs" disabled={busy} onClick={again}>Read it again</button> (replaces your edits)</>}</p>}
          <ul className="stack g8" style={{ margin: 0, padding: 0, listStyle: 'none' }}>
            {rows.map((x, i) => (
              <li key={x.id || `n${i}`} className="row g8" style={{ flexWrap: 'wrap', alignItems: 'center' }} data-testid="crit-row">
                <select className="input" style={{ flex: '0 1 150px', minWidth: 0 }} aria-label="Kind" value={x.kind} disabled={!can} onChange={(e) => edit(i, 'kind', e.target.value)}>
                  {KINDS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
                </select>
                <input className="input" style={{ flex: '1 1 200px', minWidth: 0 }} aria-label="Requirement" maxLength={160} value={x.text} disabled={!can} onChange={(e) => edit(i, 'text', e.target.value)} data-testid="crit-text" />
                <label className="row g4 xs" style={{ minHeight: 44, alignItems: 'center' }}>
                  <input type="checkbox" checked={!!x.must} disabled={!can || busy} data-testid="crit-must"
                    onChange={(e) => { const next = rows.map((y, j) => (j === i ? { ...y, must: e.target.checked } : y)); setRows(next); if (dirty) setDirty(true); else save(next); }} /> Must-have
                </label>
                {can && <button type="button" className="link-btn xs" disabled={busy} aria-label={`Remove: ${x.text}`} onClick={() => { const next = rows.filter((_, j) => j !== i); setRows(next); if (dirty) setDirty(true); else save(next); }} data-testid="crit-remove">Remove</button>}
              </li>
            ))}
          </ul>
          {can && (
            <div className="row g8" style={{ flexWrap: 'wrap' }}>
              {rows.length < MAX && <button type="button" className="btn btn-outline btn-sm" disabled={busy} onClick={() => { setRows([...rows, { kind: 'skill', text: '', must: false }]); setDirty(true); }} data-testid="crit-add">Add a requirement</button>}
              {dirty && <button type="button" className="btn btn-signal btn-sm" disabled={busy} onClick={() => save(rows)} data-testid="crit-save">{busy ? 'Saving…' : 'Save requirements'}</button>}
              {dirty && <button type="button" className="link-btn xs" disabled={busy} onClick={() => { setDirty(false); setRows(d.items.map((y) => ({ ...y }))); setErr(''); }}>Cancel</button>}
            </div>
          )}
          <FairnessNotes items={fair} testid="crit-fair" />
          {err && <p className="error" role="alert" data-testid="crit-error">{err}</p>}
        </div>
      )}
    </details>
  );
}

/** While some people show "evaluating…": ask the server to run a few, then reload (every 4 s, at most 15 times). */
export function useEvaluating(c, jobId, pending, reload) {
  const [tries, setTries] = useState(0);
  useEffect(() => { setTries(0); }, [jobId]);
  useEffect(() => {
    if (!jobId || !pending || tries >= 15) return undefined;
    const t = setTimeout(() => {
      rq(`/api/company/${c.id}/trust/criteria/${encodeURIComponent(jobId)}/run`, { method: 'POST' }).catch(() => {}).finally(() => { setTries((n) => n + 1); reload(); });
    }, 4000);
    return () => clearTimeout(t);
  }, [c.id, jobId, pending, tries, reload]);
}
