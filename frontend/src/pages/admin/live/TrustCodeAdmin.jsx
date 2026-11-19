// Admin → Skill checks → Vetting Trust → Coding tasks (T14; changes need the "settings" permission and are audited).
// The code sandbox (the test sandbox or Judge0 CE), whether each key is set (never the value: Render env vars,
// docs/trust/T14-vendors.md), "Check the sandbox now", the limits passed on every run (CPU, wall time, memory, output,
// processes; never network), run limits per person, the AI code review and company replays switches, counts, the coding
// problems with their HIDDEN tests (admins only; each save runs the reference solution through the sandbox and the
// problem is offered only when it passes), and the latest results with "Watch the replay". /api/admin/trust/code
import { Suspense, lazy, useEffect, useState } from 'react';
import { Dialog, useToast } from '../../../components/ui';
import { lazyRetry } from '../../../lib/chunks';
import { Loading, http, useAction, useApi, when } from './common';

const CodeReplay = lazy(lazyRetry(() => import('../../me/trust/CodeReplay')));
const NUMS = [['cpuS', 'CPU seconds per test', 0.5], ['wallS', 'Wall-clock seconds per test', 1], ['memoryMb', 'Memory (MB)', 1], ['outputKb', 'Output read back (KB)', 1], ['processes', 'Processes / threads', 1], ['runsPerTask', '“Run” presses per task', 1], ['runsPerMinute', '“Run” presses a minute (per person)', 1], ['bigPaste', 'A paste this long is a signal (characters)', 1]];
const blank = { title: '', statement: '', skills: [], minutes: 30, languages: { python: '# TODO\n' }, samples: [{ name: 'Sample 1', stdin: '', expected: '' }], hidden: [], reference: { language: 'python', source: '' }, active: true };

function ProblemForm({ p, skills, langs, onClose, onSaved }) {
  const toast = useToast();
  const [busy, run] = useAction(toast);
  const [f, setF] = useState(() => ({ ...blank, ...p, samplesText: JSON.stringify((p || blank).samples, null, 1), hiddenText: JSON.stringify((p || blank).hidden, null, 1) }));
  const [err, setErr] = useState('');
  const save = () => {
    let samples; let hidden;
    try { samples = JSON.parse(f.samplesText); hidden = JSON.parse(f.hiddenText); } catch { setErr('The tests must be JSON: [{"name": "…", "stdin": "…", "expected": "…"}]'); return; }
    setErr('');
    const body = { title: f.title, statement: f.statement, skills: f.skills, minutes: Number(f.minutes), languages: f.languages, samples, hidden, reference: f.reference, active: f.active };
    run(async () => { const r = await http(p?.id ? `/api/admin/trust/code/problems/${p.id}` : '/api/admin/trust/code/problems', { method: p?.id ? 'PUT' : 'POST', body }); onSaved(r); }, 'Saved and checked');
  };
  const toggleLang = (k) => {
    const l = { ...f.languages };
    if (k in l) delete l[k]; else l[k] = '// TODO\n';
    setF({ ...f, languages: l });
  };
  return (
    <Dialog title={p?.id ? `Edit: ${p.title}` : 'Add a coding problem'} onClose={onClose} wide>
      <div className="stack g8" data-testid="tc-form">
        <div className="field"><label className="label" htmlFor="tc-t">Title</label><input id="tc-t" className="input" value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} data-testid="tc-title" /></div>
        <div className="field"><label className="label" htmlFor="tc-s">Problem statement</label><textarea id="tc-s" className="input" rows={5} value={f.statement} onChange={(e) => setF({ ...f, statement: e.target.value })} data-testid="tc-statement" /></div>
        <fieldset className="stack g4" style={{ border: 0, padding: 0, margin: 0 }}><legend className="label">Roles (tech skill checks)</legend>
          <div className="row g8" style={{ flexWrap: 'wrap' }}>{skills.map((s) => <label key={s} className="row g8 small" style={{ minHeight: 44, alignItems: 'center' }}><input type="checkbox" checked={f.skills.includes(s)} onChange={() => setF({ ...f, skills: f.skills.includes(s) ? f.skills.filter((x) => x !== s) : [...f.skills, s] })} />{s}</label>)}</div></fieldset>
        <fieldset className="stack g4" style={{ border: 0, padding: 0, margin: 0 }}><legend className="label">Languages and starter code</legend>
          <div className="row g8" style={{ flexWrap: 'wrap' }}>{langs.map((l) => <label key={l.key} className="row g8 small" style={{ minHeight: 44, alignItems: 'center' }}><input type="checkbox" checked={l.key in f.languages} onChange={() => toggleLang(l.key)} />{l.label}</label>)}</div>
          {Object.entries(f.languages).map(([k, v]) => <textarea key={k} className="input ct-mono" rows={4} aria-label={`Starter code: ${k}`} value={v} onChange={(e) => setF({ ...f, languages: { ...f.languages, [k]: e.target.value } })} style={{ fontFamily: 'ui-monospace, monospace' }} />)}
        </fieldset>
        <div className="field"><label className="label" htmlFor="tc-sa">Visible sample tests (JSON; the candidate sees these)</label><textarea id="tc-sa" className="input" rows={4} value={f.samplesText} onChange={(e) => setF({ ...f, samplesText: e.target.value })} style={{ fontFamily: 'ui-monospace, monospace' }} data-testid="tc-samples" /></div>
        <div className="field"><label className="label" htmlFor="tc-hi">Hidden tests (JSON, 3–30; never shown to candidates)</label><textarea id="tc-hi" className="input" rows={6} value={f.hiddenText} onChange={(e) => setF({ ...f, hiddenText: e.target.value })} style={{ fontFamily: 'ui-monospace, monospace' }} data-testid="tc-hidden" /></div>
        <div className="row g8" style={{ flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <div className="field"><label className="label" htmlFor="tc-rl">Reference solution language</label><select id="tc-rl" className="input" value={f.reference.language} onChange={(e) => setF({ ...f, reference: { ...f.reference, language: e.target.value } })}>{Object.keys(f.languages).map((k) => <option key={k} value={k}>{k}</option>)}</select></div>
          <div className="field"><label className="label" htmlFor="tc-min">Minutes</label><input id="tc-min" type="number" min={10} max={90} className="input" value={f.minutes} onChange={(e) => setF({ ...f, minutes: e.target.value })} /></div>
          <label className="row g8 small" style={{ minHeight: 44, alignItems: 'center' }}><input type="checkbox" checked={f.active} onChange={(e) => setF({ ...f, active: e.target.checked })} />Offered (once validated)</label>
        </div>
        <div className="field"><label className="label" htmlFor="tc-ref">Reference solution (run through the sandbox against every test before the problem is offered)</label><textarea id="tc-ref" className="input" rows={6} value={f.reference.source} onChange={(e) => setF({ ...f, reference: { ...f.reference, source: e.target.value } })} style={{ fontFamily: 'ui-monospace, monospace' }} data-testid="tc-ref" /></div>
        {err && <p className="error" role="alert">{err}</p>}
        <div className="row g8"><button type="button" className="btn btn-signal" disabled={busy} onClick={save} data-testid="tc-save-problem">Save and check with the sandbox</button><button type="button" className="btn btn-ghost" onClick={onClose}>Cancel</button></div>
      </div>
    </Dialog>
  );
}

function Problems({ langs }) {
  const st = useApi('/api/admin/trust/code/problems');
  const toast = useToast();
  const [busy, run] = useAction(toast);
  const [edit, setEdit] = useState(null);
  return (
    <div className="stack g8" data-testid="tc-problems">
      <div className="row g8" style={{ alignItems: 'center', flexWrap: 'wrap' }}><strong>Coding problems</strong><button type="button" className="btn btn-outline btn-sm" style={{ minHeight: 44 }} onClick={() => setEdit({})} data-testid="tc-add">Add a problem</button></div>
      <Loading st={st}>{(d) => (
        <ul className="small" style={{ margin: 0, paddingLeft: 18 }}>
          {d.items.map((p) => (
            <li key={p.id} data-testid="tc-problem" style={{ marginBottom: 6 }}>
              <strong>{p.title}</strong> · {p.skills.join(', ') || 'no role'} · {Object.keys(p.languages).join(', ')} · {p.samples.length} samples, {p.hidden.length} hidden · v{p.version}
              {' · '}{!p.active ? 'off' : p.validated?.ok ? <span style={{ color: '#166534' }}>validated{p.validated.by === 'seed' ? ' (built in)' : ''}</span> : <span style={{ color: '#b42318' }}>not offered: {p.validated?.error || (p.validated?.failing?.length ? `fails ${p.validated.failing.join(', ')}` : 'not validated yet')}</span>}
              <span className="row g8" style={{ display: 'inline-flex', marginLeft: 8 }}>
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => setEdit(p)}>Edit</button>
                <button type="button" className="btn btn-ghost btn-sm" disabled={busy} onClick={() => run(async () => { await http(`/api/admin/trust/code/problems/${p.id}/validate`, { method: 'POST' }); st.reload(); }, 'Checked')} data-testid="tc-validate">Validate</button>
              </span>
            </li>
          ))}
        </ul>
      )}</Loading>
      {edit && st.data && <ProblemForm p={edit.id ? edit : null} skills={st.data.skills} langs={langs} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); st.reload(); }} />}
    </div>
  );
}

function Results() {
  const st = useApi('/api/admin/trust/code/results');
  const [open, setOpen] = useState(null);
  const [rep, setRep] = useState(null);
  useEffect(() => { if (open) http(`/api/admin/trust/code/replay/${open}`).then(setRep, () => setRep({ error: true })); else setRep(null); }, [open]);
  return (
    <div className="stack g8" data-testid="tc-results">
      <strong>Latest coding results</strong>
      <Loading st={st}>{(d) => (d.items.length ? (
        <ul className="small" style={{ margin: 0, paddingLeft: 18 }}>
          {d.items.map((x) => (
            <li key={x.attemptId} data-testid="tc-result">
              {x.problem} · {x.language} · {x.status === 'done' ? `${x.passed} of ${x.total} hidden tests` : x.status}{x.tries ? ` · ${x.tries} tries` : ''} · {when(x.at)}
              {x.flags.length > 0 && <span style={{ color: '#b42318' }}> · signals: {x.flags.join(', ')}</span>}
              <button type="button" className="btn btn-ghost btn-sm" style={{ marginLeft: 6 }} onClick={() => setOpen(x.attemptId)} data-testid="tc-watch">{x.hasReplay ? 'Watch the replay' : 'Open (no replay)'}</button>
            </li>
          ))}
        </ul>
      ) : <p className="small muted" style={{ margin: 0 }}>No coding tasks sent yet.</p>)}</Loading>
      {open && (
        <Dialog title="Coding task" onClose={() => setOpen(null)} wide>
          {!rep ? <p className="small muted">Loading…</p> : rep.error ? <p className="error">Couldn’t load it.</p> : (
            <div className="stack g8">
              <p className="small" style={{ margin: 0 }}>{rep.problem} · {rep.language} · {rep.passed} of {rep.total} hidden tests · tests: {rep.cases.map((c) => `${c.hidden ? '' : '(sample) '}${c.name} ${c.passed ? '✓' : '✗'}`).join(' · ')}</p>
              {rep.replay ? <Suspense fallback={<p className="small muted">Loading the replay…</p>}><CodeReplay replay={rep.replay} /></Suspense> : <><p className="small muted" style={{ margin: 0 }}>No replay (the candidate didn’t agree to it, or it was deleted). The submitted code:</p><pre className="small" style={{ whiteSpace: 'pre', overflowX: 'auto', maxWidth: '100%' }}>{rep.source}</pre></>}
            </div>
          )}
        </Dialog>
      )}
    </div>
  );
}

export default function TrustCodeAdmin() {
  const st = useApi('/api/admin/trust/code');
  const toast = useToast();
  const [busy, run] = useAction(toast);
  const [f, setF] = useState(null);
  const [health, setHealth] = useState(null);
  useEffect(() => { if (st.data) setF({ ...st.data.settings }); }, [st.data]);
  return (
    <section className="card stack g12" aria-labelledby="tc-h" data-testid="tc-card">
      <h2 id="tc-h" className="h3" style={{ margin: 0 }}>Coding tasks</h2>
      <Loading st={st}>{(d) => {
        if (!f) return null;
        const chosen = d.providers.find((p) => p.key === f.provider);
        const save = () => run(async () => { await http('/api/admin/trust/code', { method: 'PUT', body: f }); st.reload(); }, 'Saved');
        const c = d.counts;
        return (
          <>
            <p className="small" style={{ margin: 0 }}>For tech roles, the practical task becomes a coding task: the candidate writes code in the browser, runs it on visible samples, and hidden tests decide the score. Code never runs on Nm7’s server: it goes to the code sandbox below, with these limits and no internet. Big pastes and solutions with almost no typing become integrity signals for a person (never a rejection).</p>
            <label className="row g8 small" style={{ minHeight: 44, alignItems: 'center' }}><input type="checkbox" checked={f.on} onChange={(e) => setF({ ...f, on: e.target.checked })} data-testid="tc-on" />Coding tasks on (off: tech roles keep the written task)</label>
            <div className="row g8" style={{ flexWrap: 'wrap', alignItems: 'flex-end' }}>
              <div className="field" style={{ flex: '1 1 240px' }}><label className="label" htmlFor="tc-p">Code sandbox</label>
                <select id="tc-p" className="input" value={f.provider} onChange={(e) => setF({ ...f, provider: e.target.value })} data-testid="tc-provider">{d.providers.map((p) => <option key={p.key} value={p.key}>{p.label}{p.test || p.ready ? '' : ' (keys not set)'}</option>)}</select></div>
              <span className={`mchip ${chosen?.test ? 'mchip-warn' : chosen?.ready ? 'mchip-ok' : 'mchip-neutral'}`} role="status" style={{ whiteSpace: 'normal', maxWidth: '100%' }} data-testid="tc-state">{chosen?.test ? 'Test mode: only testers and demo accounts on the live site' : chosen?.ready ? 'Keys set' : 'Keys not set: tech roles keep the written task'}</span>
              <button type="button" className="btn btn-outline" style={{ minHeight: 44 }} disabled={busy} onClick={() => run(async () => setHealth(await http('/api/admin/trust/code/health', { method: 'POST' })))} data-testid="tc-health">Check the sandbox now</button>
              {health && <span className="small" role="status" data-testid="tc-health-out">{health.ok ? `Up · ${health.detail}` : `Not reachable · ${health.detail}`}</span>}
            </div>
            <div className="row g8" style={{ flexWrap: 'wrap' }}>
              {NUMS.map(([k, label, step]) => (
                <div key={k} className="field" style={{ flex: '1 1 160px' }}><label className="label" htmlFor={`tc-${k}`}>{label}</label>
                  <input id={`tc-${k}`} type="number" className="input" step={step} min={d.bounds[k]?.[0]} max={d.bounds[k]?.[1]} value={f[k]} onChange={(e) => setF({ ...f, [k]: Number(e.target.value) })} data-testid={`tc-${k}`} />
                  <span className="xs muted">{d.bounds[k]?.[0]}–{d.bounds[k]?.[1]}</span></div>
              ))}
            </div>
            <label className="row g8 small" style={{ minHeight: 44, alignItems: 'center' }}><input type="checkbox" checked={f.aiReview} onChange={(e) => setF({ ...f, aiReview: e.target.checked })} />AI code-quality review as feedback (anonymised; never changes the score)</label>
            <label className="row g8 small" style={{ minHeight: 44, alignItems: 'center' }}><input type="checkbox" checked={f.companyReplay} onChange={(e) => setF({ ...f, companyReplay: e.target.checked })} data-testid="tc-company" />Companies may watch the editor replay of candidates they can see (only where Vetting Trust is on for the company)</label>
            <div><button type="button" className="btn btn-outline" style={{ minHeight: 44 }} disabled={busy} onClick={save} data-testid="tc-save">Save</button></div>
            {d.providers.filter((p) => !p.test).map((p) => (
              <div key={p.key} className="stack g4" data-testid={`tc-keys-${p.key}`}>
                <span className="label">{p.label}: keys (Render → Environment)</span>
                <ul className="small" style={{ margin: 0, paddingLeft: 18 }}>{Object.entries(p.keys).map(([k, v]) => <li key={k}><code>{k}</code>: {v ? 'set' : 'not set'}</li>)}</ul>
              </div>
            ))}
            <p className="small" style={{ margin: 0 }} data-testid="tc-counts">Problems: {c.problems} ({c.active} offered) · coding tasks: {c.tasks} ({Object.entries(c.byStatus).map(([k, n]) => `${k} ${n}`).join(' · ') || 'none'}) · replays kept: {c.replays} (deleted after {d.replayDays} days) · with integrity signals: {c.flagged}.</p>
            <Problems langs={d.languages} />
            <Results />
          </>
        );
      }}</Loading>
    </section>
  );
}
