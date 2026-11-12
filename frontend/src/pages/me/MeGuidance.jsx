// Guidance (Phase 6, S9): a backup plan if you are preparing for government exams (private roles that use the same
// subjects, with live jobs), and honest resume wording for a gap year or backlogs. We only use what you tell us: we
// never hide a gap or change your dates, and "Check my wording" flags a line that does.
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { http } from '../../services/http';
import { MeHead } from './MeLayout';

const REASONS = [['', 'Choose…'], ['exam_prep', 'Preparing for exams'], ['health', 'Health (now resolved)'], ['family', 'Family responsibilities'], ['caregiving', 'Caring for someone'], ['work', 'Working'], ['learning', 'Learning new skills'], ['other', 'Personal reasons']];
const BLANK = { kind: 'gap', from: '', to: '', reason: '', did: '', backlogs: '0', cleared: false, clearedOn: '' };

function Exams() {
  const [d, setD] = useState(null);
  useEffect(() => { http('/api/public/guidance/exams').then(setD, () => setD([])); }, []);
  if (!d) return <p className="muted">Loading…</p>;
  return (
    <section className="stack g8" aria-label="Government exam backup" data-testid="gd-exams">
      <strong>Preparing for a government exam? A backup that uses the same subjects</strong>
      <span className="xs muted">Keep preparing; a private job alongside can pay your way and adds experience.</span>
      {d.map((e) => (
        <div key={e.id} className="card stack g4" data-testid="gd-exam">
          <strong className="small">{e.name}</strong>
          <span className="xs muted">Subjects: {e.subjects}</span>
          <span className="small">{e.why}</span>
          <div className="row g8" style={{ flexWrap: 'wrap' }}>
            {e.roles.map((r) => <Link key={r.id} className="btn btn-outline btn-sm" to={`/me/learn?role=${r.id}`}>{r.title}{r.liveJobs ? ` · ${r.liveJobs} live job${r.liveJobs === 1 ? '' : 's'}` : ''}</Link>)}
          </div>
        </div>
      ))}
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
    <section className="card stack g8" aria-label="Gap year and backlogs" data-testid="gd-wording">
      <strong>Gap year or backlogs: honest wording for your resume</strong>
      <div className="row g12" style={{ flexWrap: 'wrap' }}>{[['gap', 'A gap / break'], ['backlog', 'Backlogs']].map(([k, l]) => <label key={k} className="row g4 small"><input type="radio" name="gd-kind" checked={f.kind === k} onChange={() => { setF({ ...BLANK, kind: k }); setOut(null); setCheck(null); }} data-testid={`gd-kind-${k}`} />{l}</label>)}</div>
      <form className="stack g8" onSubmit={suggest}>
        {f.kind === 'gap' ? (
          <>
            <div className="co-grid">
              <label className="field"><span className="label">From (month)</span><input className="input" type="month" value={f.from} onChange={set('from')} data-testid="gd-from" /></label>
              <label className="field"><span className="label">To (month)</span><input className="input" type="month" value={f.to} onChange={set('to')} data-testid="gd-to" /></label>
              <label className="field"><span className="label">Why</span><select className="input" value={f.reason} onChange={set('reason')} data-testid="gd-reason">{REASONS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></label>
            </div>
            <label className="field"><span className="label">What you did then (optional)</span><input className="input" maxLength={300} value={f.did} onChange={set('did')} placeholder="e.g. completed a free SQL course" /></label>
          </>
        ) : (
          <div className="co-grid">
            <label className="field"><span className="label">Backlogs (subjects)</span><input className="input" inputMode="numeric" value={f.backlogs} onChange={set('backlogs')} data-testid="gd-backlogs" /></label>
            <label className="row g8 small" style={{ alignSelf: 'end' }}><input type="checkbox" checked={f.cleared} onChange={set('cleared')} />All cleared now</label>
            <label className="field"><span className="label">{f.cleared ? 'Cleared in (month)' : 'Expect to clear by (optional)'}</span><input className="input" type="month" value={f.clearedOn} onChange={set('clearedOn')} /></label>
          </div>
        )}
        <button type="submit" className="btn btn-ink btn-sm" style={{ alignSelf: 'flex-start' }} data-testid="gd-suggest">Suggest honest wording</button>
      </form>
      {out && (
        <div className="stack g4" data-testid="gd-suggestions">
          {out.suggestions.map((s) => <p key={s} className="small card-sm" style={{ margin: 0 }}>{s}</p>)}
          <span className="xs muted">{out.note}</span>
        </div>
      )}
      <label className="field"><span className="label">Check my own wording</span><textarea className="input" rows={2} maxLength={600} value={mine} onChange={(e) => setMine(e.target.value)} data-testid="gd-mine" /></label>
      <button type="button" className="btn btn-outline btn-sm" style={{ alignSelf: 'flex-start' }} onClick={test} data-testid="gd-check">Check my wording</button>
      {check && (check.honest ? <p className="small" role="status" data-testid="gd-check-ok">✓ Honest: it matches what you told us.</p> : <ul className="small error" style={{ margin: 0, paddingLeft: 18 }} role="alert" data-testid="gd-check-bad">{check.problems.map((p) => <li key={p}>{p}</li>)}</ul>)}
      {err && <p className="error" role="alert">{err}</p>}
    </section>
  );
}

export default function MeGuidance() {
  return (
    <div className="stack g16" data-testid="me-guidance">
      <MeHead title="Guidance" sub="A private-job backup for government exam aspirants, and honest wording for a gap year or backlogs." />
      <Exams />
      <Wording />
    </div>
  );
}
