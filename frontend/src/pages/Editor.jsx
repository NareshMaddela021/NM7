import { useState } from 'react';
import { Link } from 'react-router-dom';
import Header from '../components/Header';
import { Icon, Meter, useToast } from '../components/ui';
import { PLANS, PROMISES, inr } from '../lib/pricing';

const LINES = {
  o1: { sec: 'Summary', text: 'Seeking a challenging role in a reputed organisation where I can grow my skills.', why: 'The most-read line on your page says nothing specific. Lead with role + proof.', tag: 'Medium', pts: 6,
    opts: [['Data analyst fresher who turns messy sales data into decisions — SQL, Python, Power BI.', 'Role-first, names your three strongest tools'], ['B.Tech CSE graduate with a 6-month analytics internship and 3 shipped dashboards.', 'Proof-first, good if you lack a clear target']] },
  e1: { sec: 'Experience', text: 'Helped with dashboards for the sales team.', why: '“Helped with” describes a duty. Recruiters scan for what changed because of you.', tag: 'High', pts: 8,
    opts: [['Built 6 Power BI dashboards that cut weekly sales reporting from 5 hours to 30 minutes.', 'Adds scale + time saved · adds keyword “Power BI”'], ['Owned the sales team’s Power BI reporting, used by [N] managers every Monday.', 'Adds ownership + audience']] },
  p1: { sec: 'Projects', text: 'Analysed website data for a college project.', why: 'Missing the keyword “A/B testing” that Data Analyst postings commonly ask for.', tag: 'High', pts: 7,
    opts: [['Ran an A/B test on 12K sessions for a college fest site; variant B lifted sign-ups 14%.', 'Adds A/B testing + a measurable result'], ['Analysed 12K web sessions in SQL to find the drop-off page; redesign cut exits 20%.', 'Adds SQL + outcome']] },
};
const DOC = [
  ['Summary', [['o1']]],
  ['Experience', [['e0', 'Data Analyst Intern · [Company] · Jan–Jun 2025', true], ['e1'], ['e2', 'Cleaned and merged weekly CSV exports in Python (Pandas).']]],
  ['Projects', [['p1']]],
  ['Skills', [['s1', 'SQL · Python (Pandas, NumPy) · Excel · Power BI · Statistics']]],
  ['Education', [['d1', 'B.Tech, Computer Science · [College] · 2025 · 8.1 CGPA', true]]],
];
const BASE = 63;

export default function Editor() {
  const toast = useToast();
  const [sel, setSel] = useState('e1');
  const [choice, setChoice] = useState(0);
  const [done, setDone] = useState({});
  const S = sel && LINES[sel];
  const score = BASE + Object.keys(done).reduce((s, k) => s + LINES[k].pts, 0);

  const accept = () => {
    const id = sel;
    setDone({ ...done, [id]: choice });
    toast(`Rewrite applied · score +${LINES[id].pts}`, () => setDone((d) => { const n = { ...d }; delete n[id]; return n; }));
  };
  const checks = [['Every bullet has a result', done.e1 !== undefined], ['Keywords match your target role', done.p1 !== undefined], ['Top line says who you are', done.o1 !== undefined], ['Single column, ATS-safe', true]];
  const ok = checks.filter((c) => c[1]).length;

  return (
    <>
      <Header variant="public" right={
        <span aria-live="polite" className="row g8 small muted" style={{ padding: '8px 12px', borderRadius: 10, background: 'var(--sunken)' }}>
          Score <strong className="display" style={{ fontSize: 20, color: 'var(--text)' }}>{score}</strong>{score > BASE && <span style={{ color: 'var(--success)', fontWeight: 600 }}>+{score - BASE}</span>}
        </span>
      } />
      <main className="container-wide row g24" style={{ padding: '28px 24px 64px', alignItems: 'flex-start' }}>
        <nav aria-label="Sections" className="stack g4" style={{ flex: '1 1 180px', maxWidth: 220 }}>
          <span className="mono faint" style={{ padding: '0 10px 8px' }}>SECTIONS</span>
          {DOC.map(([title]) => {
            const open = Object.keys(LINES).filter((k) => LINES[k].sec === title && done[k] === undefined).length;
            return <button key={title} type="button" onClick={() => document.getElementById(`sec-${title}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' })} className="row between" style={{ minHeight: 40, padding: '0 10px', borderRadius: 8, border: 0, background: 'transparent', color: 'var(--text)', fontSize: 14, fontWeight: 500, textAlign: 'left' }}>{title}<span className="xs strong" style={{ color: open ? 'var(--warning)' : 'var(--success)' }}>{open ? `${open} to fix` : '✓'}</span></button>;
          })}
          <div className="stack g8" style={{ marginTop: 16 }}>
            <button type="button" className="btn btn-ink">Download PDF · {inr(PLANS.diy.price)}</button>
            <button type="button" className="btn btn-outline">DOCX</button>
          </div>
        </nav>

        <section aria-label="Resume" style={{ flex: '3 1 520px', minWidth: 0 }}>
          <article className="paper stack g20" style={{ padding: '48px 52px', fontSize: 14, lineHeight: 1.65 }}>
            <header className="stack"><span className="display" style={{ fontSize: 30 }}>Sai Varsha</span><span className="muted">Chennai · saivarsha@[email] · linkedin.com/in/[handle] · github.com/[handle]</span></header>
            {DOC.map(([title, lines]) => (
              <div key={title} id={`sec-${title}`} className="stack g4">
                <span style={{ fontSize: 12, fontWeight: 700, letterSpacing: '.12em', textTransform: 'uppercase', color: 'var(--text2)', borderBottom: '1px solid var(--border)', paddingBottom: 4 }}>{title}</span>
                {lines.map(([lid, txt, bold]) => {
                  const L = LINES[lid];
                  const isDone = L && done[lid] !== undefined;
                  const selected = sel === lid;
                  const text = L ? (isDone ? L.opts[done[lid]][0] : L.text) : txt;
                  if (!L) return <div key={lid} style={{ padding: '4px 8px', margin: '0 -8px', fontWeight: bold ? 600 : 400 }}>{text}</div>;
                  return (
                    <button key={lid} type="button" aria-pressed={selected} onClick={() => { setSel(lid); setChoice(0); }}
                      style={{ textAlign: 'left', border: 0, background: selected ? 'var(--sunken)' : 'transparent', boxShadow: selected ? 'inset 0 0 0 2px var(--ink)' : 'none', padding: '4px 8px', margin: '0 -8px', borderRadius: 6, lineHeight: 1.65, fontSize: 14 }}>
                      <span className={isDone ? 'fixed' : 'hl'} style={{ padding: '0 2px' }}>{text}</span>
                    </button>
                  );
                })}
              </div>
            ))}
          </article>
        </section>

        <aside aria-label="AI assistant" className="stack g16 sticky" style={{ flex: '2 1 340px', minWidth: 0 }}>
          {S ? (
            <div className="card stack g16 rise" key={sel}>
              <div className="row between g8"><span className="mono faint">SELECTED · {S.sec.toUpperCase()}</span><span className={`badge ${done[sel] !== undefined ? 'b-success' : S.tag === 'High' ? 'b-warning' : 'b-neutral'}`}>{done[sel] !== undefined ? 'Fixed' : S.tag}</span></div>
              <p className="muted" style={{ lineHeight: 1.55 }}>{S.why}</p>
              {done[sel] === undefined ? (
                <>
                  <fieldset className="stack g8" style={{ border: 0, margin: 0, padding: 0 }}>
                    <legend className="strong small" style={{ marginBottom: 8 }}><Icon name="spark" size={14} /> Pick a rewrite</legend>
                    {S.opts.map(([t, note], i) => (
                      <label key={t} className="option" data-on={choice === i}>
                        <input type="radio" name="opt" checked={choice === i} onChange={() => setChoice(i)} />
                        <span className="stack g4 small"><span>{t}</span><span className="xs faint">{note}</span></span>
                      </label>
                    ))}
                  </fieldset>
                  <p className="xs faint">Only accept numbers that are true — interviewers will ask.</p>
                  <div className="row g8"><button type="button" className="btn btn-ink btn-lg" style={{ flex: 1 }} onClick={accept}>Use this rewrite</button><button type="button" className="btn btn-outline btn-lg" onClick={() => setSel(null)}>Keep mine</button></div>
                </>
              ) : (
                <div className="row between" style={{ padding: '12px 14px', borderRadius: 12, background: 'var(--successbg)', color: 'var(--success)', fontWeight: 600 }}>
                  <span>Rewrite applied</span>
                  <button type="button" className="link-btn" style={{ color: 'var(--success)', minHeight: 36 }} onClick={() => { const n = { ...done }; delete n[sel]; setDone(n); }}>Undo</button>
                </div>
              )}
            </div>
          ) : (
            <div className="card stack g8" style={{ borderStyle: 'dashed' }}><strong>Click any highlighted line</strong><span className="small muted">Yellow lines are what a recruiter would flag. Pick one and the AI suggests rewrites you can accept or ignore.</span></div>
          )}
          <div className="card stack g12">
            <div className="row between"><strong>Before you apply</strong><span className="xs faint">{ok}/{checks.length}</span></div>
            <Meter value={(ok / checks.length) * 100} color="var(--success)" label="Checklist progress" />
            {checks.map(([l, v]) => (
              <div key={l} className="row g8 small" style={{ color: v ? 'var(--text)' : 'var(--text2)' }}>
                <span style={{ width: 18, height: 18, borderRadius: '50%', border: `2px solid ${v ? 'var(--success)' : 'var(--border2)'}`, background: v ? 'var(--success)' : 'transparent', boxSizing: 'border-box' }} />{l}
              </div>
            ))}
          </div>
          <Link to="/checkout" className="card-ink row between g12" style={{ textDecoration: 'none', padding: '18px 20px' }}>
            <span className="stack"><strong style={{ fontSize: 15 }}>Stuck? Hand it to an expert</strong><span className="xs" style={{ opacity: .75 }}>Verified expert · {inr(PLANS.expert.price)} · {PROMISES.delivery}</span></span>
            <Icon name="arrow" size={20} />
          </Link>
        </aside>
      </main>
    </>
  );
}
