// The quick start's first results page, from the answers just given (pages/start/QuickStart.jsx):
//   job seeker -> Jobs matched for you: the job board's own search (and match score, with a resume) for the job, cities
//                and experience, widened step by step when nothing matches; freshers also get the practice papers;
//   student    -> Internships and projects for you: open internships, guided projects and courses, the role finder;
//   expert     -> Your expert application: its status (paid work only after Nm7 approves it) and the next step.
// Each job has View / Apply / Save like every other job card (Batch C item 17).
// Then: the next role to set up (people with several roles do each one once), the dashboard, "Change my answers".
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Spinner } from '../../components/ui';
import JobActions from '../../components/JobActions';
import { homeFor } from '../../lib/auth';
import { pageQuery, placeText, searchJobs } from '../../lib/jobBoard';
import { ROLE_NAMES } from '../../lib/roles';
import { STATUS, loadExpert, useExpertReady } from '../../lib/expert';
import { EXPERIENCE, LOOKING, RESULTS_TITLE, SERVICES, YEARS, getAllSetup, jobQueries, nextRole, startPath } from '../../lib/quickStart';

const label = (list, k) => list.find(([x]) => x === k)?.[1] || k;
const words = (k) => ({ 'jobs.remote': 'Remote' }[k] || k);

function JobList({ items, testid }) {
  return (
    <ul className="qs-jobs" data-testid={testid}>
      {items.map((j) => (
        <li key={j.id} className="qs-job" data-testid="qs-job">
          <Link to={`/jobs/${j.slug}`} className="qs-job-title" id={`qs-jt-${j.id}`}>{j.title}</Link>
          <span className="small">{j.company?.name}</span>
          <span className="xs muted">{[placeText(j, words), j.match?.score != null ? `Match ${j.match.score}%` : ''].filter(Boolean).join(' · ')}</span>
          <JobActions job={j} titleId={`qs-jt-${j.id}`} />
        </li>
      ))}
    </ul>
  );
}

async function firstJobs(tries) {
  for (const t of tries) {
    const lists = await Promise.all(t.places.map((city) => searchJobs({ q: t.q, experience: t.experience, city, sort: 'match' }).catch(() => null)));
    const seen = new Set();
    const items = lists.flatMap((l) => l?.items || []).filter((j) => !seen.has(j.id) && seen.add(j.id));
    items.sort((a, b) => (b.match?.score ?? -1) - (a.match?.score ?? -1) || (b.postedAt || 0) - (a.postedAt || 0));
    if (items.length) return { items: items.slice(0, 10), t };
  }
  return { items: [], t: null };
}

function JobsResults({ answers }) {
  const [r, setR] = useState(null);
  useEffect(() => { let dead = false; firstJobs(jobQueries(answers)).then((x) => { if (!dead) setR(x); }); return () => { dead = true; }; }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const first = jobQueries(answers)[0];
  const exact = r?.t && JSON.stringify(r.t) === JSON.stringify(first);
  const city = r?.t?.places?.[0] || '';
  const board = `/jobs?${pageQuery({ q: r?.t?.q || '', city, experience: r?.t?.experience ? answers.experience : '' })}`;
  const what = [answers.job, answers.cities?.join(', ') || (answers.remote ? 'Remote' : ''), answers.experience ? label(EXPERIENCE, answers.experience) : ''].filter(Boolean).join(' · ');
  return (
    <section className="stack g12" aria-labelledby="qs-r-jobs">
      <h2 id="qs-r-jobs" className="h4" style={{ margin: 0 }}>Jobs</h2>
      {what && <span className="small muted">For: {what}</span>}
      {!r ? <div className="row g8 muted" aria-busy="true"><Spinner />Finding jobs…</div>
        : r.items.length ? (
          <>
            {!exact && <p className="small" role="status" style={{ margin: 0 }}>No exact matches yet, so here are the closest open jobs.</p>}
            <JobList items={r.items} testid="qs-jobs" />
            <Link to={board} className="btn btn-outline" style={{ alignSelf: 'flex-start' }}>See all on the job board</Link>
          </>
        ) : <p className="small" role="status" data-testid="qs-no-jobs" style={{ margin: 0 }}>No open jobs right now. New jobs show up here and on the job board as they are posted.</p>}
      {answers.experience === 'fresher' && (
        <Link to="/me/practice" className="qs-tile" data-testid="qs-papers">
          <strong>Fresher practice papers</strong>
          <span className="small muted">Aptitude, English and basic coding, the way placement tests ask them. Free, as often as you like.</span>
        </Link>
      )}
    </section>
  );
}

function StudentResults({ answers, setup }) {
  const [jobs, setJobs] = useState(null);
  useEffect(() => { let dead = false; searchJobs({ jobType: 'internship' }).then((x) => { if (!dead) setJobs(x.items.slice(0, 6)); }, () => { if (!dead) setJobs([]); }); return () => { dead = true; }; }, []);
  const looking = answers.looking || [];
  const tiles = [
    looking.includes('first_job') && ['/jobs?experience=fresher', 'Jobs for freshers', 'Open jobs that take freshers.', 'fresher'],
    ['/me/learn', 'Guided projects and free courses', looking.includes('live_project') ? 'Small projects you can finish and show, with free courses for each step.' : 'Learning paths with free courses and a small project to show.', 'learn'],
    ['/me/roles', 'Find the right role for you', 'Ten simple questions, three roles that fit you, and what to learn for each.', 'roles'],
    ['/me/practice', 'Practice tests', 'Aptitude, English and basic coding. Free.', 'practice'],
  ].filter(Boolean);
  if (looking[0] === 'learning') tiles.unshift(tiles.splice(tiles.findIndex((t) => t[3] === 'learn'), 1)[0]);
  const age = setup?.answers?.age;
  return (
    <>
      {age === 'parent_asked' && <p className="small qs-note" role="status" data-testid="qs-parent-wait">Waiting for your parent or guardian to agree. Skill checks and AI interviews open after that; everything else works now.</p>}
      <section className="stack g12" aria-labelledby="qs-r-int">
        <h2 id="qs-r-int" className="h4" style={{ margin: 0 }}>Internships</h2>
        {!jobs ? <div className="row g8 muted" aria-busy="true"><Spinner />Finding internships…</div>
          : jobs.length ? <><JobList items={jobs} testid="qs-internships" /><Link to="/jobs?jobType=internship" className="btn btn-outline" style={{ alignSelf: 'flex-start' }}>See all internships</Link></>
            : <p className="small" role="status" data-testid="qs-no-internships" style={{ margin: 0 }}>No internships open right now. They show up here and on the job board as companies post them.</p>}
      </section>
      <section className="stack g12" aria-labelledby="qs-r-proj">
        <h2 id="qs-r-proj" className="h4" style={{ margin: 0 }}>Projects and learning</h2>
        <div className="qs-tiles">
          {tiles.map(([to, t, s, k]) => <Link key={k} to={to} className="qs-tile" data-testid={`qs-tile-${k}`}><strong>{t}</strong><span className="small muted">{s}</span></Link>)}
        </div>
      </section>
    </>
  );
}

function ExpertResults({ answers, user }) {
  const ready = useExpertReady();
  if (!ready) return <div className="row g8 muted" aria-busy="true"><Spinner />Loading your application…</div>;
  const status = loadExpert()?.status || user.expertStatus || 'draft';
  const open = !['approved', 'rejected'].includes(status);
  const facts = [
    answers.expertise?.length && ['Expertise', answers.expertise.join(', ')],
    answers.years && ['Experience', label(YEARS, answers.years)],
    answers.services?.length && ['Services', answers.services.map((k) => label(SERVICES, k)).join(', ')],
  ].filter(Boolean);
  return (
    <section className="stack g12" aria-labelledby="qs-r-app" data-testid="qs-expert-app">
      <h2 id="qs-r-app" className="h4" style={{ margin: 0 }}>Status: <span data-testid="qs-expert-status">{open ? 'Pending approval' : STATUS[status]?.[0]}</span></h2>
      <p className="small" style={{ margin: 0 }}>{STATUS[status]?.[2]}</p>
      {facts.length > 0 && <dl className="qs-facts">{facts.map(([k, v]) => <div key={k}><dt className="xs muted">{k}</dt><dd>{v}</dd></div>)}</dl>}
      {open && <p className="small muted" style={{ margin: 0 }}>You can take paid work only after Nm7 approves your application. Meanwhile you can use Nm7 as a job seeker or student too.</p>}
      <Link to="/expert/profile" className="btn btn-ink btn-lg" style={{ alignSelf: 'flex-start' }} data-testid="qs-expert-continue">{status === 'draft' || status === 'changes' ? 'Continue my application' : 'Open my application'}</Link>
    </section>
  );
}

export default function Results({ role, answers, user }) {
  const [all, setAll] = useState(null);
  useEffect(() => { let dead = false; getAllSetup().then((x) => { if (!dead) setAll(x); }, () => {}); return () => { dead = true; }; }, []);
  const next = nextRole(all, role);
  return (
    <div className="stack g20" data-testid="qs-results" data-role={role}>
      <div className="stack g4">
        <span className="kicker">{ROLE_NAMES[role]}</span>
        <h1 className="display qs-results-h">{RESULTS_TITLE[role]}</h1>
        {role === 'student' && answers.looking?.length > 0 && <span className="small muted">Looking for: {answers.looking.map((k) => label(LOOKING, k).toLowerCase()).join(', ')}</span>}
      </div>
      {role === 'jobseeker' && <JobsResults answers={answers} />}
      {role === 'student' && <StudentResults answers={answers} setup={all?.setup?.student} />}
      {role === 'expert' && <ExpertResults answers={answers} user={user} />}
      {next && (
        <Link to={startPath(next)} className="qs-tile qs-next" data-testid="qs-next-role">
          <strong>Next: set up your {ROLE_NAMES[next].toLowerCase()} side</strong>
          <span className="small muted">A few quick questions, then your first results there.</span>
        </Link>
      )}
      <div className="row g8 qs-actions">
        <Link to={homeFor(user)} className="btn btn-ink" data-testid="qs-dashboard">Go to my dashboard</Link>
        <Link to={startPath(role, true)} className="btn btn-outline" data-testid="qs-change">Change my answers</Link>
      </div>
    </div>
  );
}
