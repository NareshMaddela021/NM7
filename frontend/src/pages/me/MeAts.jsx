// ATS & job match: "Match a job" (job post -> score /100, what to fix, a tailored copy: JobMatch.jsx) and "ATS check"
// (score any resume with the expert rules, missing keywords, the score trend).
import { lazy, Suspense, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useNavigate } from 'react-router-dom';
import { useToast } from '../../components/ui';
import { useMe, setMe, addResume, openInBuilder, activeResume } from '../../lib/customerStore';
import { atsScore } from '../../lib/atsScore';
import { MeHead } from './MeLayout';
import { ScoreTrend, fmtShort, fmtDay } from './shared';
import { Bar, Chip, ScoreRing, StickyBar } from './kit';
import '../../styles/me-resume.css';
import { IcCheck, IcTarget, IcX } from '../../components/icons';

const JobMatch = lazy(() => import('./JobMatch'));
const TABS = [['match', 'Match a job'], ['ats', 'ATS check']];

export default function MeAts() {
  const [params, setParams] = useSearchParams();
  const tab = params.get('tab') === 'ats' ? 'ats' : 'match';
  return (
    <>
      <MeHead title="ATS & job match" sub="Paste a job post to see how well your resume fits it and what to fix. Or check any resume with the rules our experts use." />
      <div className="segmented ats-tabs" role="tablist" aria-label="ATS & job match" style={{ alignSelf: 'flex-start' }}>
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
      <div className="mgrid-2 ats-layout">
        <section className="mcard ats-result" aria-label="Result">
          <div className="ats-hero">
            <ScoreRing value={res.score} label={jd.trim() ? 'ATS score for this job' : 'ATS score'} size={140} />
            <div className="mstack" style={{ gap: 6 }}>
              <span className="mkicker">{jd.trim() ? 'For this job' : 'General check'}</span>
              <strong className="ats-verdict">{res.score >= 80 ? 'Ready to send' : res.score >= 60 ? 'Almost there' : 'Needs some work'}</strong>
              <span className="mitem-meta">{res.score} / 100 {jd.trim() ? 'for this job' : '· general'} · {res.checks.filter((c) => c.ok).length} of {res.checks.length} checks passed</span>
            </div>
          </div>
          <ul className="mlist ats-checks">
            {[...res.checks].sort((a, b) => a.ok - b.ok).map((c) => (
              <li key={c.label} className={`ats-check ${c.ok ? 'ok' : 'todo'}`}>
                <span className="ats-check-ic" aria-hidden="true">{c.ok ? <IcCheck size={14} /> : '!'}</span>
                <span className="mstack" style={{ gap: 2 }}><span className="ats-check-l"><strong>{c.label}</strong> <span className="sr-only">{c.ok ? 'passed' : 'needs work'}</span></span>{!c.ok && <span className="mitem-meta">{c.tip}</span>}</span>
                <Chip tone={c.ok ? 'ok' : 'warn'}>{c.ok ? 'Done' : 'Fix'}</Chip>
              </li>
            ))}
          </ul>
          {m.keywords.length > 0 && (
            <div className="mstack ats-kw" style={{ gap: 8 }}>
              <strong>Job keywords · {m.found.length} of {m.keywords.length} found</strong>
              <Bar value={m.found.length} max={m.keywords.length} label="Keywords found" tone={m.found.length / m.keywords.length >= 0.7 ? 'ok' : 'warn'} />
              <div className="mrow" style={{ gap: 6 }}>
                {m.found.map((k) => <span key={k} className="badge b-success"><IcCheck size={14} /> {k}</span>)}
                {m.missing.map((k) => <span key={k} className="badge b-danger"><IcX size={14} /> {k}</span>)}
              </div>
              <span className="mitem-meta">Add a missing keyword only if you really have that skill — interviewers ask about it.</span>
            </div>
          )}
        </section>

        <section className="mcard" aria-label="Check">
          <header className="mcard-h"><span className="mcard-ic violet" aria-hidden="true"><IcTarget /></span><span className="mcard-ht"><h2 className="mcard-title">What to check</h2><span className="mcard-sub">Pick a resume. Paste a job post to score it for that job.</span></span></header>
          <div className="field"><label htmlFor="ats-r" className="label">Resume</label>
            <select id="ats-r" className="input" value={r.id} onChange={(e) => setRid(e.target.value)}>{me.resumes.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select></div>
          <div className="mfields-body">
            <div className="field"><label htmlFor="ats-c" className="label">Company · optional</label><input id="ats-c" className="input" value={company} onChange={(e) => setCompany(e.target.value)} /></div>
            <div className="field"><label htmlFor="ats-role" className="label">Role · optional</label><input id="ats-role" className="input" value={role} onChange={(e) => setRole(e.target.value)} /></div>
          </div>
          <div className="field"><label htmlFor="ats-jd" className="label">Job description · optional</label><textarea id="ats-jd" className="input" rows={7} value={jd} onChange={(e) => setJd(e.target.value)} placeholder="Paste the full job post here." /></div>
          <StickyBar label="Check actions">
            <button type="button" className="btn btn-signal" disabled={!jd.trim()} onClick={tailor}>Tailor a copy for this job</button>
            <button type="button" className="btn btn-outline" onClick={() => { setMe((s) => ({ checks: [...s.checks, { at: Date.now(), score: atsScore(r.data).score, resumeId: r.id, label: company || 'Saved check' }] })); toast('Saved to your history'); }}>Save this check</button>
          </StickyBar>
        </section>
      </div>

      <section className="mcard" aria-label="Score trend">
        <div className="mspread"><span className="mcard-ht"><h2 className="mcard-title">ATS score over time</h2><span className="mcard-sub">{r.name}</span></span><button type="button" className="btn btn-outline" onClick={() => setTable(!table)}>{table ? 'Chart' : 'Table'}</button></div>
        {table ? (
          <table className="table small mtable"><thead><tr><th>When</th><th>Score</th></tr></thead><tbody>{points.map((p, i) => <tr key={i}><td data-label="When">{p.label}</td><td data-label="Score">{p.score}</td></tr>)}</tbody></table>
        ) : <ScoreTrend points={points} />}
      </section>
    </>
  );
}
