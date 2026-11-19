// Admin → Skill checks → Vetting Trust → Honesty and retakes (T9; changes audited). The retake limits people Vetting
// Trust is on for get (attempts per role in a period, for the skill check and the AI interview; the badge refresher's
// wait after one that doesn't renew), "Explain your answer" (on / off, 1 or 2 questions about the candidate's own
// practical task in the AI interview) and the honesty pledge they tick before a test, a task or the interview.
// Everyone else keeps the engine's rule (1 every 30 days) while the switch is off. /api/admin/trust/honesty
import { useEffect, useState } from 'react';
import { useToast } from '../../../components/ui';
import { Loading, http, useAction, useApi } from './common';

const NUMS = [
  ['skillAttempts', 'Skill check: attempts per period', 'attempts'], ['skillDays', 'Skill check: period (days)', 'days'],
  ['interviewAttempts', 'AI interview: attempts per period', 'attempts'], ['interviewDays', 'AI interview: period (days)', 'days'],
  ['refreshDays', 'Badge refresher: wait after one that doesn’t renew (days)', 'refreshDays'], ['explainQuestions', 'Explain your answer: questions', 'explainQuestions'],
];

export default function TrustHonestyAdmin() {
  const st = useApi('/api/admin/trust/honesty');
  const toast = useToast();
  const [busy, run] = useAction(toast);
  const [f, setF] = useState(null);
  useEffect(() => { if (st.data) setF(Object.fromEntries([...NUMS.map(([k]) => [k, String(st.data[k])]), ['explainOn', st.data.explainOn]])); }, [st.data]);
  return (
    <section className="card stack g12" aria-labelledby="th-h" data-testid="th-card">
      <h2 id="th-h" className="h3" style={{ margin: 0 }}>Honesty pledge and retakes</h2>
      <Loading st={st}>{(d) => {
        if (!f) return null;
        const save = () => run(async () => { await http('/api/admin/trust/honesty', { method: 'PUT', body: { ...Object.fromEntries(NUMS.map(([k]) => [k, Number(f[k])])), explainOn: f.explainOn } }); st.reload(); }, 'Saved');
        return (
          <>
            <p className="small" style={{ margin: 0 }}>People see these limits before they start and on their results, and the server enforces the same numbers. The default, 1 attempt every 30 days, is the rule everyone else keeps while Vetting Trust is hidden. A free retest after “needs retest” and carrying on with a test in progress are always allowed.</p>
            <div className="row g8" style={{ flexWrap: 'wrap', alignItems: 'flex-end' }}>
              {NUMS.map(([k, label, b]) => (
                <div key={k} className="field" style={{ flex: '1 1 170px' }}>
                  <label className="label" htmlFor={`th-${k}`}>{label} ({d.bounds[b][0]}–{d.bounds[b][1]})</label>
                  <input id={`th-${k}`} type="number" className="input" min={d.bounds[b][0]} max={d.bounds[b][1]} value={f[k]} onChange={(e) => setF({ ...f, [k]: e.target.value })} data-testid={`th-${k}`} />
                </div>
              ))}
            </div>
            <label className="row g8 small" style={{ minHeight: 44, alignItems: 'center' }}><input type="checkbox" checked={f.explainOn} onChange={(e) => setF({ ...f, explainOn: e.target.checked })} data-testid="th-explain-on" />Explain your answer: ask about the candidate’s own practical task in the AI interview (graded Strong / Partial / Weak / Not answered; weak is a signal for the integrity rating, never a rejection)</label>
            <div><button type="button" className="btn btn-outline" style={{ minHeight: 44 }} disabled={busy} onClick={save} data-testid="th-save">Save</button></div>
            <details className="small" data-testid="th-pledge">
              <summary style={{ minHeight: 44, display: 'flex', alignItems: 'center', cursor: 'pointer' }}>The honesty pledge (version {d.pledge.version})</summary>
              {['en', 'hi', 'te'].map((l) => <p key={l} lang={l} style={{ margin: '4px 0' }}><strong>{d.pledge.tick[l]}</strong> {d.pledge.text[l]}</p>)}
              <p className="xs muted" style={{ margin: 0 }}>What counts: {d.counts.skill} {d.counts.interview}</p>
            </details>
          </>
        );
      }}</Loading>
    </section>
  );
}
