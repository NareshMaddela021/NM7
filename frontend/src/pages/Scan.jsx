import { useEffect, useMemo, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import Header from '../components/Header';
import { Icon, Meter, useToast } from '../components/ui';
import { useFlow } from '../lib/flow';
import { scanResume } from '../services/api';
import { PLANS, PROMISES, inr } from '../lib/pricing';

const SEV = { 'Blocks ATS': 'b-danger', High: 'b-warning', Medium: 'b-neutral', Low: 'b-neutral' };

function Scanning({ role, step }) {
  const steps = ['Reading your layout', `Matching keywords for ${role || 'your role'}`, 'Measuring impact in each bullet', 'Simulating a 6-second recruiter skim'];
  const widths = [50, 70, 0, 30, 92, 84, 88, 30, 90, 76, 30, 86, 60];
  return (
    <main className="container grid-auto g48" aria-live="polite" style={{ '--min': '360px', padding: '72px 24px', maxWidth: 980, alignItems: 'center' }}>
      <div aria-hidden="true" className="paper stack g12" style={{ position: 'relative', overflow: 'hidden', padding: 36, minHeight: 420 }}>
        <div className="scanline" />
        {widths.map((w, i) => (w === 0 ? <hr key={i} className="divider" style={{ margin: '8px 0' }} /> : <div key={i} style={{ height: i === 0 ? 18 : 10, width: `${w}%`, borderRadius: 3, background: w === 30 || i === 0 ? 'var(--border2)' : 'var(--border)', marginTop: w === 30 && i > 3 ? 10 : 0 }} />))}
      </div>
      <div className="stack g24">
        <h1 className="display" style={{ fontSize: 36 }}>Reading it like a recruiter would…</h1>
        <ol className="stack g12" style={{ listStyle: 'none', margin: 0, padding: 0 }}>
          {steps.map((s, i) => (
            <li key={s} className="row g12" style={{ color: i <= step ? 'var(--text)' : 'var(--text3)', fontSize: 16 }}>
              <span style={{ width: 24, display: 'flex', justifyContent: 'center' }}>
                {i < step ? <Icon name="check" size={20} stroke={2.6} color="var(--success)" /> : i === step ? <span className="spin" /> : <span style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--border2)' }} />}
              </span>{s}
            </li>
          ))}
        </ol>
      </div>
    </main>
  );
}

function Report({ report, role }) {
  const nav = useNavigate();
  const toast = useToast();
  const { fixed, setFixed } = useFlow();
  const [focus, setFocus] = useState(null);
  const [skim, setSkim] = useState(false);
  const [expanded, setExpanded] = useState(false);

  const byLine = useMemo(() => Object.fromEntries(report.issues.map((i) => [i.line, i])), [report]);
  const score = report.baseScore + report.issues.reduce((s, i) => s + (fixed[i.id] ? i.pts : 0), 0);
  const fixedCount = report.issues.filter((i) => fixed[i.id]).length;
  const verdict = score >= 80 ? ['Interview-ready', 'b-success'] : score >= 65 ? ['Getting close', 'b-warning'] : ['Likely filtered out', 'b-danger'];
  const shown = expanded ? report.issues : report.issues.slice(0, 3);

  const toggleFix = (iss) => {
    const on = !fixed[iss.id];
    setFixed({ ...fixed, [iss.id]: on });
    setFocus(iss.id);
    if (on) toast(`Rewrote issue ${iss.n} · score +${iss.pts}`, () => setFixed((f) => ({ ...f, [iss.id]: false })));
  };
  const showOnResume = (id) => {
    setFocus(id);
    document.getElementById(`line-${report.issues.find((i) => i.id === id).line}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  };

  return (
    <main className="container-wide split" style={{ padding: '32px 24px 96px' }}>
      <section className="main stack g12" aria-label="Your resume, marked up">
        <div className="row between g12">
          <span className="small muted">{report.file} · for <strong style={{ color: 'var(--text)' }}>{role}</strong></span>
          <button type="button" role="switch" aria-checked={skim} onClick={() => setSkim(!skim)} className="btn" style={{ borderRadius: 999, border: '1px solid var(--border2)', background: skim ? 'var(--signal)' : 'var(--surface)', color: skim ? 'var(--signalink)' : 'var(--text)', paddingLeft: 8 }}>
            <span aria-hidden="true" style={{ width: 36, height: 22, borderRadius: 999, background: skim ? 'var(--signalink)' : 'var(--border2)', position: 'relative', transition: 'background-color 200ms' }}>
              <span style={{ position: 'absolute', top: 3, left: skim ? 17 : 3, width: 16, height: 16, borderRadius: '50%', background: 'var(--surface)', transition: 'left 200ms var(--ease)' }} />
            </span>
            6-second view
          </button>
        </div>
        {skim && <p className="small muted rise">This is roughly all a recruiter takes in on a first skim. Everything faded is effectively invisible.</p>}
        <article className="paper stack g16" style={{ padding: '40px 40px 40px 68px', fontSize: 14, lineHeight: 1.7 }}>
          {report.sections.map((sec) => (
            <div key={sec.id} className="stack g4">
              <span style={sec.isName ? { fontFamily: 'var(--font-display)', fontSize: 26, fontWeight: 700, letterSpacing: '-0.02em' } : { fontSize: 12, fontWeight: 700, letterSpacing: '.12em', textTransform: 'uppercase' }}>{sec.title}</span>
              {sec.lines.map((l) => {
                const iss = byLine[l.id];
                const isFixed = iss && fixed[iss.id];
                const cls = iss ? (isFixed ? 'fixed' : `hl${focus === iss.id ? ' focus' : ''}`) : '';
                return (
                  <div key={l.id} id={`line-${l.id}`} style={{ position: 'relative' }} className={skim ? (l.skim ? 'undim' : 'dim') : ''}>
                    {iss && <button type="button" className="num-dot" onClick={() => setFocus(iss.id)} aria-label={`Issue ${iss.n}: ${iss.title}`} style={{ position: 'absolute', left: -48, top: 0, width: 26, height: 26, background: isFixed ? 'var(--success)' : 'var(--ink)' }}>{iss.n}</button>}
                    <span className={cls} style={{ padding: '0 2px' }}>{isFixed ? iss.fix : l.text}</span>
                  </div>
                );
              })}
            </div>
          ))}
        </article>
      </section>

      <aside className="side stack g20 sticky" aria-label="Scan results">
        <div className="card stack g16">
          <div className="row between g12" style={{ alignItems: 'flex-end' }}>
            <div className="stack g4">
              <span className="small muted">Resume score</span>
              <div className="row g8" style={{ alignItems: 'baseline' }}><span aria-live="polite" className="display" style={{ fontSize: 72, lineHeight: .9 }}>{score}</span><span className="faint">/100</span></div>
            </div>
            <span className={`badge ${verdict[1]}`}>{verdict[0]}</span>
          </div>
          <Meter value={score} label="Resume score" />
          <span className="small muted">Fixing all {report.issues.length} issues takes you to about <strong style={{ color: 'var(--success)' }}>{report.targetScore}</strong>.</span>
        </div>

        <div className="card stack" style={{ padding: 8 }}>
          <div className="row between" style={{ padding: '12px 16px' }}><h2 style={{ fontSize: 16, fontFamily: 'var(--font-body)', letterSpacing: 0 }}>Fix these first</h2><span className="xs faint">{fixedCount} of {report.issues.length} fixed</span></div>
          {shown.map((i) => {
            const on = !!fixed[i.id];
            return (
              <div key={i.id} className="stack g8" style={{ borderRadius: 14, padding: 16, margin: '0 4px 6px', background: on ? 'var(--successbg)' : focus === i.id ? 'var(--sunken)' : 'transparent', transition: 'background-color 200ms' }}>
                <div className="row g12" style={{ flexWrap: 'nowrap' }}><span className="num-dot">{i.n}</span><strong style={{ flex: 1, fontSize: 15 }}>{i.title}</strong><span className={`badge ${SEV[i.sev]}`}>{i.sev}</span></div>
                <p className="small muted" style={{ lineHeight: 1.55 }}>{i.why}</p>
                <div className="row g8">
                  <button type="button" className={`btn ${on ? 'btn-outline' : 'btn-ink'}`} style={{ minHeight: 40, color: on ? 'var(--success)' : undefined }} onClick={() => toggleFix(i)}>{on ? 'Fixed ✓ · undo' : 'Fix with AI'}</button>
                  <button type="button" className="btn btn-ghost" style={{ minHeight: 40 }} onClick={() => showOnResume(i.id)}>Show on resume</button>
                </div>
              </div>
            );
          })}
          {!expanded && <button type="button" className="btn" style={{ color: 'var(--accent)' }} onClick={() => setExpanded(true)}>Show {report.issues.length - 3} more issues</button>}
        </div>

        <div className="card-ink stack g12">
          <h2 style={{ fontSize: 22, fontWeight: 600 }}>Want a professional to do all of it?</h2>
          <p style={{ opacity: .8, fontSize: 15 }}>A verified {role || 'industry'} expert rewrites it for this role, delivered in {PROMISES.delivery}.</p>
          <button type="button" className="btn btn-signal btn-lg" onClick={() => nav('/checkout')}>Get an expert rewrite · {inr(PLANS.expert.price)}</button>
          <Link to="/editor" className="btn" style={{ color: 'var(--onink)', opacity: .85 }}>or keep fixing it myself</Link>
        </div>
      </aside>
    </main>
  );
}

export default function Scan() {
  const { state } = useLocation();
  const navigate = useNavigate();
  const { role, report, setReport, setFixed } = useFlow();
  const fresh = !!state?.fresh || !report;
  const [step, setStep] = useState(fresh ? 0 : 4);

  useEffect(() => {
    if (!fresh) return undefined; // coming back from checkout — keep the existing report
    let alive = true;
    navigate('/scan', { replace: true, state: null }); // so Back/refresh doesn't re-run the scan
    setReport(null);
    setFixed({});
    setStep(0);
    const timers = [1, 2, 3, 4].map((k) => setTimeout(() => alive && setStep(k), k * 750));
    scanResume({ file: state?.fileName ? { name: state.fileName } : null, role }).then((r) => {
      setTimeout(() => alive && setReport(r), 3200);
    });
    return () => { alive = false; timers.forEach(clearTimeout); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const ready = report && step >= 4;
  return (
    <>
      <Header variant="flow" />
      {ready ? <Report report={report} role={role} /> : <Scanning role={role} step={step} />}
    </>
  );
}
