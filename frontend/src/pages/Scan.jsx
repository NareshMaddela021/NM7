// The free ATS scan report. The file is read and checked in the browser (src/lib/scan) — nothing is uploaded.
// The score comes from fixed, documented rules (src/lib/scan/analyze.js): same file + role = same score.
import { useEffect, useMemo, useState } from 'react';
import { Link, Navigate, useNavigate } from 'react-router-dom';
import Header from '../components/Header';
import { Icon, Meter, useToast } from '../components/ui';
import { useFlow } from '../lib/flow';
import { scanResume } from '../services/api';
import { MESSAGES } from '../lib/scan';
import { PLANS, PROMISES, inr } from '../lib/pricing';

const SEV = { 'Blocks ATS': 'b-danger', High: 'b-warning', Medium: 'b-neutral', Low: 'b-neutral' };
const wrap = { overflowWrap: 'anywhere', wordBreak: 'break-word' };

function Scanning({ role, step }) {
  const steps = ['Reading your file on this device', 'Checking the layout', `Matching keywords for ${role.trim() || 'your role'}`, 'Looking for results in each bullet'];
  const widths = [50, 70, 0, 30, 92, 84, 88, 30, 90, 76, 30, 86, 60];
  return (
    <main className="container grid-auto g48" aria-live="polite" style={{ '--min': '360px', padding: '72px 24px', maxWidth: 980, alignItems: 'center' }}>
      <div aria-hidden="true" className="paper stack g12" style={{ position: 'relative', overflow: 'hidden', padding: 36, minHeight: 420 }}>
        <div className="scanline" />
        {widths.map((w, i) => (w === 0 ? <hr key={i} className="divider" style={{ margin: '8px 0' }} /> : <div key={i} style={{ height: i === 0 ? 18 : 10, width: `${w}%`, borderRadius: 3, background: w === 30 || i === 0 ? 'var(--border2)' : 'var(--border)', marginTop: w === 30 && i > 3 ? 10 : 0 }} />))}
      </div>
      <div className="stack g24" style={{ minWidth: 0 }}>
        <h1 className="display" style={{ fontSize: 36 }}>Reading it like a recruiter would…</h1>
        <ol className="stack g12" style={{ listStyle: 'none', margin: 0, padding: 0 }}>
          {steps.map((s, i) => (
            <li key={i} className="row g12" style={{ color: i <= step ? 'var(--text)' : 'var(--text3)', fontSize: 16, flexWrap: 'nowrap', ...wrap }}>
              <span style={{ width: 24, flex: 'none', display: 'flex', justifyContent: 'center' }}>
                {i < step ? <Icon name="check" size={20} stroke={2.6} color="var(--success)" /> : i === step ? <span className="spin" /> : <span style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--border2)' }} />}
              </span><span style={{ minWidth: 0 }}>{s}</span>
            </li>
          ))}
        </ol>
      </div>
    </main>
  );
}

function Rewrite({ text }) {
  const toast = useToast();
  const copy = async () => { try { await navigator.clipboard.writeText(text.replace(/\[[^\]]*\]/g, '').replace(/\s+,/g, ',').trim()); toast('Copied — now add your real details'); } catch { /* ignore */ } };
  return (
    <div className="well stack g8 rise" style={{ padding: 12 }}>
      <span className="xs muted">Suggested rewrite — a template built from your line. Replace the [brackets] with your real details; don’t invent numbers.</span>
      <span className="small" style={{ whiteSpace: 'pre-wrap', ...wrap }}>{text}</span>
      <button type="button" className="link-btn xs" style={{ alignSelf: 'flex-start' }} onClick={copy}>Copy</button>
    </div>
  );
}

function Report({ report }) {
  const nav = useNavigate();
  const { setUpload } = useFlow();
  const [focus, setFocus] = useState(null);
  const [skim, setSkim] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [open, setOpen] = useState({});
  const role = report.role || 'your role';

  const byLine = useMemo(() => {
    const m = {};
    report.issues.forEach((i) => { if (!m[i.line]) m[i.line] = i; });
    return m;
  }, [report]);
  const { score, issues } = report;
  const verdict = score >= 80 ? ['Interview-ready', 'b-success'] : score >= 65 ? ['Getting close', 'b-warning'] : ['Likely filtered out', 'b-danger'];
  const shown = expanded ? issues : issues.slice(0, 3);
  const showOnResume = (iss) => {
    setFocus(iss.id);
    document.getElementById(`line-${iss.line}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  };
  const mark = (id, text, style, skimOn) => {
    const iss = byLine[id];
    return (
      <div id={id ? `line-${id}` : undefined} style={{ position: 'relative' }} className={skim ? (skimOn ? 'undim' : 'dim') : ''}>
        {iss && <button type="button" className="num-dot" onClick={() => setFocus(iss.id)} aria-label={`Issue ${iss.n}: ${iss.title}`} style={{ position: 'absolute', left: -48, top: 0, width: 26, height: 26, background: 'var(--ink)' }}>{iss.n}</button>}
        <span className={iss ? `hl${focus === iss.id ? ' focus' : ''}` : ''} style={{ padding: '0 2px', ...style, ...wrap }}>{text}</span>
      </div>
    );
  };

  return (
    <main className="container-wide split" style={{ padding: '32px 24px 96px' }}>
      <section className="main stack g12" aria-label={report.sample ? 'Sample resume, marked up' : 'Your resume, marked up'} style={{ minWidth: 0 }}>
        {report.sample && (
          <div className="well row between g12" role="note" style={{ borderLeft: '3px solid var(--signal)' }}>
            <span className="small"><strong>Sample resume</strong> — this is not your resume. Upload your own to see your real score.</span>
            <button type="button" className="btn btn-outline" onClick={() => { setUpload(null); nav('/'); }}>Scan my resume</button>
          </div>
        )}
        <div className="row between g12">
          <span className="small muted" style={{ minWidth: 0, ...wrap }}>
            {report.sample && <span className="badge b-warning" style={{ marginRight: 8 }}>Sample resume</span>}
            <strong style={{ color: 'var(--text)' }}>{report.file}</strong> · for <strong style={{ color: 'var(--text)' }}>{role}</strong>
          </span>
          <button type="button" role="switch" aria-checked={skim} onClick={() => setSkim(!skim)} className="btn" style={{ borderRadius: 999, border: '1px solid var(--border2)', background: skim ? 'var(--signal)' : 'var(--surface)', color: skim ? 'var(--signalink)' : 'var(--text)', paddingLeft: 8 }}>
            <span aria-hidden="true" style={{ width: 36, height: 22, borderRadius: 999, background: skim ? 'var(--signalink)' : 'var(--border2)', position: 'relative', transition: 'background-color 200ms' }}>
              <span style={{ position: 'absolute', top: 3, left: skim ? 17 : 3, width: 16, height: 16, borderRadius: '50%', background: 'var(--surface)', transition: 'left 200ms var(--ease)' }} />
            </span>
            6-second view
          </button>
        </div>
        {skim && <p className="small muted rise">Roughly what a recruiter takes in on a first skim: your name and contact, section openers and dates. Everything faded is easy to miss.</p>}
        <article className="paper stack g16" data-testid="resume-preview" style={{ padding: '40px 40px 40px 68px', fontSize: 14, lineHeight: 1.7 }}>
          {report.sections.map((sec) => (
            <div key={sec.id} className="stack g4">
              {sec.title && mark(sec.titleId, sec.title, sec.isName ? { fontFamily: 'var(--font-display)', fontSize: 26, fontWeight: 700, letterSpacing: '-0.02em' } : { fontSize: 12, fontWeight: 700, letterSpacing: '.12em', textTransform: 'uppercase' }, true)}
              {sec.lines.map((l) => <div key={l.id}>{mark(l.id, l.text, {}, l.skim)}</div>)}
            </div>
          ))}
        </article>
        <p className="xs faint">{report.sample ? 'Sample text.' : `Read on your device from ${report.file} — the file was never uploaded.`} Text as our reader sees it; your file’s styling isn’t shown.</p>
      </section>

      <aside className="side stack g20 sticky" aria-label="Scan results" style={{ minWidth: 0 }}>
        <div className="card stack g16">
          <div className="row between g12" style={{ alignItems: 'flex-end' }}>
            <div className="stack g4">
              <span className="small muted">{report.sample ? 'Sample score' : 'Resume score'}</span>
              <div className="row g8" style={{ alignItems: 'baseline' }}><span data-testid="score" className="display" style={{ fontSize: 72, lineHeight: .9 }}>{score}</span><span className="faint">/100</span></div>
            </div>
            <span className={`badge ${verdict[1]}`}>{verdict[0]}</span>
          </div>
          <Meter value={score} label="Resume score" />
          {issues.length > 0 && <span className="small muted">Fixing all {issues.length} issues could take it to about <strong style={{ color: 'var(--success)' }}>{report.targetScore}</strong>.</span>}
          <details>
            <summary className="small" style={{ cursor: 'pointer' }}>How this score is worked out</summary>
            <ul className="stack g4 small" style={{ listStyle: 'none', margin: '10px 0 0', padding: 0 }}>
              {report.checks.map((c) => (
                <li key={c.key} className="row between g8" style={{ flexWrap: 'nowrap' }}>
                  <span style={{ minWidth: 0, ...wrap }}>{c.label}{c.detail && <span className="xs faint"> · {c.detail}</span>}</span>
                  <strong style={{ color: c.score === c.max ? 'var(--success)' : 'var(--text)' }}>{c.score}/{c.max}</strong>
                </li>
              ))}
            </ul>
            <p className="xs faint" style={{ marginTop: 8 }}>Fixed rules, no AI: the same file and role always get the same score.</p>
          </details>
        </div>

        <div className="card stack g8">
          <h2 style={{ fontSize: 16, fontFamily: 'var(--font-body)', letterSpacing: 0, ...wrap }}>Keywords for {role}</h2>
          <div className="row g4" style={{ flexWrap: 'wrap' }}>
            {report.keywords.found.map((k) => <span key={k} className="badge b-success">✓ {k}</span>)}
            {report.keywords.missing.map((k) => <span key={k} className="badge b-neutral" style={{ opacity: .8 }}>{k}</span>)}
          </div>
          <span className="xs faint">Green = found in your resume. Add the others only if you really have them.</span>
        </div>

        <div className="card stack" style={{ padding: 8 }}>
          <div className="row between" style={{ padding: '12px 16px' }}><h2 style={{ fontSize: 16, fontFamily: 'var(--font-body)', letterSpacing: 0 }}>{issues.length ? 'Fix these first' : 'No issues found'}</h2><span className="xs faint">{issues.length} issue{issues.length === 1 ? '' : 's'}</span></div>
          {shown.map((i) => (
            <div key={i.id} data-testid="issue" className="stack g8" style={{ borderRadius: 14, padding: 16, margin: '0 4px 6px', background: focus === i.id ? 'var(--sunken)' : 'transparent', transition: 'background-color 200ms' }}>
              <div className="row g12" style={{ flexWrap: 'nowrap' }}><span className="num-dot">{i.n}</span><strong style={{ flex: 1, fontSize: 15, minWidth: 0, ...wrap }}>{i.title}</strong><span className={`badge ${SEV[i.sev]}`}>{i.sev}</span></div>
              <p className="small muted" style={{ lineHeight: 1.55, ...wrap }}>{i.why}{i.pts > 0 && <span className="faint"> · up to +{i.pts}</span>}</p>
              {open[i.id] && i.suggest && <Rewrite text={i.suggest} />}
              <div className="row g8">
                {i.suggest && <button type="button" className={`btn ${open[i.id] ? 'btn-outline' : 'btn-ink'}`} style={{ minHeight: 40 }} onClick={() => setOpen({ ...open, [i.id]: !open[i.id] })}>{open[i.id] ? 'Hide rewrite' : 'Suggested rewrite'}</button>}
                {(i.builder || !i.suggest) && <Link to="/editor" className="btn btn-outline" style={{ minHeight: 40 }}>Fix in the builder</Link>}
                <button type="button" className="btn btn-ghost" style={{ minHeight: 40 }} onClick={() => showOnResume(i)}>Show on resume</button>
              </div>
            </div>
          ))}
          {!expanded && issues.length > 3 && <button type="button" className="btn" style={{ color: 'var(--accent)' }} onClick={() => setExpanded(true)}>Show {issues.length - 3} more issues</button>}
        </div>

        <div className="card-ink stack g12">
          <h2 style={{ fontSize: 22, fontWeight: 600 }}>Want a professional to do all of it?</h2>
          <p style={{ opacity: .8, fontSize: 15, ...wrap }}>A verified {report.role || 'industry'} expert rewrites it for this role, delivered in {PROMISES.delivery}.</p>
          <button type="button" className="btn btn-signal btn-lg" onClick={() => nav('/checkout')}>Get an expert rewrite · {inr(PLANS.expert.price)}</button>
          <Link to="/editor" className="btn" style={{ color: 'var(--onink)', opacity: .85 }}>or keep fixing it myself</Link>
        </div>
      </aside>
    </main>
  );
}

export default function Scan() {
  const nav = useNavigate();
  const { role, upload, setUpload, report, setReport } = useFlow();
  const [step, setStep] = useState(0);

  useEffect(() => {
    if (!upload) return undefined;
    let alive = true;
    setStep(0);
    scanResume(upload, role, (s) => alive && setStep(s))
      .then((r) => { if (alive) { setReport(r); setUpload(null); } })
      .catch((e) => {
        if (!alive) return;
        setUpload(null);
        nav('/', { replace: true, state: { scanError: e?.code ? e.message : MESSAGES.unreadable } });
      });
    return () => { alive = false; };
  }, [upload]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!upload && !report) return <Navigate to="/" replace />; // nothing scanned yet → back to the upload box
  return (
    <>
      <Header variant="flow" />
      {upload || !report ? <Scanning role={role} step={step} /> : <Report report={report} />}
    </>
  );
}
