// ATS & job match: "Match a job" (job post → score /100, what to fix, a tailored copy: JobMatch.jsx) and "ATS check"
// (score any resume with the expert rules, missing keywords, the score trend).
import { lazy, Suspense, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useNavigate } from 'react-router-dom';
import { useToast } from '../../components/ui';
import { useMe, setMe, addResume, openInBuilder, activeResume } from '../../lib/customerStore';
import { atsScore } from '../../lib/atsScore';
import { MeHead } from './MeLayout';
import { ScoreTrend, fmtShort, fmtDay } from './shared';

const JobMatch = lazy(() => import('./JobMatch'));
const TABS = [['match', 'Match a job'], ['ats', 'ATS check']];

export default function MeAts() {
  const [params, setParams] = useSearchParams();
  const tab = params.get('tab') === 'ats' ? 'ats' : 'match';
  return (
    <>
      <MeHead title="ATS & job match" sub="Paste a job post to see how well your resume fits it and what to fix. Or check any resume with the rules our experts use." />
      <div className="segmented" role="tablist" aria-label="ATS & job match" style={{ alignSelf: 'flex-start' }}>
        {TABS.map(([k, l]) => <button key={k} type="button" role="tab" aria-selected={tab === k} onClick={() => setParams(k === 'match' ? {} : { tab: k }, { replace: true })}>{l}</button>)}
      </div>
      {tab === 'match' ? <Suspense fallback={null}><JobMatch /></Suspense> : <AtsCheck />}
    </>
  );
}

function AtsCheck() {
  const me = useMe();
  const nav = useNavigate();
  const toast = useToast();
  const [rid, setRid] = useState(activeResume(me).id);
  const [jd, setJd] = useState('');
  const [company, setCompany] = useState('');
  const [role, setRole] = useState('');
  const [table, setTable] = useState(false);
  const r = me.resumes.find((x) => x.id === rid) || me.resumes[0];
  const res = atsScore(r.data, jd);
  const m = res.match;
  const hist = me.checks.filter((c) => c.resumeId === r.id).sort((a, b) => a.at - b.at);
  const points = [...hist.map((c) => ({ score: c.score, label: `${fmtDay(c.at)} · ${c.label}`, short: fmtShort(c.at) })), { score: atsScore(r.data).score, label: 'Now', short: 'Now' }];
  const tailor = () => {
    const name = `${role.trim() || 'Job'}${company.trim() ? ` – ${company.trim()}` : ''}`;
    const id = addResume(name, r.data, { jd });
    openInBuilder(id);
    toast(`Copy “${name}” made — add the missing keywords you really have`);
    nav('/builder', { state: { open: 'build' } });
  };

  return (
    <>
      <div className="row g16" style={{ alignItems: 'flex-start' }}>
        <section className="card stack g12" style={{ flex: '2 1 340px' }} aria-label="Check">
          <div className="field"><label htmlFor="ats-r" className="label">Resume</label>
            <select id="ats-r" className="input" style={{ height: 42 }} value={r.id} onChange={(e) => setRid(e.target.value)}>{me.resumes.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select></div>
          <div className="row g8">
            <div className="field" style={{ flex: 1 }}><label htmlFor="ats-c" className="label">Company · optional</label><input id="ats-c" className="input" style={{ height: 42 }} value={company} onChange={(e) => setCompany(e.target.value)} /></div>
            <div className="field" style={{ flex: 1 }}><label htmlFor="ats-role" className="label">Role · optional</label><input id="ats-role" className="input" style={{ height: 42 }} value={role} onChange={(e) => setRole(e.target.value)} /></div>
          </div>
          <div className="field"><label htmlFor="ats-jd" className="label">Job description · optional</label><textarea id="ats-jd" className="input" rows={7} value={jd} onChange={(e) => setJd(e.target.value)} placeholder="Paste the full job post here." /></div>
          <div className="row g8">
            <button type="button" className="btn btn-outline" onClick={() => { setMe((s) => ({ checks: [...s.checks, { at: Date.now(), score: atsScore(r.data).score, resumeId: r.id, label: company || 'Saved check' }] })); toast('Saved to your history'); }}>Save this check</button>
            <button type="button" className="btn btn-ink" disabled={!jd.trim()} onClick={tailor}>Tailor a copy for this job</button>
          </div>
        </section>

        <section className="card stack g12" style={{ flex: '3 1 420px' }} aria-label="Result">
          <div className="row g12" style={{ alignItems: 'baseline' }}><strong className="display" style={{ fontSize: 44, color: res.score >= 80 ? 'var(--success)' : 'var(--warning)' }}>{res.score}</strong><span className="muted">/ 100 {jd.trim() ? 'for this job' : '· general'}</span></div>
          <ul className="stack g8" style={{ listStyle: 'none', margin: 0, padding: 0 }}>
            {res.checks.map((c) => (
              <li key={c.label} className="row g8" style={{ alignItems: 'flex-start', flexWrap: 'nowrap' }}>
                <span aria-hidden="true" style={{ color: c.ok ? 'var(--success)' : 'var(--warning)', fontWeight: 700, width: 16 }}>{c.ok ? '✓' : '!'}</span>
                <span className="stack"><span className="small"><strong>{c.label}</strong> <span className="sr-only">{c.ok ? 'passed' : 'needs work'}</span></span>{!c.ok && <span className="xs muted">{c.tip}</span>}</span>
              </li>
            ))}
          </ul>
          {m.keywords.length > 0 && (
            <div className="stack g8">
              <strong className="small">Job keywords · {m.found.length} of {m.keywords.length} found</strong>
              <div className="row g4">
                {m.found.map((k) => <span key={k} className="badge b-success">✓ {k}</span>)}
                {m.missing.map((k) => <span key={k} className="badge b-danger">✕ {k}</span>)}
              </div>
              <span className="xs muted">Add a missing keyword only if you really have that skill — interviewers ask about it.</span>
            </div>
          )}
        </section>
      </div>

      <section className="card stack g8" aria-label="Score trend">
        <div className="row between"><strong className="small">ATS score over time · {r.name}</strong><button type="button" className="link-btn xs" onClick={() => setTable(!table)}>{table ? 'Chart' : 'Table'}</button></div>
        {table ? (
          <table className="table small"><thead><tr><th>When</th><th>Score</th></tr></thead><tbody>{points.map((p, i) => <tr key={i}><td>{p.label}</td><td>{p.score}</td></tr>)}</tbody></table>
        ) : <ScoreTrend points={points} />}
      </section>
    </>
  );
}
