// Expert test task: rewrite a sample resume in the real workspace, within 48 hours, then submit for review.
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import Header from '../../components/Header';
import { Dialog, useToast } from '../../components/ui';
import Builder from '../Builder';
import { loadExpert, saveExpert, submitTest, useExpertReady } from '../../lib/expert';
import { LIVE } from '../../services/http';
import { currentUser } from '../../lib/auth';
import { taskById, RUBRIC, atsDelta, TEST_HOURS } from '../../lib/expertTest';
import { atsScore } from '../../lib/atsScore';
import { countdown } from '../me/shared';
import { ExpertLoading, ExpertPage } from './ExpertFrame';
import { Chip, Empty, MeCard } from '../me/kit';
import '../../styles/me-kit.css';
import '../../styles/expert.css';
import { IcCheck, IcClock } from '../../components/icons';

export default function TestTask() {
  const ready = useExpertReady();
  if (!ready) return <ExpertLoading />;
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
    return (
      <ExpertPage width="narrow" kicker="Expert test task" title="No test task right now" shape="resume">
        <Empty shape="resume" title="Your test task comes after the profile review" action={<Link to="/expert/profile" className="btn btn-outline">Back to my profile</Link>}>We send a short test task after your profile is reviewed. You’ll get a WhatsApp and email when it’s ready.</Empty>
      </ExpertPage>
    );
  }
  if (p.status === 'testReview') {
    return (
      <ExpertPage width="narrow" kicker="Expert test task" title="Test submitted" shape="badge">
        <MeCard tone="ok" title="We’re reviewing it" icon={<IcCheck />}>
          <span className="small">Thanks! We review test tasks in 1–2 working days and email you the result with feedback.</span>
          <Link to="/expert/profile" className="btn btn-outline" style={{ alignSelf: 'flex-start' }}>Back to my profile</Link>
        </MeCard>
      </ExpertPage>
    );
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
      <div className="ex-wsbar">
        <div className="ex-wsbar-card">
          <div className="ex-wsbar-row">
            <div className="stack g4" style={{ minWidth: 0 }}><span className="ex-kicker">Expert test task · {t.id}</span><h1 className="ex-title" style={{ fontSize: 'clamp(22px, 3vw, 28px)' }}>Rewrite this resume for: {t.title}</h1></div>
            <div className="ex-wsbar-id">
              <Chip tone="accent">ATS {before} to <strong style={{ marginLeft: 4 }}>{now?.score ?? before}</strong></Chip>
              {now && now.match.keywords.length > 0 && <Chip tone="neutral">Job {now.match.found.length}/{now.match.keywords.length}</Chip>}
              <Chip tone={cd.late ? 'bad' : 'neutral'}><IcClock size={14} /> {cd.text}</Chip>
              <button type="button" className="btn btn-signal" onClick={() => setConfirm(true)}>Submit test</button>
            </div>
          </div>
        </div>
      </div>
      <div className="container-wide stack g12" style={{ padding: '4px 24px 8px' }}>
        <details className="mcard" open>
          <summary className="strong" style={{ cursor: 'pointer', minHeight: 32 }}>Brief, job post and how we score</summary>
          <div className="mgrid-2" style={{ marginTop: 4 }}>
            <div className="mstack" style={{ gap: 10 }}>
              <div className="ex-fact"><span className="ex-fact-l">Job post</span><span className="ex-fact-v">{t.jd}</span></div>
              <div className="ex-fact"><span className="ex-fact-l">What the candidate told us</span><span className="ex-fact-v">{t.notes}</span></div>
              <span className="xs muted">Use only facts given here. Where a number or name is missing, write it in [brackets] — that’s what you’d ask the customer.</span>
            </div>
            <ul className="stack g8 small" style={{ margin: 0, padding: 0, listStyle: 'none' }}>
              {RUBRIC.map(([k, l, h]) => <li key={k} className="ex-tip"><span className="ex-tip-ic" aria-hidden="true"><IcCheck size={14} /></span><span><strong>{l}</strong> — <span className="muted">{h}</span></span></li>)}
              <li className="xs faint">Each scored 1–5. You have {TEST_HOURS} hours; it usually takes 30–45 minutes.</li>
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
            <button type="button" className="btn btn-signal" onClick={submit}>Submit test</button>
          </div>
        </Dialog>
      )}
    </>
  );
}
