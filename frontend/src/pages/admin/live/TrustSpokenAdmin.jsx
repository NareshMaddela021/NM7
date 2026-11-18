// Admin → Skill checks → Vetting Trust → Spoken English (T10; changes need the "settings" permission and are audited).
// The pronunciation provider (none = not measured, the test provider, or Azure AI Speech), whether each key is set
// (never the value: keys live in Render env vars, docs/trust/T10-vendors.md), which role categories get the "Spoken
// English" filter in Hire now, whether voice clips are kept (off by default; then the "Voice clips" retention days),
// the bands and how the score is measured, and the counts. /api/admin/trust/spoken
import { useEffect, useState } from 'react';
import { useToast } from '../../../components/ui';
import { Loading, http, useAction, useApi } from './common';

export default function TrustSpokenAdmin() {
  const st = useApi('/api/admin/trust/spoken');
  const toast = useToast();
  const [busy, run] = useAction(toast);
  const [f, setF] = useState(null);
  useEffect(() => { if (st.data) setF({ provider: st.data.provider, categories: [...st.data.categories], keepAudio: st.data.keepAudio }); }, [st.data]);
  return (
    <section className="card stack g12" aria-labelledby="ts-h" data-testid="ts-card">
      <h2 id="ts-h" className="h3" style={{ margin: 0 }}>Spoken English</h2>
      <Loading st={st}>{(d) => {
        if (!f) return null;
        const chosen = d.providers.find((p) => p.key === d.provider);
        const cat = (k) => setF({ ...f, categories: f.categories.includes(k) ? f.categories.filter((x) => x !== k) : [...f.categories, k] });
        const save = () => run(async () => { await http('/api/admin/trust/spoken', { method: 'PUT', body: f }); st.reload(); }, 'Saved');
        const c = d.counts;
        return (
          <>
            <p className="small" style={{ margin: 0 }}>A band from A1 to C2 with four sub-scores (pronunciation, fluency, grammar, comprehension) from the English answers of a spoken AI interview, when the candidate chooses it and agrees to the voice consent. It never changes the interview score and never rejects anyone: companies may filter by it for the role categories below.</p>
            <div className="row g8" style={{ flexWrap: 'wrap', alignItems: 'flex-end' }}>
              <div className="field" style={{ flex: '1 1 240px' }}><label className="label" htmlFor="ts-p">Pronunciation provider</label>
                <select id="ts-p" className="input" value={f.provider} onChange={(e) => setF({ ...f, provider: e.target.value })} data-testid="ts-provider">{d.providers.map((p) => <option key={p.key} value={p.key}>{p.label}{p.test || p.ready || p.key === 'none' ? '' : ' (keys not set)'}</option>)}</select></div>
              <span className={`mchip ${chosen?.test ? 'mchip-warn' : chosen?.ready ? 'mchip-ok' : 'mchip-neutral'}`} role="status" style={{ whiteSpace: 'normal', maxWidth: '100%' }} data-testid="ts-state">{chosen?.test ? 'Test mode: only testers and demo accounts on the live site' : chosen?.ready ? 'Connected' : 'Pronunciation not measured: bands use fluency, grammar and comprehension'}</span>
            </div>
            <fieldset className="stack g4" style={{ border: 0, padding: 0, margin: 0 }}>
              <legend className="label">Role categories with the “Spoken English” filter in Hire now</legend>
              <div className="row g8" style={{ flexWrap: 'wrap' }}>
                {d.allCategories.map((x) => <label key={x.key} className="row g8 small" style={{ minHeight: 44, alignItems: 'center', flex: '1 1 220px' }}><input type="checkbox" checked={f.categories.includes(x.key)} onChange={() => cat(x.key)} data-testid={`ts-cat-${x.key}`} />{x.label}</label>)}
              </div>
              <span className="xs muted">A job’s category comes from its title and skills (for example “Customer Support Executive” → customer support).</span>
            </fieldset>
            <label className="row g8 small" style={{ minHeight: 44, alignItems: 'center' }}><input type="checkbox" checked={f.keepAudio} onChange={(e) => setF({ ...f, keepAudio: e.target.checked })} data-testid="ts-keep" />Keep voice clips (encrypted) for {d.keepDays} days, for checking a score by hand. Off: clips go to the provider and are dropped (recommended). The days are in Retention above.</label>
            <div><button type="button" className="btn btn-outline" style={{ minHeight: 44 }} disabled={busy} onClick={save} data-testid="ts-save">Save</button></div>
            {d.providers.filter((p) => !p.test && Object.keys(p.keys).length).map((p) => (
              <div key={p.key} className="stack g4" data-testid={`ts-keys-${p.key}`}>
                <span className="label">{p.label}: keys (Render → Environment)</span>
                <ul className="small" style={{ margin: 0, paddingLeft: 18 }}>{Object.entries(p.keys).map(([k, v]) => <li key={k}><code>{k}</code>: {v ? 'set' : 'not set'}</li>)}</ul>
              </div>
            ))}
            <p className="small" style={{ margin: 0 }} data-testid="ts-counts">Scores: {c.scored} ({Object.entries(c.bands).map(([b, n]) => `${b} ${n}`).join(' · ')}) · not enough English speech: {c.notEnough} · pronunciation not measured: {c.pronunciationNotMeasured} · clips assessed: {c.clips} (failed: {c.clipErrors}) · clips kept now: {c.clipsKept}. Scores are kept {d.scoreDays} days.</p>
            <details className="small" data-testid="ts-how">
              <summary style={{ minHeight: 44, display: 'flex', alignItems: 'center', cursor: 'pointer' }}>The bands and how it is measured</summary>
              <ul style={{ margin: '4px 0', paddingLeft: 18 }}>{d.bands.map((b) => <li key={b.key}><strong>{b.key}</strong> ({b.min}+): {b.text}</li>)}</ul>
              <ul style={{ margin: '4px 0', paddingLeft: 18 }}>{d.how.map((h) => <li key={h}>{h}</li>)}</ul>
            </details>
          </>
        );
      }}</Loading>
    </section>
  );
}
