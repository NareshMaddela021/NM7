// Get skill verified (Vetting V2): the 50 roles with a skill check, grouped (tech, business, trades, health) with a
// search, the roles suggested from the person's resume and from live-job demand, and a plain-words consent card the
// first time (what the test page notices; no camera). A check is 18 questions in about 15 minutes for an experience
// band (extra time on request), in English or (for some roles) Telugu / Hindi. A pass (70+) opens a short practical
// task; both together give "Skill verified" for 90 days. One try per role every 30 days.
// The test (vetting/TestRunner) and the result + task (vetting/Result, vetting/Task) load only when needed.
// /me/skill-checks/:id shows one result; ?skill=<test>[&band=<band>] opens the start dialog for that role.
// Vetting V5 re-verify: from 15 days before a badge ends (and up to 30 days after), the badge list and the role card
// offer "Renew your badge: 8 questions, ~5 min" (POST start with refresh: true; the same test runner); the reminder
// email's link ?refresh=<test> opens that prompt.
import { Suspense, lazy, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { Dialog } from '../../components/ui';
import { http } from '../../services/http';
import { lazyRetry } from '../../lib/chunks';
import { useLang } from '../../lib/i18n';
import { useVettingOn } from '../../lib/vettingAccess';
import { useTrustOn } from '../../lib/trustAccess';
import { MeHead } from './MeLayout';
import { Chip, Empty, MeCard, Skel, Stat } from './kit';
import { API, GROUPS, LANGS, RUN_KEY, TASKS, badgeLine, day, readStore, renewState, writeStore } from './vetting/lib';
import '../../styles/me-vet.css';
import { IcArrowLeft, IcCheck, IcLock } from '../../components/icons';

const Classic = lazy(lazyRetry(() => import('./MeSkillChecksClassic')));
const TestRunner = lazy(lazyRetry(() => import('./vetting/TestRunner')));
const Result = lazy(lazyRetry(() => import('./vetting/Result')));
const FaceCheck = lazy(lazyRetry(() => import('./trust/FaceCheck'))); // Vetting Trust T3: ID + selfie before a test
const SnapshotChoice = lazy(lazyRetry(() => import('./trust/Snapshots').then((m) => ({ default: m.SnapshotChoice })))); // Vetting Trust T8: optional webcam snapshots (own consent)
const Pledge = lazy(lazyRetry(() => import('./trust/Honesty').then((m) => ({ default: m.Pledge })))); // Vetting Trust T9: honesty pledge (Trust only)
const RetakeInfo = lazy(lazyRetry(() => import('./trust/Honesty').then((m) => ({ default: m.RetakeInfo })))); // T9: retake limits
const WorkTests = lazy(lazyRetry(() => import('./trust/WorkTests'))); // Vetting Trust T15: typing, SJT, aptitude (Trust only)
const tries = (cat) => (cat.retakeAttempts > 1 ? `${cat.retakeAttempts} tries` : 'One try'); // T9: Admin may allow more

const MONITORED = [
  ['Leaving the test page', 'how many times, and for how long'],
  ['Copy and paste', 'how often (nothing is blocked)'],
  ['Right-click and developer tools', 'whether they were opened'],
  ['Answer timing', 'how long each answer took'],
  ['A device and network check', 'a scrambled code (a hash), never your contacts, files or location'],
];

function ConsentList() {
  return (
    <ul className="vet-consent-list">
      {MONITORED.map(([a, b]) => <li key={a}><strong>{a}</strong>: {b}.</li>)}
      <li className="vet-no"><strong>No camera.</strong> The microphone is used only in speaking tasks, and your speech is turned into text in your browser. No audio is stored or sent.</li>
      <li className="vet-no">Companies never see these checks, only your badge and scores.</li>
    </ul>
  );
}

function ConsentCard({ onDone }) {
  const [ok, setOk] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const go = async () => {
    setBusy(true); setErr('');
    try { onDone((await http(`${API}/consent`, { method: 'POST' })).consentAt); } catch (e) { setErr(e.message); setBusy(false); }
  };
  return (
    <MeCard tone="flat" icon={<IcLock />} title="Before your first test: what we check" sub="So results are fair for everyone, the test page notices a few things while you take it." testid="vt-consent" id="vt-consent">
      <ConsentList />
      <label className="vet-check">
        <input type="checkbox" checked={ok} onChange={(e) => setOk(e.target.checked)} aria-label="I understand what is checked during the test" data-testid="vt-consent-tick" />
        <span>I understand what is checked during the test</span>
      </label>
      {err && <p className="error" role="alert">{err}</p>}
      <div className="mrow"><button type="button" className="btn btn-signal" disabled={!ok || busy} onClick={go} data-testid="vt-consent-go">{busy ? 'Saving…' : 'Continue'}</button></div>
    </MeCard>
  );
}

export function RoleCard({ r, cat, onStart, onRenew }) {
  const last = r.last;
  // an older skill check (before Vetting V2, v 1) has no result page or test runner here: its score is shown only
  // (full site test, 19 Nov: "See result" opened "That test isn't here.")
  const v2 = last?.v === 2;
  const running = v2 && !last.done;
  const renew = renewState(r.verified);
  const nQ = Math.min(cat.questions, r.questions);
  return (
    <li className="mcard mcard-tight vet-role" data-testid="vt-role" data-test={r.test}>
      <div className="stack g4" style={{ minWidth: 0 }}>
        <strong className="vet-role-title">{r.role}</strong>
        <span className="xs muted">{r.test} · {nQ} questions · {TASKS[r.task] || 'Practical task'}</span>
      </div>
      <div className="vet-role-meta">
        {r.langs.length > 1 && <span className="xs">Languages: {r.langs.map((l) => LANGS[l].split(' ')[0]).join(' · ')}</span>}
        <span className="xs">{r.demand ? `${r.demand} live job${r.demand === 1 ? '' : 's'}` : 'No live jobs right now'}</span>
      </div>
      {(r.verified || last) && (
        <div className="mrow" style={{ gap: 6 }}>
          {r.verified && !r.verified.expired && <Chip tone="ok"><IcCheck size={14} /> Verified · {r.verified.score}/100</Chip>}
          {r.verified?.expired && <Chip tone="warn">Badge expired</Chip>}
          {r.verified && !r.verified.expired && renew.open && <Chip tone="warn">Ends in {renew.daysLeft} day{renew.daysLeft === 1 ? '' : 's'}</Chip>}
          {last?.done && !r.verified && (last.retest ? <Chip tone="info">Free retest offered</Chip> : <Chip tone={last.pass ? 'ok' : 'warn'}>Last score {last.score}/100</Chip>)}
          {running && <Chip tone="accent">Test in progress</Chip>}
        </div>
      )}
      <div className="vet-role-go">
        {!running && renew.open && <button type="button" className="btn btn-signal" onClick={() => onRenew(r)} aria-label={`Renew your badge: ${r.role}`} data-testid={`vt-renew-${r.test}`}>Renew badge</button>}
        {running ? <button type="button" className="btn btn-signal" onClick={() => onStart(r, { resume: true })} data-testid={`sk-start-${r.test}`}>Carry on with the test</button>
          : r.canStart ? <button type="button" className={`btn ${renew.open ? 'btn-outline' : 'btn-signal'}`} onClick={() => onStart(r)} aria-label={`Start: ${r.role}`} data-testid={`sk-start-${r.test}`}>{last?.freeRetest ? 'Start free retest' : 'Start'}</button>
            : !renew.open && <span className="xs muted" data-testid="vt-wait">Next try from {day(last?.againAt)}</span>}
        {v2 && last.done && <Link className="btn btn-outline" to={`/me/skill-checks/${last.id}`} aria-label={`See result: ${r.role}`}>See result</Link>}
      </div>
    </li>
  );
}

function StartDialog({ r, cat, preset, needConsent, onConsent, onClose, onGo }) {
  const [, siteLang] = useLang();
  const [band, setBand] = useState(cat.bands.some((b) => b.id === preset?.band) ? preset.band : 'fresher');
  const [lang, setLang] = useState(r.langs.includes(siteLang) ? siteLang : 'en');
  const [extra, setExtra] = useState(false);
  const [ok, setOk] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [pledge, setPledge] = useState(); // T9: undefined = not asked, null = not ticked yet, n = the version ticked
  const go = async () => {
    setBusy(true); setErr('');
    try {
      if (needConsent) onConsent((await http(`${API}/consent`, { method: 'POST' })).consentAt);
      await onGo({ skill: r.test, band, lang, extraTime: extra, ...(pledge ? { pledge } : {}) });
    } catch (e) { setErr(e.message); setBusy(false); }
  };
  const minutes = extra ? cat.minutes * 1.5 : cat.minutes;
  return (
    <Dialog title={`Start: ${r.role}`} onClose={onClose} showTitle>
      <div className="stack g16" data-testid="vt-start">
        {/* Batch C item 27: the short version first, the details behind "Read more" */}
        <p className="small" style={{ margin: 0 }} data-testid="vt-start-short"><strong>{cat.questions} questions, about {String(minutes).replace('.5', '½')} minutes.</strong> Pass mark {cat.pass}/100.</p>
        <details className="vet-more" data-testid="vt-read-more">
          <summary className="small">Read more</summary>
          <div className="stack g8 small" style={{ marginTop: 8 }}>
            <span>Each question has its own timer and moves on by itself. {tries(cat)} every {cat.retakeDays} days.</span>
            <span>Find a quiet place with a steady connection. If the connection drops, come back within 10 minutes to carry on.</span>
            {r.retake && <Suspense fallback={null}><RetakeInfo rk={r.retake} /></Suspense>}
          </div>
        </details>
        <fieldset className="vet-fs">
          <legend className="vet-legend">Your experience</legend>
          <div className="vet-chips">
            {cat.bands.map((b) => (
              <label key={b.id} className={`vet-pill ${band === b.id ? 'on' : ''}`}>
                <input type="radio" name="vt-band" value={b.id} checked={band === b.id} onChange={() => setBand(b.id)} data-testid={`vt-band-${b.id}`} />
                <span>{b.label}</span>
              </label>
            ))}
          </div>
          <span className="xs muted">More experience means harder questions.</span>
        </fieldset>
        {r.langs.length > 1 && (
          <fieldset className="vet-fs">
            <legend className="vet-legend">Language of the questions</legend>
            <div className="vet-chips">
              {r.langs.map((l) => (
                <label key={l} className={`vet-pill ${lang === l ? 'on' : ''}`}>
                  <input type="radio" name="vt-lang" value={l} checked={lang === l} onChange={() => setLang(l)} data-testid={`vt-lang-${l}`} />
                  <span>{LANGS[l]}</span>
                </label>
              ))}
            </div>
          </fieldset>
        )}
        <label className="vet-check">
          <input type="checkbox" checked={extra} onChange={(e) => setExtra(e.target.checked)} aria-label="I need extra time" data-testid="vt-extra" />
          <span><strong>I need extra time</strong><span className="xs muted" style={{ display: 'block' }}>1½ times the time. It doesn’t change your score.</span></span>
        </label>
        <Suspense fallback={null}><SnapshotChoice kind="skill" /></Suspense>
        {needConsent && (
          <div className="stack g8">
            <details className="vet-more"><summary className="small"><strong>What the test page checks</strong> (read more)</summary><ConsentList /></details>
            <label className="vet-check">
              <input type="checkbox" checked={ok} onChange={(e) => setOk(e.target.checked)} aria-label="I understand what is checked during the test" data-testid="vt-consent-tick-dialog" />
              <span>I understand what is checked during the test</span>
            </label>
          </div>
        )}
        <Suspense fallback={null}><Pledge kind="skill" lang={lang} onChange={setPledge} /></Suspense>
        {err && <p className="error" role="alert">{err}</p>}
        <div className="vet-actions">
          <button type="button" className="btn btn-signal btn-lg" disabled={busy || (needConsent && !ok) || pledge === null} onClick={go} data-testid="vt-go">{busy ? 'Starting…' : 'Start the test'}</button>
          <button type="button" className="btn btn-ghost" onClick={onClose}>Not now</button>
        </div>
      </div>
    </Dialog>
  );
}

function RenewDialog({ r, needConsent, onConsent, onClose, onGo }) {
  const [, siteLang] = useLang();
  const v = r.verified;
  const st = renewState(v);
  const [lang, setLang] = useState(r.langs.includes(siteLang) ? siteLang : 'en');
  const [extra, setExtra] = useState(false);
  const [ok, setOk] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [pledge, setPledge] = useState(); // T9 (see StartDialog)
  const go = async () => {
    setBusy(true); setErr('');
    try {
      if (needConsent) onConsent((await http(`${API}/consent`, { method: 'POST' })).consentAt);
      await onGo({ skill: r.test, band: v.band, lang, extraTime: extra, refresh: true, ...(pledge ? { pledge } : {}) });
    } catch (e) { setErr(e.message); setBusy(false); }
  };
  return (
    <Dialog title={`Renew your badge: ${r.role}`} onClose={onClose} showTitle>
      <div className="stack g16" data-testid="vt-renew">
        <p className="small" style={{ margin: 0 }}><strong>8 questions, about 5 minutes</strong>, at the same level as your badge ({v.bandLabel}). Score 70 or more and your badge lasts another 90 days.</p>
        <p className="xs muted" style={{ margin: 0 }}>{st.expired ? `Your badge ended on ${day(v.expiresAt)}. You can still renew it until ${day(v.expiresAt + 30 * 86_400_000)}.` : `Your badge ends on ${day(v.expiresAt)}.`} If you skip it, the badge shows as expired.</p>
        {r.langs.length > 1 && (
          <fieldset className="vet-fs">
            <legend className="vet-legend">Language of the questions</legend>
            <div className="vet-chips">
              {r.langs.map((l) => (
                <label key={l} className={`vet-pill ${lang === l ? 'on' : ''}`}>
                  <input type="radio" name="vt-rlang" value={l} checked={lang === l} onChange={() => setLang(l)} />
                  <span>{LANGS[l]}</span>
                </label>
              ))}
            </div>
          </fieldset>
        )}
        <label className="vet-check">
          <input type="checkbox" checked={extra} onChange={(e) => setExtra(e.target.checked)} aria-label="I need extra time" />
          <span><strong>I need extra time</strong><span className="xs muted" style={{ display: 'block' }}>1½ times the time. It doesn’t change your score.</span></span>
        </label>
        {needConsent && (
          <div className="stack g8">
            <details className="vet-more"><summary className="small"><strong>What the test page checks</strong> (read more)</summary><ConsentList /></details>
            <label className="vet-check">
              <input type="checkbox" checked={ok} onChange={(e) => setOk(e.target.checked)} aria-label="I understand what is checked during the test" />
              <span>I understand what is checked during the test</span>
            </label>
          </div>
        )}
        <Suspense fallback={null}><Pledge kind="skill" lang={lang} onChange={setPledge} /></Suspense>
        {r.retake?.refreshDays && <p className="xs muted" style={{ margin: 0 }}>If the refresher doesn’t renew your badge, you can take it again after {r.retake.refreshDays} days.</p>}
        {err && <p className="error" role="alert">{err}</p>}
        <div className="vet-actions">
          <button type="button" className="btn btn-signal btn-lg" disabled={busy || (needConsent && !ok) || pledge === null} onClick={go} data-testid="vt-renew-go">{busy ? 'Starting…' : 'Start the refresher'}</button>
          <button type="button" className="btn btn-ghost" onClick={onClose}>Not now</button>
        </div>
      </div>
    </Dialog>
  );
}

/** Vetting V2 for people who get it (Admin -> Skill checks -> Launch), else the skill checks as before. */
export default function MeSkillChecks() {
  const on = useVettingOn();
  if (on == null) return <Skel cards={2} lines={3} label="Loading skill checks" />;
  return on ? <MeSkillChecksV2 /> : <Suspense fallback={<Skel cards={2} lines={3} label="Loading skill checks" />}><Classic /></Suspense>;
}

function MeSkillChecksV2() {
  const trust = useTrustOn(); // Vetting Trust T15: the work tests card
  const { id } = useParams();
  const loc = useLocation();
  const nav = useNavigate();
  const [params, setParams] = useSearchParams();
  const [cat, setCat] = useState(null);
  const [err, setErr] = useState('');
  const [paper, setPaper] = useState(null);
  const [dialog, setDialog] = useState(null); // { r, preset }
  const [renewing, setRenewing] = useState(null); // a role whose badge is being renewed
  const [notice, setNotice] = useState('');
  const [q, setQ] = useState('');
  const [group, setGroup] = useState('all');
  const resumed = useRef(false);

  const load = () => http(API).then(setCat, (e) => setErr(e.message));
  useEffect(() => { load(); }, []);

  const [face, setFace] = useState(null); // Vetting Trust T3: the start body waiting for the ID + selfie check
  const begin = async (body) => {
    let p;
    try { p = await http(`${API}/start`, { method: 'POST', body }); } catch (e) {
      if (e.code === 'face_check_needed') { setDialog(null); setRenewing(null); setFace(body); return; }
      throw e;
    }
    writeStore(RUN_KEY, { ...body, id: p.id });
    setDialog(null);
    setRenewing(null);
    setPaper({ ...p, refresh: !!body.refresh });
    window.scrollTo?.(0, 0);
  };

  // a reload in the middle of a test: the same paper comes back with the answers and the time that was left
  useEffect(() => {
    if (!cat || resumed.current) return;
    resumed.current = true;
    const run = readStore(RUN_KEY);
    const role = run && cat.roles.find((r) => r.test === run.skill);
    if (run && role?.last && !role.last.done && role.last.id === run.id) begin(run).catch((e) => { writeStore(RUN_KEY, null); setErr(e.message); });
    else if (run) writeStore(RUN_KEY, null);
  }, [cat]); // eslint-disable-line react-hooks/exhaustive-deps

  // ?skill=<test>: open that role's start dialog (links from Find my role, Learning paths, a result's free retest)
  const want = params.get('skill');
  useEffect(() => {
    if (!cat || id || !want) return;
    const r = cat.roles.find((x) => x.test.toLowerCase() === want.toLowerCase() || x.slug === want);
    if (r?.canStart && !(r.last && !r.last.done)) setDialog({ r, preset: { band: params.get('band') || r.last?.band } });
  }, [cat, id, want]); // eslint-disable-line react-hooks/exhaustive-deps

  // ?refresh=<test> (the reminder email's link): open that badge's refresher prompt, or say why it isn't open
  const wantRefresh = params.get('refresh');
  useEffect(() => {
    if (!cat || id || !wantRefresh) return;
    const r = cat.roles.find((x) => x.test.toLowerCase() === wantRefresh.toLowerCase() || x.slug === wantRefresh);
    const st = renewState(r?.verified);
    if (r && st.open && !(r.last && !r.last.done)) { setRenewing(r); return; }
    setNotice(!r?.verified ? 'You don’t have this badge yet. Take the skill check to earn it.'
      : r.last && !r.last.done ? 'You have a test in progress for this role. Carry on with it first.'
        : st.daysLeft > 0 ? `The refresher opens 15 days before your badge ends (it ends on ${day(r.verified.expiresAt)}).`
          : 'This badge ended more than 30 days ago. Take the full skill check to earn it again.');
    setParams({}, { replace: true });
  }, [cat, id, wantRefresh]); // eslint-disable-line react-hooks/exhaustive-deps

  const onRenew = (r) => { setErr(''); setNotice(''); setRenewing(r); };
  const closeRenew = () => { setRenewing(null); if (wantRefresh) setParams({}, { replace: true }); };

  const onStart = (r, { resume } = {}) => {
    setErr('');
    if (resume) { begin({ skill: r.test, band: r.last.band, lang: r.last.lang, ...(r.last.kind === 'refresh' ? { refresh: true } : {}) }).catch((e) => setErr(e.message)); return; }
    setDialog({ r, preset: { band: r.last?.band } });
  };
  const closeDialog = () => { setDialog(null); if (want) setParams({}, { replace: true }); };

  const finished = (result) => {
    const pid = paper.id;
    writeStore(RUN_KEY, null);
    setPaper(null);
    load();
    nav(`/me/skill-checks/${pid}`, { state: result ? { result } : null });
  };

  const verifiedCount = cat ? cat.roles.filter((r) => r.verified && !r.verified.expired).length : 0;
  const taken = cat ? cat.roles.filter((r) => r.last?.done).length : 0;
  const shown = useMemo(() => {
    if (!cat) return [];
    const s = q.trim().toLowerCase();
    return cat.roles.filter((r) => (group === 'all' || r.group === group) && (!s || `${r.role} ${r.test}`.toLowerCase().includes(s)));
  }, [cat, q, group]);
  const suggested = useMemo(() => {
    if (!cat) return [];
    const byTest = Object.fromEntries(cat.roles.map((r) => [r.test, r]));
    const list = [...cat.roles.filter((r) => r.suggested).map((r) => r.test), ...(cat.topDemand || [])];
    return [...new Set(list)].map((t) => byTest[t]).filter(Boolean).slice(0, 6);
  }, [cat]);

  if (paper) {
    return (
      <>
        <MeHead title={paper.refresh ? 'Badge refresher' : 'Skill check'} sub={`${paper.role || paper.skill} · ${paper.questions.length} questions. Pick one answer for each; it is sent by itself when the time ends.`} />
        <Suspense fallback={<Skel cards={1} lines={5} label="Opening the test" />}>
          <TestRunner paper={paper} onDone={finished} onError={(m) => { writeStore(RUN_KEY, null); setPaper(null); setErr(m); load(); }} />
        </Suspense>
      </>
    );
  }

  if (id) {
    const retest = (r) => nav(`/me/skill-checks?skill=${encodeURIComponent(r.skill)}&band=${encodeURIComponent(r.band)}`);
    return (
      <>
        <MeHead title="Your skill check result" right={<Link className="btn btn-ghost" to="/me/skill-checks"><IcArrowLeft size={16} /> All skill checks</Link>} />
        <Suspense fallback={<Skel cards={1} lines={4} label="Loading your result" />}>
          <Result key={id} id={id} initial={loc.state?.result} onRetest={retest} />
        </Suspense>
      </>
    );
  }

  const head = <MeHead title="Get skill verified" sub="Show companies what you can do: a short test, then a small real-work task. Free." />;
  if (!cat) return err ? <>{head}<p className="error" role="alert">{err}</p></> : <>{head}<Skel cards={4} label="Loading skill checks" /></>;
  const badges = cat.roles.filter((r) => r.verified);

  return (
    <>
      {head}
      <section className="mcard mcard-accent vet-hero" aria-labelledby="vt-hero-h" data-testid="vt-hero">
        <div className="stack g8" style={{ minWidth: 0 }}>
          <span className="mkicker">How it works</span>
          <h2 id="vt-hero-h" className="vet-h2">Get skill verified in 3 steps</h2>
          <ol className="vet-steps">
            <li><strong>Test:</strong> {cat.questions} questions, about {cat.minutes} minutes, at your experience level. Pass mark {cat.pass}.</li>
            <li><strong>Practical task:</strong> a short real-work task (writing, speaking or work situations). Pass mark {cat.taskPass}.</li>
            <li><strong>Badge:</strong> “Skill verified” on your profile for {cat.validDays} days. Companies hiring now see it.</li>
          </ol>
        </div>
        <div className="vet-hero-stats">
          <Stat label="Verified" value={verifiedCount} tone={verifiedCount ? 'ok' : undefined} testid="vt-verified-count" />
          <Stat label="Tests taken" value={taken} sub={`${tries(cat).toLowerCase()} per role every ${cat.retakeDays} days`} />
        </div>
      </section>

      {badges.length > 0 && (
        <ul className="mlist" aria-label="Your badges" data-testid="vt-badges">
          {badges.map((r) => {
            const st = renewState(r.verified);
            const running = r.last && !r.last.done;
            return (
              <li key={r.test} className="vet-badge-row" data-testid="vt-badge" data-test={r.test}>
                <div className={`vet-badge ${st.expired ? 'expired' : ''}`}>
                  <strong><IcCheck size={14} /> {badgeLine(r.verified, r.role)}</strong>
                  <span className="xs">{st.expired ? <><strong>expired</strong> · ended {day(r.verified.expiresAt)}</> : `Valid until ${day(r.verified.expiresAt)}`}</span>
                </div>
                {st.open && !running && (
                  <div className="vet-renew" data-testid="vt-renew-prompt">
                    <span><strong>Renew your badge: 8 questions, ~5 min</strong>{st.expired ? '' : ` · ends in ${st.daysLeft} day${st.daysLeft === 1 ? '' : 's'}`}</span>
                    <button type="button" className="btn btn-signal" onClick={() => onRenew(r)} aria-label={`Renew your badge: ${r.role}`}>Renew now</button>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {notice && <p className="vet-calm small" role="status" data-testid="vt-notice">{notice}</p>}

      {err && <p className="error" role="alert">{err}</p>}
      {!cat.consentAt && <ConsentCard onDone={(at) => setCat({ ...cat, consentAt: at })} />}

      {cat.roles.length === 0 ? (
        <Empty shape="cap" tint="student" title="No skill checks yet" action={<Link className="btn btn-signal" to="/me/practice">Practise for free</Link>}>Skill checks are being added. Practice tests are open now.</Empty>
      ) : (
        <>
          {suggested.length > 0 && (
            <section className="stack g12" aria-labelledby="vt-sug-h">
              <div className="stack g2">
                <h2 id="vt-sug-h" className="vet-sec-h">Suggested for you</h2>
                <span className="xs muted">From your resume and the jobs companies are hiring for now.</span>
              </div>
              <ul className="vet-grid" data-testid="vt-suggested">{suggested.map((r) => <RoleCard key={r.test} r={r} cat={cat} onStart={onStart} onRenew={onRenew} />)}</ul>
            </section>
          )}

          <section className="stack g12" aria-labelledby="vt-all-h">
            <h2 id="vt-all-h" className="vet-sec-h">All roles ({cat.roles.length})</h2>
            <div className="vet-filters">
              <div className="field vet-search">
                <label className="label" htmlFor="vt-search">Search roles</label>
                <input id="vt-search" className="input" type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="e.g. electrician, SQL, sales" data-testid="vt-search" />
              </div>
              <div className="vet-chips" role="group" aria-label="Show roles in">
                {[['all', 'All'], ...GROUPS].map(([k, l]) => (
                  <button key={k} type="button" className={`vet-pill ${group === k ? 'on' : ''}`} aria-pressed={group === k} onClick={() => setGroup(k)} data-testid={`vt-group-${k}`}>{l.split(' ')[0]}</button>
                ))}
              </div>
            </div>
            <div data-testid="sk-list" className="stack g16">
              {GROUPS.map(([g, label]) => {
                const rs = shown.filter((r) => r.group === g);
                if (!rs.length) return null;
                return (
                  <div key={g} className="stack g8">
                    <h3 className="vet-group-h">{label} <span className="xs muted">({rs.length})</span></h3>
                    <ul className="vet-grid">{rs.map((r) => <RoleCard key={r.test} r={r} cat={cat} onStart={onStart} onRenew={onRenew} />)}</ul>
                  </div>
                );
              })}
              {shown.length === 0 && <Empty compact shape="cap" tint="student" title="No role matches">Try another word, or pick “All”.</Empty>}
            </div>
          </section>
        </>
      )}

      {trust && <Suspense fallback={null}><WorkTests /></Suspense>}
      <MeCard tone="flat" className="mcard-tight" icon={<IcLock />} title="Fair and private" sub="No camera and no screen recording. Companies see only your badge and scores, and only if you choose to show the score." headingLevel={2} />
      {renewing && <RenewDialog r={renewing} needConsent={!cat.consentAt} onConsent={(at) => setCat({ ...cat, consentAt: at })} onClose={closeRenew} onGo={begin} />}
      {face && (
        <Suspense fallback={null}>
          <FaceCheck mode="identity" step="skill_check" onClose={() => setFace(null)} onDone={() => { const b = face; setFace(null); begin(b).catch((e) => setErr(e.message)); }} onLater={() => { const b = face; setFace(null); begin({ ...b, noCamera: true }).catch((e) => setErr(e.message)); }} />
        </Suspense>
      )}
      {dialog && <StartDialog r={dialog.r} cat={cat} preset={dialog.preset} needConsent={!cat.consentAt} onConsent={(at) => setCat({ ...cat, consentAt: at })} onClose={closeDialog} onGo={begin} />}
    </>
  );
}
