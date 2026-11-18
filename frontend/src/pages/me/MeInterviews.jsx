// The AI screening interview (Vetting V3): the roles the person can be interviewed for (a current "Skill verified"
// badge), each with its last result, then a plain-words consent card before starting (what it is, speech turned into
// text in the browser, timed answers, no pasting, how long the transcript is kept and what companies see, one try per
// 30 days, language never lowering the score) with an "I agree" tick, and the start options (language, typed or
// spoken, extra time). A pass gives L3 "Interview-ready" for 180 days.
// The interview (interview/Runner) and the result (interview/IvResult) load only when needed.
// /me/interviews/:id shows one result.
import { Suspense, lazy, useEffect, useState } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import { http } from '../../services/http';
import { lazyRetry } from '../../lib/chunks';
import { useLang } from '../../lib/i18n';
import { useVettingOn } from '../../lib/vettingAccess';
import { speechSupported } from '../../lib/speechCore';
import { MeHead } from './MeLayout';
import { Chip, Empty, MeCard, Skel } from './kit';
import { LANGS, day } from './vetting/lib';
import { API, ROLES_API, avg, timeWords } from './interview/lib';
import '../../styles/me-vet.css';
import '../../styles/me-iv.css';

const Runner = lazy(lazyRetry(() => import('./interview/Runner')));
const IvResult = lazy(lazyRetry(() => import('./interview/IvResult')));
const FaceCheck = lazy(lazyRetry(() => import('./trust/FaceCheck'))); // Vetting Trust T3: ID + selfie before the interview
const SnapshotChoice = lazy(lazyRetry(() => import('./trust/Snapshots').then((m) => ({ default: m.SnapshotChoice })))); // Vetting Trust T8: optional webcam snapshots (own consent)
// Vetting Trust T9 (only for people Vetting Trust is on for: the server sends `retake` then): pledge, limits, explain note
const Pledge = lazy(lazyRetry(() => import('./trust/Honesty').then((m) => ({ default: m.Pledge }))));
const RetakeInfo = lazy(lazyRetry(() => import('./trust/Honesty').then((m) => ({ default: m.RetakeInfo }))));
const ExplainNote = lazy(lazyRetry(() => import('./trust/Honesty').then((m) => ({ default: m.ExplainNote }))));
const SpokenChoice = lazy(lazyRetry(() => import('./trust/Spoken').then((m) => ({ default: m.SpokenChoice })))); // Vetting Trust T10 (only when the server sends `spoken`)

function LastChip({ last }) {
  if (!last) return null;
  if (last.status === 'running') return <Chip tone="accent">Interview in progress</Chip>;
  if (last.status === 'answered' || last.status === 'review') return <Chip tone="info">Being graded</Chip>;
  if (last.passed) return <Chip tone="ok">Passed · {avg(last.average)}/5 · until {day(last.validUntil)}</Chip>;
  return <Chip tone="warn">Not yet · {avg(last.average)}/5</Chip>;
}

function RoleCard({ r, onStart, onResume }) {
  const last = r.last;
  const running = last?.status === 'running';
  return (
    <li className="mcard mcard-tight vet-role" data-testid="iv-role" data-test={r.test}>
      <div className="stack g4" style={{ minWidth: 0 }}>
        <strong className="vet-role-title">{r.role || r.test}</strong>
        <span className="xs muted">{r.test} · 7 questions · about 10 minutes</span>
      </div>
      <div className="mrow" style={{ gap: 6 }}>
        <Chip tone="ok">✓ Skill verified</Chip>
        {r.langs.length > 1 && <span className="xs">🗣 {r.langs.map((l) => LANGS[l].split(' ')[0]).join(' · ')}</span>}
        <LastChip last={last} />
      </div>
      <div className="vet-role-go">
        {running ? <button type="button" className="btn btn-signal" onClick={() => onResume(r)} data-testid="iv-resume">Carry on with the interview</button>
          : r.canStart ? <button type="button" className="btn btn-signal" onClick={() => onStart(r)} aria-label={`Start the interview: ${r.role || r.test}`} data-testid={`iv-start-${r.test}`}>{last ? 'Take it again' : 'Start'}</button>
            : <span className="xs muted" data-testid="iv-wait">Next try from {day(last?.againAt)}</span>}
        {last && !running && last.status !== 'answered' && <Link className="btn btn-outline" to={`/me/interviews/${last.id}`} aria-label={`See result: ${r.role || r.test}`} data-testid="iv-see">See result</Link>}
      </div>
    </li>
  );
}

function Setup({ r, d, onCancel, onGo }) {
  const [, siteLang] = useLang();
  const [lang, setLang] = useState(r.langs.includes(siteLang) ? siteLang : 'en');
  const canSpeak = speechSupported();
  const [mode, setMode] = useState('text');
  const [extra, setExtra] = useState(false);
  const [ok, setOk] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [pledge, setPledge] = useState(); // T9: undefined = not asked, null = not ticked yet, n = the version ticked
  const [spoken, setSpoken] = useState(false); // T10: also measure my spoken English (voice + English)
  const secs = (m) => Math.round((d.seconds?.[m] || (m === 'voice' ? 100 : 150)) * (extra ? 1.5 : 1));
  const go = async () => {
    setBusy(true); setErr('');
    try { await onGo({ test: r.test, lang, mode, extraTime: extra, consent: true, ...(pledge ? { pledge } : {}), ...(spoken && mode === 'voice' && lang === 'en' && canSpeak ? { spoken: true } : {}) }); } catch (e) { setErr(e.message); setBusy(false); }
  };
  return (
    <div className="mstack iv-setup" data-testid="iv-setup">
      <MeCard tone="flat" icon="🔒" title="Before you start: how the interview works" sub={`${r.role || r.test}. Please read this, then tick “I agree”.`} testid="iv-consent">
        <ul className="vet-consent-list iv-consent">
          <li><strong>What it is:</strong> 7 questions about your work for this role, about {d.minutes || 10} minutes. You can type or speak your answers. After an answer, the AI may ask one short follow-up about what you said.</li>
          <li><strong>Speaking:</strong> your speech is turned into text in your browser. No audio is recorded, stored or sent.</li>
          <li><strong>Timed:</strong> each answer has its own timer ({timeWords(secs('text'))} typed, {timeWords(secs('voice'))} spoken). When it ends, what you have is sent.</li>
          <li><strong>Typing:</strong> pasting is turned off, so please type in your own words. Leaving the page is counted.</li>
          <li><strong>Grading:</strong> {d.criteria.map((c) => c.label.toLowerCase()).join(', ')}; each out of 5. To pass: an average of {d.pass.average} or more and no line below {d.pass.min}. A pass makes you L3 “Interview-ready” for 180 days.</li>
          <li><strong>What is kept:</strong> the transcript (your answers as text) is kept for 180 days, then deleted. Companies you are shown to see a summary: your scores, 3 strengths, 1 concern and your answers.</li>
          <li>{r.retake ? <><strong>Attempts:</strong> {r.retake.attempts} every {r.retake.days} days for this role.</> : <><strong>One try</strong> per role every 30 days.</>}</li>
          <li className="vet-no"><strong>Your language is fine.</strong> English, Telugu or Hindi never lowers your score, unless the job itself needs English.</li>
        </ul>
        {r.retake && <Suspense fallback={null}><ExplainNote /><RetakeInfo rk={r.retake} what="interview" /></Suspense>}
      </MeCard>

      <section className="mcard stack g16" aria-labelledby="iv-opts-h">
        <h2 id="iv-opts-h" className="mcard-title">Your choices</h2>
        {r.langs.length > 1 && (
          <fieldset className="vet-fs">
            <legend className="vet-legend">Language of the questions</legend>
            <div className="vet-chips">
              {r.langs.map((l) => (
                <label key={l} className={`vet-pill ${lang === l ? 'on' : ''}`}>
                  <input type="radio" name="iv-lang" value={l} checked={lang === l} onChange={() => setLang(l)} data-testid={`iv-lang-${l}`} />
                  <span>{LANGS[l]}</span>
                </label>
              ))}
            </div>
          </fieldset>
        )}
        <fieldset className="vet-fs">
          <legend className="vet-legend">How you will answer</legend>
          <div className="vet-chips">
            {[['text', '⌨ Type my answers'], ['voice', '🎤 Speak my answers']].map(([m, l]) => (
              <label key={m} className={`vet-pill ${mode === m ? 'on' : ''}`}>
                <input type="radio" name="iv-mode" value={m} checked={mode === m} onChange={() => setMode(m)} data-testid={`iv-mode-${m}`} />
                <span>{l}</span>
              </label>
            ))}
          </div>
          {mode === 'voice' && !canSpeak && <span className="xs" style={{ color: '#92400e' }}>This browser can’t turn speech into text, so you will type instead. Chrome on Android works well for speaking.</span>}
        </fieldset>
        <label className="vet-check">
          <input type="checkbox" checked={extra} onChange={(e) => setExtra(e.target.checked)} data-testid="iv-extra" />
          <span><strong>I need extra time</strong><span className="xs muted" style={{ display: 'block' }}>For a disability, reading difficulty or a slow phone: 1½ times the time for each answer. It doesn’t change your score.</span></span>
        </label>
        {d.spoken && canSpeak && <Suspense fallback={null}><SpokenChoice d={d.spoken} mode={mode} lang={lang} on={spoken} onChange={setSpoken} /></Suspense>}
        <Suspense fallback={null}><SnapshotChoice kind="interview" /></Suspense>
        <Suspense fallback={null}><Pledge kind="interview" lang={lang} onChange={setPledge} /></Suspense>
        <label className="vet-check">
          <input type="checkbox" checked={ok} onChange={(e) => setOk(e.target.checked)} data-testid="iv-agree" />
          <span><strong>I agree</strong>: I have read how the interview works and what is kept.</span>
        </label>
        <p className="xs muted" style={{ margin: 0 }}>Find a quiet place with a steady connection. If it drops, come back to carry on.</p>
        {err && <p className="error" role="alert">{err}</p>}
        <div className="vet-actions">
          <button type="button" className="btn btn-signal btn-lg" disabled={!ok || busy || pledge === null} onClick={go} data-testid="iv-go">{busy ? 'Starting…' : 'Start the interview'}</button>
          <button type="button" className="btn btn-ghost" onClick={onCancel}>Not now</button>
        </div>
      </section>
    </div>
  );
}

/** Hidden from this person (Admin → Skill checks → Launch): nothing to see yet. */
export default function MeInterviews() {
  const on = useVettingOn();
  if (on == null) return <Skel cards={1} lines={3} label="Loading" />;
  if (!on) return <><MeHead title="Screening interview" /><Empty shape="badge" title="Not open yet">The screening interview is not open yet.</Empty></>;
  return <MeInterviewsPage />;
}

function MeInterviewsPage() {
  const { id } = useParams();
  const loc = useLocation();
  const nav = useNavigate();
  const [d, setD] = useState(null);
  const [err, setErr] = useState('');
  const [setup, setSetup] = useState(null);
  const [run, setRun] = useState(null);

  const load = () => http(ROLES_API).then(setD, (e) => setErr(e.message));
  useEffect(() => { load(); }, []);

  const [face, setFace] = useState(null); // Vetting Trust T3: the start body waiting for the ID + selfie check
  const begin = async (body) => {
    let iv;
    try { iv = await http(`${API}/start`, { method: 'POST', body }); } catch (e) {
      if (e.code === 'face_check_needed') { setFace(body); throw new Error(''); } // Setup stays, quietly ready again
      throw e;
    }
    setSetup(null); setRun(iv); window.scrollTo?.(0, 0);
  };
  const faceEl = face && (
    <Suspense fallback={null}>
      <FaceCheck mode="identity" step="interview" onClose={() => setFace(null)} onDone={() => { const b = face; setFace(null); begin(b).catch((e) => setErr(e.message)); }} />
    </Suspense>
  );
  const resume = (r) => { setErr(''); begin({ test: r.test, lang: r.last.lang, mode: r.last.mode, consent: true }).catch((e) => setErr(e.message)); };
  const done = (result) => { const iid = run.id; setRun(null); load(); nav(`/me/interviews/${iid}`, { state: { result } }); };

  if (run) {
    return (
      <>
        <MeHead title="Screening interview" sub={`${run.role || run.test} · answer in your own words. Each answer has its own timer.`} />
        <Suspense fallback={<Skel cards={1} lines={5} label="Opening the interview" />}>
          <Runner start={run} onDone={done} onError={(m) => { setRun(null); setErr(m); load(); }} />
        </Suspense>
      </>
    );
  }

  if (id) {
    return (
      <>
        <MeHead title="Your screening interview" right={<Link className="btn btn-ghost" to="/me/interviews">← All interviews</Link>} />
        <Suspense fallback={<Skel cards={1} lines={4} label="Loading your result" />}>
          <IvResult key={id} id={id} initial={loc.state?.result} pass={d?.pass} />
        </Suspense>
      </>
    );
  }

  const head = <MeHead title="AI screening interview" sub="Instead of a first phone call: 7 questions about your work, about 10 minutes, typed or spoken. Free." />;
  if (!d) return err ? <>{head}<p className="error" role="alert">{err}</p></> : <>{head}<Skel cards={2} label="Loading interviews" /></>;
  if (setup) return <>{head}<Setup r={setup} d={d} onCancel={() => setSetup(null)} onGo={begin} />{faceEl}</>;

  return (
    <>
      {head}
      <section className="mcard mcard-accent vet-hero" aria-labelledby="iv-hero-h" data-testid="iv-hero">
        <div className="stack g8" style={{ minWidth: 0 }}>
          <span className="mkicker">How it works</span>
          <h2 id="iv-hero-h" className="vet-h2">Become Interview-ready (L3)</h2>
          <ol className="vet-steps">
            <li><strong>Answer 7 questions</strong> about your experience, the role and your notice and salary, by typing or speaking.</li>
            <li><strong>Get feedback:</strong> a score out of 5 on {d.criteria.length} things, each with a reason, plus your strengths.</li>
            <li><strong>Pass</strong> (average {d.pass.average}+) and companies hiring now see you as Interview-ready for 180 days.</li>
          </ol>
        </div>
        {d.interviewReadyUntil
          ? <div className="vet-badge" data-testid="iv-ready"><strong>✓ L3 Interview-ready</strong><span className="xs">Until {day(d.interviewReadyUntil)}</span></div>
          : <span className="small muted">You need a current “Skill verified” badge for a role to take its interview.</span>}
      </section>

      {err && <p className="error" role="alert">{err}</p>}

      {d.roles.length === 0 ? (
        <Empty shape="cap" tint="student" title="Get skill verified first" testid="iv-none" action={<Link className="btn btn-signal" to="/me/skill-checks">Skill checks</Link>}>
          The interview opens for a role once you have its “Skill verified” badge: a short test and a practical task.
        </Empty>
      ) : (
        <section className="stack g12" aria-labelledby="iv-roles-h">
          <h2 id="iv-roles-h" className="vet-sec-h">Your roles ({d.roles.length})</h2>
          <ul className="vet-grid" data-testid="iv-roles">{d.roles.map((r) => <RoleCard key={r.test} r={r} onStart={(x) => { setErr(''); setSetup(x); window.scrollTo?.(0, 0); }} onResume={resume} />)}</ul>
        </section>
      )}

      {faceEl}
      <MeCard tone="flat" className="mcard-tight" icon="🔒" title="Fair and private" sub="No camera and no audio stored. Only what you say about the work is graded, never who you are or how you sound." headingLevel={2} />
    </>
  );
}
