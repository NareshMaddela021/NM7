// Guidance (Phase 6, S9): a backup plan if you are preparing for government exams (private roles that use the same
// subjects, with live jobs), and honest resume wording for a gap year or backlogs. We only use what you tell us: we
// never hide a gap or change your dates, and "Check my wording" flags a line that does.
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { http } from '../../services/http';
import { MeHead } from './MeLayout';
import { Chip, FieldGroup, MeCard, Skel } from './kit';
import '../../styles/me-learn.css';
import { IcArrowRight, IcCheck, IcCheckCircle, IcEdit } from '../../components/icons';

const REASONS = [['', 'Choose…'], ['exam_prep', 'Preparing for exams'], ['health', 'Health (now resolved)'], ['family', 'Family responsibilities'], ['caregiving', 'Caring for someone'], ['work', 'Working'], ['learning', 'Learning new skills'], ['other', 'Personal reasons']];
const BLANK = { kind: 'gap', from: '', to: '', reason: '', did: '', backlogs: '0', cleared: false, clearedOn: '' };

function Exams() {
  const [d, setD] = useState(null);
  useEffect(() => { http('/api/public/guidance/exams').then(setD, () => setD([])); }, []);
  return (
    <section className="stack g12" aria-label="Government exam backup" data-testid="gd-exams">
      <div className="stack g4">
        <h2 className="mcard-title">Preparing for a government exam? A backup that uses the same subjects</h2>
        <span className="small muted">Keep preparing; a private job alongside can pay your way and adds experience.</span>
      </div>
      {!d ? <Skel cards={2} label="Loading exams" /> : (
        <div className="mgrid">
          {d.map((e) => (
            <div key={e.id} className="mcard mcard-tight" data-testid="gd-exam">
              <div className="mrow" style={{ flexWrap: 'nowrap', alignItems: 'flex-start' }}>
                <span className="mcard-ic student" aria-hidden="true"><IcEdit /></span>
                <span className="stack g4" style={{ minWidth: 0 }}>
                  <strong className="mserif" style={{ fontSize: 20, color: 'var(--ink)' }}>{e.name}</strong>
                  <span className="xs muted">Subjects: {e.subjects}</span>
                </span>
              </div>
              <span className="small" style={{ lineHeight: 1.5 }}>{e.why}</span>
              <div className="stack g8">
                <span className="ml-box-h">Private roles to try</span>
                {e.roles.map((r) => (
                  <Link key={r.id} className="ml-slot" style={{ textDecoration: 'none', color: 'var(--text)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }} to={`/me/learn?role=${r.id}`}>
                    <span>{r.title}</span>
                    {r.liveJobs ? <Chip tone="ok">{r.liveJobs} live job{r.liveJobs === 1 ? '' : 's'}</Chip> : <IcArrowRight style={{ color: '#be185d' }} />}
                  </Link>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function Wording() {
  const [f, setF] = useState(BLANK);
  const [out, setOut] = useState(null);
  const [mine, setMine] = useState('');
  const [check, setCheck] = useState(null);
  const [err, setErr] = useState('');
  const set = (k) => (e) => setF({ ...f, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value });
  const body = () => ({ ...f, backlogs: Number(f.backlogs) || 0 });
  const suggest = async (e) => {
    e.preventDefault(); setErr('');
    try { setOut(await http('/api/me/guidance/wording', { method: 'POST', body: body() })); } catch (x) { setErr(x.message); }
  };
  const test = async () => {
    setErr('');
    try { setCheck(await http('/api/me/guidance/check', { method: 'POST', body: { ...body(), text: mine } })); } catch (x) { setErr(x.message); }
  };
  return (
    <MeCard icon={<IcCheckCircle />} title="Gap year or backlogs: honest wording for your resume" sub="We only use what you tell us. We never hide a gap or change your dates." testid="gd-wording" label="Gap year and backlogs">
      <div className="ml-seg" role="radiogroup" aria-label="What to explain">{[['gap', 'A gap / break'], ['backlog', 'Backlogs']].map(([k, l]) => <label key={k}><input type="radio" name="gd-kind" checked={f.kind === k} onChange={() => { setF({ ...BLANK, kind: k }); setOut(null); setCheck(null); }} data-testid={`gd-kind-${k}`} />{l}</label>)}</div>
      <form className="stack g12" onSubmit={suggest}>
        {f.kind === 'gap' ? (
          <FieldGroup title="Your break" help="Months only. Use the real dates.">
            <label className="field"><span className="label">From (month)</span><input className="input" type="month" value={f.from} onChange={set('from')} data-testid="gd-from" /></label>
            <label className="field"><span className="label">To (month)</span><input className="input" type="month" value={f.to} onChange={set('to')} data-testid="gd-to" /></label>
            <label className="field"><span className="label">Why</span><select className="input" value={f.reason} onChange={set('reason')} data-testid="gd-reason">{REASONS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></label>
            <label className="field full"><span className="label">What you did then (optional)</span><input className="input" maxLength={300} value={f.did} onChange={set('did')} placeholder="e.g. completed a free SQL course" /></label>
          </FieldGroup>
        ) : (
          <FieldGroup title="Your backlogs" help="Subjects you still have to clear, or have cleared.">
            <label className="field"><span className="label">Backlogs (subjects)</span><input className="input" inputMode="numeric" value={f.backlogs} onChange={set('backlogs')} data-testid="gd-backlogs" /></label>
            <label className="ml-toggle" style={{ alignSelf: 'end' }}><input type="checkbox" checked={f.cleared} onChange={set('cleared')} />All cleared now</label>
            <label className="field"><span className="label">{f.cleared ? 'Cleared in (month)' : 'Expect to clear by (optional)'}</span><input className="input" type="month" value={f.clearedOn} onChange={set('clearedOn')} /></label>
          </FieldGroup>
        )}
        <div><button type="submit" className="btn btn-signal" data-testid="gd-suggest">Suggest honest wording</button></div>
      </form>
      {out && (
        <div className="stack g8" data-testid="gd-suggestions">
          <span className="ml-box-h">Suggested wording</span>
          {out.suggestions.map((s) => <p key={s} className="ml-suggest">{s}</p>)}
          <span className="xs muted">{out.note}</span>
        </div>
      )}
      <FieldGroup title="Check my own wording" help="Paste a line from your resume. We tell you if it matches what you told us.">
        <label className="field full"><span className="label">Your resume line</span><textarea className="input" rows={2} maxLength={600} value={mine} onChange={(e) => setMine(e.target.value)} data-testid="gd-mine" /></label>
      </FieldGroup>
      <div><button type="button" className="btn btn-outline" onClick={test} data-testid="gd-check">Check my wording</button></div>
      {check && (check.honest ? <p className="ml-result-ok" role="status" data-testid="gd-check-ok"><IcCheck size={14} /> Honest: it matches what you told us.</p> : <ul className="ml-result-bad" role="alert" data-testid="gd-check-bad">{check.problems.map((p) => <li key={p}>{p}</li>)}</ul>)}
      {err && <p className="error" role="alert">{err}</p>}
    </MeCard>
  );
}

export default function MeGuidance() {
  return (
    <div className="stack g16" data-testid="me-guidance">
      <MeHead title="Guidance" sub="A private-job backup for government exam aspirants, and honest wording for a gap year or backlogs." />
      <Wording />
      <Exams />
    </div>
  );
}
