// Vetting V3: "Screening interview" on a Hire now card and in an applicant's profile, for people at level 3 or more.
// One panel (a side drawer) from GET /api/company/{cid}/hire/interview/{uid}: the average and the 5 rubric scores with
// their reasons, 3 strengths, 1 concern and the full transcript, with a one-tap "Invite to final interview" that uses
// the Hire now invite for that job (POST /hire/invite; the person accepts, then picks an interview time from the slots).
// An applicant who isn't on the Hire now list for the job is moved to Shortlisted instead (the same applicant stages).
// English only for now.
import { useEffect, useRef, useState } from 'react';
import { rq } from '../../lib/company';
import { Dialog } from '../../components/ui';
import { Bar, Chip } from '../me/kit';
import '../../styles/me-iv.css';

const day = (ms) => (ms ? new Date(ms).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '');
const LANG = { en: 'English', te: 'Telugu', hi: 'Hindi' };

function Panel({ c, uid, name, job, appId, canInvite, invited, onInvited }) {
  const [d, setD] = useState(null);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const [sent, setSent] = useState(false);
  useEffect(() => { rq(`/api/company/${c.id}/hire/interview/${encodeURIComponent(uid)}`).then(setD, (x) => setErr(x.message)); }, [c.id, uid]);
  const invite = async () => {
    setBusy(true); setMsg(''); setErr('');
    try {
      const r = await rq(`/api/company/${c.id}/hire/invite`, { method: 'POST', body: { job, people: [uid], note: 'You passed the screening interview: we would like to meet you for a final interview.' } });
      if (r.sent) { setSent(true); setMsg(`Invited. When ${name} accepts, they pick a time from your interview slots.`); onInvited?.(); }
      else if (r.skipped?.[0]?.why === 'invited') { setSent(true); setMsg(`${name} already has an invite for this job.`); }
      else if (appId) {
        await rq(`/api/company/${c.id}/applicants/${appId}/status`, { method: 'POST', body: { status: 'shortlisted' } });
        setSent(true); setMsg(`${name} is shortlisted. Schedule the final interview from their card.`); onInvited?.();
      } else setMsg(`${name} can’t be invited for this job right now (no longer on the Hire now list).`);
    } catch (x) { setErr(x.message); } finally { setBusy(false); }
  };
  if (err && !d) return <p className="error" role="alert" data-testid="co-iv-error">{err}</p>;
  if (!d) return <p className="small muted" role="status">Loading the interview…</p>;
  return (
    <div className="iv-co" data-testid="co-iv-panel">
      <div className="iv-co-top">
        <div className="iv-avg" role="img" aria-label={`Average ${Number(d.average).toFixed(1)} out of 5`}><strong aria-hidden="true">{Number(d.average).toFixed(1)}</strong><small aria-hidden="true">/ 5</small></div>
        <div className="stack g4" style={{ minWidth: 0 }}>
          <strong>{d.role || d.test}</strong>
          <span className="mrow" style={{ gap: 6 }}><Chip tone="ok">Passed · Interview-ready</Chip><Chip tone="neutral">{d.mode === 'voice' ? 'Spoken' : 'Typed'} · {LANG[d.lang] || d.lang}</Chip></span>
          {d.validUntil && <span className="xs muted">Valid until {day(d.validUntil)}</span>}
        </div>
      </div>
      <section className="stack g8" aria-labelledby="co-iv-scores">
        <h3 id="co-iv-scores">Scores</h3>
        <ul className="iv-scores">
          {d.scores.map((s) => (
            <li key={s.key} className="iv-score" data-testid="co-iv-score">
              <Bar value={s.score} max={5} label={s.label} tone={s.score >= 4 ? 'ok' : s.score >= 3 ? 'accent' : 'warn'} />
              {s.reason && <p className="iv-reason">{s.reason}</p>}
              {s.quote && <blockquote className="iv-quote">“{s.quote}”</blockquote>}
            </li>
          ))}
        </ul>
      </section>
      {d.strengths?.length > 0 && (
        <section className="stack g8" aria-labelledby="co-iv-str"><h3 id="co-iv-str">Strengths</h3><ul className="iv-list" data-testid="co-iv-strengths">{d.strengths.map((s) => <li key={s}>{s}</li>)}</ul></section>
      )}
      {d.concern && <section className="stack g8" aria-labelledby="co-iv-con"><h3 id="co-iv-con">One concern</h3><p className="small" style={{ margin: 0 }} data-testid="co-iv-concern">{d.concern}</p></section>}
      <section className="stack g8" aria-labelledby="co-iv-tr">
        <h3 id="co-iv-tr">Transcript</h3>
        <ol className="iv-tr-list" data-testid="co-iv-transcript">
          {d.transcript.map((t, i) => (
            <li key={i}>
              <p className="iv-tr-q">{t.q}</p>
              <p className="iv-tr-a">{t.a || <span className="muted">(no answer)</span>}</p>
              {t.followUp && <><p className="iv-tr-q"><span className="iv-follow">Follow-up:</span> {t.followUp}</p><p className="iv-tr-a">{t.followAnswer || <span className="muted">(no answer)</span>}</p></>}
            </li>
          ))}
        </ol>
        <span className="xs muted">Speech was turned into text in the candidate’s browser; small slips are not theirs. Language is never scored unless the job needs English.</span>
      </section>
      {canInvite && job && (
        <div className="iv-co-foot">
          {invited || sent ? <Chip tone="info" role="status" data-testid="co-iv-invited">{msg || 'Invited'}</Chip>
            : <button type="button" className="btn btn-signal" disabled={busy} onClick={invite} data-testid="co-iv-invite">{busy ? 'Inviting…' : 'Invite to final interview'}</button>}
          {!sent && msg && <span className="small" role="status">{msg}</span>}
          {err && <p className="error" role="alert" style={{ margin: 0 }}>{err}</p>}
        </div>
      )}
    </div>
  );
}

/** The button and its drawer. `level` is the person's level number; nothing shows below 3. */
export default function ScreeningInterview({ c, uid, name, level, job, appId, canInvite, invited, onInvited, top }) {
  const [open, setOpen] = useState(false);
  const changed = useRef(false);
  const close = () => { setOpen(false); if (changed.current) { changed.current = false; onInvited?.(); } }; // the list reloads after the drawer closes
  if (!uid || !(level >= 3)) return null;
  return (
    <>
      <button type="button" className="btn btn-outline btn-sm iv-co-btn" onClick={() => setOpen(true)} aria-label={`Screening interview: ${name}`} data-testid="co-iv-open">Screening interview</button>
      {open && (
        <Dialog title={`Screening interview · ${name}`} onClose={close} showTitle top={top}
          overlayStyle={{ justifyContent: 'flex-end', alignItems: 'stretch', padding: 0 }}
          panelStyle={{ width: 'min(520px, 100vw)', maxWidth: '100vw', height: '100vh', maxHeight: '100vh', margin: 0, borderRadius: '22px 0 0 22px' }}>
          <Panel c={c} uid={uid} name={name} job={job} appId={appId} canInvite={canInvite} invited={invited} onInvited={() => { changed.current = true; }} />
        </Dialog>
      )}
    </>
  );
}
