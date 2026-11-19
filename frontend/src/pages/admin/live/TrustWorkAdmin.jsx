// Admin → Skill checks → Vetting Trust → Work tests & reliability (T15). The three banks (typing, situational judgement,
// aptitude; English / Hindi / Telugu, 2 forms each) with their validation, attempts by test / language, how many people
// the aptitude "top X%" compares with (provisional cut scores until enough), the latest results (with the typing /
// integrity signals for a person), the reliability record counts and the disputes to decide (count it / remove it),
// and "Run the reliability pass now". /api/admin/trust/worktests
import { useState } from 'react';
import { useToast } from '../../../components/ui';
import { Loading, http, useAction, useApi, when } from './common';

const NAMES = { typing: 'Typing', sjt: 'Situational judgement', aptitude: 'Aptitude' };

function Dispute({ x, reload }) {
  const toast = useToast();
  const [busy, run] = useAction(toast);
  const [note, setNote] = useState('');
  const decide = (decision) => run(async () => { await http(`/api/admin/trust/worktests/disputes/${encodeURIComponent(x.id)}`, { method: 'POST', body: { decision, note } }); reload(); },
    decision === 'count' ? 'The company’s answer stands' : 'Removed from the record');
  return (
    <li className="card stack g8" data-testid="tw-dispute">
      <strong className="small">{x.user.name} · {x.what} · {x.company}{x.role ? ` · ${x.role}` : ''}</strong>
      <span className="xs">Company said: no · {when(x.at)}{x.note ? ` · “${x.note}”` : ''}</span>
      <span className="xs">Candidate: {x.dispute}{x.disputeText ? ` · “${x.disputeText}”` : ''}</span>
      <input className="input" maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Note (what you checked)" aria-label="Note" style={{ minHeight: 44 }} />
      <div className="row g8" style={{ flexWrap: 'wrap' }}>
        <button type="button" className="btn btn-outline" style={{ minHeight: 44 }} disabled={busy} onClick={() => decide('count')} data-testid="tw-count">Count it</button>
        <button type="button" className="btn btn-signal" style={{ minHeight: 44 }} disabled={busy} onClick={() => decide('remove')} data-testid="tw-remove">Remove it</button>
      </div>
    </li>
  );
}

export default function TrustWorkAdmin() {
  const st = useApi('/api/admin/trust/worktests');
  const toast = useToast();
  const [busy, run] = useAction(toast);
  return (
    <section className="card stack g12" aria-labelledby="tw-h" data-testid="tw-admin">
      <h2 id="tw-h" className="h3" style={{ margin: 0 }}>Work tests &amp; reliability (T15)</h2>
      <Loading st={st}>{(d) => (
        <>
          <p className="small" style={{ margin: 0 }}>Typing, situational judgement and aptitude in English, Hindi and Telugu. Graded by fixed rules (no AI). Aptitude “top X%” compares with {d.norms.people} people{d.norms.people < d.norms.needed ? ` (provisional cut scores until ${d.norms.needed})` : ''}.</p>
          <div className="table-wrap mtable-wrap vt-scroll">
            <table className="table mtable vt-table">
              <thead><tr><th>Bank</th><th>Forms</th><th>Items per form</th><th>Check</th></tr></thead>
              <tbody>{d.banks.map((b) => (
                <tr key={b.test} data-testid={`tw-bank-${b.test}`}>
                  <th scope="row" className="small">{NAMES[b.test]} · EN / HI / TE</th>
                  <td data-label="Forms">{b.forms.join(', ')}</td>
                  <td data-label="Items per form">{b.items.join(' / ')}</td>
                  <td data-label="Check">{b.ok ? <span className="mchip mchip-ok">Valid</span> : <span className="mchip mchip-warn" title={b.problems.join('\n')}>{b.problems.length} problems</span>}</td>
                </tr>
              ))}</tbody>
            </table>
          </div>
          <p className="xs" style={{ margin: 0 }} data-testid="tw-counts">Attempts: {Object.entries(d.counts).map(([k, v]) => `${k.replaceAll('_', ' ')} ${v}`).join(' · ') || 'none yet'}</p>
          {d.latest.length > 0 && (
            <div className="table-wrap mtable-wrap vt-scroll">
              <table className="table mtable vt-table">
                <thead><tr><th>Person</th><th>Test</th><th>Result</th><th>Badge</th><th>Signals</th></tr></thead>
                <tbody>{d.latest.map((r) => (
                  <tr key={r.id} data-testid="tw-result">
                    <th scope="row" className="small">{r.user.name}<span className="xs faint"> · {when(r.at)}</span></th>
                    <td data-label="Test">{NAMES[r.test]} ({r.lang}, {r.form})</td>
                    <td data-label="Result">{r.test === 'typing' ? `${r.wpm} wpm · ${r.accuracy}%` : `${r.score}/100`}</td>
                    <td data-label="Badge">{r.badge || '—'}</td>
                    <td data-label="Signals" className="xs">{[...r.rawFlags, ...r.integrityReasons].join(', ') || '—'}</td>
                  </tr>
                ))}</tbody>
              </table>
            </div>
          )}
          <h3 className="h4" style={{ margin: 0 }}>Reliability record</h3>
          <p className="xs" style={{ margin: 0 }}>A company’s “no” waits {d.rules.windowHours} hours for the candidate’s side; disputes (within {d.rules.disputeDays} days) come here. Counts: {Object.entries(d.reliability.counts).map(([k, v]) => `${k.replaceAll('_', ' ')} ${v}`).join(' · ') || 'none yet'}</p>
          {d.reliability.disputes.length ? <ul className="stack g8" style={{ listStyle: 'none', padding: 0, margin: 0 }}>{d.reliability.disputes.map((x) => <Dispute key={x.id} x={x} reload={st.reload} />)}</ul>
            : <p className="small muted" style={{ margin: 0 }} data-testid="tw-no-disputes">No disputes to decide.</p>}
          <button type="button" className="btn btn-outline" style={{ minHeight: 44, alignSelf: 'flex-start' }} disabled={busy} onClick={() => run(async () => { await http('/api/admin/trust/worktests/run', { method: 'POST' }); st.reload(); }, 'Reliability pass ran')} data-testid="tw-run">Run the reliability pass now</button>
        </>
      )}</Loading>
    </section>
  );
}
