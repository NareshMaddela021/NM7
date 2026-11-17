// Auto Apply 2.0 (A7) numbers, shared by Admin → Daily report (the "Auto Apply" section, from the snapshot) and Admin →
// Auto Apply (counted now): per channel sent / delivered / failed with reply and interview rates, and the success
// measures with their targets as plain Met / Not met / No data yet (backend: app/autoapply/stats.py).
import '../../../styles/admin-aa-numbers.css';

// its own formatter and stylesheet: nothing shared with the report's chunk, so the main bundle's import map stays the same
const num = (v) => (v == null ? '—' : Number(v).toLocaleString('en-IN'));

const MSTATE = { met: ['mchip-ok', 'Met'], miss: ['mchip-bad', 'Not met'], none: ['mchip-neutral', 'No data yet'] };
const AA_COUNT = new Set(['perSeeker', 'companyComplaints']);

/** Auto Apply 2.0 (A7): per channel for the last 7 days, and the success measures with plain met / not met. Also on
 * Admin → Auto Apply (same numbers). */
export default function AutoApplyNumbers({ aa }) {
  if (!aa) return <span className="small muted" data-testid="dr-aa-none">No Auto Apply numbers in this snapshot yet. Press Refresh now.</span>;
  return (
    <div className="stack g12" data-testid="dr-aa">
      <ul className="aan-channels" data-testid="dr-aa-channels">
        {aa.channels.map((c) => (
          <li key={c.key} className="aan-ch" data-testid="dr-aa-ch" data-channel={c.key}>
            <strong className="small">{c.label}</strong>
            <span className="aan-nums small"><span><b>{num(c.sent)}</b> sent</span><span><b>{num(c.delivered)}</b> delivered</span><span className={c.failed ? 'aan-bad' : ''}><b>{num(c.failed)}</b> failed</span></span>
            <span className="xs muted">Replies {c.replyRate == null ? '—' : `${c.replyRate}%`} · interviews {c.interviewRate == null ? '—' : `${c.interviewRate}%`}</span>
          </li>
        ))}
      </ul>
      <div className="stack g8">
        <h3 className="aan-h3">Success measures</h3>
        <ul className="aan-measures" data-testid="dr-aa-measures">
          {aa.measures.map((x) => (
            <li key={x.key} className="aan-measure" data-testid="dr-aa-measure" data-key={x.key} data-state={x.state}>
              <span className="aan-measure-l">{x.label}{x.note && <span className="xs muted" style={{ display: 'block' }}>{x.note}</span>}</span>
              <span className="aan-measure-v">{x.value == null ? '—' : AA_COUNT.has(x.key) ? num(x.value) : `${x.value}%`}<span className="xs muted"> / target {x.target}</span></span>
              <span className={`mchip ${MSTATE[x.state][0]}`}>{MSTATE[x.state][1]}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
