// /expert/reviewer (Vetting V4): the Nm7 reviewer workspace for expert accounts, in three tabs.
//   Profile      the roles they can check (from the 50 skill-check roles, up to 10), a few lines about them, and the
//                weekly hours they are free (Mon–Sun × 8 am–8 pm, India time). PUT /api/reviewer/me.
//   Calibration  5 sample interviews: score each on the 5 rubric lines (0–5); within 1 point of the gold scores on 80%
//                of the lines passes, then an Nm7 admin turns them on. GET/POST /api/reviewer/calibration.
//   My checks    booked calls: the person, the time, a call link, the weak spots to probe, the checklist with ticks, a
//                1–5 score, pass / fail and a 3-line note -> POST /api/reviewer/checks/{id}/result. Senior re-reviews
//                are marked "Second opinion".
// Nothing is paid yet (payments off): the page says so.
import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { http } from '../../services/http';
import { ExpertPage } from './ExpertFrame';
import { Chip, Empty, MeCard, Skel } from '../me/kit';
import { GROUP_LABEL, VETTING_ROLES } from '../../lib/vettingRoles';
import { DAYS, HOURS, hourText, l4Status, noteLines, whenText } from '../../lib/l4';
import '../../styles/vetting-l4.css';

const TABS = [['profile', 'Profile'], ['calibration', 'Calibration'], ['checks', 'My checks']];
const STATUS = {
  none: ['Not applied yet', 'neutral'], calibrating: ['Calibration next', 'info'], approval: ['Waiting for Nm7 to turn you on', 'accent'],
  active: ['Active reviewer', 'ok'], paused: ['Paused', 'warn'],
};
const MAX_ROLES = 10;

function Tabs({ tab, setTab }) {
  const refs = useRef({});
  const onKey = (e) => {
    const i = TABS.findIndex(([v]) => v === tab);
    const n = { ArrowRight: i + 1, ArrowLeft: i - 1, Home: 0, End: TABS.length - 1 }[e.key];
    if (n == null) return;
    e.preventDefault();
    const next = TABS[(n + TABS.length) % TABS.length][0];
    setTab(next); refs.current[next]?.focus();
  };
  return (
    <div className="l4-tabs" role="tablist" aria-label="Reviewer workspace" onKeyDown={onKey}>
      {TABS.map(([v, l]) => (
        <button key={v} ref={(el) => { refs.current[v] = el; }} type="button" role="tab" id={`rv-tab-${v}`} aria-controls={`rv-panel-${v}`}
          aria-selected={tab === v} tabIndex={tab === v ? 0 : -1} onClick={() => setTab(v)} data-testid={`rv-tab-${v}`}>{l}</button>
      ))}
    </div>
  );
}

/* ---------- Profile ---------- */

function Profile({ me, onSaved }) {
  const id = useId();
  const [roles, setRoles] = useState(me.roles || []);
  const [about, setAbout] = useState(me.about || '');
  const [slots, setSlots] = useState(() => new Set((me.slots || []).map((s) => `${s.day}-${s.hour}`)));
  const [filter, setFilter] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');
  const groups = useMemo(() => {
    const q = filter.trim().toLowerCase();
    const list = VETTING_ROLES.filter((r) => !q || `${r.test} ${r.role}`.toLowerCase().includes(q));
    return Object.keys(GROUP_LABEL).map((g) => [g, list.filter((r) => r.group === g)]).filter(([, l]) => l.length);
  }, [filter]);
  const toggleRole = (t) => setRoles((x) => (x.includes(t) ? x.filter((y) => y !== t) : x.length >= MAX_ROLES ? x : [...x, t]));
  const toggleSlot = (k) => setSlots((x) => { const n = new Set(x); if (n.has(k)) n.delete(k); else if (n.size < 40) n.add(k); return n; });
  const save = async (e) => {
    e.preventDefault(); setErr(''); setMsg('');
    if (!roles.length) { setErr('Pick at least one role you can check.'); return; }
    setBusy(true);
    try {
      const body = { roles, about: about.trim(), slots: [...slots].map((k) => { const [day, hour] = k.split('-').map(Number); return { day, hour }; }) };
      const r = await http('/api/reviewer/me', { method: 'PUT', body });
      onSaved(r);
      setMsg(r.status === 'calibrating' && !r.calibration ? 'Saved. Next: the calibration tab (5 sample interviews, about 15 minutes).' : 'Saved.');
    } catch (x) { setErr(x.message); } finally { setBusy(false); }
  };
  return (
    <form className="stack g16" onSubmit={save} noValidate data-testid="rv-profile">
      <MeCard title="Roles you can check" icon="◎" sub={`Pick up to ${MAX_ROLES}: the jobs you know well enough to probe in a 15-minute call. ${roles.length} picked.`}>
        <label className="field"><span className="label">Find a role</span>
          <input className="input" type="search" value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="SQL, nurse, sales…" data-testid="rv-role-filter" /></label>
        <div className="l4-roles" data-testid="rv-roles">
          {groups.map(([g, list]) => (
            <fieldset key={g} className="l4-day">
              <legend className="l4-legend">{GROUP_LABEL[g]}</legend>
              <div className="l4-choices">
                {list.map((r) => (
                  <button key={r.test} type="button" className="l4-choice" aria-pressed={roles.includes(r.test)} title={r.role}
                    disabled={!roles.includes(r.test) && roles.length >= MAX_ROLES} onClick={() => toggleRole(r.test)} data-testid="rv-role">{r.test}</button>
                ))}
              </div>
            </fieldset>
          ))}
          {!groups.length && <span className="small muted">No role matches “{filter}”.</span>}
        </div>
      </MeCard>
      <MeCard title="About you" icon="✎" sub="A few lines candidates and Nm7 see: your work, the years, the languages you speak.">
        <label className="field"><span className="label">About you</span>
          <textarea className="input" rows={4} maxLength={600} value={about} onChange={(e) => setAbout(e.target.value)} aria-describedby={`${id}-a`} data-testid="rv-about" /></label>
        <span className="xs muted" id={`${id}-a`}>{about.length} / 600</span>
      </MeCard>
      <MeCard title="Your weekly hours" icon="◷" sub={`Tap the hours you are free each week (India time). Each is a 15-minute call slot. ${slots.size} picked.`}>
        <div className="l4-week" data-testid="rv-week">
          {DAYS.map((dname, day) => (
            <fieldset key={dname} className="l4-day">
              <legend>{dname}</legend>
              <div className="l4-choices">
                {HOURS.map((h) => {
                  const k = `${day}-${h}`;
                  return <button key={k} type="button" className="l4-choice" aria-pressed={slots.has(k)} aria-label={`${dname} ${hourText(h)}`} onClick={() => toggleSlot(k)} data-testid="rv-slot">{hourText(h)}</button>;
                })}
              </div>
            </fieldset>
          ))}
        </div>
      </MeCard>
      {err && <p className="error" role="alert" style={{ margin: 0 }}>{err}</p>}
      {msg && <p className="small" role="status" style={{ margin: 0 }} data-testid="rv-saved">{msg}</p>}
      <button type="submit" className="btn btn-signal" style={{ alignSelf: 'flex-start' }} disabled={busy} data-testid="rv-save">{busy ? 'Saving…' : 'Save my reviewer profile'}</button>
    </form>
  );
}

/* ---------- Calibration ---------- */

function Calibration({ me, onDone }) {
  const [d, setD] = useState(null);
  const [err, setErr] = useState('');
  const [a, setA] = useState({});
  const [busy, setBusy] = useState(false);
  const [res, setRes] = useState(null);
  useEffect(() => { http('/api/reviewer/calibration').then(setD, (e) => setErr(e.message)); }, []);
  if (!d) return err ? <p className="error" role="alert">{err}</p> : <Skel cards={1} lines={4} label="Loading the samples" />;
  const total = d.samples.length * d.criteria.length;
  const done = d.samples.reduce((n, s) => n + d.criteria.filter((c) => Number.isInteger(a[s.id]?.[c.key])).length, 0);
  const pick = (sid, key, v) => setA((x) => ({ ...x, [sid]: { ...x[sid], [key]: v } }));
  const send = async (e) => {
    e.preventDefault(); setErr('');
    if (done < total) { setErr(`Score every line first: ${total - done} left.`); return; }
    setBusy(true);
    try { const r = await http('/api/reviewer/calibration', { method: 'POST', body: { answers: a } }); setRes(r); onDone(r); window.scrollTo?.(0, 0); }
    catch (x) { setErr(x.message); } finally { setBusy(false); }
  };
  const last = res || me.calibration;
  return (
    <div className="stack g16">
      {last && (
        <div className={`l4-result ${last.passed ? '' : 'bad'}`} role="status" data-testid="rv-cal-result">
          <strong>{last.passed ? 'Passed' : 'Not yet'}: {Math.round((last.share || 0) * 100)}% of lines within 1 point of Nm7’s scores</strong>
          <span className="small" style={{ display: 'block' }}>
            {last.passed ? (res?.status === 'approval' || me.status === 'approval' ? 'An Nm7 admin will turn you on soon; then booked calls show in My checks.' : 'Thanks: your calibration is up to date.')
              : `You need ${Math.round(d.pass * 100)}%. Read the guide for each line and try again.`}
          </span>
        </div>
      )}
      <MeCard tone="flat" className="mcard-tight" icon="⚖" title="How calibration works" headingLevel={2}
        sub={`Read 5 short sample interviews and score each one on ${d.criteria.length} lines from 0 to 5. Land within 1 point of Nm7’s scores on ${Math.round(d.pass * 100)}% of the lines to pass.`}>
        <dl className="stack g4" style={{ margin: 0 }}>
          {d.criteria.map((c) => <div key={c.key} className="small"><dt style={{ display: 'inline', fontWeight: 800 }}>{c.label}: </dt><dd style={{ display: 'inline', margin: 0 }} className="muted">{c.guide}</dd></div>)}
        </dl>
      </MeCard>
      <form className="stack g16" onSubmit={send} noValidate data-testid="rv-cal">
        {d.samples.map((s, i) => (
          <MeCard key={s.id} title={`Sample ${i + 1} · ${s.role}`} icon={String(i + 1)} testid="rv-sample">
            <pre className="l4-transcript">{s.transcript}</pre>
            {d.criteria.map((c) => (
              <fieldset key={c.key} className="l4-crit">
                <legend className="l4-legend">{c.label}</legend>
                <div className="l4-choices" role="radiogroup" aria-label={`Sample ${i + 1}: ${c.label}`}>
                  {[0, 1, 2, 3, 4, 5].map((v) => (
                    <button key={v} type="button" role="radio" className="l4-choice" aria-checked={a[s.id]?.[c.key] === v} aria-label={`${v} out of 5`}
                      onClick={() => pick(s.id, c.key, v)} data-testid={`rv-cal-${s.id}-${c.key}-${v}`}>{v}</button>
                  ))}
                </div>
              </fieldset>
            ))}
          </MeCard>
        ))}
        <span className="small muted" aria-live="polite">{done} of {total} lines scored</span>
        {err && <p className="error" role="alert" style={{ margin: 0 }}>{err}</p>}
        <button type="submit" className="btn btn-signal" style={{ alignSelf: 'flex-start' }} disabled={busy} data-testid="rv-cal-send">{busy ? 'Checking…' : 'Send my scores'}</button>
      </form>
    </div>
  );
}

/* ---------- My checks ---------- */

function CheckItem({ x, checklist, onDone }) {
  const id = useId();
  const [link, setLink] = useState(x.callLink || '');
  const [ticks, setTicks] = useState({});
  const [score, setScore] = useState(0);
  const [passed, setPassed] = useState(null);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const sent = !x.senior && x.status !== 'booked';
  const send = async (e) => {
    e.preventDefault(); setErr('');
    const miss = [!score && 'a score', passed == null && 'pass or fail', note.trim().length < 10 && 'a note (3 short lines)'].filter(Boolean);
    if (miss.length) { setErr(`Please add ${miss.join(', ')}.`); return; }
    if (noteLines(note) > 3) { setErr('Keep the note to 3 lines.'); return; }
    if (link.trim() && !/^https:\/\/\S+$/.test(link.trim())) { setErr('The call link should start with https://'); return; }
    setBusy(true);
    try {
      await http(`/api/reviewer/checks/${x.id}/result`, { method: 'POST', body: { score, passed, note: note.trim(), checklist: ticks, callLink: link.trim() } });
      onDone();
    } catch (y) { setErr(y.message); } finally { setBusy(false); }
  };
  const [words, tone] = l4Status(x.status);
  return (
    <li className="mcard l4-check-item" data-testid="rv-check">
      <div className="mrow" style={{ gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        <strong style={{ fontSize: 17 }}>{x.person || 'Candidate'}</strong>
        {x.senior ? <Chip tone="accent" testid="rv-senior">Second opinion</Chip> : <Chip tone={tone}>{words}</Chip>}
      </div>
      <span className="small"><span aria-hidden="true">☎ </span>{whenText(x.slotAt)} · 15 minutes</span>
      {(x.weakSpots?.length > 0 || x.interviewConcern) && (
        <div className="stack g4">
          <span className="l4-legend">Probe these</span>
          {x.weakSpots?.length > 0 && <div className="l4-status">{x.weakSpots.map((w) => <Chip key={w} tone="warn">{w}</Chip>)}</div>}
          {x.interviewConcern && <span className="small">Interview concern: {x.interviewConcern}</span>}
        </div>
      )}
      {x.referees?.length > 0 && <span className="xs muted">Referees: {x.referees.map((r) => `${r.name} (${r.relation}${r.answered ? ', answered' : ''})`).join(' · ')}</span>}
      {x.senior && x.check && <span className="small">First reviewer: {x.check.score}/5, {x.check.passed ? 'pass' : 'fail'}. Make up your own mind before you read their note.</span>}
      {sent ? <Chip tone="info">Result sent</Chip> : (
        <form className="stack g12" onSubmit={send} noValidate aria-label={`Result for ${x.person || 'this candidate'}`}>
          {!x.senior && (
            <label className="field"><span className="label">Call link (video or phone)</span>
              <input className="input" type="url" inputMode="url" maxLength={300} value={link} onChange={(e) => setLink(e.target.value)} placeholder="https://meet…" data-testid="rv-link" /></label>
          )}
          <fieldset className="l4-crit">
            <legend className="l4-legend">Checklist</legend>
            <div className="l4-ticks">
              {checklist.map((c) => (
                <label key={c.key} className="l4-tick">
                  <input type="checkbox" checked={!!ticks[c.key]} onChange={(e) => setTicks((t) => ({ ...t, [c.key]: e.target.checked }))} data-testid={`rv-tick-${c.key}`} />
                  <span>{c.label}</span>
                </label>
              ))}
            </div>
            <span className="xs muted">If the person doesn’t match their profile, the check is a fail. Never ask for ID numbers.</span>
          </fieldset>
          <fieldset className="l4-crit">
            <legend className="l4-legend">Score</legend>
            <div className="l4-choices" role="radiogroup" aria-label="Score from 1 to 5">
              {[1, 2, 3, 4, 5].map((v) => <button key={v} type="button" role="radio" className="l4-choice" aria-checked={score === v} aria-label={`${v} out of 5`} onClick={() => setScore(v)} data-testid={`rv-score-${v}`}>{v}</button>)}
            </div>
          </fieldset>
          <fieldset className="l4-crit">
            <legend className="l4-legend">Result</legend>
            <div className="l4-choices" role="radiogroup" aria-label="Pass or fail">
              <button type="button" role="radio" className="l4-choice" aria-checked={passed === true} onClick={() => setPassed(true)} data-testid="rv-pass">Pass</button>
              <button type="button" role="radio" className="l4-choice" aria-checked={passed === false} onClick={() => setPassed(false)} data-testid="rv-fail">Fail</button>
            </div>
          </fieldset>
          <label className="field"><span className="label">Note (3 short lines)</span>
            <textarea className="input" rows={3} maxLength={400} value={note} onChange={(e) => setNote(e.target.value)} aria-describedby={`${id}-n`} data-testid="rv-note" /></label>
          <span className="xs muted" id={`${id}-n`}>{noteLines(note)} / 3 lines · what you saw, the skills you probed, anything a company should know.</span>
          {err && <p className="error" role="alert" style={{ margin: 0 }}>{err}</p>}
          <button type="submit" className="btn btn-signal" style={{ alignSelf: 'flex-start' }} disabled={busy} data-testid="rv-send">{busy ? 'Sending…' : 'Send the result'}</button>
        </form>
      )}
    </li>
  );
}

function Checks() {
  const [d, setD] = useState(null);
  const [err, setErr] = useState('');
  const load = useCallback(() => http('/api/reviewer/checks').then(setD, (e) => setErr(e.message)), []);
  useEffect(() => { load(); }, [load]);
  if (!d) return err ? <p className="error" role="alert">{err}</p> : <Skel cards={1} lines={3} label="Loading your checks" />;
  if (!d.active) return <Empty shape="badge" title="Not active yet" testid="rv-not-active">Your booked calls show here once you have passed calibration and an Nm7 admin has turned you on.</Empty>;
  if (!d.items.length) return <Empty shape="badge" title="No calls booked" testid="rv-no-checks">When a candidate books one of your hours, the call shows here with what to probe.</Empty>;
  return <ul className="l4-refs" style={{ gap: 16 }} data-testid="rv-checks">{d.items.map((x) => <CheckItem key={x.id} x={x} checklist={d.checklist || []} onDone={load} />)}</ul>;
}

/** Only for experts the vetting engine is open to (Admin -> Skill checks -> Launch). */
export default function Reviewer() {
  const [on, setOn] = useState(null);
  useEffect(() => { http('/api/reviewer/access').then((x) => setOn(!!x?.on), () => setOn(false)); }, []);
  if (on == null) return <ExpertPage kicker="Nm7 checks" title="Reviewer"><Skel cards={1} lines={3} label="Loading" /></ExpertPage>;
  if (!on) return <ExpertPage kicker="Nm7 checks" title="Reviewer"><Empty shape="badge" title="Not open yet">The reviewer workspace is not open yet.</Empty></ExpertPage>;
  return <ReviewerPage />;
}

function ReviewerPage() {
  const [sp, setSp] = useSearchParams();
  const tab = TABS.some(([v]) => v === sp.get('tab')) ? sp.get('tab') : 'profile';
  const setTab = (v) => setSp(v === 'profile' ? {} : { tab: v }, { replace: true });
  const [me, setMe] = useState(null);
  const [err, setErr] = useState('');
  useEffect(() => { http('/api/reviewer/me').then(setMe, (e) => setErr(e.message)); }, []);
  const [words, tone] = STATUS[me?.status] || STATUS.none;
  return (
    <ExpertPage width="mid" kicker="Nm7 human check" title="Reviewer workspace" shape="badge"
      sub="15-minute calls that confirm a candidate is real and ready: the last step to L4 · Nm7 verified."
      right={me && <><Chip tone={tone} testid="rv-status">{words}</Chip>{me.quality != null && <Chip tone="neutral">Quality {me.quality}</Chip>}<Chip tone="neutral">{me.completed || 0} checks done</Chip>{me.free && <Chip tone="info" testid="rv-free">No payouts yet: nothing is charged or paid</Chip>}</>}>
      {!me ? (err ? <p className="error" role="alert">{err}</p> : <Skel cards={2} label="Loading your reviewer profile" />) : (
        <>
          <Tabs tab={tab} setTab={setTab} />
          <div role="tabpanel" id={`rv-panel-${tab}`} aria-labelledby={`rv-tab-${tab}`} className="stack g16">
            {tab === 'profile' && <Profile me={me} onSaved={setMe} />}
            {tab === 'calibration' && (me.status === 'none'
              ? <Empty shape="badge" title="Fill in your profile first" testid="rv-cal-first" action={<button type="button" className="btn btn-signal" onClick={() => setTab('profile')}>Open my profile</button>}>Pick the roles you can check and your weekly hours, then come back for calibration.</Empty>
              : <Calibration me={me} onDone={(r) => setMe((x) => ({ ...x, status: r.status, calibration: { share: r.share, passed: r.passed } }))} />)}
            {tab === 'checks' && <Checks />}
          </div>
        </>
      )}
    </ExpertPage>
  );
}
