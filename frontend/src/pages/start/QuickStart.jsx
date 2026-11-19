// Profile setup P1: the quick start after "What would you like to do?" — one question per screen (big tap choices
// on a phone, a compact card on a desktop), then the role's first results page:
//   /start/jobseeker → Jobs matched for you · /start/student → Internships and projects for you ·
//   /start/expert → Your expert application. /start/<role>?all=1 goes through every step again ("Change my answers").
// Every answer is saved at once (lib/quickStart.js → PUT /api/me/setup/<role>); a reload or a later visit picks up at
// the same step. Every step has "Skip for now", and "Browse jobs" is always there. Steps already answered by the
// person's existing data are passed (pre-filled when going through all of them). Its own lazy chunk.
import { Suspense, lazy, useEffect, useRef, useState } from 'react';
import { Link, Navigate, useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { Logo, ThemeToggle } from '../../components/Header';
import { Spinner } from '../../components/ui';
import { homeFor, useAuth } from '../../lib/auth';
import { usePageMeta } from '../../lib/meta';
import { ROLE_NAMES, activeRoleOf, rolesOf, switchRole } from '../../lib/roles';
import { DOMAINS } from '../../lib/expert';
import {
  CITIES, COURSES, EXPERIENCE, LOOKING, MAX_CITIES, QS_ROLES, RESULTS_TITLE, SERVICES, STEP_TEXT, YEARS,
  getSetup, nearestCity, nextStep, prevStep, putSetup, resultsPath, resumeStep, stepsFor, suggest, withAnswer, answered,
} from '../../lib/quickStart';
import { AgeGate, ParentAsk } from '../me/trust/AgeParent';
import Results from './Results';
import '../../styles/quick-start.css';

const FillFaster = lazy(() => import('../me/MeProfile').then((m) => ({ default: m.FillFaster })));
const ExpertFaster = lazy(() => import('./ExpertFaster'));
const Waiting = () => <main className="container row g8" style={{ padding: 40 }} aria-busy="true"><Spinner /><span className="muted">Loading…</span></main>;

export default function QuickStart() {
  const [role, view] = (useParams()['*'] || '').split('/');
  const { user, ready } = useAuth();
  const { pathname, search } = useLocation();
  const [sp] = useSearchParams();
  const all = sp.get('all') === '1';
  if (!ready) return <Waiting />;
  if (!user) return <Navigate to={`/login?next=${encodeURIComponent(pathname + search)}`} replace />;
  if (user.role === 'admin') return <Navigate to="/admin" replace />;
  if (user.rolesPending) return <Navigate to="/welcome" replace />;
  if (!QS_ROLES.includes(role)) return <Navigate to={homeFor(user)} replace />;
  if (!rolesOf(user).includes(role)) return <Navigate to={`/welcome?add=1&role=${role}`} replace />;
  return <Flow key={`${role}${all ? '-all' : ''}`} role={role} results={view === 'results'} all={all} user={user} />;
}

/** One save at a time, in order; the last result's state is kept. */
function useSaver(role, readOnly) {
  const chain = useRef(Promise.resolve());
  const [status, setStatus] = useState('');
  const save = (body) => {
    if (readOnly) { setStatus('readonly'); return chain.current; }
    setStatus('saving');
    chain.current = chain.current.then(() => putSetup(role, body)).then(
      (s) => { setStatus('saved'); return s; },
      () => { setStatus('error'); return null; },
    );
    return chain.current;
  };
  return [save, status];
}

function Flow({ role, results, all, user }) {
  const nav = useNavigate();
  const readOnly = !!user.view?.readOnly;
  const [st, setSt] = useState(null);
  const [err, setErr] = useState('');
  const [answers, setAnswers] = useState({});
  const [skipped, setSkipped] = useState([]);
  const [step, setStep] = useState(null);
  const [save, status] = useSaver(role, readOnly);
  const head = useRef(null);
  usePageMeta({ title: results ? RESULTS_TITLE[role] : 'Quick start', noindex: true });

  const finish = () => {
    save({ step: 'results', done: true });
    nav(resultsPath(role), { replace: !results });
  };
  useEffect(() => {
    let dead = false;
    (async () => {
      try {
        // the role's own dashboard follows: switch to it first (never inside an admin's view)
        if (!user.view && activeRoleOf(user) !== role) await switchRole(role).catch(() => {});
        const s = await getSetup(role);
        if (dead) return;
        setSt(s); setAnswers(s.answers); setSkipped(s.skipped);
        if (results) return;
        const first = resumeStep(s.steps, s.answers, s.skipped, s.savedStep, s.done, all);
        if (first === 'results') finish(); else setStep(first);
      } catch (x) { if (!dead) setErr(x.message || 'Please try again.'); }
    })();
    return () => { dead = true; };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (step) head.current?.focus({ preventScroll: false }); }, [step]);

  if (err) return <Frame role={role}><div className="qs-card stack g12" role="alert"><strong>We couldn’t open your quick start.</strong><span className="small muted">{err}</span><div className="row g8"><button type="button" className="btn btn-ink" onClick={() => window.location.reload()}>Try again</button><Link to="/jobs" className="btn btn-outline">Browse jobs</Link></div></div></Frame>;
  if (!st) return <Frame role={role}><div className="row g8 muted" aria-busy="true"><Spinner />Loading…</div></Frame>;
  if (results) return <Frame role={role} wide><Results role={role} answers={answers} user={user} /></Frame>;
  if (!step) return <Frame role={role}><div className="row g8 muted" aria-busy="true"><Spinner />Loading…</div></Frame>;

  const switches = st.switches || {};
  const steps = stepsFor(role, answers, switches);
  const idx = Math.max(0, steps.indexOf(step));
  const move = (a, sk, body) => {
    const n = nextStep(stepsFor(role, a, switches), a, sk, step, all);
    setAnswers(a); setSkipped(sk);
    save({ ...body, step: n, done: n === 'results' });
    if (n === 'results') nav(resultsPath(role)); else setStep(n);
  };
  const answer = (patch) => { const a = withAnswer(answers, patch); move(a, skipped.filter((s) => !answered(s, a)), { answers: patch }); };
  const derived = (patch) => { const a = { ...answers, ...patch }; move(a, skipped, {}); }; // worked out by the server (the age step)
  const skip = () => move(answers, [...new Set([...skipped, step])], { skip: [step] });
  const back = () => { const p = prevStep(steps, step); if (p) { setStep(p); save({ step: p }); } };
  const [q, reward] = STEP_TEXT[step];
  const props = { role, answers, switches, onAnswer: answer, onDerived: derived, prefilled: st.prefilled.includes(stepKey(step)) };
  const Step = STEPS[step];
  return (
    <Frame role={role} progress={{ at: idx + 1, of: steps.length }}>
      <section className="qs-card stack g16" aria-labelledby="qs-q" data-testid="qs-step" data-step={step}>
        <div className="stack g4">
          {idx === 0 && !all && <span className="small muted">Hi {(user.name || '').split(' ')[0]}, a few quick questions. Every one can be skipped.</span>}
          <h1 id="qs-q" ref={head} tabIndex={-1} className="qs-q">{q}</h1>
          <p className="qs-reward" data-testid="qs-reward"><span aria-hidden="true">✓ </span>{reward}</p>
          {props.prefilled && <span className="xs muted" data-testid="qs-prefilled">From your profile. Change it, or continue.</span>}
        </div>
        <Step {...props} />
        <div className="qs-foot">
          {prevStep(steps, step) && <button type="button" className="btn btn-ghost" onClick={back}>Back</button>}
          <button type="button" className="btn btn-outline qs-skip" onClick={skip} data-testid="qs-skip">Skip for now</button>
        </div>
        <SaveNote status={status} />
      </section>
    </Frame>
  );
}

const stepKey = (s) => ({ city: 'cities' }[s] || s);

function SaveNote({ status }) {
  const text = { saving: 'Saving…', saved: 'Saved', error: 'Not saved: check your connection. Your answers stay on this screen.', readonly: 'Read-only view: answers are not saved.' }[status];
  return <span className={`xs ${status === 'error' ? 'error' : 'muted'}`} aria-live="polite" data-testid="qs-saved">{text || ''}</span>;
}

/** The page: a small header (logo, step count, "Browse jobs" always) and the card. */
function Frame({ role, progress, wide, children }) {
  return (
    <div className="qs-page">
      <header className="site-header"><div className="bar">
        <Logo />
        <span className="row g8" style={{ alignItems: 'center' }}>
          <Link to="/jobs" className="btn btn-outline btn-sm qs-browse" data-testid="qs-browse">Browse jobs</Link>
          <ThemeToggle />
        </span>
      </div></header>
      <main id="main" className={`container qs-main${wide ? ' qs-wide' : ''}`}>
        {progress && (
          <div className="qs-progress" data-testid="qs-progress">
            <span className="xs muted">{ROLE_NAMES[role]} · step {progress.at} of {progress.of}</span>
            <span className="qs-bar" aria-hidden="true"><span style={{ width: `${Math.round((progress.at / progress.of) * 100)}%` }} /></span>
          </div>
        )}
        {children}
      </main>
    </div>
  );
}

/* ---------- the steps ---------- */

function Choices({ label, children }) {
  return <div className="qs-choices" role="group" aria-label={label}>{children}</div>;
}
const Choice = ({ on, children, ...p }) => <button type="button" className="qs-choice" aria-pressed={on === undefined ? undefined : !!on} {...p}>{children}</button>;
const Continue = ({ disabled, label = 'Continue' }) => <button type="submit" className="btn btn-ink btn-lg qs-continue" disabled={disabled} data-testid="qs-continue">{label}</button>;

function useSuggest(kind, text) {
  const [items, setItems] = useState([]);
  useEffect(() => {
    let dead = false;
    const t = setTimeout(() => suggest(kind, text).then((r) => { if (!dead) setItems(r.items || []); }, () => {}), text ? 250 : 0);
    return () => { dead = true; clearTimeout(t); };
  }, [kind, text]);
  return items;
}

function TextStep({ id, label, ph, kind, field, value, onAnswer }) {
  const [text, setText] = useState(value || '');
  const items = useSuggest(kind, text.trim()).filter((x) => x.toLowerCase() !== text.trim().toLowerCase());
  return (
    <form className="stack g12" noValidate onSubmit={(e) => { e.preventDefault(); if (text.trim()) onAnswer({ [field]: text.trim() }); }}>
      <div className="field">
        <label htmlFor={id} className="label">{label}</label>
        <input id={id} className="input qs-input" value={text} maxLength={field === 'college' ? 120 : 80} autoComplete="off" placeholder={ph} onChange={(e) => setText(e.target.value)} />
      </div>
      {items.length > 0 && (
        <Choices label="Suggestions">
          {items.slice(0, 6).map((x) => <Choice key={x} onClick={() => onAnswer({ [field]: x })}>{x}</Choice>)}
        </Choices>
      )}
      <Continue disabled={!text.trim()} />
    </form>
  );
}

const JobStep = ({ answers, onAnswer }) => <TextStep id="qs-job" label="Job title" ph="e.g. Data analyst, Delivery executive" kind="job" field="job" value={answers.job} onAnswer={onAnswer} />;
const CollegeStep = ({ answers, onAnswer }) => <TextStep id="qs-college" label="College name" ph="Type your college’s name" kind="college" field="college" value={answers.college} onAnswer={onAnswer} />;

function CityStep({ answers, onAnswer }) {
  const [picked, setPicked] = useState(answers.cities || []);
  const [remote, setRemote] = useState(!!answers.remote);
  const [other, setOther] = useState('');
  const [loc, setLoc] = useState('');
  const full = picked.length >= MAX_CITIES;
  const toggle = (c) => setPicked((p) => (p.includes(c) ? p.filter((x) => x !== c) : p.length >= MAX_CITIES ? p : [...p, c]));
  const add = (c) => { const v = c.trim(); if (v && !picked.some((x) => x.toLowerCase() === v.toLowerCase()) && !full) setPicked((p) => [...p, v]); };
  const here = () => {
    if (!navigator.geolocation) { setLoc('Your browser can’t share a location. Pick your city instead.'); return; }
    setLoc('busy');
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        try { const r = await nearestCity(pos.coords.latitude, pos.coords.longitude); add(r.city); setLoc(`Near you: ${r.city}`); } catch (x) { setLoc(x.message || 'We couldn’t find a city near you. Pick your city instead.'); }
      },
      () => setLoc('We couldn’t get your location. Pick your city instead.'),
      { timeout: 10_000, maximumAge: 600_000 },
    );
  };
  const shown = [...new Set([...CITIES, ...picked])];
  return (
    <form className="stack g12" noValidate onSubmit={(e) => { e.preventDefault(); onAnswer({ cities: picked, remote }); }}>
      <Choices label={`Cities (up to ${MAX_CITIES})`}>
        {shown.map((c) => <Choice key={c} on={picked.includes(c)} disabled={full && !picked.includes(c)} onClick={() => toggle(c)}>{c}</Choice>)}
        <Choice on={remote} onClick={() => setRemote((v) => !v)}>Remote / work from home</Choice>
      </Choices>
      <button type="button" className="btn btn-outline qs-loc" onClick={here} disabled={loc === 'busy'} data-testid="qs-location">{loc === 'busy' && <Spinner />}Use my location</button>
      <span className="xs muted" role="status">{loc && loc !== 'busy' ? loc : 'We use your location once to find your city. We don’t keep it.'}</span>
      <div className="row g8 qs-other">
        <div className="field" style={{ flex: '1 1 180px', minWidth: 0 }}>
          <label htmlFor="qs-other" className="label">Another city</label>
          <input id="qs-other" className="input" value={other} maxLength={60} onChange={(e) => setOther(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); add(other); setOther(''); } }} />
        </div>
        <button type="button" className="btn btn-outline" style={{ alignSelf: 'flex-end', minHeight: 48 }} disabled={!other.trim() || full} onClick={() => { add(other); setOther(''); }}>Add</button>
      </div>
      <Continue disabled={!picked.length && !remote} />
    </form>
  );
}

function OneTap({ label, options, value, onPick }) {
  return <Choices label={label}>{options.map(([k, l]) => <Choice key={k} on={value === k} onClick={() => onPick(k)}>{l}</Choice>)}</Choices>;
}
const ExperienceStep = ({ answers, onAnswer }) => <OneTap label="Work experience" options={EXPERIENCE} value={answers.experience} onPick={(k) => onAnswer({ experience: k })} />;
const YearsStep = ({ answers, onAnswer }) => <OneTap label="Years of work experience" options={YEARS} value={answers.years} onPick={(k) => onAnswer({ years: k })} />;

function CourseStep({ role, answers, onAnswer }) {
  const [course, setCourse] = useState(answers.course || '');
  const [year, setYear] = useState(answers.year || null);
  const now = new Date().getFullYear();
  const years = role === 'student' ? [0, 1, 2, 3, 4].map((n) => now + n) : [-3, -2, -1, 0, 1, 2].map((n) => now + n);
  return (
    <form className="stack g12" noValidate onSubmit={(e) => { e.preventDefault(); if (course.trim()) onAnswer({ course: course.trim(), year }); }}>
      <div className="field">
        <label htmlFor="qs-course" className="label">Course</label>
        <input id="qs-course" className="input qs-input" value={course} maxLength={80} placeholder="e.g. B.Tech CSE" onChange={(e) => setCourse(e.target.value)} />
      </div>
      <Choices label="Common courses">{COURSES.map((c) => <Choice key={c} on={course === c} onClick={() => setCourse(c)}>{c}</Choice>)}</Choices>
      <span className="label" id="qs-year-l">{role === 'student' ? 'Year you finish' : 'Passing year'}</span>
      <div className="qs-choices" role="group" aria-labelledby="qs-year-l">
        {years.map((y) => <Choice key={y} on={year === y} onClick={() => setYear(year === y ? null : y)}>{y}</Choice>)}
      </div>
      <Continue disabled={!course.trim()} />
    </form>
  );
}

function Many({ label, options, value = [], field, max, onAnswer }) {
  const [picked, setPicked] = useState(value);
  const toggle = (k) => setPicked((p) => (p.includes(k) ? p.filter((x) => x !== k) : max && p.length >= max ? p : [...p, k]));
  return (
    <form className="stack g12" noValidate onSubmit={(e) => { e.preventDefault(); onAnswer({ [field]: picked }); }}>
      <Choices label={label}>{options.map(([k, l]) => <Choice key={k} on={picked.includes(k)} disabled={!!max && picked.length >= max && !picked.includes(k)} onClick={() => toggle(k)}>{l}</Choice>)}</Choices>
      {max && <span className="xs muted">Pick up to {max}.</span>}
      <Continue disabled={!picked.length} />
    </form>
  );
}
const LookingStep = ({ answers, onAnswer }) => <Many label="Looking for" options={LOOKING} value={answers.looking} field="looking" onAnswer={onAnswer} />;
const ExpertiseStep = ({ answers, onAnswer }) => <Many label="Expertise" options={DOMAINS.map((d) => [d, d])} value={answers.expertise} field="expertise" max={5} onAnswer={onAnswer} />;
const ServicesStep = ({ answers, switches, onAnswer }) => <Many label="Services" options={SERVICES.filter(([k]) => k !== 'l4_reviewer' || switches.vetting)} value={answers.services} field="services" onAnswer={onAnswer} />;

/** Students, where Vetting Trust is on: the T1 age check, and under 18 the parent's or guardian's link. */
function AgeStep({ answers, onDerived }) {
  const [age, setAge] = useState(answers.age === 'minor' ? { minor: true, parent: null } : null);
  if (!age) {
    return <AgeGate intro="Please confirm your date of birth." onDone={(a) => (a.minor ? setAge(a) : onDerived({ age: 'adult' }))} />;
  }
  const asked = age.parent?.status === 'pending';
  return (
    <div className="stack g12" data-testid="qs-parent">
      <ParentAsk age={age} onDone={setAge} />
      {asked && <button type="button" className="btn btn-ink btn-lg qs-continue" onClick={() => onDerived({ age: 'parent_asked' })} data-testid="qs-continue">Continue</button>}
    </div>
  );
}

function FasterStep({ role, answers, onAnswer }) {
  const [used, setUsed] = useState(!!answers.faster);
  const done = () => setUsed(true);
  return (
    <div className="stack g12 qs-faster">
      <Suspense fallback={<div className="row g8 muted"><Spinner />Loading…</div>}>
        {role === 'expert' ? <ExpertFaster onAdded={done} /> : <FillFaster onAdded={(n) => { if (n) done(); }} />}
      </Suspense>
      <button type="button" className="btn btn-ink btn-lg qs-continue" disabled={!used} onClick={() => onAnswer({ faster: 'used' })} data-testid="qs-continue">{used ? 'See my results' : 'Add a file first, or skip for now'}</button>
    </div>
  );
}

const STEPS = { job: JobStep, city: CityStep, experience: ExperienceStep, college: CollegeStep, course: CourseStep, looking: LookingStep, age: AgeStep, faster: FasterStep, expertise: ExpertiseStep, years: YearsStep, services: ServicesStep };

