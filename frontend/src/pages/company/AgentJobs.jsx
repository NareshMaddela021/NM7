// Company dashboard → Jobs → "Call / message matching candidates" (Vetting Trust T5). Only where the Trust switch lets
// this company in (GET /api/company/{id}/trust/agent answers 404 otherwise, and nothing shows). Per job: the toggle
// (Nm7 messages the best-matching people who said yes to WhatsApp / calls, then calls with an AI assistant if they
// don't reply), a short list of extra yes/no questions, and the live status: contacted, interested, booked, and for
// each person who said Interested their answers and the booked time (never transcripts, recordings or phone numbers).
// Interview times come from "Interview times" on the Hire tab. English only while it is tested; no pop-ups; 390 px.
import { useCallback, useEffect, useState } from 'react';
import { rq } from '../../lib/company';
import { Chip } from '../me/kit';

const when = (v) => (v ? new Date(v).toLocaleString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }) : '');

function Extra({ value, onChange, max }) {
  const set = (i, k, v) => onChange(value.map((q, n) => (n === i ? { ...q, [k]: v } : q)));
  return (
    <div className="stack g8" data-testid="ag-co-extra">
      {value.map((q, i) => (
        <div key={i} className="row g8" style={{ flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <label className="field stack g4" style={{ flex: '1 1 220px', minWidth: 0 }}>
            <span className="label">Yes/no question {i + 1}</span>
            <input className="input" value={q.text} maxLength={200} onChange={(e) => set(i, 'text', e.target.value)} placeholder="Can you start within 2 weeks?" data-testid="ag-co-q" />
          </label>
          <label className="field stack g4" style={{ flex: '0 0 140px' }}>
            <span className="label">The answer that fits</span>
            <select className="input" value={q.want} onChange={(e) => set(i, 'want', e.target.value)} data-testid="ag-co-want"><option value="yes">Yes</option><option value="no">No</option></select>
          </label>
          <button type="button" className="link-btn small" style={{ minHeight: 44 }} onClick={() => onChange(value.filter((_, n) => n !== i))}>Remove</button>
        </div>
      ))}
      {value.length < max && <div><button type="button" className="link-btn small" style={{ minHeight: 44 }} onClick={() => onChange([...value, { text: '', want: 'yes' }])} data-testid="ag-co-add-q">+ Add a yes/no question</button></div>}
    </div>
  );
}

function Job({ c, j, max, can, onSaved }) {
  const [open, setOpen] = useState(false);
  const [extra, setExtra] = useState(j.extra);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const put = async (on, knockouts) => {
    setBusy(true); setErr('');
    try { onSaved(await rq(`/api/company/${c.id}/trust/agent/jobs/${j.id}`, { method: 'PUT', body: { on, ...(knockouts ? { knockouts } : {}) } })); setOpen(false); } catch (x) { setErr(x.message); } finally { setBusy(false); }
  };
  const asked = j.knockouts.filter((k) => k.source === 'job');
  return (
    <li className="mcard mcard-tight stack g8" data-testid="ag-co-job" style={{ minWidth: 0 }}>
      <div className="row g8" style={{ justifyContent: 'space-between', flexWrap: 'wrap', alignItems: 'center' }}>
        <strong className="small" style={{ overflowWrap: 'anywhere' }}>{j.title}</strong>
        {j.eligible ? (
          <label className="row g8" style={{ alignItems: 'center', minHeight: 44 }}>
            <input type="checkbox" checked={j.on} disabled={!can || busy} onChange={(e) => put(e.target.checked)} data-testid="ag-co-toggle" />
            <span className="small">Call / message matching candidates</span>
          </label>
        ) : <span className="xs muted">Only for jobs that take applications on Nm7</span>}
      </div>
      {j.on && (
        <span className="row g8" style={{ flexWrap: 'wrap' }} data-testid="ag-co-status" role="status">
          {j.picking ? <Chip tone="neutral">Finding matching people…</Chip> : <Chip tone="neutral">{j.selected} picked</Chip>}
          <Chip tone="neutral" data-testid="ag-co-contacted">{j.contacted} contacted</Chip>
          <Chip tone={j.interested ? 'ok' : 'neutral'} data-testid="ag-co-interested">{j.interested} interested</Chip>
          <Chip tone={j.booked ? 'ok' : 'neutral'} data-testid="ag-co-booked">{j.booked} booked</Chip>
          {j.waiting > 0 && <Chip tone="warn">{j.waiting} waiting for a reply</Chip>}
        </span>
      )}
      {j.eligible && (
        <span className="xs muted">
          Asks: are you interested{asked.length ? `, ${asked.map((k) => `“${k.text}”`).join(', ')}` : ''}{j.extra.length ? `, and ${j.extra.length} more yes/no question${j.extra.length === 1 ? '' : 's'}` : ''}; then offers your interview times. Answers that don’t fit are only a label for you; nobody is rejected automatically.
          {can && !open && <> <button type="button" className="link-btn small" onClick={() => { setExtra(j.extra); setOpen(true); }} data-testid="ag-co-edit">Edit questions</button></>}
        </span>
      )}
      {open && (
        <form className="stack g8" onSubmit={(e) => { e.preventDefault(); put(j.on, extra.filter((q) => q.text.trim())); }} aria-label={`Questions for ${j.title}`}>
          <Extra value={extra} onChange={setExtra} max={max} />
          <div className="row g8"><button type="submit" className="btn btn-signal btn-sm" disabled={busy} data-testid="ag-co-save">Save questions</button>
            <button type="button" className="link-btn small" onClick={() => setOpen(false)}>Cancel</button></div>
        </form>
      )}
      {err && <p className="error" role="alert" style={{ margin: 0 }}>{err}</p>}
      {j.people.length > 0 && (
        <details data-testid="ag-co-people">
          <summary className="small">People who said Interested ({j.people.length})</summary>
          <ul className="stack g8" style={{ listStyle: 'none', padding: 0, margin: '8px 0 0' }}>
            {j.people.map((p, i) => (
              <li key={i} className="stack g4" style={{ borderTop: '1px solid var(--border)', paddingTop: 8, minWidth: 0 }} data-testid="ag-co-person">
                <span className="small"><strong>{p.name || 'Candidate'}</strong> · {p.stateText}{p.slotAt ? ` · ${when(p.slotAt)}` : ''}{!p.fit ? <> · <Chip tone="warn">Not a fit</Chip></> : null}</span>
                {p.answers.length > 0 && <ul className="xs" style={{ margin: 0, paddingLeft: 18 }}>{p.answers.map((a) => <li key={a.id}>{a.text} <strong>{a.answer || '—'}</strong></li>)}</ul>}
              </li>
            ))}
          </ul>
          <span className="xs muted">Their applications are in Applicants. Nm7 keeps no call recordings; the candidate can read what was said.</span>
        </details>
      )}
    </li>
  );
}

export default function AgentJobs({ c }) {
  const [d, setD] = useState(null);
  const can = ['main', 'full', 'posting'].includes(c.myRole);
  const load = useCallback(() => rq(`/api/company/${c.id}/trust/agent`).then(setD, () => setD(null)), [c.id]);
  useEffect(() => { load(); }, [load]);
  const live = d?.jobs.some((j) => j.on);
  useEffect(() => {
    if (!live) return undefined;
    const id = setInterval(() => { if (document.visibilityState === 'visible') load(); }, 30000);
    return () => clearInterval(id);
  }, [live, load]);
  if (!d || d.jobs.length === 0) return null;
  const saved = (x) => setD({ ...d, jobs: d.jobs.map((j) => (j.id === x.id ? { ...j, ...x } : j)) });
  return (
    <section className="mcard stack g12" aria-labelledby="ag-co-h" data-testid="ag-co">
      <header className="mcard-h"><span className="mcard-ic" aria-hidden="true">💬</span><span className="mcard-ht">
        <h2 id="ag-co-h" className="mcard-title">Call / message matching candidates</h2>
        <span className="mcard-sub">When a job is live, Nm7 messages up to {d.perJob} best-matching people who said yes to WhatsApp or calls, asks your yes/no questions and books one of your interview times. Never at night, never anyone who said Stop.</span>
      </span></header>
      <ul className="stack g8" style={{ listStyle: 'none', padding: 0, margin: 0 }}>
        {d.jobs.map((j) => <Job key={j.id} c={c} j={j} max={d.maxExtra} can={can} onSaved={saved} />)}
      </ul>
    </section>
  );
}
