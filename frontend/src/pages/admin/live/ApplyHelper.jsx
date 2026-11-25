// Admin -> Auto Apply -> "Nm7 Apply helper" (backend/app/autoapply/helper.py): the week's numbers (installs that
// connect within a day, fill rate, applied after a fill, first-week disconnects, smart-answer spend), today's smart
// answers against the two limits, the top 10 field labels the helper couldn't fill (from the opt-in miss reports,
// by site and hiring system, to improve the adapters), and the settings: the daily spending limit, the per-person
// cap, "Promote the helper" (OFF until the Chrome Web Store listing is approved) and the store link.
import { useState } from 'react';
import { Kpi } from '../AdminUI';
import { Loading, http, useAction, useApi } from './common';

const BASE = '/api/admin/auto-apply/helper';
const pct = (v) => (v == null ? 'n/a' : `${v}%`);

export function HelperNumbers({ d }) {
  const w = d.week;
  return (
    <div className="stack g12" data-testid="aa-helper-numbers">
      <div className="grid-kpi" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 10 }}>
        <Kpi label="Connected within a day of install" value={`${w.connectWithinDay} of ${w.pairedWithInstall}`} sub={`${w.paired} browsers paired this week`} />
        <Kpi label="Fill rate" value={pct(w.fillRate)} sub={`${w.fieldsFilled} of ${w.fieldsTotal} fields, ${w.fills} fills`} />
        <Kpi label="Marked applied after a fill" value={`${w.appliedAfterFill} of ${w.kitsFilled}`} sub="jobs filled with the helper this week" />
        <Kpi label="Disconnected in the first week" value={w.firstWeekDisconnects} />
        <Kpi label="Smart answers this week" value={`Rs ${w.spendRupees}`} sub={`${w.aiCalls} AI drafts, ${w.answersCached} reused from saved answers`} />
        <Kpi label="Smart answers today" value={`Rs ${d.today.spendRupees} of ${d.settings.rupeesDay}`} sub={`${d.today.answers} drafts, ${d.today.cached} reused${d.today.paused ? '. Paused for today' : ''}`} />
      </div>
      <div className="stack g4">
        <strong className="small">Top fields the helper couldn’t fill</strong>
        <span className="xs muted">From people who switched on “Help improve the helper”. Only the label, the kind of field and the site: never a value or a person.</span>
        {d.topMisses.length === 0 ? <span className="small muted" data-testid="aa-helper-misses-empty">No reports yet.</span> : (
          <ol className="small stack g4" data-testid="aa-helper-misses" style={{ margin: 0, paddingLeft: 20 }}>
            {d.topMisses.map((m) => <li key={`${m.host}|${m.adapter}|${m.label}|${m.type}`}><strong>{m.label}</strong> <span className="muted">({m.type}) on {m.host}{m.adapter ? `, ${m.adapter}` : ''}: {m.count}</span></li>)}
          </ol>
        )}
        {d.bySite.length > 0 && <span className="xs muted">By site: {d.bySite.slice(0, 8).map((s) => `${s.host} ${s.count}`).join(', ')}</span>}
      </div>
    </div>
  );
}

function HelperSettings({ s, busy, onSave }) {
  const [v, setV] = useState({ rupeesDay: s.rupeesDay, perUser: s.perUser, promote: s.promote, storeUrl: s.storeUrl });
  const set = (k) => (e) => setV({ ...v, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.type === 'number' ? Number(e.target.value) : e.target.value });
  return (
    <form className="stack g8" data-testid="aa-helper-settings" onSubmit={(e) => { e.preventDefault(); onSave(v); }}>
      <div className="row g12" style={{ flexWrap: 'wrap' }}>
        <label className="stack g4 small">Smart answers: daily spending limit (Rs)<input type="number" min="0" step="10" value={v.rupeesDay} onChange={set('rupeesDay')} className="input" /></label>
        <label className="stack g4 small">Smart answers per person per day<input type="number" min="0" max="500" value={v.perUser} onChange={set('perUser')} className="input" /></label>
      </div>
      <label className="row g8 small" style={{ alignItems: 'center' }}><input type="checkbox" checked={v.promote} onChange={set('promote')} data-testid="aa-helper-promote" /> Promote the helper (Jobs ready and the morning email). Keep it off until the Chrome Web Store listing is approved.</label>
      <label className="stack g4 small">Chrome Web Store link (a placeholder until the listing is approved)<input type="url" value={v.storeUrl} onChange={set('storeUrl')} className="input" /></label>
      <span className="xs muted">About Rs {s.rupeesPerCall} per AI draft. Over either limit the helper says “Smart answers are paused for today, type this one yourself” and still fills everything else.</span>
      <button type="submit" className="btn btn-outline btn-sm" style={{ alignSelf: 'flex-start' }} disabled={busy}>Save helper settings</button>
    </form>
  );
}

export default function ApplyHelper({ toast }) {
  const st = useApi(BASE);
  const [busy, run] = useAction(toast);
  const save = (v) => run(async () => { await http(`${BASE}/settings`, { method: 'PUT', body: v }); st.reload(); }, 'Saved');
  return (
    <section className="card stack g12" aria-label="Nm7 Apply helper" data-testid="aa-helper">
      <strong>Nm7 Apply helper</strong>
      <span className="xs muted">The Chrome extension: this week’s numbers (counts only, never what people typed).</span>
      <Loading st={st}>{(d) => (
        <>
          <HelperNumbers d={d} />
          <HelperSettings key={JSON.stringify(d.settings)} s={d.settings} busy={busy} onSave={save} />
        </>
      )}</Loading>
    </section>
  );
}
