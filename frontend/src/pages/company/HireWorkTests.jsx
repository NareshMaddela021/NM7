// Vetting Trust T15 in Hire now: the work-test filters ("Typing 35 wpm+", "SJT: strong", "Aptitude: top 30%") with how
// many people each would leave, and each person's work-test badges and reliability record ("Showed up 4/4 · Joined
// 2/2 · confirmed by employers", or "No history yet" — never a negative, and there is no filter on it). Shown only when
// the shortlist answer carries `workTests` (the Trust switch lets the company in). Statically imported by CompanyHire.

/** "Showed up 4/4 · Joined 2/2 · confirmed by employers", or "No history yet" (kept here so no chunk is shared). */
export const recordLine = (rec) => (!rec ? '' : rec.empty ? rec.text : `${rec.text} · ${rec.source}`);
import { IcCheck } from '../../components/icons';

export const WT_NONE = { typing: 0, sjt: '', aptitude: '' };

/** The query parameters for the work-test filters (only the ones that are on). */
export function workQuery(q, f) {
  if (Number(f.typing) > 0) q.set('typing', String(f.typing));
  if (f.sjt) q.set('sjt', f.sjt);
  if (f.aptitude) q.set('aptitude', f.aptitude);
  return q;
}
const n = (c) => (c == null ? '' : ` (${c})`);

export function WorkFilters({ f, setF, counts = {} }) {
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value }));
  return (
    <fieldset className="hn-sv hn-nt" data-testid="co-hire-wt-filters">
      <legend className="hn-sv-legend">Work tests <span className="xs muted">· measured by Nm7 tests</span></legend>
      <label className="field hn-field"><span className="label">Typing{n(counts.typing)}</span>
        <select className="input" value={f.typing} onChange={set('typing')} data-testid="co-hire-wt-typing">
          <option value={0}>Any (or not taken)</option>
          {[25, 35, 45].map((w) => <option key={w} value={w}>Typing {w} wpm+</option>)}
        </select>
      </label>
      <label className="field hn-field"><span className="label">Situational judgement{n(counts.sjt)}</span>
        <select className="input" value={f.sjt} onChange={set('sjt')} data-testid="co-hire-wt-sjt">
          <option value="">Any (or not taken)</option>
          <option value="good">SJT: good or strong</option>
          <option value="strong">SJT: strong</option>
        </select>
      </label>
      <label className="field hn-field"><span className="label">Aptitude{n(counts.aptitude)}</span>
        <select className="input" value={f.aptitude} onChange={set('aptitude')} data-testid="co-hire-wt-aptitude">
          <option value="">Any (or not taken)</option>
          <option value="top50">Aptitude: top 50%</option>
          <option value="top30">Aptitude: top 30%</option>
          <option value="top10">Aptitude: top 10%</option>
        </select>
      </label>
      <span className="xs muted" style={{ flexBasis: '100%' }}>The reliability record is a signal only: there is no filter on it, and “No history yet” is never held against anyone.</span>
      {(Number(f.typing) > 0 || f.sjt || f.aptitude) && <button type="button" className="btn btn-outline hn-clear" onClick={() => setF(WT_NONE)} data-testid="co-hire-wt-clear">Clear work-test filters</button>}
    </fieldset>
  );
}

/** One person's work-test badges and reliability record as chips, each with its source. */
export function WorkChips({ w, rec }) {
  const chips = [];
  if (w?.typing) chips.push(['ok', `${w.typing.label} · ${w.typing.wpm} wpm, ${w.typing.accuracy}% accuracy`, 'typing']);
  if (w?.sjt) chips.push(['ok', `${w.sjt.label}`, 'sjt']);
  if (w?.aptitude) chips.push(['ok', `${w.aptitude.label}`, 'aptitude']);
  if (rec) chips.push([rec.empty ? 'neutral' : 'info', recordLine(rec), 'record']);
  if (!chips.length) return null;
  return (
    <ul className="hn-chips" aria-label="Work tests and reliability" data-testid="co-hire-wt">
      {chips.map(([tone, text, k]) => <li key={k} className={`mchip mchip-${tone}`} data-testid={`co-hire-wt-${k}`} style={{ whiteSpace: 'normal', overflowWrap: 'anywhere', maxWidth: '100%' }}>{tone === 'ok' && <IcCheck size={14} />} {text}</li>)}
    </ul>
  );
}
