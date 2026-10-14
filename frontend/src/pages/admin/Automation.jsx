// Automation: simple "when → then" rules with on/off, and a builder for new ones.
import { useState } from 'react';
import { useToast } from '../../components/ui';
import { useAdmin } from './AdminContext';
import { PageHead } from './AdminUI';

const WHEN = {
  deadline: ['Hours before the deadline, no draft yet', 'hours'],
  unassigned: ['Order unassigned for', 'minutes'],
  'expert-refunds': ['Expert refunds in a week reach', 'refunds'],
  'low-rating': ['Customer rating at or below', '★'],
  'payout-waiting': ['Payout request waiting for', 'hours'],
};
const THEN = {
  'alert-expert-ops': 'Alert the expert and ops (WhatsApp + email)',
  'auto-assign': 'Auto-assign the best expert',
  'flag-expert': 'Flag the expert for review',
  audit: 'Add to the quality audit queue',
  'alert-finance': 'Alert finance',
};
const label = (r) => `${WHEN[r.when][0]} ${r.value} ${WHEN[r.when][1]} → ${THEN[r.then]}`;

export default function Automation() {
  const { rules, actions } = useAdmin();
  const toast = useToast();
  const [n, setN] = useState({ when: 'payout-waiting', value: 24, then: 'alert-finance' });
  return (
    <>
      <PageHead title="Automation" sub="Rules run on the server every few minutes in the live app. Here you can switch them on/off and add new ones." />
      <div className="stack g8">
        {rules.map((r) => (
          <div key={r.id} className="card row between g12" style={{ opacity: r.on ? 1 : 0.6 }}>
            <span className="stack g4" style={{ flex: '1 1 300px' }}><strong className="small">{r.label}</strong><span className="xs faint">Ran {r.runs} time{r.runs === 1 ? '' : 's'} in the last 7 days</span></span>
            <span className="row g8">
              <button type="button" role="switch" aria-checked={r.on} aria-label={`Rule on: ${r.label}`} className="btn btn-outline" style={{ minHeight: 36 }} onClick={() => actions.rules(rules.map((x) => (x.id === r.id ? { ...x, on: !x.on } : x)), `${r.on ? 'Turned off' : 'Turned on'} rule: ${r.label}`)}>{r.on ? 'On' : 'Off'}</button>
              <button type="button" className="btn btn-danger-soft" onClick={() => { actions.rules(rules.filter((x) => x.id !== r.id), `Deleted rule: ${r.label}`); toast('Rule deleted'); }}>Delete</button>
            </span>
          </div>
        ))}
      </div>
      <form className="card stack g12" onSubmit={(e) => { e.preventDefault(); const r = { id: `r${Date.now()}`, on: true, runs: 0, ...n, label: label(n) }; actions.rules([...rules, r], `Created rule: ${r.label}`); toast('Rule created'); }}>
        <strong>New rule</strong>
        <div className="row g8" style={{ alignItems: 'flex-end' }}>
          <div className="field" style={{ flex: '2 1 240px' }}><label htmlFor="aw" className="label">When</label><select id="aw" className="input" style={{ height: 42 }} value={n.when} onChange={(e) => setN({ ...n, when: e.target.value })}>{Object.entries(WHEN).map(([k, [l]]) => <option key={k} value={k}>{l}</option>)}</select></div>
          <div className="field" style={{ flex: '0 1 120px' }}><label htmlFor="av" className="label">{WHEN[n.when][1]}</label><input id="av" className="input" type="number" min={1} style={{ height: 42 }} value={n.value} onChange={(e) => setN({ ...n, value: Math.max(1, +e.target.value || 1) })} /></div>
          <div className="field" style={{ flex: '2 1 240px' }}><label htmlFor="at" className="label">Then</label><select id="at" className="input" style={{ height: 42 }} value={n.then} onChange={(e) => setN({ ...n, then: e.target.value })}>{Object.entries(THEN).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></div>
        </div>
        <span className="small muted">Reads as: <strong>{label(n)}</strong></span>
        <button type="submit" className="btn btn-ink" style={{ alignSelf: 'flex-start' }}>Create rule</button>
      </form>
    </>
  );
}
