// Expert test task: rewrite a sample resume in the real workspace, within 48 hours, then submit for review.
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import Header from '../../components/Header';
import { Dialog, useToast } from '../../components/ui';
import Builder from '../Builder';
import { loadExpert, saveExpert, submitTest, useExpertReady } from '../../lib/expert';
import { LIVE } from '../../services/http';
import { Spinner } from '../../components/ui';
import { currentUser } from '../../lib/auth';
import { taskById, RUBRIC, atsDelta, TEST_HOURS } from '../../lib/expertTest';
import { atsScore } from '../../lib/atsScore';
import { countdown } from '../me/shared';

export default function TestTask() {
  const ready = useExpertReady();
  if (!ready) return <><Header variant="expert" /><main className="container row g12 muted" role="status" style={{ padding: 48 }}><Spinner /> Loading…</main></>;
  return <TestTaskPage />;
}

function TestTaskPage() {
  const toast = useToast();
  const [p, setP] = useState(loadExpert);
  const [d, setD] = useState(null);
  const [confirm, setConfirm] = useState(false);
  const [note, setNote] = useState('');
  const t = p?.test ? taskById(p.test.taskId) : null;
  const embedded = useMemo(() => (t ? { storageKey: `asuraa-expert-test:${currentUser()?.id || 'guest'}`, initial: t.original, onChange: setD } : null), [t?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!p || !t || !['test', 'testReview'].includes(p.status)) {
    return (<><Header variant="expert" /><main className="container stack g12" style={{ maxWidth: 720, padding: 40 }}>
      <h1 className="display" style={{ fontSize: 28 }}>No test task right now</h1>
      <p className="muted">We send a short test task after your profile is reviewed. You’ll get a WhatsApp and email when it’s ready.</p>
      <Link to="/expert/profile">Back to my profile</Link></main></>);
  }
  if (p.status === 'testReview') {
    return (<><Header variant="expert" /><main className="container stack g12" style={{ maxWidth: 720, padding: 40 }}>
      <h1 className="display" style={{ fontSize: 28 }}>Test submitted ✓</h1>
      <p className="muted">Thanks! We review test tasks in 1–2 working days and email you the result with feedback.</p>
      <Link to="/expert/profile">Back to my profile</Link></main></>);
  }
  const cd = countdown(p.test.due);
  const now = d ? atsScore(d, t.jd) : null;
  const { before } = atsDelta(t, t.original);
  const submit = async () => {
    if (LIVE) {
      try { setP(await submitTest(d || t.original, note.trim())); setConfirm(false); toast('Test submitted — we’ll email you the result'); } catch (e) { toast(e.message || 'Not submitted. Please try again.'); }
      return;
    }
    const next = { ...p, status: 'testReview', test: { ...p.test, submitted: { data: d || t.original, at: Date.now(), note: note.trim(), late: cd.late } } };
    saveExpert(next); setP(next); setConfirm(false);
    toast('Test submitted — we’ll email you the result');
  };

  return (
    <>
      <Header variant="expert" />
      <div className="container-wide stack g12" style={{ padding: '16px 24px 8px' }}>
        <div className="row between g12">
          <div className="stack g4"><span className="mono xs muted">EXPERT TEST TASK · {t.id}</span><h1 className="display" style={{ fontSize: 26 }}>Rewrite this resume for: {t.title}</h1></div>
          <div className="row g8">
            <span className="badge b-neutral" style={{ fontSize: 13 }}>ATS {before} → <strong style={{ marginLeft: 4 }}>{now?.score ?? before}</strong></span>
            {now && now.match.keywords.length > 0 && <span className="badge b-neutral" style={{ fontSize: 13 }}>Job {now.match.found.length}/{now.match.keywords.length}</span>}
            <span className="xs strong" style={{ color: cd.late ? 'var(--danger)' : 'var(--text2)' }}>⏱ {cd.text}</span>
            <button type="button" className="btn btn-ink" onClick={() => setConfirm(true)}>Submit test</button>
          </div>
        </div>
        <details className="card" open>
          <summary className="strong" style={{ cursor: 'pointer' }}>Brief, job post and how we score</summary>
          <div className="row g16" style={{ alignItems: 'flex-start', marginTop: 12 }}>
            <div className="stack g8" style={{ flex: '1 1 320px' }}>
              <span className="small"><strong>Job post:</strong> {t.jd}</span>
              <span className="small"><strong>What the candidate told us:</strong> {t.notes}</span>
              <span className="xs muted">Use only facts given here. Where a number or name is missing, write it in [brackets] — that’s what you’d ask the customer.</span>
            </div>
            <ul className="stack g4 small" style={{ flex: '1 1 320px', margin: 0, paddingLeft: 18 }}>
              {RUBRIC.map(([k, l, h]) => <li key={k}><strong>{l}</strong> — <span className="muted">{h}</span></li>)}
              <li className="xs faint" style={{ listStyle: 'none', marginLeft: -18 }}>Each scored 1–5. You have {TEST_HOURS} hours; it usually takes 30–45 minutes.</li>
            </ul>
          </div>
        </details>
      </div>
      <div className="container-wide" style={{ padding: '0 24px' }}>
        {embedded && <Builder embedded={embedded} />}
      </div>
      {confirm && (
        <Dialog showTitle title="Submit your test task?" onClose={() => setConfirm(false)}>
          <div className="stack g12">
            <span className="small muted">You can’t edit it after submitting. ATS now {now?.score ?? before} (was {before}).</span>
            <label htmlFor="tnote" className="label">Note to the reviewer · optional</label>
            <textarea id="tnote" className="input" rows={3} value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. I left [brackets] where I’d ask the candidate for numbers." />
            <button type="button" className="btn btn-ink" onClick={submit}>Submit test</button>
          </div>
        </Dialog>
      )}
    </>
  );
}
